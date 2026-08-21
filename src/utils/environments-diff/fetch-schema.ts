import type { CmaClient } from '@datocms/cli-utils';
import type { Schema } from './types';

/**
 * Internal bookkeeping owned by the content-diff plugin. It is deliberately
 * outside the user-managed schema so a mapping ledger created in one
 * environment never becomes a schema migration create/delete operation.
 */
export const CONTENT_DIFF_MAPPING_MODEL_API_KEY = 'datocms_content_diff';

const ITEM_TYPE_REFERENCE_VALIDATORS = new Set([
  'item_item_type',
  'items_item_type',
  'rich_text_blocks',
  'single_block_blocks',
  'structured_text_blocks',
  'structured_text_inline_blocks',
  'structured_text_links',
]);

export async function fetchSchema(client: CmaClient.Client): Promise<Schema> {
  const [
    siteResponse,
    menuItemsResponse,
    schemaMenuItemsResponse,
    pluginsResponse,
    workflowsResponse,
    itemTypeFiltersResponse,
    uploadFiltersResponse,
  ] = await Promise.all([
    client.site.rawFind({
      include: 'item_types,item_types.fields,item_types.fieldsets',
    }),
    client.menuItems.rawList(),
    client.schemaMenuItems.rawList(),
    client.plugins.rawList(),
    client.workflows.rawList(),
    client.itemTypeFilters.rawList(),
    client.uploadFilters.rawList(),
  ]);

  const includedResources = siteResponse.included || [];

  const internalItemTypes = includedResources.filter(
    (resource): resource is CmaClient.RawApiTypes.ItemType =>
      resource.type === 'item_type' &&
      resource.attributes.api_key === CONTENT_DIFF_MAPPING_MODEL_API_KEY,
  );
  const internalItemTypeIds = new Set(internalItemTypes.map(({ id }) => id));

  const allFields = includedResources.filter(
    (x): x is CmaClient.RawApiTypes.Field => x.type === 'field',
  );

  const allFieldsets: CmaClient.RawApiTypes.Fieldset[] =
    includedResources.filter(
      (x): x is CmaClient.RawApiTypes.Fieldset => x.type === 'fieldset',
    );

  assertContentDiffMappingModelContract({
    itemTypes: internalItemTypes,
    fields: allFields,
    fieldsets: allFieldsets,
    menuItems: menuItemsResponse.data,
    schemaMenuItems: schemaMenuItemsResponse.data,
    itemTypeFilters: itemTypeFiltersResponse.data,
  });

  const schemaMenuItems = withoutInternalSchemaMenuItems(
    schemaMenuItemsResponse.data,
    internalItemTypeIds,
  );
  const menuItems = withoutInternalMenuItems(
    menuItemsResponse.data,
    internalItemTypeIds,
  );
  const internalItemTypeFilters = itemTypeFiltersResponse.data.filter((itf) =>
    internalItemTypeIds.has(itf.relationships.item_type.data.id),
  );

  if (internalItemTypeFilters.length > 0) {
    throw internalNavigationConflict(
      'item-type filters',
      internalItemTypeFilters.map(({ id }) => id),
    );
  }

  return {
    siteEntity: siteResponse.data,
    internalItemTypeIds: [...internalItemTypeIds].sort(),
    itemTypesById: Object.fromEntries(
      includedResources
        .filter(
          (x): x is CmaClient.RawApiTypes.ItemType =>
            x.type === 'item_type' && !internalItemTypeIds.has(x.id),
        )
        .map((itemType) => [
          itemType.id,
          {
            entity: itemType,
            fieldsById: Object.fromEntries(
              allFields
                .filter(
                  (f) => f.relationships.item_type.data.id === itemType.id,
                )
                .map((field) => [field.id, field]),
            ),
            fieldsetsById: Object.fromEntries(
              allFieldsets
                .filter(
                  (f) => f.relationships.item_type.data.id === itemType.id,
                )
                .map((fieldset) => [fieldset.id, fieldset]),
            ),
          },
        ]),
    ),
    menuItemsById: Object.fromEntries(
      menuItems.map((menuItem) => [menuItem.id, menuItem]),
    ),
    schemaMenuItemsById: Object.fromEntries(
      schemaMenuItems.map((schemaMenuItem) => [
        schemaMenuItem.id,
        schemaMenuItem,
      ]),
    ),
    pluginsById: Object.fromEntries(
      pluginsResponse.data.map((plugin) => [plugin.id, plugin]),
    ),
    workflowsById: Object.fromEntries(
      workflowsResponse.data.map((workflow) => [workflow.id, workflow]),
    ),
    itemTypeFiltersById: Object.fromEntries(
      itemTypeFiltersResponse.data
        .filter((itf) => itf.attributes.shared)
        .map((itemTypeFilter) => [itemTypeFilter.id, itemTypeFilter]),
    ),
    uploadFiltersById: Object.fromEntries(
      uploadFiltersResponse.data
        .filter((itf) => itf.attributes.shared)
        .map((uploadFilter) => [uploadFilter.id, uploadFilter]),
    ),
  };
}

function assertContentDiffMappingModelContract({
  itemTypes,
  fields,
  fieldsets,
  menuItems,
  schemaMenuItems,
  itemTypeFilters,
}: {
  itemTypes: CmaClient.RawApiTypes.ItemType[];
  fields: CmaClient.RawApiTypes.Field[];
  fieldsets: CmaClient.RawApiTypes.Fieldset[];
  menuItems: CmaClient.RawApiTypes.MenuItem[];
  schemaMenuItems: CmaClient.RawApiTypes.SchemaMenuItem[];
  itemTypeFilters: CmaClient.RawApiTypes.ItemTypeFilter[];
}): void {
  if (itemTypes.length === 0) return;

  const itemType = itemTypes[0];
  const modelFields = fields.filter(
    (field) => field.relationships.item_type.data.id === itemType.id,
  );
  const modelFieldsets = fieldsets.filter(
    (fieldset) => fieldset.relationships.item_type.data.id === itemType.id,
  );
  const modelMenuItems = menuItems.filter(
    (item) => item.relationships.item_type.data?.id === itemType.id,
  );
  const modelSchemaMenuItems = schemaMenuItems.filter(
    (item) => item.relationships.item_type.data?.id === itemType.id,
  );
  const modelFilters = itemTypeFilters.filter(
    (filter) => filter.relationships.item_type.data.id === itemType.id,
  );
  const inboundReferenceFields = fields.filter(
    (field) =>
      field.relationships.item_type.data.id !== itemType.id &&
      Object.entries(field.attributes.validators).some(
        ([validator, configuration]) =>
          ITEM_TYPE_REFERENCE_VALIDATORS.has(validator) &&
          configuration &&
          typeof configuration === 'object' &&
          'item_types' in configuration &&
          Array.isArray(configuration.item_types) &&
          configuration.item_types.includes(itemType.id),
      ),
  );
  const byApiKey = new Map(
    modelFields.map((field) => [field.attributes.api_key, field]),
  );
  const nameField = byApiKey.get('name');
  const mappingField = byApiKey.get('mapping');
  const modelIsExact =
    itemTypes.length === 1 &&
    itemType.attributes.name === 'Content diff' &&
    itemType.attributes.api_key === CONTENT_DIFF_MAPPING_MODEL_API_KEY &&
    itemType.attributes.singleton === false &&
    itemType.attributes.modular_block === false &&
    itemType.attributes.draft_mode_active === true &&
    itemType.attributes.draft_saving_active === false &&
    itemType.attributes.sortable === false &&
    itemType.attributes.tree === false &&
    itemType.attributes.all_locales_required === false &&
    itemType.attributes.inverse_relationships_enabled === false &&
    itemType.attributes.collection_appearance === 'compact' &&
    itemType.attributes.ordering_direction === null &&
    itemType.attributes.ordering_meta === null &&
    itemType.attributes.has_singleton_item === false &&
    itemType.attributes.hint === null &&
    itemType.relationships.workflow.data === null &&
    itemType.relationships.singleton_item.data === null &&
    itemType.relationships.ordering_field.data === null &&
    itemType.relationships.presentation_title_field.data?.id ===
      nameField?.id &&
    itemType.relationships.title_field.data?.id === nameField?.id &&
    itemType.relationships.presentation_image_field.data === null &&
    itemType.relationships.image_preview_field.data === null &&
    itemType.relationships.excerpt_field.data === null;
  const nameFieldIsExact =
    nameField?.attributes.label === 'Name' &&
    nameField.attributes.field_type === 'string' &&
    nameField.attributes.localized === false &&
    nameField.attributes.position === 1 &&
    fieldHasExactInternalDefaults(nameField, 'single_line', {
      heading: false,
      placeholder: null,
    }) &&
    hasExactlyValidatorKeys(nameField.attributes.validators, [
      'required',
      'unique',
    ]);
  const mappingFieldIsExact =
    mappingField?.attributes.label === 'Mapping' &&
    mappingField.attributes.field_type === 'json' &&
    mappingField.attributes.localized === false &&
    mappingField.attributes.position === 2 &&
    fieldHasExactInternalDefaults(mappingField, 'json', {}) &&
    hasExactlyValidatorKeys(mappingField.attributes.validators, ['required']);
  const schemaMenuIsExact =
    modelSchemaMenuItems.length === 1 &&
    modelSchemaMenuItems[0].relationships.parent.data === null &&
    modelSchemaMenuItems[0].relationships.children.data.length === 0;

  if (
    !modelIsExact ||
    modelFields.length !== 2 ||
    !nameFieldIsExact ||
    !mappingFieldIsExact ||
    modelFieldsets.length > 0 ||
    modelMenuItems.length > 0 ||
    !schemaMenuIsExact ||
    modelFilters.length > 0 ||
    inboundReferenceFields.length > 0
  ) {
    throw new Error(
      `The reserved model API key "${CONTENT_DIFF_MAPPING_MODEL_API_KEY}" is not the exact internal content-diff mapping contract. Rerun the content migration that created it if setup was interrupted, or rename the conflicting model before generating a schema migration.`,
    );
  }
}

function fieldHasExactInternalDefaults(
  field: CmaClient.RawApiTypes.Field,
  editor: string,
  expectedParameters: Record<string, unknown>,
): boolean {
  const appearance = field.attributes.appearance as {
    addons?: unknown;
    editor?: unknown;
    parameters?: unknown;
  };
  const parameters = appearance?.parameters;

  return (
    field.attributes.default_value === null &&
    field.attributes.hint === null &&
    field.attributes.deep_filtering_enabled === false &&
    'content_link_enabled' in field.attributes &&
    field.attributes.content_link_enabled === true &&
    field.relationships.fieldset.data === null &&
    Array.isArray(appearance?.addons) &&
    appearance.addons.length === 0 &&
    appearance.editor === editor &&
    parameters !== null &&
    typeof parameters === 'object' &&
    !Array.isArray(parameters) &&
    Object.keys(parameters).length === Object.keys(expectedParameters).length &&
    Object.entries(expectedParameters).every(
      ([key, value]) => (parameters as Record<string, unknown>)[key] === value,
    )
  );
}

function hasExactlyValidatorKeys(
  validators: Record<string, unknown>,
  expected: string[],
): boolean {
  const keys = Object.keys(validators).sort();

  return (
    keys.length === expected.length &&
    expected.every(
      (key, index) =>
        keys[index] === key &&
        validators[key] !== null &&
        typeof validators[key] === 'object' &&
        !Array.isArray(validators[key]) &&
        Object.keys(validators[key] as Record<string, unknown>).length === 0,
    )
  );
}

function withoutInternalMenuItems(
  input: CmaClient.RawApiTypes.MenuItem[],
  internalItemTypeIds: ReadonlySet<string>,
): CmaClient.RawApiTypes.MenuItem[] {
  const conflicts = input.filter(
    ({ relationships }) =>
      relationships.item_type.data &&
      internalItemTypeIds.has(relationships.item_type.data.id),
  );

  if (conflicts.length > 0) {
    throw internalNavigationConflict(
      'content menu items',
      conflicts.map(({ id }) => id),
    );
  }

  return input;
}

/**
 * Removing an internal root changes the absolute positions returned for every
 * later root. Compact each remaining sibling group so the ignored node cannot
 * produce a spurious schema-menu reorder. Descendants are rejected rather than
 * silently hidden because removing their parent would leave an invalid graph.
 */
function withoutInternalSchemaMenuItems(
  input: CmaClient.RawApiTypes.SchemaMenuItem[],
  internalItemTypeIds: ReadonlySet<string>,
): CmaClient.RawApiTypes.SchemaMenuItem[] {
  const internalItems = input.filter(
    ({ relationships }) =>
      relationships.item_type.data &&
      internalItemTypeIds.has(relationships.item_type.data.id),
  );
  const excludedIds = new Set(internalItems.map(({ id }) => id));
  const invalidInternalItems = internalItems.filter(
    ({ relationships }) =>
      relationships.parent.data || relationships.children.data.length > 0,
  );
  const orphanedChildren = input.filter(({ relationships }) => {
    const parentId = relationships.parent.data?.id;

    return parentId ? excludedIds.has(parentId) : false;
  });

  if (invalidInternalItems.length > 0 || orphanedChildren.length > 0) {
    throw internalNavigationConflict('schema-menu descendants', [
      ...invalidInternalItems.map(({ id }) => id),
      ...orphanedChildren.map(({ id }) => id),
    ]);
  }

  const keptIds = new Set(
    input.filter(({ id }) => !excludedIds.has(id)).map(({ id }) => id),
  );
  const output = input
    .filter(({ id }) => keptIds.has(id))
    .map((item) => ({
      ...item,
      attributes: { ...item.attributes },
      relationships: {
        ...item.relationships,
        children: {
          ...item.relationships.children,
          data: item.relationships.children.data.filter(({ id }) =>
            keptIds.has(id),
          ),
        },
      },
    }));
  compactNavigationPositions(output);

  return output;
}

function internalNavigationConflict(kind: string, ids: string[]): Error {
  return new Error(
    `The reserved ${CONTENT_DIFF_MAPPING_MODEL_API_KEY} model has unsupported ${kind}: ${[
      ...new Set(ids),
    ]
      .sort()
      .join(
        ', ',
      )}. Remove this custom navigation before generating a schema migration.`,
  );
}

function compactNavigationPositions<
  Item extends
    | CmaClient.RawApiTypes.MenuItem
    | CmaClient.RawApiTypes.SchemaMenuItem,
>(output: Item[]): void {
  const siblings = new Map<string, Item[]>();

  for (const item of output) {
    const parentId = item.relationships.parent.data?.id ?? '';
    siblings.set(parentId, [...(siblings.get(parentId) ?? []), item]);
  }

  for (const group of siblings.values()) {
    group
      .sort(
        (left, right) =>
          left.attributes.position - right.attributes.position ||
          left.id.localeCompare(right.id),
      )
      .forEach((item, index) => {
        item.attributes.position = index + 1;
      });
  }
}
