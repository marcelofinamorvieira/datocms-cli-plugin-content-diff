import type { CmaClient } from '@datocms/cli-utils';
import { canonicalizeJson, isPortableDatoId } from './canonicalize';
import {
  analyzeRuntimeCurrentUniqueTransitions,
  collectCreateCycleIntermediateCandidates,
  collectOptionalDeletionCycleReleaseCandidates,
  collectPublishedDependencyIds,
  collectRequiredDeletionCycleReleaseCandidates,
  contentItemNamespaceIds,
} from './dependencies';
import { contentTraversalSchema } from './inspection-schema';
import {
  applyLegacyIdMappingsToSnapshot,
  assertNoManagedRelationshipToMappingModel,
  prepareLegacyIdMappings,
  readLegacyIdMappingRegistry,
  remapInvalidContentDiagnostics,
} from './legacy-ids';
import {
  assertCanEditSchema,
  assertUnrestrictedReadAccess,
} from './permissions';
import { buildContentDiffPlan } from './plan';
import {
  assertSameProject,
  assertSchemasCompatible,
  fetchSchemaSnapshot,
  migrationsTrackingModelId,
  schemaForScope,
  schemaMismatch,
} from './schema';
import { captureContentSnapshot } from './snapshot';
import type {
  BuildContentDiffPlanOptions,
  ContentDiffPlan,
  ContentSnapshot,
  DeleteReleaseStep,
  InvalidContentDiagnostic,
  InvalidContentSlice,
  ItemTypeSelection,
  JsonObject,
  SchemaSnapshot,
  UploadSelection,
} from './types';
import { ContentDiffError } from './types';
import { DEFAULT_CONTENT_DIFF_MODEL_API_KEY } from './types';
import { buildRecordValidationPayload } from './validation-payload';
import { writeContentDiffArtifacts } from './write-artifacts';

export type ContentDiffMigrationSummary = {
  counts: Record<string, number>;
  records: Array<{ id: string; itemTypeId: string; action: string }>;
  uploads: Array<{ id: string; action: string }>;
  destructiveActions: string[];
  warnings: string[];
  invalidContent: ContentDiffPlan['summary']['invalidContent'];
  skippedRecords: Array<{
    id: string;
    itemTypeId: string;
    disposition: string;
    reasons: Array<{
      code: string;
      slice: string | null;
      dependencyId?: string;
      dependencyChain: string[];
    }>;
  }>;
  validatorRelaxations: Array<{
    fieldId: string;
    itemTypeId: string;
    relaxedValidatorKeys: string[];
    affectedRecordIds: string[];
  }>;
  legacyIdMappings: Array<{
    entityType: string;
    sourceId: string;
    targetId: string;
    status: 'existing' | 'new';
  }>;
  skippedLegacyIdMappings: Array<{
    entityType: string;
    sourceId: string;
    reason: string;
  }>;
};

export interface GenerateContentDiffMigrationInput {
  client: CmaClient.Client;
  buildClientForEnvironment: (
    environmentId: string,
  ) => Promise<CmaClient.Client>;
  sourceEnvironmentId: string;
  destinationEnvironmentId: string;
  migrationFilePath: string;
  format: 'js' | 'ts';
  options: {
    itemTypes: ItemTypeSelection;
    uploads: UploadSelection;
    includeDeletions: boolean;
    bundleAssets: boolean;
    migrateInvalidContent: boolean;
    migrationsModelApiKey?: string;
    contentDiffModelApiKey?: string;
  };
}

export interface GenerateContentDiffMigrationResult {
  sourceEnvironmentId: string;
  destinationEnvironmentId: string;
  format: 'js' | 'ts';
  migrationPath: string;
  planPath: string;
  runtimePath: string;
  assetsPath?: string;
  summary: ContentDiffMigrationSummary;
}

export async function generateContentDiffMigration({
  client,
  buildClientForEnvironment,
  sourceEnvironmentId,
  destinationEnvironmentId,
  migrationFilePath,
  format,
  options,
}: GenerateContentDiffMigrationInput): Promise<GenerateContentDiffMigrationResult> {
  if (sourceEnvironmentId === destinationEnvironmentId) {
    throw new Error('Source and destination environments must be different');
  }
  const contentDiffModelApiKey =
    options.contentDiffModelApiKey ?? DEFAULT_CONTENT_DIFF_MODEL_API_KEY;
  const migrationsModelApiKey =
    options.migrationsModelApiKey ?? 'schema_migration';
  if (migrationsModelApiKey === contentDiffModelApiKey) {
    throw new ContentDiffError(
      'INVALID_SCOPE',
      `The migrations tracking model and internal content-diff ledger cannot both use API key ${contentDiffModelApiKey}. Configure a different migrations model API key.`,
      { contentDiffModelApiKey },
    );
  }

  const [sourceClient, destinationClient] = await Promise.all([
    buildClientForEnvironment(sourceEnvironmentId),
    buildClientForEnvironment(destinationEnvironmentId),
  ]);
  const [sourceSchema, destinationSchema] = await Promise.all([
    fetchSchemaSnapshot(sourceClient, sourceEnvironmentId),
    fetchSchemaSnapshot(destinationClient, destinationEnvironmentId),
  ]);

  assertSameProject(sourceSchema, destinationSchema);
  assertNoManagedRelationshipToMappingModel(
    sourceSchema,
    contentDiffModelApiKey,
  );
  assertNoManagedRelationshipToMappingModel(
    destinationSchema,
    contentDiffModelApiKey,
  );
  const sourceScopedSchema = schemaForScope(
    sourceSchema,
    options.itemTypes,
    migrationsModelApiKey,
    contentDiffModelApiKey,
  );
  let destinationScopedSchema: SchemaSnapshot;

  try {
    destinationScopedSchema = schemaForScope(
      destinationSchema,
      options.itemTypes,
      migrationsModelApiKey,
      contentDiffModelApiKey,
    );
  } catch (error) {
    if (error instanceof ContentDiffError && error.code === 'INVALID_SCOPE') {
      throw schemaMismatch(sourceScopedSchema, destinationSchema);
    }

    throw error;
  }

  assertSchemasCompatible(sourceScopedSchema, destinationScopedSchema);
  await Promise.all([
    readLegacyIdMappingRegistry(
      sourceClient,
      sourceSchema,
      contentDiffModelApiKey,
      false,
    ),
    readLegacyIdMappingRegistry(
      destinationClient,
      destinationSchema,
      contentDiffModelApiKey,
      false,
    ),
  ]);
  const sourceMigrationsModelId = migrationsTrackingModelId(
    sourceSchema,
    migrationsModelApiKey,
  );
  const destinationMigrationsModelId = migrationsTrackingModelId(
    destinationSchema,
    migrationsModelApiKey,
  );
  await Promise.all([
    assertUnrestrictedReadAccess(
      client,
      [sourceEnvironmentId],
      sourceSchema.itemTypes.filter(({ id }) => id !== sourceMigrationsModelId),
    ),
    assertUnrestrictedReadAccess(
      client,
      [destinationEnvironmentId],
      destinationSchema.itemTypes.filter(
        ({ id }) => id !== destinationMigrationsModelId,
      ),
    ),
  ]);

  const scope = {
    itemTypes: options.itemTypes,
    uploads: options.uploads,
    migrationsModelApiKey,
    contentDiffModelApiKey,
  } as const;
  const sourceSnapshot = await captureContentSnapshot({
    client: sourceClient,
    environmentId: sourceEnvironmentId,
    schema: sourceSchema,
    scope,
    maxAttempts: 3,
    fullAccessVerified: true,
  });
  const legacyRegistry = await readLegacyIdMappingRegistry(
    destinationClient,
    destinationSchema,
    contentDiffModelApiKey,
    true,
  );
  const sourceUploadIds = new Set(Object.keys(sourceSnapshot.uploads));
  const sourceCollectionIds = new Set(
    Object.keys(sourceSnapshot.uploadCollections),
  );
  const destinationSnapshot = await captureContentSnapshot({
    client: destinationClient,
    environmentId: destinationEnvironmentId,
    schema: destinationSchema,
    scope: {
      ...scope,
      // A source asset can already exist in the destination without being
      // referenced by the selected destination records. Include those IDs in
      // the baseline so it is reconciled instead of mistaken for a create.
      baselineUploadIds: [
        ...sourceUploadIds,
        ...legacyRegistry.entries
          .filter(
            ({ entityType, sourceId }) =>
              entityType === 'upload' && sourceUploadIds.has(sourceId),
          )
          .map(({ targetId }) => targetId),
      ],
      baselineUploadCollectionIds: [
        ...sourceCollectionIds,
        ...legacyRegistry.entries
          .filter(
            ({ entityType, sourceId }) =>
              entityType === 'upload_collection' &&
              sourceCollectionIds.has(sourceId),
          )
          .map(({ targetId }) => targetId),
      ],
      allUploadCollections: true,
    },
    maxAttempts: 3,
    fullAccessVerified: true,
  });
  assertNoLegacyDestinationIdCollisions(
    await findDestinationIdCollisions(
      sourceSnapshot,
      destinationSnapshot,
      destinationClient,
    ),
  );
  const legacyIdMappings = prepareLegacyIdMappings(
    sourceSnapshot,
    destinationSnapshot,
    legacyRegistry,
  );
  const externalLegacyRecordTargets = await inspectExistingLegacyRecordTargets(
    destinationClient,
    destinationSnapshot,
    legacyIdMappings,
  );
  const normalizedSourceSnapshot = applyLegacyIdMappingsToSnapshot(
    sourceSnapshot,
    legacyIdMappings,
  );
  const legacyRecordTargets = new Map(
    legacyIdMappings.entries
      .filter(({ entityType }) => entityType === 'record')
      .map(({ sourceId, targetId }) => [sourceId, targetId]),
  );
  const entityIdCollisions = await findDestinationIdCollisions(
    normalizedSourceSnapshot,
    destinationSnapshot,
    destinationClient,
  );
  const structurallyInvalidSourceIds = new Set(
    sourceSnapshot.inspection.structuralIssues.map(({ recordId }) => recordId),
  );
  const sourceItemTypesById = new Map(
    sourceSnapshot.schema.itemTypes.map((itemType) => [itemType.id, itemType]),
  );
  const createCycleIntermediateCandidates =
    collectCreateCycleIntermediateCandidates(
      Object.fromEntries(
        Object.entries(sourceSnapshot.records).filter(
          ([id]) => !structurallyInvalidSourceIds.has(id),
        ),
      ),
      contentTraversalSchema(sourceSnapshot),
      new Set(
        Object.keys(sourceSnapshot.records).filter(
          (id) =>
            !(
              (legacyRecordTargets.get(id) ?? id) in destinationSnapshot.records
            ),
        ),
      ),
    ).filter(({ recordId, itemTypeId, topologyCycle }) => {
      if (topologyCycle) return false;
      const record = sourceSnapshot.records[recordId];
      const itemType = sourceItemTypesById.get(itemTypeId);

      return Boolean(
        record &&
          itemType &&
          (record.published ||
            !itemType.draftModeActive ||
            !itemType.draftSavingActive),
      );
    });
  const runtimeUniqueIntermediateCandidates = options.migrateInvalidContent
    ? analyzeRuntimeCurrentUniqueTransitions(
        sourceSnapshot,
        destinationSnapshot,
      ).conflicts.flatMap(({ recordId, phase }) => {
        const record = sourceSnapshot.records[recordId];
        const version =
          phase === 'current-restore'
            ? record?.current
            : phase === 'create-seed'
              ? record?.published ?? record?.current
              : record?.published;
        return version && !structurallyInvalidSourceIds.has(recordId)
          ? [
              {
                recordId,
                versionHash: version.hash,
                fields: version.fields,
              },
            ]
          : [];
      })
    : [];
  const intermediateCandidates = [
    ...new Map(
      [
        ...createCycleIntermediateCandidates,
        ...runtimeUniqueIntermediateCandidates,
      ].map((candidate) => [
        `${candidate.recordId}\0${candidate.versionHash}`,
        candidate,
      ]),
    ).values(),
  ];
  const targetOnlyRecords = Object.fromEntries(
    Object.entries(destinationSnapshot.records).filter(
      ([id]) => !normalizedSourceSnapshot.records[id],
    ),
  );
  const destinationTraversalSchema =
    contentTraversalSchema(destinationSnapshot);
  const destinationItemTypes = new Map(
    destinationTraversalSchema.itemTypes.map((itemType) => [
      itemType.id,
      itemType,
    ]),
  );
  const deletionCandidateOptions = {
    reservedItemIds: contentItemNamespaceIds(
      normalizedSourceSnapshot,
      destinationSnapshot,
    ),
  };
  const requiredDeletionCycleReleaseCandidates =
    options.migrateInvalidContent && options.includeDeletions
      ? collectRequiredDeletionCycleReleaseCandidates(
          targetOnlyRecords,
          destinationTraversalSchema,
          deletionCandidateOptions,
        )
      : [];
  const optionalDeletionCycleReleaseCandidates = options.includeDeletions
    ? collectOptionalDeletionCycleReleaseCandidates(
        targetOnlyRecords,
        destinationTraversalSchema,
        deletionCandidateOptions,
      )
    : [];
  const requiredDeletionReleaseKeys = new Set(
    requiredDeletionCycleReleaseCandidates.flatMap(({ releases }) =>
      releases.map(
        ({ recordId, intermediateCurrentHash }) =>
          `${recordId}\0${intermediateCurrentHash}`,
      ),
    ),
  );
  const deletionCycleReleaseCandidates = [
    ...requiredDeletionCycleReleaseCandidates,
    ...optionalDeletionCycleReleaseCandidates,
  ]
    // Published-derived releases that need fresh nested block IDs are
    // classified as fail-closed skips by the planner. Do not ask the raw
    // validation endpoint to diagnose a payload the CMA update path cannot
    // execute safely.
    .filter(({ releases }) =>
      releases.every(
        ({ transientNestedBlockIds }) => transientNestedBlockIds.length === 0,
      ),
    )
    .flatMap(({ releases }) => releases)
    // Optional releases can still be strict writes even though they do not
    // publish explicitly: no-draft models auto-publish, and models with
    // invalid-draft saving disabled validate every update.
    .filter((release) => {
      if (
        requiredDeletionReleaseKeys.has(
          `${release.recordId}\0${release.intermediateCurrentHash}`,
        )
      ) {
        return true;
      }
      const record = targetOnlyRecords[release.recordId];
      const itemType = record
        ? destinationItemTypes.get(record.itemTypeId)
        : undefined;
      return Boolean(
        release.publish ||
          !itemType?.draftModeActive ||
          !itemType.draftSavingActive,
      );
    });
  const [sourceDiagnostics, destinationDiagnostics, deletionCycleDiagnostics] =
    await Promise.all([
      // Source invalidity is authoritative even in default mode. These private,
      // read-only calls let the planner prove whether an invalid native draft
      // depends on a uniqueness peer that another safety rule will skip.
      diagnoseInvalidSourceContent(
        sourceClient,
        sourceSnapshot,
        intermediateCandidates,
      ),
      options.migrateInvalidContent
        ? diagnoseDesiredContentAgainstDestination(
            destinationClient,
            normalizedSourceSnapshot,
            destinationSnapshot,
          )
        : Promise.resolve([]),
      deletionCycleReleaseCandidates.length > 0
        ? diagnoseDeletionCycleReleasesAgainstDestination(
            destinationClient,
            destinationSnapshot,
            deletionCycleReleaseCandidates,
          )
        : Promise.resolve([]),
    ]);
  const resolvedInvalidContentDiagnostics = [
    ...remapInvalidContentDiagnostics(
      sourceDiagnostics,
      sourceSnapshot,
      normalizedSourceSnapshot,
      destinationSnapshot,
      legacyIdMappings,
    ),
    ...destinationDiagnostics,
    ...deletionCycleDiagnostics,
  ];
  const plan = buildContentDiffPlan(sourceSnapshot, destinationSnapshot, {
    includeDeletions: options.includeDeletions,
    uploads: options.uploads,
    migrationsModelApiKey,
    migrateInvalidContent: options.migrateInvalidContent,
    invalidContentDiagnostics: resolvedInvalidContentDiagnostics,
    entityIdCollisions,
    legacyIdMappings,
    externalLegacyRecordTargets,
    legacyIdMappingOccupiedItemIds: legacyRegistry.entries
      .filter(
        ({ entityType }) => entityType === 'record' || entityType === 'block',
      )
      .map(({ targetId }) => targetId),
  });
  await assertTransientDeleteReleaseIdsUnoccupied(
    destinationClient,
    plan.execution.deleteReleases,
  );
  if (plan.requiredPermissions.editSchema) {
    await assertCanEditSchema(destinationClient);
  }
  await assertPublicationBoundarySafety(destinationClient, plan);
  await assertPublishedDeleteReleasesValid(
    destinationClient,
    plan.execution.deleteReleases,
    new Set(
      plan.invalidContent.validatorRelaxations.flatMap(
        ({ affectedRecordIds }) => affectedRecordIds,
      ),
    ),
    destinationSnapshot,
  );
  const artifacts = await writeContentDiffArtifacts({
    plan,
    migrationFilePath,
    format,
    bundleAssets: options.bundleAssets,
  });

  return {
    sourceEnvironmentId,
    destinationEnvironmentId,
    format,
    migrationPath: artifacts.migrationPath,
    planPath: artifacts.planPath,
    runtimePath: artifacts.runtimePath,
    ...(artifacts.assetsPath ? { assetsPath: artifacts.assetsPath } : {}),
    summary: summarizeForCommand(plan),
  };
}

export function assertNoLegacyDestinationIdCollisions(
  collisions: NonNullable<BuildContentDiffPlanOptions['entityIdCollisions']>,
): void {
  const legacyCollisions = collisions.filter(({ id }) => !isPortableDatoId(id));

  if (legacyCollisions.length === 0) return;

  throw new ContentDiffError(
    'DUPLICATE_ENTITY_ID',
    `Legacy source IDs already belong to out-of-scope destination Items: ${legacyCollisions
      .map(({ id }) => id)
      .sort()
      .join(
        ', ',
      )}. Widen --item-types so the existing entities can be reconciled in place, or resolve the ID collision before generating a content migration.`,
    { entityIds: legacyCollisions.map(({ id }) => id).sort() },
  );
}

async function inspectExistingLegacyRecordTargets(
  destinationClient: CmaClient.Client,
  destination: ContentSnapshot,
  mappings: ContentDiffPlan['legacyIdMappings'],
): Promise<
  NonNullable<BuildContentDiffPlanOptions['externalLegacyRecordTargets']>
> {
  const visible = new Set(destination.visibleRecordIds);
  const candidates = mappings.entries.filter(
    ({ entityType, status, targetId }) =>
      entityType === 'record' && status === 'existing' && visible.has(targetId),
  );
  const result: NonNullable<
    BuildContentDiffPlanOptions['externalLegacyRecordTargets']
  > = {};
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor];
      cursor += 1;
      let current: unknown;

      try {
        current = await destinationClient.items.find(candidate.targetId, {
          version: 'current',
          nested: false,
        });
      } catch (error) {
        if (isNotFoundError(error)) continue;
        throw error;
      }

      const itemTypeId = recordItemTypeId(current);
      if (!itemTypeId) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Mapped destination record ${candidate.targetId} has no authoritative item type.`,
          { targetId: candidate.targetId },
        );
      }

      let published = false;
      try {
        const publishedRecord = await destinationClient.items.find(
          candidate.targetId,
          { version: 'published', nested: false },
        );
        const publishedItemTypeId = recordItemTypeId(publishedRecord);
        if (publishedItemTypeId !== itemTypeId) {
          throw new ContentDiffError(
            'UNSUPPORTED_CONTENT_STATE',
            `Mapped destination record ${candidate.targetId} changed item type between current and published reads.`,
            { targetId: candidate.targetId },
          );
        }
        published = true;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }

      result[candidate.targetId] = {
        itemTypeId,
        current: true,
        published,
      };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(5, candidates.length) }, () => worker()),
  );
  return result;
}

function recordItemTypeId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const itemType = record.item_type;
  if (itemType && typeof itemType === 'object') {
    const id = (itemType as Record<string, unknown>).id;
    if (typeof id === 'string') return id;
  }
  const relationships = record.relationships;
  if (!relationships || typeof relationships !== 'object') return null;
  const relationship = (relationships as Record<string, unknown>).item_type;
  if (!relationship || typeof relationship !== 'object') return null;
  const data = (relationship as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return null;
  const id = (data as Record<string, unknown>).id;
  return typeof id === 'string' ? id : null;
}

/**
 * Runs private, non-mutating validation calls only for source slices whose CMA
 * validity flag is false. Unknown error shapes are retained as an explicit
 * contract diagnostic so the planner can skip the aggregate fail-closed.
 */
export async function diagnoseInvalidSourceContent(
  sourceClient: CmaClient.Client,
  source: ContentSnapshot,
  intermediateCandidates: ReadonlyArray<{
    recordId: string;
    versionHash: string;
    fields: JsonObject;
  }> = [],
): Promise<InvalidContentDiagnostic[]> {
  const structurallyInvalidRecordIds = new Set(
    source.inspection.structuralIssues.map(({ recordId }) => recordId),
  );
  const traversalSchema = contentTraversalSchema(source);
  const tasks = Object.values(source.records)
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((record) => {
      if (structurallyInvalidRecordIds.has(record.id)) return [];
      const values: Array<{
        recordId: string;
        itemTypeId: string;
        slice: Exclude<InvalidContentSlice, 'schedule'>;
        versionHash: string;
        fields: JsonObject;
      }> = [];

      if (!record.validity.current) {
        values.push({
          recordId: record.id,
          itemTypeId: record.itemTypeId,
          slice: 'current',
          versionHash: record.current.hash,
          fields: record.current.fields,
        });
      }

      if (record.published && record.validity.published === false) {
        values.push({
          recordId: record.id,
          itemTypeId: record.itemTypeId,
          slice: 'published',
          versionHash: record.published.hash,
          fields: record.published.fields,
        });
      }

      return values;
    })
    .concat(
      [...intermediateCandidates]
        .filter(({ recordId }) => !structurallyInvalidRecordIds.has(recordId))
        .sort(
          (left, right) =>
            left.recordId.localeCompare(right.recordId) ||
            left.versionHash.localeCompare(right.versionHash),
        )
        .map(({ recordId, versionHash, fields }) => ({
          recordId,
          itemTypeId: source.records[recordId].itemTypeId,
          slice: 'intermediate' as const,
          versionHash,
          fields,
        })),
    );
  const diagnostics = new Array<InvalidContentDiagnostic>(tasks.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      const task = tasks[index];

      try {
        await sourceClient.items.validateExisting(
          task.recordId,
          buildRecordValidationPayload(
            task.fields,
            task.itemTypeId,
            traversalSchema,
          ) as never,
        );
        diagnostics[index] = {
          recordId: task.recordId,
          slice: task.slice,
          versionHash: task.versionHash,
          valid: true,
          issues: [],
        };
      } catch (error) {
        const issues = validationIssuesFromError(error);

        if (!issues) throw error;

        diagnostics[index] = {
          recordId: task.recordId,
          slice: task.slice,
          versionHash: task.versionHash,
          valid: false,
          issues,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(5, tasks.length) }, () => worker()),
  );

  return diagnostics;
}

/**
 * Diagnoses destination-side validator conflicts (notably unique-value
 * handoffs) for exact desired payloads of records that already exist there.
 * Source-only creates continue to use source-side shell diagnostics because
 * unavailable destination dependencies would make validateNew ambiguous.
 */
export async function diagnoseDesiredContentAgainstDestination(
  destinationClient: CmaClient.Client,
  source: ContentSnapshot,
  destination: ContentSnapshot,
): Promise<InvalidContentDiagnostic[]> {
  const structurallyInvalidRecordIds = new Set(
    source.inspection.structuralIssues.map(({ recordId }) => recordId),
  );
  const traversalSchema = contentTraversalSchema(source);
  const tasks = Object.values(source.records)
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((record) => {
      if (structurallyInvalidRecordIds.has(record.id)) return [];
      const baseline = destination.records[record.id];

      if (!baseline) return [];

      const values: Array<{
        recordId: string;
        itemTypeId: string;
        slice: 'current' | 'published';
        versionHash: string;
        fields: JsonObject;
      }> = [];

      if (record.current.hash !== baseline.current.hash) {
        values.push({
          recordId: record.id,
          itemTypeId: record.itemTypeId,
          slice: 'current',
          versionHash: record.current.hash,
          fields: record.current.fields,
        });
      }

      if (
        record.published &&
        record.published.hash !== baseline.published?.hash
      ) {
        values.push({
          recordId: record.id,
          itemTypeId: record.itemTypeId,
          slice: 'published',
          versionHash: record.published.hash,
          fields: record.published.fields,
        });
      }

      return values;
    });
  const diagnostics = new Array<InvalidContentDiagnostic>(tasks.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      const task = tasks[index];

      try {
        await destinationClient.items.validateExisting(
          task.recordId,
          buildRecordValidationPayload(
            task.fields,
            task.itemTypeId,
            traversalSchema,
          ) as never,
        );
        diagnostics[index] = {
          recordId: task.recordId,
          slice: task.slice,
          versionHash: task.versionHash,
          valid: true,
          issues: [],
        };
      } catch (error) {
        const issues = validationIssuesFromError(error);

        if (!issues) throw error;

        diagnostics[index] = {
          recordId: task.recordId,
          slice: task.slice,
          versionHash: task.versionHash,
          valid: false,
          issues,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(5, tasks.length) }, () => worker()),
  );

  return diagnostics;
}

/**
 * Diagnoses the canonical intermediate versions used to release a
 * destination-only reference SCC before deletion. These payloads are
 * validated against the destination because the records do not exist in the
 * source environment.
 */
export async function diagnoseDeletionCycleReleasesAgainstDestination(
  destinationClient: CmaClient.Client,
  destination: ContentSnapshot,
  releases: readonly DeleteReleaseStep[],
): Promise<InvalidContentDiagnostic[]> {
  const traversalSchema = contentTraversalSchema(destination);
  const tasks = [...releases]
    .sort((left, right) => left.recordId.localeCompare(right.recordId))
    .map((release) => {
      const record = destination.records[release.recordId];

      if (!record) {
        throw new ContentDiffError(
          'CONCURRENT_SNAPSHOT_CHANGE',
          `Deletion-cycle release owner ${release.recordId} disappeared after destination capture.`,
          { recordId: release.recordId },
        );
      }

      return {
        recordId: release.recordId,
        itemTypeId: record.itemTypeId,
        versionHash: release.intermediateCurrentHash,
        fields: release.fields,
      };
    });
  const diagnostics = new Array<InvalidContentDiagnostic>(tasks.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      const task = tasks[index];

      try {
        await destinationClient.items.validateExisting(
          task.recordId,
          buildRecordValidationPayload(
            task.fields,
            task.itemTypeId,
            traversalSchema,
          ) as never,
        );
        diagnostics[index] = {
          recordId: task.recordId,
          slice: 'intermediate',
          versionHash: task.versionHash,
          valid: true,
          issues: [],
        };
      } catch (error) {
        const issues = validationIssuesFromError(error);

        if (!issues) throw error;

        diagnostics[index] = {
          recordId: task.recordId,
          slice: 'intermediate',
          versionHash: task.versionHash,
          valid: false,
          issues,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(5, tasks.length) }, () => worker()),
  );

  return diagnostics;
}

function validationIssuesFromError(
  error: unknown,
): InvalidContentDiagnostic['issues'] | null {
  if (!error || typeof error !== 'object') return null;

  const candidate = error as Record<string, unknown>;
  const response =
    candidate.response && typeof candidate.response === 'object'
      ? (candidate.response as Record<string, unknown>)
      : null;
  const body =
    response?.body && typeof response.body === 'object'
      ? (response.body as Record<string, unknown>)
      : null;
  const errors = Array.isArray(candidate.errors)
    ? candidate.errors
    : Array.isArray(body?.errors)
      ? body.errors
      : null;

  if (!errors) {
    const status = response?.status;

    if (status === 400 || status === 409 || status === 422) {
      return [
        {
          code: 'VALIDATION_CONTRACT_CHANGED',
          fieldId: null,
          details: { status },
        },
      ];
    }

    return null;
  }

  return errors.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return {
        code: 'VALIDATION_CONTRACT_CHANGED',
        fieldId: null,
        details: {},
      };
    }

    const raw = entry as Record<string, unknown>;
    const attributes =
      raw.attributes && typeof raw.attributes === 'object'
        ? (raw.attributes as Record<string, unknown>)
        : raw;
    const details =
      attributes.details && typeof attributes.details === 'object'
        ? (canonicalizeJson(attributes.details) as JsonObject)
        : {};
    const nestedCode = details.code;
    const topCode = attributes.code;
    const code =
      typeof nestedCode === 'string'
        ? nestedCode
        : typeof topCode === 'string' && topCode !== 'INVALID_FIELD'
          ? topCode
          : 'VALIDATION_CONTRACT_CHANGED';
    const nestedFieldId = details.field_id;
    const topFieldId = attributes.field_id;
    const fieldId =
      typeof nestedFieldId === 'string'
        ? nestedFieldId
        : typeof topFieldId === 'string'
          ? topFieldId
          : null;

    return { code, fieldId, details };
  });
}

/**
 * Proves the two publication operations that could otherwise escape the
 * selected content scope: recursively publishing an external dependency and
 * cascading/scrubbing a published referrer while unpublishing a record.
 */
export async function assertPublicationBoundarySafety(
  destinationClient: CmaClient.Client,
  plan: ContentDiffPlan,
): Promise<void> {
  const recordPlansById = new Map(
    plan.records.map((recordPlan) => [recordPlan.id, recordPlan]),
  );
  const publishOrderIndex = new Map(
    plan.execution.publishOrder.map((recordId, index) => [recordId, index]),
  );
  const externalPublicationOwners = new Map<string, Set<string>>();

  function requireExternalPublication(
    dependencyId: string,
    ownerRecordId: string,
  ): void {
    if (dependencyId === ownerRecordId) return;
    const owners = externalPublicationOwners.get(dependencyId) ?? new Set();
    owners.add(ownerRecordId);
    externalPublicationOwners.set(dependencyId, owners);
  }

  for (const recordPlan of plan.records) {
    if (!recordPlan.desired?.published) continue;

    for (const dependencyId of recordPlan.publishedDependencies) {
      if (!recordPlansById.has(dependencyId)) {
        requireExternalPublication(dependencyId, recordPlan.id);
      }
    }
  }

  for (const release of plan.execution.deleteReleases.filter(
    ({ publish }) => publish,
  )) {
    const owner = recordPlansById.get(release.recordId);

    if (!owner?.baseline) {
      throw new ContentDiffError(
        'UNSUPPORTED_CONTENT_STATE',
        `Published deletion release ${release.recordId} has no destination baseline.`,
        { recordId: release.recordId },
      );
    }

    const releaseSnapshot = {
      ...owner.baseline,
      published: {
        fields: release.fields,
        hash: release.intermediateCurrentHash,
      },
    };

    for (const dependencyId of collectPublishedDependencyIds(
      releaseSnapshot,
      plan.schema,
    )) {
      if (dependencyId === release.recordId) continue;

      const dependencyPlan = recordPlansById.get(dependencyId);

      if (!dependencyPlan) {
        requireExternalPublication(dependencyId, release.recordId);
        continue;
      }

      const remainsPublishedBeforeDeleteIsland = Boolean(
        dependencyPlan.desired?.published ||
          (dependencyPlan.action === 'delete' &&
            dependencyPlan.baseline?.published),
      );

      if (!remainsPublishedBeforeDeleteIsland) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Temporary deletion release ${release.recordId} depends on managed record ${dependencyId}, but that dependency will be unpublished before the deletion phase.`,
          { recordId: release.recordId, dependencyId },
        );
      }
    }
  }

  const externalPublishedDependencyIds = [
    ...externalPublicationOwners.keys(),
  ].sort();
  const publicationBoundaryTargets = plan.records.filter(
    (recordPlan) =>
      Boolean(recordPlan.baseline?.published) &&
      (recordPlan.action === 'delete' ||
        (Boolean(recordPlan.desired) &&
          recordPlan.desired?.published === null)),
  );
  const checks: Array<() => Promise<void>> = [
    ...externalPublishedDependencyIds.map(
      (dependencyId) => async (): Promise<void> => {
        try {
          await destinationClient.items.find(dependencyId, {
            version: 'published',
            nested: false,
          });
        } catch (error) {
          if (!isNotFoundError(error)) throw error;

          throw new ContentDiffError(
            'UNSUPPORTED_CONTENT_STATE',
            `Desired or temporary published content references out-of-scope record ${dependencyId}, but that record has no published destination version. Publishing it could mutate content outside the selected scope.`,
            {
              dependencyId,
              requiredBy: [
                ...(externalPublicationOwners.get(dependencyId) ?? []),
              ].sort(),
            },
          );
        }
      },
    ),
    ...publicationBoundaryTargets.map(
      (recordPlan) => async (): Promise<void> => {
        const referrers = await destinationClient.items.references(
          recordPlan.id,
          { version: 'published', nested: false },
        );

        for (const referrer of referrers) {
          const referrerId = String((referrer as { id?: unknown }).id ?? '');

          if (!referrerId || referrerId === recordPlan.id) continue;

          const referrerPlan = recordPlansById.get(referrerId);
          const targetIndex = publishOrderIndex.get(recordPlan.id);
          const referrerIndex = publishOrderIndex.get(referrerId);
          const targetIsDeletion = recordPlan.action === 'delete';
          const referrerRunsFirst =
            targetIsDeletion ||
            (referrerIndex !== undefined &&
              targetIndex !== undefined &&
              referrerIndex < targetIndex);
          const sameDeleteIsland = Boolean(
            targetIsDeletion && referrerPlan?.action === 'delete',
          );
          const removesPublishedReference = Boolean(
            referrerPlan?.desired?.published &&
              !referrerPlan.publishedDependencies.includes(recordPlan.id) &&
              referrerPlan.action !== 'noop' &&
              referrerRunsFirst,
          );
          const unpublishesFirst = Boolean(
            referrerPlan?.desired &&
              referrerPlan.desired.published === null &&
              referrerPlan.action !== 'noop' &&
              referrerPlan.action !== 'delete' &&
              referrerRunsFirst,
          );

          if (
            sameDeleteIsland ||
            removesPublishedReference ||
            unpublishesFirst
          ) {
            continue;
          }

          throw new ContentDiffError(
            'UNSUPPORTED_CONTENT_STATE',
            recordPlan.action === 'delete'
              ? `Record ${recordPlan.id} cannot be deleted safely because published referrer ${referrerId} is outside the selected reconciliation or deletion island, or retains the reference.`
              : `Record ${recordPlan.id} cannot be unpublished safely because published referrer ${referrerId} is outside the selected reconciliation order or retains the reference.`,
            { recordId: recordPlan.id, referrerId },
          );
        }
      },
    ),
  ];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < checks.length) {
      const check = checks[cursor];
      cursor += 1;
      await check();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(5, checks.length) }, () => worker()),
  );
}

export async function assertPublishedDeleteReleasesValid(
  destinationClient: CmaClient.Client,
  releases: readonly DeleteReleaseStep[],
  validatorRelaxedRecordIds: ReadonlySet<string> = new Set(),
  destination?: ContentSnapshot,
): Promise<void> {
  const itemTypes = new Map(
    destination?.schema.itemTypes.map((itemType) => [itemType.id, itemType]) ??
      [],
  );
  const strictReleases = releases.filter(({ publish, recordId }) => {
    if (validatorRelaxedRecordIds.has(recordId)) return false;
    if (publish) return true;
    if (!destination) return false;
    const record = destination.records[recordId];
    const itemType = record ? itemTypes.get(record.itemTypeId) : undefined;
    return Boolean(
      !itemType || !itemType.draftModeActive || !itemType.draftSavingActive,
    );
  });
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < strictReleases.length) {
      const release = strictReleases[cursor];
      cursor += 1;

      try {
        // `fields` is a complete request-compatible high-level item body. The
        // private validation endpoint is read-only and runs the same record
        // validators that a strict update or publication of the temporary
        // unlink state will run.
        await destinationClient.items.validateExisting(
          release.recordId,
          destination
            ? buildRecordValidationPayload(
                release.fields,
                destination.records[release.recordId]?.itemTypeId ?? '',
                contentTraversalSchema(destination),
              )
            : release.fields,
        );
      } catch (error) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Record ${release.recordId} cannot pass strict validation after removing cyclic deletion references. No migration artifacts were written.`,
          {
            recordId: release.recordId,
            cause: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(5, strictReleases.length) }, () => worker()),
  );
}

export async function assertTransientDeleteReleaseIdsUnoccupied(
  destinationClient: CmaClient.Client,
  releases: readonly DeleteReleaseStep[],
): Promise<void> {
  const reservations = releases
    .flatMap(({ recordId, transientNestedBlockIds }) =>
      transientNestedBlockIds.map((blockId) => ({ blockId, recordId })),
    )
    .sort(
      (left, right) =>
        left.blockId.localeCompare(right.blockId) ||
        left.recordId.localeCompare(right.recordId),
    );
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < reservations.length) {
      const reservation = reservations[cursor];
      cursor += 1;

      try {
        await destinationClient.items.find(reservation.blockId, {
          version: 'current',
          nested: false,
        });
      } catch (error) {
        if (isNotFoundError(error)) continue;
        throw error;
      }

      throw new ContentDiffError(
        'BLOCK_OWNERSHIP_CONFLICT',
        `Transient nested block ID ${reservation.blockId} planned for deletion release ${reservation.recordId} is already occupied in the destination. No migration artifacts were written.`,
        {
          blockId: reservation.blockId,
          recordId: reservation.recordId,
        },
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(5, reservations.length) }, () => worker()),
  );
}

export async function findDestinationIdCollisions(
  source: ContentSnapshot,
  destination: ContentSnapshot,
  destinationClient: CmaClient.Client,
): Promise<NonNullable<BuildContentDiffPlanOptions['entityIdCollisions']>> {
  const sourceOnlyEntities = [
    ...Object.keys(source.records)
      .filter((id) => !(id in destination.records))
      .map((id) => ({ id, kind: 'record' as const, topRecordId: id })),
    ...Object.keys(source.blockOwnership)
      .filter((id) => !(id in destination.blockOwnership))
      .map((id) => ({
        id,
        kind: 'block' as const,
        topRecordId: source.blockOwnership[id][0].topRecordId,
      })),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const collisions: NonNullable<
    BuildContentDiffPlanOptions['entityIdCollisions']
  > = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < sourceOnlyEntities.length) {
      const entity = sourceOnlyEntities[cursor];
      cursor += 1;

      try {
        await destinationClient.items.find(entity.id, {
          version: 'current',
          nested: false,
        });
      } catch (error) {
        if (isNotFoundError(error)) {
          continue;
        }

        throw error;
      }

      collisions.push(entity);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(5, sourceOnlyEntities.length) }, () =>
      worker(),
    ),
  );

  return collisions.sort(
    (left, right) =>
      left.topRecordId.localeCompare(right.topRecordId) ||
      left.id.localeCompare(right.id),
  );
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (
    'response' in error &&
    error.response &&
    typeof error.response === 'object' &&
    'status' in error.response &&
    error.response.status === 404
  ) {
    return true;
  }

  if (!('errors' in error) || !Array.isArray(error.errors)) {
    return false;
  }

  return error.errors.some((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const attributes =
      'attributes' in entry &&
      entry.attributes &&
      typeof entry.attributes === 'object'
        ? entry.attributes
        : entry;
    const code = 'code' in attributes ? attributes.code : undefined;

    return (
      code === 'NOT_FOUND' ||
      code === 'RECORD_NOT_FOUND' ||
      code === 'ITEM_NOT_FOUND'
    );
  });
}

export function summarizeForCommand(
  plan: ContentDiffPlan,
): ContentDiffMigrationSummary {
  const counts: Record<string, number> = {
    'records.create': plan.summary.records.create,
    'records.update': plan.summary.records.update,
    'records.delete': plan.summary.records.delete,
    'uploads.create': plan.summary.uploads.create,
    'uploads.update': plan.summary.uploads.update,
    'uploads.delete': plan.summary.uploads.delete,
    'uploadCollections.create': plan.summary.uploadCollections.create,
    'uploadCollections.update': plan.summary.uploadCollections.update,
    'legacyIdMappings.detected': plan.summary.legacyIdMappings.detected,
    'legacyIdMappings.skipped': plan.summary.legacyIdMappings.skipped,
    'legacyIdMappings.records': plan.summary.legacyIdMappings.records,
  };

  return {
    counts: Object.fromEntries(
      Object.entries(counts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    records: plan.records
      .filter(({ action }) => action !== 'noop')
      .map(({ id, itemTypeId, action }) => ({
        id,
        itemTypeId,
        action,
      })),
    uploads: plan.uploads
      .filter(({ action }) => action !== 'noop')
      .map(({ id, action }) => ({ id, action })),
    destructiveActions: [
      ...plan.records
        .filter(({ action }) => action === 'delete')
        .map(({ id }) => `delete record ${id}`),
      ...plan.uploads
        .filter(({ action }) => action === 'delete')
        .map(({ id }) => `delete upload ${id}`),
    ],
    warnings: plan.warnings.map(({ message }) => message),
    invalidContent: plan.summary.invalidContent,
    skippedRecords: plan.invalidContent.skippedRecords.map(
      ({ id, itemTypeId, disposition, reasons }) => ({
        id,
        itemTypeId,
        disposition,
        reasons: reasons.map(
          ({ code, slice, dependencyId, dependencyChain }) => ({
            code,
            slice,
            ...(dependencyId ? { dependencyId } : {}),
            dependencyChain,
          }),
        ),
      }),
    ),
    validatorRelaxations: plan.invalidContent.validatorRelaxations.map(
      ({ fieldId, itemTypeId, relaxedValidatorKeys, affectedRecordIds }) => ({
        fieldId,
        itemTypeId,
        relaxedValidatorKeys,
        affectedRecordIds,
      }),
    ),
    legacyIdMappings: plan.legacyIdMappings.entries.map(
      ({ entityType, sourceId, targetId, status }) => ({
        entityType,
        sourceId,
        targetId,
        status,
      }),
    ),
    skippedLegacyIdMappings: plan.legacyIdMappings.skippedEntries.map(
      ({ entityType, sourceId, reason }) => ({
        entityType,
        sourceId,
        reason,
      }),
    ),
  };
}

export * from './canonicalize';
export * from './dependencies';
export * from './legacy-ids';
export * from './permissions';
export * from './plan';
export * from './schema';
export * from './snapshot';
export * from './types';
export * from './write-artifacts';
