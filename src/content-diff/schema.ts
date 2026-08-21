import type { CmaClient } from '@datocms/cli-utils';
import {
  canonicalizeJson,
  semanticHash,
  stableStringify,
} from './canonicalize';
import type {
  FieldSchemaSnapshot,
  ItemTypeSchemaSnapshot,
  ItemTypeSelection,
  JsonObject,
  SchemaSnapshot,
  WorkflowSchemaSnapshot,
} from './types';
import { ContentDiffError, DEFAULT_CONTENT_DIFF_MODEL_API_KEY } from './types';

export async function fetchSchemaSnapshot(
  client: CmaClient.Client,
  environmentId: string,
): Promise<SchemaSnapshot> {
  const [site, itemTypes, workflows] = await Promise.all([
    client.site.find(),
    client.itemTypes.list(),
    client.workflows.list(),
  ]);
  const fieldLists = await mapWithConcurrency(itemTypes, 5, async (itemType) =>
    client.fields.list(itemType.id),
  );
  const fieldsByItemType = new Map(
    itemTypes.map((itemType, index) => [itemType.id, fieldLists[index]]),
  );
  const normalizedItemTypes = itemTypes
    .map((itemType) =>
      normalizeItemType(itemType, fieldsByItemType.get(itemType.id) ?? []),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const normalizedWorkflows = workflows
    .map(normalizeWorkflow)
    .sort((left, right) => left.id.localeCompare(right.id));

  const snapshot: SchemaSnapshot = {
    siteId: site.id,
    environmentId,
    locales: [...site.locales],
    environmentSemantics: {
      timezone: site.timezone,
      improvedTimezoneManagement: site.meta.improved_timezone_management,
      improvedBooleanFields: site.meta.improved_boolean_fields,
      improvedValidationAtPublishing:
        site.meta.improved_validation_at_publishing,
      millisecondsInDatetime: site.meta.milliseconds_in_datetime,
      nonLocalizedFocalPoints: site.meta.non_localized_focal_points,
      improvedHexManagement: site.meta.improved_hex_management,
    },
    itemTypes: normalizedItemTypes,
    workflows: normalizedWorkflows,
    digest: '',
  };

  snapshot.digest = computeSchemaDigest(snapshot);

  return snapshot;
}

export function schemaForScope(
  schema: SchemaSnapshot,
  selection: ItemTypeSelection,
  migrationsModelApiKey?: string,
  contentDiffModelApiKey: string = DEFAULT_CONTENT_DIFF_MODEL_API_KEY,
): SchemaSnapshot {
  const selected = resolveItemTypeSelection(
    schema,
    selection,
    migrationsModelApiKey,
    contentDiffModelApiKey,
  );

  const allById = new Map(
    schema.itemTypes.map((itemType) => [itemType.id, itemType]),
  );
  const includedIds = new Set(selected.map(({ id }) => id));
  const internalModelId = schema.itemTypes.find(
    ({ apiKey }) => apiKey === contentDiffModelApiKey,
  )?.id;
  let changed = true;

  // Field validators contain every allowed record/block model relationship.
  // Following those IDs keeps the digest scoped while still including nested
  // block schemas and linked-model constraints needed by the generated plan.
  while (changed) {
    changed = false;

    for (const itemTypeId of [...includedIds]) {
      const itemType = allById.get(itemTypeId);

      if (!itemType) {
        continue;
      }

      for (const field of itemType.fields) {
        for (const candidate of referencedItemTypeIds(field.validators)) {
          if (candidate === internalModelId) {
            throw new ContentDiffError(
              'INVALID_SCOPE',
              `Managed field ${field.id} refers to reserved internal model ${contentDiffModelApiKey}.`,
              { itemTypeId, fieldId: field.id, contentDiffModelApiKey },
            );
          }
          if (allById.has(candidate) && !includedIds.has(candidate)) {
            includedIds.add(candidate);
            changed = true;
          }
        }
      }
    }
  }

  const itemTypes = schema.itemTypes.filter(({ id }) => includedIds.has(id));
  const workflowIds = new Set(
    itemTypes
      .map(({ workflowId }) => workflowId)
      .filter((id): id is string => Boolean(id)),
  );
  const scoped: SchemaSnapshot = {
    siteId: schema.siteId,
    environmentId: schema.environmentId,
    locales: [...schema.locales],
    environmentSemantics: { ...schema.environmentSemantics },
    itemTypes,
    workflows: schema.workflows.filter(({ id }) => workflowIds.has(id)),
    digest: '',
  };

  scoped.digest = computeSchemaDigest(scoped);

  return scoped;
}

export function resolveItemTypeSelection(
  schema: SchemaSnapshot,
  selection: ItemTypeSelection,
  migrationsModelApiKey?: string,
  contentDiffModelApiKey: string = DEFAULT_CONTENT_DIFF_MODEL_API_KEY,
): ItemTypeSchemaSnapshot[] {
  const migrationsModelId = migrationsTrackingModelId(
    schema,
    migrationsModelApiKey,
  );
  const regularItemTypes = schema.itemTypes.filter(
    (itemType) =>
      !itemType.modularBlock &&
      itemType.id !== migrationsModelId &&
      itemType.apiKey !== contentDiffModelApiKey,
  );
  let selected: ItemTypeSchemaSnapshot[];

  if (selection === 'all') {
    selected = regularItemTypes;
  } else {
    const bySelector = new Map<string, ItemTypeSchemaSnapshot>();

    for (const itemType of regularItemTypes) {
      bySelector.set(itemType.id, itemType);
      bySelector.set(itemType.apiKey, itemType);
    }

    selected = selection.map((selector) => {
      const itemType = bySelector.get(selector);

      if (!itemType) {
        throw new ContentDiffError(
          'INVALID_SCOPE',
          `Cannot find a regular model with ID or API key "${selector}".`,
          { selector },
        );
      }

      return itemType;
    });
  }

  if (selected.length === 0) {
    throw new ContentDiffError(
      'INVALID_SCOPE',
      'The selected content scope does not contain any regular models.',
    );
  }

  return [
    ...new Map(selected.map((itemType) => [itemType.id, itemType])).values(),
  ].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Returns the configured core CLI tracking model only when it is safe to
 * exclude from authoritative content/referrer reads. The runner itself treats
 * this API key as internal, so a conflicting user model must fail closed.
 */
export function migrationsTrackingModelId(
  schema: SchemaSnapshot,
  migrationsModelApiKey?: string,
): string | undefined {
  if (!migrationsModelApiKey) return undefined;
  const model = schema.itemTypes.find(
    ({ apiKey }) => apiKey === migrationsModelApiKey,
  );
  if (!model) return undefined;

  const nameField = model.fields[0];
  const exact =
    model.name === 'Schema migration' &&
    model.modularBlock === false &&
    model.singleton === false &&
    model.sortable === false &&
    model.tree === false &&
    model.draftModeActive === false &&
    model.draftSavingActive === false &&
    model.allLocalesRequired === false &&
    model.workflowId === null &&
    model.fields.length === 1 &&
    nameField?.apiKey === 'name' &&
    nameField.fieldType === 'string' &&
    nameField.localized === false &&
    nameField.defaultValue === null &&
    stableStringify(nameField.validators) === stableStringify({ required: {} });

  if (!exact) {
    throw new ContentDiffError(
      'INVALID_MIGRATIONS_MODEL',
      `Configured migrations model ${migrationsModelApiKey} does not match the exact internal tracking-model contract created by migrations:run.`,
      { migrationsModelApiKey, itemTypeId: model.id },
    );
  }

  return model.id;
}

/**
 * Digest algorithm shared with the generated runtime. Provenance fields are
 * intentionally excluded so a fork of the baseline remains compatible.
 */
export function computeSchemaDigest(schema: SchemaSnapshot): string {
  return semanticHash(schemaSemanticState(schema));
}

export function schemaSemanticState(schema: SchemaSnapshot): JsonObject {
  return canonicalizeJson({
    locales: schema.locales,
    environmentSemantics: schema.environmentSemantics,
    itemTypes: schema.itemTypes.map((itemType) => ({
      id: itemType.id,
      apiKey: itemType.apiKey,
      modularBlock: itemType.modularBlock,
      singleton: itemType.singleton,
      sortable: itemType.sortable,
      tree: itemType.tree,
      draftModeActive: itemType.draftModeActive,
      draftSavingActive: itemType.draftSavingActive,
      allLocalesRequired: itemType.allLocalesRequired,
      workflowId: itemType.workflowId,
      fields: itemType.fields.map((field) => ({
        id: field.id,
        apiKey: field.apiKey,
        fieldType: field.fieldType,
        localized: field.localized,
        position: field.position,
        defaultValue:
          field.defaultValue === undefined ? null : field.defaultValue,
        validators: field.validators,
      })),
    })),
    workflows: schema.workflows.map((workflow) => ({
      id: workflow.id,
      apiKey: workflow.apiKey,
      stages: workflow.stages,
    })),
  }) as JsonObject;
}

export function assertSchemasCompatible(
  source: SchemaSnapshot,
  target: SchemaSnapshot,
): void {
  assertSameProject(source, target);

  if (
    stableStringify(source.environmentSemantics) !==
    stableStringify(target.environmentSemantics)
  ) {
    const keys = Object.keys(source.environmentSemantics).filter(
      (key) =>
        source.environmentSemantics[
          key as keyof SchemaSnapshot['environmentSemantics']
        ] !==
        target.environmentSemantics[
          key as keyof SchemaSnapshot['environmentSemantics']
        ],
    );
    throw new ContentDiffError(
      'ENVIRONMENT_SEMANTICS_MISMATCH',
      `Source environment "${
        source.environmentId
      }" and destination environment "${
        target.environmentId
      }" have incompatible content serialization or validation settings (${keys.join(
        ', ',
      )}). Align the environment activations/settings before generating a content diff; schema autogeneration alone may not repair this mismatch. No content records were read.`,
      {
        sourceEnvironmentId: source.environmentId,
        destinationEnvironmentId: target.environmentId,
        mismatchedSettings: keys,
      },
    );
  }

  if (source.digest !== target.digest) {
    throw schemaMismatch(source, target);
  }
}

export function assertSameProject(
  source: SchemaSnapshot,
  target: SchemaSnapshot,
): void {
  if (source.siteId !== target.siteId) {
    throw new ContentDiffError(
      'CROSS_PROJECT',
      'Content diff only supports environments from the same DatoCMS project.',
      {
        sourceSiteId: source.siteId,
        targetSiteId: target.siteId,
        sourceEnvironmentId: source.environmentId,
        destinationEnvironmentId: target.environmentId,
      },
    );
  }
}

export function schemaMismatch(
  source: Pick<SchemaSnapshot, 'environmentId'>,
  target: Pick<SchemaSnapshot, 'environmentId'>,
): ContentDiffError {
  return new ContentDiffError(
    'SCHEMA_MISMATCH',
    `Source environment "${source.environmentId}" and destination environment "${target.environmentId}" do not have identical managed schemas. Apply a schema migration first, then regenerate the content diff. No content records were read.`,
    {
      sourceEnvironmentId: source.environmentId,
      destinationEnvironmentId: target.environmentId,
    },
  );
}

function normalizeItemType(
  input: CmaClient.ApiTypes.ItemType,
  fields: CmaClient.ApiTypes.Field[],
): ItemTypeSchemaSnapshot {
  return {
    id: input.id,
    apiKey: input.api_key,
    name: input.name,
    modularBlock: input.modular_block,
    singleton: input.singleton,
    sortable: input.sortable,
    tree: input.tree,
    draftModeActive: input.draft_mode_active,
    draftSavingActive: input.draft_saving_active,
    allLocalesRequired: input.all_locales_required,
    workflowId: input.workflow?.id ?? null,
    fields: fields
      .map(normalizeField)
      .sort(
        (left, right) =>
          left.position - right.position || left.id.localeCompare(right.id),
      ),
  };
}

function normalizeField(input: CmaClient.ApiTypes.Field): FieldSchemaSnapshot {
  return {
    id: input.id,
    apiKey: input.api_key,
    fieldType: input.field_type,
    localized: input.localized,
    position: input.position,
    defaultValue:
      input.default_value === undefined
        ? null
        : canonicalizeJson(input.default_value),
    validators: canonicalizeJson(input.validators) as JsonObject,
  };
}

function normalizeWorkflow(
  input: CmaClient.ApiTypes.Workflow,
): WorkflowSchemaSnapshot {
  return {
    id: input.id,
    apiKey: input.api_key,
    stages: input.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      initial: stage.initial === true,
    })),
  };
}

const ITEM_TYPE_REFERENCE_VALIDATORS = new Set([
  'item_item_type',
  'items_item_type',
  'rich_text_blocks',
  'single_block_blocks',
  'structured_text_blocks',
  'structured_text_inline_blocks',
  'structured_text_links',
]);

function referencedItemTypeIds(validators: JsonObject): string[] {
  const result = new Set<string>();

  for (const [validatorKey, configuration] of Object.entries(validators)) {
    if (
      !ITEM_TYPE_REFERENCE_VALIDATORS.has(validatorKey) ||
      !configuration ||
      typeof configuration !== 'object' ||
      Array.isArray(configuration)
    ) {
      continue;
    }

    const itemTypes = configuration.item_types;

    if (!Array.isArray(itemTypes)) continue;

    for (const itemTypeId of itemTypes) {
      if (typeof itemTypeId === 'string') result.add(itemTypeId);
    }
  }

  return [...result].sort();
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const output = new Array<Output>(values.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        output[index] = await mapper(values[index], index);
      }
    },
  );

  await Promise.all(workers);

  return output;
}
