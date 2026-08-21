export const RUNTIME_VERSION = '15' as const;
export const CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION = 1 as const;

export type RuntimeFormat = 'js' | 'ts';

/**
 * Render the immutable runtime copied next to generated content migrations.
 *
 * The emitted file deliberately carries its own canonicalizers and executor:
 * generated migrations must keep working after this plugin is upgraded or
 * removed. Its only non-built-in dependency is the CMA client handed to the
 * migration entrypoint by `datocms migrations:run`.
 */
export function renderRuntime(format: RuntimeFormat): string {
  const header =
    format === 'ts'
      ? `// DatoCMS content-diff migration runtime. Do not edit.\n// @ts-nocheck\nimport { createHash } from 'node:crypto';\nimport { createReadStream, createWriteStream } from 'node:fs';\nimport { mkdtemp, rm } from 'node:fs/promises';\nimport { tmpdir } from 'node:os';\nimport { dirname, isAbsolute, join, relative, resolve } from 'node:path';\nimport { Readable, Transform } from 'node:stream';\nimport { pipeline } from 'node:stream/promises';\n\n`
      : `'use strict';\n\n// DatoCMS content-diff migration runtime. Do not edit.\nconst { createHash } = require('node:crypto');\nconst { createReadStream, createWriteStream } = require('node:fs');\nconst { mkdtemp, rm } = require('node:fs/promises');\nconst { tmpdir } = require('node:os');\nconst { dirname, isAbsolute, join, relative, resolve } = require('node:path');\nconst { Readable, Transform } = require('node:stream');\nconst { pipeline } = require('node:stream/promises');\n\n`;
  const footer =
    format === 'ts'
      ? '\nexport { CONTENT_DIFF_RUNTIME_VERSION as RUNTIME_VERSION, runContentDiffMigration };\n'
      : '\nmodule.exports = {\n  RUNTIME_VERSION: CONTENT_DIFF_RUNTIME_VERSION,\n  runContentDiffMigration,\n};\n';

  return header + GENERATED_RUNTIME_BODY + footer;
}

/** Render the small migration file discovered by `migrations:run`. */
export function renderEntrypoint(
  format: RuntimeFormat,
  manifestBasename: string,
  manifestSha256: string,
): string {
  const manifestLiteral = JSON.stringify(manifestBasename);
  const digestLiteral = JSON.stringify(manifestSha256.toLowerCase());
  const runtimeImport = `./.datocms-content/runtime-v${RUNTIME_VERSION}`;

  if (format === 'ts') {
    return `import { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport { dirname, resolve } from 'node:path';\nimport type { Client } from 'datocms/lib/cma-client-node';\nimport { runContentDiffMigration } from ${JSON.stringify(
      runtimeImport,
    )};\n\ntype MigrationExecutionContext = {\n  readonly environmentId?: string;\n  readonly inPlace?: boolean;\n  readonly allowPrimary?: boolean;\n  readonly contentDiffProtocolVersion: ${CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION};\n};\n\nexport default async function(\n  client: Client,\n  executionContext?: MigrationExecutionContext,\n): Promise<void> {\n  if (executionContext?.contentDiffProtocolVersion !== ${CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION}) {\n    throw new Error(\n      'Unsupported content-diff migration runner protocol: expected ${CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION}, received ' +\n        String(executionContext?.contentDiffProtocolVersion) +\n        '. Upgrade the datocms CLI and execute this file through datocms migrations:run.',\n    );\n  }\n\n  const manifestPath = resolve(dirname(__filename), '.datocms-content', ${manifestLiteral});\n  const manifestBytes = readFileSync(manifestPath);\n  const actualSha256 = createHash('sha256').update(manifestBytes).digest('hex');\n\n  if (actualSha256 !== ${digestLiteral}) {\n    throw new Error('Content migration manifest integrity validation failed');\n  }\n\n  const envelope = JSON.parse(manifestBytes.toString('utf8'));\n  await runContentDiffMigration(client, envelope, {\n    migrationFilePath: __filename,\n    manifestPath,\n    executionContext,\n  });\n}\n`;
  }

  return `'use strict';\n\nconst { createHash } = require('node:crypto');\nconst { readFileSync } = require('node:fs');\nconst { dirname, resolve } = require('node:path');\nconst { runContentDiffMigration } = require(${JSON.stringify(
    runtimeImport,
  )});\n\nmodule.exports = async function contentDiffMigration(client, executionContext) {\n  if (!executionContext || executionContext.contentDiffProtocolVersion !== ${CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION}) {\n    const actualProtocol = executionContext && executionContext.contentDiffProtocolVersion;\n    throw new Error(\n      'Unsupported content-diff migration runner protocol: expected ${CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION}, received ' +\n        String(actualProtocol) +\n        '. Upgrade the datocms CLI and execute this file through datocms migrations:run.',\n    );\n  }\n\n  const manifestPath = resolve(dirname(__filename), '.datocms-content', ${manifestLiteral});\n  const manifestBytes = readFileSync(manifestPath);\n  const actualSha256 = createHash('sha256').update(manifestBytes).digest('hex');\n\n  if (actualSha256 !== ${digestLiteral}) {\n    throw new Error('Content migration manifest integrity validation failed');\n  }\n\n  const envelope = JSON.parse(manifestBytes.toString('utf8'));\n  await runContentDiffMigration(client, envelope, {\n    migrationFilePath: __filename,\n    manifestPath,\n    executionContext,\n  });\n};\n`;
}

// Keep this body valid JavaScript. The TypeScript renderer intentionally uses
// @ts-nocheck: the generated runtime is versioned, checksummed implementation
// machinery, while the human-authored migration entrypoint remains typed.
const GENERATED_RUNTIME_BODY = String.raw`
const CONTENT_DIFF_RUNTIME_VERSION = '15';
const CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION = 1;
const CONTENT_DIFF_PLAN_VERSION = 9;
const CONTENT_DIFF_MANIFEST_VERSION = 9;
const LEGACY_ID_MAPPING_FORMAT_VERSION = 1;
const LEGACY_ID_MAPPING_MODEL_API_KEY = 'datocms_content_diff';
const LEGACY_ID_MAPPING_MODEL_NAME = 'Content diff';
const LEGACY_ID_MAPPING_NAME_FIELD_API_KEY = 'name';
const LEGACY_ID_MAPPING_NAME_FIELD_LABEL = 'Name';
const LEGACY_ID_MAPPING_FIELD_API_KEY = 'mapping';
const LEGACY_ID_MAPPING_FIELD_LABEL = 'Mapping';
const LEGACY_ID_MAPPING_MAX_DOCUMENT_BYTES = 128 * 1024;
const LEGACY_ID_MAPPING_ENTITY_TYPES = new Set([
  'record',
  'block',
  'upload',
  'upload_collection',
]);
const DEFAULT_SCHEDULE_SAFETY_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_UPLOAD_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_UPLOAD_PROCESSING_POLL_INTERVAL_MS = 2 * 1000;
const DEFAULT_UPLOAD_FILENAME_COLLISION_WINDOW_MS = 2100;
const UPLOAD_NULL_MANUAL_SENTINEL = '__dcd_null__';
const DEFAULT_VALIDITY_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_VALIDITY_PROCESSING_POLL_INTERVAL_MS = 2 * 1000;
const RELAXABLE_VALIDATOR_KEYS = new Set([
  'date_range',
  'date_time_range',
  'description_length',
  'enum',
  'extension',
  'file_size',
  'format',
  'image_aspect_ratio',
  'image_dimensions',
  'length',
  'number_range',
  'required',
  'required_alt_title',
  'required_seo_fields',
  'sanitized_html',
  'size',
  'slug_format',
  'slug_title_field',
  'title_length',
  'unique',
]);
const ITEM_RESERVED_KEYS = new Set([
  '__itemTypeId',
  'creator',
  'created_at',
  'current_version',
  'editor',
  'first_published_at',
  'has_children',
  'id',
  'is_current',
  'is_current_version_valid',
  'is_published',
  'is_published_version_valid',
  'is_valid',
  'item_type',
  'meta',
  'parent_id',
  'position',
  'publication_scheduled_at',
  'published_at',
  'published_from',
  'published_until',
  'relationships',
  'stage',
  'status',
  'type',
  'unpublishing_scheduled_at',
  'updated_at',
]);
class ContentDiffRuntimeError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ContentDiffRuntimeError';
    this.code = code;
    this.details = details || null;
  }
}

async function runContentDiffMigration(client, envelope, options) {
  const runtimeOptions = options || {};
  assertMigrationExecutionProtocol(runtimeOptions);
  const plan = assertEnvelope(envelope);
  validatePlan(plan);

  const context = {
    client,
    plan,
    options: runtimeOptions,
    schemaById: new Map(plan.schema.itemTypes.map(function (itemType) {
      return [itemType.id, itemType];
    })),
    captureSchema: schemaWithInspectionItemTypes(plan.schema, plan.targetInspection.itemTypes),
    captureSchemaById: new Map(plan.schema.itemTypes.concat(plan.targetInspection.itemTypes).map(function (itemType) {
      return [itemType.id, itemType];
    })),
    recordPlansById: new Map(plan.records.map(function (record) {
      return [record.id, record];
    })),
    uploadPlansById: new Map(plan.uploads.map(function (upload) {
      return [upload.id, upload];
    })),
    collectionPlansById: new Map(plan.uploadCollections.map(function (collection) {
      return [collection.id, collection];
    })),
    initialRecords: new Map(),
    initialUploads: new Map(),
    initialCollections: new Map(),
    initialSkippedRecords: new Map(),
    stagedUploads: new Map(),
    uploadRequestTimes: new Map(),
    uploadFilenameWindowStartedAt: Date.now(),
    stagedDirectory: null,
    executionEnvironmentId: null,
    executionEnvironment: null,
    targetItemTypes: [],
    liveLegacyMappingModelId: null,
    legacyIdMappingState: null,
    defaultValueSuppressions: deriveCreateDefaultValueSuppressions(plan),
    defaultValueSuppressionStarted: false,
    suppressedDefaultFieldIds: new Set(),
    validatorRelaxationStarted: false,
    relaxedFieldIds: new Set(),
    scheduleQuiescenceRequired: false,
    schedulesQuiesced: false,
    completedPhases: [],
    mutationCount: 0,
  };

  log(context, 'Starting DatoCMS content migration: ' + plan.source.environmentId + ' -> ' + plan.target.environmentId);

  let migrationFailed = false;
  try {
    await runPhase(context, 1, 'Preflight, interrupted-schema recovery, and convergence classification', async function () {
      // These first identity passes must precede validator-recovery writes.
      // Permission completeness is proved by prepareManagedSchema immediately
      // afterward, then both checks are repeated against the authorized view.
      await verifyLegacySourceIdsAbsent(context);
      await inspectLegacyIdMappings(context);
      await prepareManagedSchema(context);
      await inspectLegacyIdMappings(context);
      await verifyLegacySourceIdsAbsent(context);
      await verifyExternalLegacyIdMappingTargets(context);
      await verifyTargetSetPreconditions(context, false);
      await classifyInitialState(context);
      await verifySkippedRecords(context, false);
      verifySkippedOrderingSafety(context);
      verifyInitialRecordPositions(context);
      await verifyBlockOwnershipSafety(context);
      await verifyTransientDeleteReleaseBlockIds(context);
      await verifyExternalDependencies(context);
      await verifyPublicationSafety(context);
      await verifyRecordDeletionSafety(context, true);
      await verifyUploadDeletionSafety(context);
      await verifyPublishedDeleteReleases(context, false);
      validateCreateSeeds(context);
    });

    if (planAlreadyConverged(context)) {
      log(context, '[12/12] Content is already converged; verifying without touching managed field settings...');
      await verifySkippedRecords(context, true);
      await verifyFinalState(context);
      context.completedPhases.push('12');
      log(context, 'Content migration complete (' + context.mutationCount + ' CMA mutations).');
      return;
    }

    await verifyLiveUploadCollectionLabelSafety(context);
    validateDesiredSchedules(context);
    validateSchedulesBeforeCancellation(context);
    await verifySkippedScheduleSafety(context, true);
    context.scheduleQuiescenceRequired = planHasCmaMutations(context.plan);

    await runPhase(context, 2, 'Quiesce schedules and stage external inputs', async function () {
      await cancelLiveSchedules(context);
      await stageUploadBinaries(context);
      await persistLegacyIdMappingReservations(context);
    });

    let contentError = null;
    let restorationError = null;
    try {
      await applyValidatorRelaxations(context);
      // Validator-owned release payloads cannot be proven against the original
      // schema. Prove them immediately after the exact relaxation is active,
      // before any content phase can mutate an unrelated aggregate. Phase 9
      // repeats this check to close the execution-time race window.
      if (context.plan.invalidContent.validatorRelaxations.length > 0) {
        await verifyPublishedDeleteReleases(context, true);
        await verifyRelaxedCreateSeeds(context, true);
      }

      await runPhase(context, 3, 'Release unique values and reconcile upload collections', async function () {
        await releaseUniqueValues(context);
        await reconcileUploadCollections(context);
      });

      await runPhase(context, 4, 'Create and update uploads', async function () {
        await reconcileUploads(context);
      });

      let createError = null;
      let defaultRestorationError = null;
      const missingCreateRecordIds = await findMissingCreateRecordIds(context);
      const phase5DefaultValueSuppressions = context.defaultValueSuppressions.filter(function (suppression) {
        return suppression.affectedRecordIds.some(function (recordId) {
          return missingCreateRecordIds.has(recordId);
        });
      });
      try {
        // Keep the project-wide default suppression window as small as
        // possible: uploads are ready, every actual create ID was checked
        // before suppression, and only exact phase-5 creates happen while
        // defaults are suppressed. A fully resumed create set performs zero
        // schema writes.
        await applyDefaultValueSuppressions(context, phase5DefaultValueSuppressions);
        await runPhase(context, 5, 'Create missing records', async function () {
          await createMissingRecords(context, missingCreateRecordIds);
        });
      } catch (error) {
        createError = error;
      } finally {
        try {
          await restoreDefaultValueSuppressions(context, phase5DefaultValueSuppressions);
        } catch (error) {
          defaultRestorationError = error;
        }
      }
      if (createError || defaultRestorationError) {
        throw combineMigrationAndRestorationErrors(createError, defaultRestorationError);
      }

      await runPhase(context, 6, 'Reconcile record tree parents', async function () {
        await reconcileTreeParents(context);
      });

      await runPhase(context, 7, 'Rebuild published record state', async function () {
        await reconcilePublishedVersions(context);
      });

      await runPhase(context, 8, 'Restore current record state and portable lifecycle metadata', async function () {
        await reconcileCurrentVersionsAndLifecycle(context);
      });

      await runPhase(context, 9, 'Delete destination-only records', async function () {
        await releaseDeleteReferences(context);
        await deleteRecords(context);
      });

      await runPhase(context, 10, 'Finalize record positions and workflow stages', async function () {
        await finalizePositionsAndStages(context);
      });

      await runPhase(context, 11, 'Prune destination-only uploads', async function () {
        await pruneUploads(context);
      });
    } catch (error) {
      contentError = error;
    } finally {
      try {
        await restoreManagedSchema(context);
      } catch (error) {
        restorationError = error;
      }
    }

    if (contentError || restorationError) {
      throw combineMigrationAndRestorationErrors(contentError, restorationError);
    }

    await runPhase(context, 12, 'Restore publication schedules and verify final state', async function () {
      await verifySchedulesRemainQuiesced(context);
      await waitForExpectedRecordValidity(context);
      await verifyTargetSchema(context);
      await verifySkippedRecords(context, true);
      await verifyFinalState(context, { includeSchedules: false });
      await verifySchedulesRemainQuiesced(context);
      validateDesiredSchedules(context);
      context.schedulesQuiesced = false;
      await restoreSchedules(context);
      await verifyFinalRecordSchedules(context);
    });

    log(context, 'Content migration complete (' + context.mutationCount + ' CMA mutations).');
  } catch (error) {
    migrationFailed = true;
    const completed = context.completedPhases.length
      ? context.completedPhases.join(', ')
      : 'none';
    console.error('[content-diff] Migration stopped after completed phases: ' + completed + '.');
    console.error('[content-diff] The runtime is idempotent: resolve the reported conflict, then rerun the migration.');
    throw error;
  } finally {
    if (context.stagedDirectory) {
      try {
        await rm(context.stagedDirectory, { recursive: true, force: true });
      } catch (cleanupError) {
        const detail = cleanupError && cleanupError.message ? cleanupError.message : String(cleanupError);
        if (migrationFailed) {
          console.error('[content-diff] Warning: could not remove temporary staged uploads after the migration failure: ' + detail);
        } else {
          log(context, 'Warning: migration completed, but temporary staged uploads could not be removed: ' + detail);
        }
      }
    }
  }
}

async function runPhase(context, number, label, task) {
  if (context.schedulesQuiesced) {
    await verifySchedulesRemainQuiesced(context);
  }
  log(context, '[' + number + '/12] ' + label + '...');
  await task();
  context.completedPhases.push(String(number));
}

function log(context, message) {
  const logger = context.options && typeof context.options.log === 'function'
    ? context.options.log
    : console.log;
  logger('[content-diff] ' + message);
}

function assertMigrationExecutionProtocol(options) {
  const executionContext = isObject(options.executionContext) ? options.executionContext : {};
  const actual = executionContext.contentDiffProtocolVersion;
  if (actual !== CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION) {
    throw runtimeError(
      'UNSUPPORTED_RUNNER_PROTOCOL',
      'Unsupported content-diff migration runner protocol: expected ' + CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION + ', received ' + String(actual) + '. Upgrade the datocms CLI and execute this migration through datocms migrations:run.',
      { expected: CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION, actual: actual },
    );
  }
}

function assertEnvelope(envelope) {
  if (!isObject(envelope)) {
    throw runtimeError('INVALID_MANIFEST', 'Content migration manifest is not an object.');
  }
  if (envelope.formatVersion !== CONTENT_DIFF_MANIFEST_VERSION) {
    throw runtimeError('UNSUPPORTED_MANIFEST', 'Unsupported content migration manifest version: ' + String(envelope.formatVersion));
  }
  if (envelope.runtimeVersion !== CONTENT_DIFF_RUNTIME_VERSION) {
    throw runtimeError('UNSUPPORTED_RUNTIME', 'Content migration requires runtime ' + String(envelope.runtimeVersion) + ', but this file is runtime ' + CONTENT_DIFF_RUNTIME_VERSION + '.');
  }
  if (!isObject(envelope.integrity) || envelope.integrity.algorithm !== 'sha256' || typeof envelope.integrity.planSha256 !== 'string') {
    throw runtimeError('INVALID_MANIFEST', 'Content migration manifest has invalid integrity metadata.');
  }
  if (!isObject(envelope.plan)) {
    throw runtimeError('INVALID_MANIFEST', 'Content migration manifest has no plan.');
  }

  const actual = sha256(stableStringify(envelope.plan));
  if (!constantTimeEqualHex(actual, envelope.integrity.planSha256)) {
    throw runtimeError('PLAN_INTEGRITY_FAILURE', 'Content migration plan integrity validation failed.');
  }

  return envelope.plan;
}

function validatePlan(plan) {
  if (plan.formatVersion !== CONTENT_DIFF_PLAN_VERSION) {
    throw runtimeError('UNSUPPORTED_PLAN', 'Unsupported content diff plan version: ' + String(plan.formatVersion));
  }
  if (!isObject(plan.source) || !isObject(plan.target) || !isObject(plan.schema)) {
    throw runtimeError('INVALID_PLAN', 'Content diff plan is missing source, target, or schema metadata.');
  }
  if (String(plan.source.siteId) !== String(plan.target.siteId)) {
    throw runtimeError('CROSS_SITE_PLAN', 'Content diff runtime only supports environments in the same DatoCMS project.');
  }
  if (plan.source.environmentId === plan.target.environmentId) {
    throw runtimeError('INVALID_PLAN', 'Source and destination environments must be different.');
  }
  if (plan.source.schemaDigest !== plan.target.schemaDigest || plan.schema.digest !== plan.target.schemaDigest) {
    throw runtimeError('SCHEMA_MISMATCH', 'The plan was generated from incompatible schemas.');
  }
  if (!isEnvironmentSemantics(plan.schema.environmentSemantics)) {
    throw runtimeError('INVALID_PLAN', 'Content diff plan is missing exact environment content-semantics metadata.');
  }
  validateTargetInspection(plan);
  if (!isObject(plan.options) || typeof plan.options.migrationsModelApiKey !== 'string' || !plan.options.migrationsModelApiKey) {
    throw runtimeError('INVALID_PLAN', 'Content diff plan is missing the migrations tracking-model API key.');
  }
  if (plan.options.migrationsModelApiKey === LEGACY_ID_MAPPING_MODEL_API_KEY) {
    throw runtimeError('INVALID_PLAN', 'The migrations tracking model cannot share the reserved content-diff ledger API key.');
  }
  for (const key of ['records', 'uploads', 'uploadCollections']) {
    if (!Array.isArray(plan[key])) {
      throw runtimeError('INVALID_PLAN', 'Content diff plan property ' + key + ' must be an array.');
    }
  }
  if (!isObject(plan.execution)) {
    throw runtimeError('INVALID_PLAN', 'Content diff plan has no execution ordering.');
  }
  for (const key of ['collectionOrder', 'uploadOrder', 'uniqueReleases', 'deleteReleases', 'shellRecordIds', 'shellComponents', 'revalidateBeforePublishIds', 'createOrder', 'publicationSeedOrder', 'publishOrder', 'updateOrder', 'deleteOrder']) {
    if (!Array.isArray(plan.execution[key])) {
      throw runtimeError('INVALID_PLAN', 'Content diff execution property ' + key + ' must be an array.');
    }
  }
  assertUniqueIds(plan.records, 'record');
  assertUniqueIds(plan.uploads, 'upload');
  assertUniqueIds(plan.uploadCollections, 'upload collection');
  const recordSnapshotIdentityMismatches = findRecordSnapshotIdentityMismatches(plan);
  if (recordSnapshotIdentityMismatches.length > 0) {
    throw runtimeError('INVALID_PLAN', 'Content plan record snapshot identities do not match their plan identities: ' + recordSnapshotIdentityMismatches.join(', ') + '.');
  }
  const invalidUploadCollectionPlan = plan.uploadCollections.map(function (collection) {
    return { collection: collection, error: uploadCollectionPlanContractError(collection) };
  }).find(function (entry) { return entry.error !== null; });
  if (invalidUploadCollectionPlan) {
    throw runtimeError(
      'INVALID_PLAN',
      'Upload collection ' + invalidUploadCollectionPlan.collection.id +
        ' has an invalid executable contract: ' + invalidUploadCollectionPlan.error + '.'
    );
  }
  const uploadCollectionOrderError = uploadCollectionOrderContractError(
    plan.uploadCollections,
    plan.execution.collectionOrder
  );
  if (uploadCollectionOrderError) {
    throw runtimeError(
      'INVALID_PLAN',
      'Upload collection label transition is not executable in the planned order: ' +
        uploadCollectionOrderError + '.'
    );
  }
  const requiredManageUploadCollections = deriveRequiredManageUploadCollections(
    plan.uploadCollections
  );
  if (
    !isObject(plan.requiredPermissions) ||
    plan.requiredPermissions.manageUploadCollections !== requiredManageUploadCollections
  ) {
    throw runtimeError(
      'INVALID_PLAN',
      'Content plan upload-collection permission does not match its exact operations: expected manageUploadCollections=' +
        String(requiredManageUploadCollections) + '.'
    );
  }
  const nonPortableCreateIds = findNonPortableCreateIds(plan);
  if (nonPortableCreateIds.length > 0) {
    throw runtimeError('INVALID_PLAN', 'Content plan contains non-portable IDs for CMA creates: ' + nonPortableCreateIds.join(', ') + '.');
  }

  if (
    !plan.options || typeof plan.options.migrateInvalidContent !== 'boolean' ||
    !isObject(plan.invalidContent) || plan.invalidContent.formatVersion !== 1 ||
    plan.invalidContent.migrateInvalidContent !== plan.options.migrateInvalidContent ||
    !Array.isArray(plan.invalidContent.detectedRecordIds) ||
    !Array.isArray(plan.invalidContent.migratedRecordIds) ||
    !Number.isInteger(plan.invalidContent.propagatedSkipCount) ||
    plan.invalidContent.propagatedSkipCount < 0 ||
    !Array.isArray(plan.invalidContent.validatorRelaxations) ||
    !Array.isArray(plan.invalidContent.skippedRecords) ||
    !isObject(plan.invalidContent.schemaStates) ||
    plan.invalidContent.schemaStates.partialRelaxationContract !== 'per_field_original_or_relaxed'
  ) {
    throw runtimeError('INVALID_PLAN', 'Content diff plan has an invalid invalid-content contract.');
  }
  if (
    plan.invalidContent.schemaStates.originalDigest !== plan.target.schemaDigest ||
    plan.invalidContent.schemaStates.originalDigest !== plan.schema.digest
  ) {
    throw runtimeError('INVALID_PLAN', 'Invalid-content schema gating does not target the plan\'s original schema digest.');
  }

  const relaxationsByFieldId = new Map();
  const relaxedRecordIds = new Set();
  for (const relaxation of plan.invalidContent.validatorRelaxations) {
    const itemType = plan.schema.itemTypes.find(function (entry) { return entry.id === relaxation.itemTypeId; });
    const field = itemType && itemType.fields.find(function (entry) { return entry.id === relaxation.fieldId; });
    const originalHash = isObject(relaxation.originalValidators) ? semanticHash(relaxation.originalValidators) : null;
    const relaxedHash = isObject(relaxation.relaxedValidators) ? semanticHash(relaxation.relaxedValidators) : null;
    const removedKeys = isObject(relaxation.originalValidators) && isObject(relaxation.relaxedValidators)
      ? Object.keys(relaxation.originalValidators).filter(function (key) {
          return !Object.prototype.hasOwnProperty.call(relaxation.relaxedValidators, key);
        }).sort()
      : [];
    const retainedValidators = isObject(relaxation.originalValidators)
      ? Object.fromEntries(Object.entries(relaxation.originalValidators).filter(function (entry) {
          return !removedKeys.includes(entry[0]);
        }))
      : null;
    if (
      !itemType || !field || relaxationsByFieldId.has(relaxation.fieldId) ||
      originalHash !== relaxation.originalHash || relaxedHash !== relaxation.relaxedHash ||
      relaxation.originalHash === relaxation.relaxedHash ||
      stableStringify(field.validators) !== stableStringify(relaxation.originalValidators) ||
      !Array.isArray(relaxation.allowedValidatorHashes) || relaxation.allowedValidatorHashes.length !== 2 ||
      !relaxation.allowedValidatorHashes.includes(relaxation.originalHash) ||
      !relaxation.allowedValidatorHashes.includes(relaxation.relaxedHash) ||
      !Array.isArray(relaxation.relaxedValidatorKeys) ||
      stableStringify(unique(relaxation.relaxedValidatorKeys).sort()) !== stableStringify(removedKeys) ||
      removedKeys.some(function (key) { return !RELAXABLE_VALIDATOR_KEYS.has(key); }) ||
      stableStringify(retainedValidators) !== stableStringify(relaxation.relaxedValidators) ||
      !Array.isArray(relaxation.affectedRecordIds) ||
      relaxation.affectedRecordIds.some(function (id) { return typeof id !== 'string' || !id; }) ||
      !Array.isArray(relaxation.reasons) || relaxation.reasons.length === 0
    ) {
      throw runtimeError('INVALID_PLAN', 'Validator relaxation for field ' + String(relaxation.fieldId) + ' is not an exact, reversible removal of supported optional validators.');
    }
    relaxationsByFieldId.set(relaxation.fieldId, relaxation);
    relaxation.affectedRecordIds.forEach(function (id) { relaxedRecordIds.add(id); });
  }
  if (plan.invalidContent.validatorRelaxations.length > 0 && plan.options.migrateInvalidContent !== true) {
    throw runtimeError('INVALID_PLAN', 'Validator relaxations require migrateInvalidContent=true in the generated plan.');
  }
  const fullyRelaxedSchema = schemaWithValidatorRelaxations(plan.schema, plan.invalidContent.validatorRelaxations);
  if (semanticHash(fullyRelaxedSchema) !== plan.invalidContent.schemaStates.fullyRelaxedDigest) {
    throw runtimeError('INVALID_PLAN', 'The declared fully-relaxed schema digest does not match the validator relaxation plan.');
  }

  assertUniqueIds(plan.invalidContent.skippedRecords, 'skipped record');
  const plannedRecordIds = new Set(plan.records.map(function (entry) { return entry.id; }));
  const detectedRecordIds = plan.invalidContent.detectedRecordIds;
  const migratedRecordIds = plan.invalidContent.migratedRecordIds;
  const detectedRecordIdSet = new Set(detectedRecordIds);
  const migratedRecordIdSet = new Set(migratedRecordIds);
  if (
    detectedRecordIds.some(function (id) { return typeof id !== 'string' || !id; }) ||
    migratedRecordIds.some(function (id) { return typeof id !== 'string' || !id; }) ||
    detectedRecordIdSet.size !== detectedRecordIds.length ||
    migratedRecordIdSet.size !== migratedRecordIds.length ||
    migratedRecordIds.some(function (id) { return !detectedRecordIdSet.has(id) || !plannedRecordIds.has(id); }) ||
    plan.invalidContent.propagatedSkipCount > plan.invalidContent.skippedRecords.length
  ) {
    throw runtimeError('INVALID_PLAN', 'Invalid-content record classifications are inconsistent.');
  }
  if (plan.invalidContent.validatorRelaxations.some(function (relaxation) {
    return relaxation.affectedRecordIds.some(function (id) { return !plannedRecordIds.has(id); });
  })) {
    throw runtimeError('INVALID_PLAN', 'Validator relaxation affectedRecordIds must refer to managed record plans.');
  }
  const sanitizationRisks = deriveSanitizedHtmlWriteRisks(plan, fullyRelaxedSchema);
  if (sanitizationRisks.length > 0) {
    throw runtimeError('INVALID_PLAN', 'One or more projected CREATE/UPDATE text values may be rewritten by active sanitized_html preprocessing. This runtime cannot preserve those source bytes exactly.', {
      recordIds: unique(sanitizationRisks.map(function (risk) { return risk.recordId; })).sort(),
      fieldIds: unique(sanitizationRisks.map(function (risk) { return risk.fieldId; })).sort(),
      stages: unique(sanitizationRisks.map(function (risk) { return risk.stage; })),
      paths: sanitizationRisks.map(function (risk) { return risk.path; }),
    });
  }
  const defaultValueSuppressions = deriveCreateDefaultValueSuppressions(plan);
  if (defaultValueSuppressions.length > 0 && plan.options.migrateInvalidContent !== true) {
    throw runtimeError('INVALID_PLAN', 'Temporary field-default suppression requires migrateInvalidContent=true in the generated plan.');
  }
  if (
    !isObject(plan.requiredPermissions) || typeof plan.requiredPermissions.editSchema !== 'boolean' ||
    ((plan.invalidContent.validatorRelaxations.length > 0 || defaultValueSuppressions.length > 0) &&
      plan.requiredPermissions.editSchema !== true)
  ) {
    throw runtimeError('INVALID_PLAN', 'Plan does not declare the schema-edit permission required by its temporary schema changes.');
  }
  const declaredUploadActions = Array.isArray(plan.requiredPermissions.uploadActions)
    ? plan.requiredPermissions.uploadActions
    : [];
  const invalidUploadPlan = plan.uploads.map(function (uploadPlan) {
    return { uploadPlan, error: uploadPlanContractError(uploadPlan, plan.schema) };
  }).find(function (entry) { return entry.error !== null; });
  if (invalidUploadPlan) {
    throw runtimeError('INVALID_PLAN', 'Upload ' + invalidUploadPlan.uploadPlan.id + ' has an invalid executable contract: ' + invalidUploadPlan.error + '. Regenerate the plan with the current plugin.');
  }
  const derivedUploadActions = deriveRequiredUploadActions(plan.uploads);
  if (stableStringify(declaredUploadActions) !== stableStringify(derivedUploadActions)) {
    throw runtimeError('INVALID_PLAN', 'The plan upload permission declaration does not match its exact create, update, replace_asset, move, and delete operations. Regenerate the plan with the current plugin.', {
      expected: derivedUploadActions,
      actual: declaredUploadActions,
    });
  }
  const defaultSuppressionWarnings = Array.isArray(plan.warnings)
    ? plan.warnings.filter(function (warning) { return warning && warning.code === 'DEFAULT_VALUE_SUPPRESSION'; })
    : [];
  if (
    (defaultValueSuppressions.length === 0 && defaultSuppressionWarnings.length !== 0) ||
    (defaultValueSuppressions.length > 0 && (
      defaultSuppressionWarnings.length !== 1 ||
      stableStringify(defaultSuppressionWarnings[0].entityIds) !==
        stableStringify(defaultValueSuppressions.map(function (entry) { return entry.fieldId; }))
    ))
  ) {
    throw runtimeError('INVALID_PLAN', 'Plan does not disclose its exact temporary field-default suppression set.');
  }
  for (const skipped of plan.invalidContent.skippedRecords) {
    if (
      plannedRecordIds.has(skipped.id) ||
      !['must_remain_absent', 'preserve_target', 'preserve_external'].includes(skipped.disposition) ||
      typeof skipped.itemTypeId !== 'string' || typeof skipped.sourceHash !== 'string' ||
      !plan.schema.itemTypes.some(function (itemType) { return itemType.id === skipped.itemTypeId && itemType.modularBlock !== true; }) ||
      !isValiditySnapshot(skipped.sourceValidity) ||
      !Array.isArray(skipped.sourceNestedBlockIds) || !Array.isArray(skipped.targetNestedBlockIds) || !Array.isArray(skipped.preservedExternalBlockIds) ||
      skipped.sourceNestedBlockIds.some(function (id) { return typeof id !== 'string' || !id; }) ||
      skipped.targetNestedBlockIds.some(function (id) { return typeof id !== 'string' || !id; }) ||
      skipped.preservedExternalBlockIds.some(function (id) { return typeof id !== 'string' || !id; }) ||
      new Set(skipped.preservedExternalBlockIds).size !== skipped.preservedExternalBlockIds.length ||
      skipped.preservedExternalBlockIds.some(function (id) {
        return !skipped.sourceNestedBlockIds.includes(id) || skipped.targetNestedBlockIds.includes(id);
      }) ||
      !Array.isArray(skipped.reasons) || skipped.reasons.length === 0
    ) {
      throw runtimeError('INVALID_PLAN', 'Skipped record ' + String(skipped.id) + ' has an invalid preservation contract.');
    }
    if (skipped.disposition === 'must_remain_absent') {
      if (skipped.expectedTargetHash !== null || skipped.targetValidity !== null || skipped.expectedTargetPosition !== null || skipped.targetNestedBlockIds.length !== 0) {
        throw runtimeError('INVALID_PLAN', 'Absent skipped record ' + skipped.id + ' unexpectedly declares target state.');
      }
    } else if (skipped.disposition === 'preserve_target' && (
      typeof skipped.expectedTargetHash !== 'string' ||
      !isValiditySnapshot(skipped.targetValidity) ||
      (skipped.expectedTargetPosition !== null && typeof skipped.expectedTargetPosition !== 'number')
    )) {
      throw runtimeError('INVALID_PLAN', 'Preserved skipped record ' + skipped.id + ' has no exact target state.');
    } else if (
      skipped.disposition === 'preserve_external' &&
      (
        skipped.expectedTargetHash !== null || skipped.expectedTargetPosition !== null ||
        skipped.targetValidity !== null || skipped.targetNestedBlockIds.length !== 0 ||
        skipped.preservedExternalBlockIds.length !== 0
      )
    ) {
      throw runtimeError('INVALID_PLAN', 'External skipped record ' + skipped.id + ' must use an existence-only target contract.');
    }
  }
  if (plan.invalidContent.skippedRecords.some(function (skipped) {
    return !detectedRecordIdSet.has(skipped.id) || migratedRecordIdSet.has(skipped.id);
  })) {
    throw runtimeError('INVALID_PLAN', 'Skipped invalid records must be detected and disjoint from migrated invalid records.');
  }
  const unavailableSkippedIds = new Set(plan.invalidContent.skippedRecords.filter(function (entry) {
    return entry.disposition !== 'preserve_target';
  }).map(function (entry) { return entry.id; }));
  if (plan.records.some(function (record) {
    return record.desired && record.dependencies.some(function (id) { return unavailableSkippedIds.has(id); });
  })) {
    throw runtimeError('INVALID_PLAN', 'A managed record depends on skipped source content that is absent or externally shadowed in the destination.');
  }
  const managedNestedBlockIds = new Set();
  const plannedNestedBlockIds = new Set();
  for (const record of plan.records) {
    for (const snapshot of [record.baseline, record.desired]) {
      if (!snapshot) continue;
      const blocks = new Map();
      collectNestedBlocks(snapshot.current.fields, blocks);
      if (snapshot.published) collectNestedBlocks(snapshot.published.fields, blocks);
      blocks.forEach(function (_value, id) { plannedNestedBlockIds.add(id); });
      if (snapshot === record.desired) {
        blocks.forEach(function (_value, id) { managedNestedBlockIds.add(id); });
      }
    }
  }
  const transientNestedBlockIds = new Set();
  const plannedTopLevelRecordIds = new Set(plan.records.map(function (entry) { return entry.id; }));
  const releaseSchemaById = new Map(plan.schema.itemTypes.concat(plan.targetInspection.itemTypes).map(function (itemType) {
    return [itemType.id, itemType];
  }));
  for (const release of plan.execution.deleteReleases) {
    if (
      Array.isArray(release.transientNestedBlockIds) &&
      release.transientNestedBlockIds.length > 0
    ) {
      throw runtimeError(
        'INVALID_PLAN',
        'Delete-reference release ' + String(release.recordId) + ' requires fresh published-derived nested block IDs, which the CMA full-validation update path cannot create safely. Regenerate this migration with content-diff plan format V9 so the deletion component is preserved.',
      );
    }
    if (
      !Array.isArray(release.transientNestedBlockIds) ||
      release.transientNestedBlockIds.some(function (id) { return typeof id !== 'string' || !isPortableDatoId(id); }) ||
      new Set(release.transientNestedBlockIds).size !== release.transientNestedBlockIds.length ||
      stableStringify(release.transientNestedBlockIds) !== stableStringify(release.transientNestedBlockIds.slice().sort())
    ) {
      throw runtimeError('INVALID_PLAN', 'Delete-reference release ' + String(release.recordId) + ' has an invalid transient nested-block ID reservation.');
    }
    const releaseBlocks = [];
    collectNestedBlockIdentities(release.fields, releaseBlocks);
    const releaseBlockIds = new Set(releaseBlocks.map(function (block) { return block.id; }));
    const declaredIds = new Set(release.transientNestedBlockIds);
    if (releaseBlocks.length !== releaseBlockIds.size) {
      throw runtimeError('INVALID_PLAN', 'Delete-reference release ' + String(release.recordId) + ' reuses a nested block ID.');
    }
    if (
      (release.publish === true && !sameStringSet(releaseBlockIds, declaredIds)) ||
      (release.publish !== true && declaredIds.size !== 0)
    ) {
      throw runtimeError('INVALID_PLAN', 'Delete-reference release ' + String(release.recordId) + ' does not declare its exact published-derived transient nested blocks.');
    }
    for (const block of releaseBlocks) {
      const blockType = releaseSchemaById.get(block.itemTypeId);
      if (!blockType || blockType.modularBlock !== true) {
        throw runtimeError('INVALID_PLAN', 'Delete-reference release ' + String(release.recordId) + ' contains a nested item with an unknown or non-block model.');
      }
    }
    for (const id of release.transientNestedBlockIds) {
      if (
        transientNestedBlockIds.has(id) ||
        plannedNestedBlockIds.has(id) ||
        plannedTopLevelRecordIds.has(id)
      ) {
        throw runtimeError('INVALID_PLAN', 'Transient nested block ' + id + ' collides with another planned Item identity.');
      }
      transientNestedBlockIds.add(id);
      plannedNestedBlockIds.add(id);
    }
  }
  validateLegacyIdMappingPlan(plan, managedNestedBlockIds, plannedNestedBlockIds);
  if (plan.invalidContent.skippedRecords.some(function (skipped) {
    return skipped.sourceNestedBlockIds.concat(skipped.targetNestedBlockIds).some(function (id) {
      return managedNestedBlockIds.has(id) || transientNestedBlockIds.has(id);
    });
  })) {
    throw runtimeError('INVALID_PLAN', 'A skipped aggregate reserves a nested block ID used by managed or transient content.');
  }

  const createIds = plan.records.filter(function (entry) { return entry.action === 'create'; }).map(function (entry) { return entry.id; });
  const deleteIds = plan.records.filter(function (entry) { return entry.action === 'delete'; }).map(function (entry) { return entry.id; });
  assertOrderContains(plan.execution.createOrder, createIds, 'record create');
  const publicationIds = plan.records.filter(function (entry) { return entry.desired; }).map(function (entry) { return entry.id; });
  assertOrderContains(plan.execution.publishOrder, publicationIds, 'record publication');
  assertOrderContains(plan.execution.deleteOrder, deleteIds, 'record delete');
  if (plan.execution.shellRecordIds.some(function (id) { return !createIds.includes(id); })) {
    throw runtimeError('INVALID_PLAN', 'Execution shellRecordIds must contain only source-only record IDs.');
  }
  const shellComponentIds = [];
  for (const component of plan.execution.shellComponents) {
    if (
      !Array.isArray(component) ||
      component.length === 0 ||
      component.some(function (id) { return typeof id !== 'string' || !plan.execution.shellRecordIds.includes(id); }) ||
      new Set(component).size !== component.length ||
      stableStringify(component) !== stableStringify(component.slice().sort())
    ) {
      throw runtimeError('INVALID_PLAN', 'Execution shellComponents must contain non-empty, sorted, unique shell-record ID arrays.');
    }
    shellComponentIds.push.apply(shellComponentIds, component);
  }
  if (
    new Set(plan.execution.shellRecordIds).size !== plan.execution.shellRecordIds.length ||
    new Set(shellComponentIds).size !== shellComponentIds.length ||
    stableStringify(plan.execution.shellRecordIds) !== stableStringify(plan.execution.shellRecordIds.slice().sort()) ||
    stableStringify(plan.execution.shellComponents) !== stableStringify(plan.execution.shellComponents.slice().sort(function (left, right) { return left.join(',').localeCompare(right.join(',')); })) ||
    stableStringify(plan.execution.shellRecordIds.slice().sort()) !== stableStringify(shellComponentIds.slice().sort())
  ) {
    throw runtimeError('INVALID_PLAN', 'Execution shellComponents must partition shellRecordIds exactly once.');
  }
  if (plan.execution.publicationSeedOrder.some(function (id) {
    const record = plan.records.find(function (entry) { return entry.id === id; });
    return !record || record.action !== 'create' || !record.desired || !record.desired.published;
  })) {
    throw runtimeError('INVALID_PLAN', 'Execution publicationSeedOrder must contain only source-only records with a desired published state.');
  }
  for (const id of plan.execution.shellRecordIds) {
    const shell = plan.records.find(function (entry) { return entry.id === id; });
    const itemType = shell && plan.schema.itemTypes.find(function (entry) { return entry.id === shell.itemTypeId; });
    if (!itemType || (!(itemType.draftModeActive && itemType.draftSavingActive) && !relaxedRecordIds.has(id))) {
      throw runtimeError('INVALID_PLAN', 'Record shell ' + id + ' requires native invalid-draft saving or an exact validator relaxation.');
    }
  }
  if (plan.execution.revalidateBeforePublishIds.some(function (id) {
    const record = plan.records.find(function (entry) { return entry.id === id; });
    const deleteReleasePublishes = plan.execution.deleteReleases.some(function (release) {
      return release.recordId === id && release.publish === true;
    });
    return !record || (!(record.desired && record.desired.published) && !deleteReleasePublishes) || !relaxedRecordIds.has(id);
  })) {
    throw runtimeError('INVALID_PLAN', 'Execution revalidateBeforePublishIds contains a record outside the validator-relaxation publication set.');
  }

  if (!plan.options || plan.options.includeDeletions !== true) {
    if (plan.records.some(function (entry) { return entry.action === 'delete'; }) || plan.uploads.some(function (entry) { return entry.action === 'delete'; })) {
      throw runtimeError('INVALID_PLAN', 'Plan contains deletions without includeDeletions enabled.');
    }
  } else if (!plan.targetPreconditions) {
    throw runtimeError('INVALID_PLAN', 'A destructive plan must include exact target-set preconditions.');
  }

  for (const entry of plan.records) {
    if (!['create', 'update', 'delete', 'noop'].includes(entry.action)) {
      throw runtimeError('INVALID_PLAN', 'Record ' + entry.id + ' has an invalid action.');
    }
    if (entry.action === 'delete' && entry.desired !== null) {
      throw runtimeError('INVALID_PLAN', 'Deleted record ' + entry.id + ' unexpectedly has desired state.');
    }
    if (entry.action !== 'delete' && !entry.desired) {
      throw runtimeError('INVALID_PLAN', 'Record ' + entry.id + ' has no desired state.');
    }
    if (entry.action === 'noop' && (
      !entry.baseline || entry.baseline.hash !== entry.desired.hash || entry.expectedTargetHash !== entry.desired.hash ||
      stableStringify(entry.baseline.validity) !== stableStringify(entry.desired.validity)
    )) {
      throw runtimeError('INVALID_PLAN', 'No-op record ' + entry.id + ' must contain identical baseline and desired states.');
    }
    if (!Array.isArray(entry.publishedDependencies) || entry.publishedDependencies.some(function (id) { return typeof id !== 'string' || !id; })) {
      throw runtimeError('INVALID_PLAN', 'Record ' + entry.id + ' has invalid publishedDependencies.');
    }
    if ((entry.baseline && !isValiditySnapshot(entry.baseline.validity)) || (entry.desired && !isValiditySnapshot(entry.desired.validity))) {
      throw runtimeError('INVALID_PLAN', 'Record ' + entry.id + ' has invalid validity expectations.');
    }
    if (entry.desired) {
      const itemType = plan.schema.itemTypes.find(function (candidate) { return candidate.id === entry.itemTypeId; });
      if (!itemType) {
        throw runtimeError('INVALID_PLAN', 'Record ' + entry.id + ' refers to missing item type ' + entry.itemTypeId + '.');
      }
      if (!itemType.draftModeActive && (!entry.desired.published || entry.desired.published.hash !== entry.desired.current.hash)) {
        throw runtimeError('UNSUPPORTED_CONTENT_STATE', 'No-draft item type ' + entry.itemTypeId + ' cannot represent different current and published states.');
      }
    }
  }
  const unsupportedFreshNestedUpdate = findUnsupportedFreshNestedBlockUpdates(plan.records)[0];
  if (unsupportedFreshNestedUpdate) {
    throw runtimeError(
      'INVALID_PLAN',
      'Record ' + unsupportedFreshNestedUpdate.recordId + ' would introduce fresh nested block ' + unsupportedFreshNestedUpdate.blockId + ' during ' + unsupportedFreshNestedUpdate.stage + '. CMA can only rehydrate nested block IDs already present in the immediately preceding CURRENT version.',
      unsupportedFreshNestedUpdate,
    );
  }
  for (const entry of plan.uploads) {
    if (!['create', 'update', 'delete', 'noop'].includes(entry.action)) {
      throw runtimeError('INVALID_PLAN', 'Upload ' + entry.id + ' has an invalid action.');
    }
    if (entry.action === 'delete' ? entry.desired !== null : !entry.desired) {
      throw runtimeError('INVALID_PLAN', 'Upload ' + entry.id + ' has state inconsistent with its action.');
    }
    if (entry.action === 'noop' && (!entry.baseline || entry.baseline.hash !== entry.desired.hash || entry.expectedTargetHash !== entry.desired.hash)) {
      throw runtimeError('INVALID_PLAN', 'No-op upload ' + entry.id + ' must contain identical baseline and desired states.');
    }
  }
  for (const release of plan.execution.uniqueReleases) {
    const owner = plan.records.find(function (entry) { return entry.id === release.recordId; });
    if (!owner || owner.action !== 'update' || !isObject(release.fields) || typeof release.intermediateCurrentHash !== 'string' || !Array.isArray(owner.allowedIntermediateHashes) || !owner.allowedIntermediateHashes.includes(release.intermediateCurrentHash)) {
      throw runtimeError('INVALID_PLAN', 'Unique-value release contains an invalid owner, field payload, or intermediate hash.');
    }
    const invalidField = findInvalidUniqueReleaseField(plan, owner, release);
    if (invalidField) {
      throw runtimeError(
        'INVALID_PLAN',
        'Unique-value release ' + release.recordId + '.' + invalidField.fieldApiKey + ' ' + invalidField.reason + '.',
        { recordId: release.recordId, fieldApiKey: invalidField.fieldApiKey },
      );
    }
  }
  const deleteReleaseOwners = new Set();
  for (const release of plan.execution.deleteReleases) {
    const owner = plan.records.find(function (entry) { return entry.id === release.recordId; });
    if (
      !owner || owner.action !== 'delete' || deleteReleaseOwners.has(release.recordId) ||
      !isObject(release.fields) || typeof release.intermediateCurrentHash !== 'string' ||
      semanticHash(release.fields) !== release.intermediateCurrentHash || typeof release.publish !== 'boolean' ||
      !Array.isArray(release.transientNestedBlockIds) ||
      !Array.isArray(owner.allowedIntermediateHashes) || !owner.allowedIntermediateHashes.includes(release.intermediateCurrentHash)
    ) {
      throw runtimeError('INVALID_PLAN', 'Delete-reference release contains an invalid owner, field payload, publication flag, or intermediate hash.');
    }
    deleteReleaseOwners.add(release.recordId);
  }
}

function findInvalidUniqueReleaseField(plan, owner, release) {
  const itemType = plan.schema.itemTypes.find(function (entry) { return entry.id === owner.itemTypeId; });
  if (!itemType) {
    return { fieldApiKey: '<item-type>', reason: 'does not belong to a managed item type' };
  }
  const fieldApiKeys = Object.keys(release.fields).sort();
  if (!fieldApiKeys.length) {
    return { fieldApiKey: '<empty>', reason: 'contains no field release' };
  }
  for (const fieldApiKey of fieldApiKeys) {
    const field = itemType.fields.find(function (entry) { return entry.apiKey === fieldApiKey; });
    if (
      !field ||
      !['link', 'slug', 'string'].includes(field.fieldType) ||
      !isObject(field.validators) ||
      !Object.prototype.hasOwnProperty.call(field.validators, 'unique')
    ) {
      return {
        fieldApiKey,
        reason: 'does not resolve to a string, slug, or link field carrying a unique validator',
      };
    }
    if (!isUniqueReleaseScalarValue(release.fields[fieldApiKey], field.localized)) {
      return {
        fieldApiKey,
        reason: 'contains a non-scalar or embedded value instead of string/null unique data',
      };
    }
  }
  return null;
}

function isUniqueReleaseScalarValue(value, localized) {
  const isScalar = function (candidate) {
    return candidate === null || typeof candidate === 'string';
  };
  if (!localized) return isScalar(value);
  return isObject(value) && Object.values(value).every(isScalar);
}

function validateTargetInspection(plan) {
  const inspection = plan.targetInspection;
  if (!isObject(inspection) || !Array.isArray(inspection.itemTypes) || typeof inspection.digest !== 'string') {
    throw runtimeError('INVALID_PLAN', 'Content diff plan is missing the destination inspection-schema contract.');
  }
  const managedItemTypeIds = new Set(plan.schema.itemTypes.map(function (itemType) { return itemType.id; }));
  const managedFieldIds = new Set(plan.schema.itemTypes.flatMap(function (itemType) {
    return itemType.fields.map(function (field) { return field.id; });
  }));
  const inspectionItemTypeIds = new Set();
  const inspectionFieldIds = new Set();
  let previousItemTypeId = null;
  for (const itemType of inspection.itemTypes) {
    if (
      !isObject(itemType) || typeof itemType.id !== 'string' || !itemType.id ||
      typeof itemType.apiKey !== 'string' || !itemType.apiKey || itemType.modularBlock !== true ||
      !Array.isArray(itemType.fields) || managedItemTypeIds.has(itemType.id) ||
      inspectionItemTypeIds.has(itemType.id) ||
      (previousItemTypeId !== null && itemType.id.localeCompare(previousItemTypeId) <= 0)
    ) {
      throw runtimeError('INVALID_PLAN', 'Destination inspection item types must be distinct, sorted, out-of-scope modular block models.');
    }
    inspectionItemTypeIds.add(itemType.id);
    previousItemTypeId = itemType.id;
    for (const field of itemType.fields) {
      if (
        !isObject(field) || typeof field.id !== 'string' || !field.id ||
        typeof field.apiKey !== 'string' || !field.apiKey || typeof field.fieldType !== 'string' ||
        typeof field.localized !== 'boolean' || typeof field.position !== 'number' ||
        !isObject(field.validators) || managedFieldIds.has(field.id) || inspectionFieldIds.has(field.id)
      ) {
        throw runtimeError('INVALID_PLAN', 'Destination inspection schema contains an invalid or colliding field.');
      }
      inspectionFieldIds.add(field.id);
    }
  }
  if (inspectionItemTypesDigest(inspection.itemTypes) !== inspection.digest) {
    throw runtimeError('INVALID_PLAN', 'Destination inspection-schema digest does not match its item types.');
  }
}

function validateLegacyIdMappingPlan(plan, managedNestedBlockIds, plannedNestedBlockIds) {
  const mappingPlan = plan.legacyIdMappings;
  const mappingSchema = mappingPlan && mappingPlan.schema;
  if (
    !isObject(mappingPlan) ||
    mappingPlan.formatVersion !== LEGACY_ID_MAPPING_FORMAT_VERSION ||
    !isObject(mappingSchema) ||
    !isObject(mappingSchema.model) ||
    !isObject(mappingSchema.nameField) ||
    !isObject(mappingSchema.mappingField) ||
    typeof mappingSchema.model.id !== 'string' ||
    !mappingSchema.model.id ||
    !['existing', 'new'].includes(mappingSchema.model.status) ||
    (mappingSchema.model.status === 'new' && !isPortableDatoId(mappingSchema.model.id)) ||
    mappingSchema.model.apiKey !== LEGACY_ID_MAPPING_MODEL_API_KEY ||
    mappingSchema.model.name !== LEGACY_ID_MAPPING_MODEL_NAME ||
    mappingSchema.model.modularBlock !== false ||
    mappingSchema.model.singleton !== false ||
    mappingSchema.model.sortable !== false ||
    mappingSchema.model.tree !== false ||
    mappingSchema.model.draftModeActive !== true ||
    mappingSchema.model.draftSavingActive !== false ||
    mappingSchema.model.allLocalesRequired !== false ||
    mappingSchema.model.inverseRelationshipsEnabled !== false ||
    mappingSchema.model.workflowId !== null ||
    typeof mappingSchema.nameField.id !== 'string' ||
    !mappingSchema.nameField.id ||
    !['existing', 'new'].includes(mappingSchema.nameField.status) ||
    (mappingSchema.nameField.status === 'new' && !isPortableDatoId(mappingSchema.nameField.id)) ||
    mappingSchema.nameField.apiKey !== LEGACY_ID_MAPPING_NAME_FIELD_API_KEY ||
    mappingSchema.nameField.label !== LEGACY_ID_MAPPING_NAME_FIELD_LABEL ||
    mappingSchema.nameField.fieldType !== 'string' ||
    mappingSchema.nameField.localized !== false ||
    mappingSchema.nameField.position !== 1 ||
    stableStringify(mappingSchema.nameField.validators) !== stableStringify({ required: {}, unique: {} }) ||
    typeof mappingSchema.mappingField.id !== 'string' ||
    !mappingSchema.mappingField.id ||
    !['existing', 'new'].includes(mappingSchema.mappingField.status) ||
    (mappingSchema.mappingField.status === 'new' && !isPortableDatoId(mappingSchema.mappingField.id)) ||
    mappingSchema.mappingField.apiKey !== LEGACY_ID_MAPPING_FIELD_API_KEY ||
    mappingSchema.mappingField.label !== LEGACY_ID_MAPPING_FIELD_LABEL ||
    mappingSchema.mappingField.fieldType !== 'json' ||
    mappingSchema.mappingField.localized !== false ||
    mappingSchema.mappingField.position !== 2 ||
    stableStringify(mappingSchema.mappingField.validators) !== stableStringify({ required: {} }) ||
    mappingSchema.nameField.status !== mappingSchema.model.status ||
    mappingSchema.mappingField.status !== mappingSchema.model.status ||
    !Array.isArray(mappingPlan.existingMappingRecords) ||
    !Array.isArray(mappingPlan.entries) ||
    !Array.isArray(mappingPlan.skippedEntries) ||
    !(mappingPlan.newMappingBatch === null || isObject(mappingPlan.newMappingBatch))
  ) {
    throw runtimeError('INVALID_PLAN', 'Content diff plan has an invalid legacy-ID mapping contract.');
  }
  let previousExistingMappingRecordId = null;
  const existingMappingRecordIds = new Set();
  for (const record of mappingPlan.existingMappingRecords) {
    if (
      !isObject(record) ||
      !isPortableDatoId(record.id) ||
      typeof record.hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(record.hash) ||
      stableStringify(Object.keys(record).sort()) !== stableStringify(['hash', 'id']) ||
      (previousExistingMappingRecordId !== null && record.id.localeCompare(previousExistingMappingRecordId) <= 0)
    ) {
      throw runtimeError('INVALID_PLAN', 'Existing legacy-ID mapping records must have unique portable IDs, exact hashes, and deterministic ordering.');
    }
    previousExistingMappingRecordId = record.id;
    existingMappingRecordIds.add(record.id);
  }
  let previousSkippedEntrySortKey = null;
  const skippedSourceClaims = new Set();
  for (const entry of mappingPlan.skippedEntries) {
    const sortKey = isObject(entry) && typeof entry.entityType === 'string' && typeof entry.sourceId === 'string' && typeof entry.reason === 'string'
      ? entry.entityType + '\u0000' + entry.sourceId + '\u0000' + entry.reason
      : null;
    const sourceKey = isObject(entry) && typeof entry.entityType === 'string' && typeof entry.sourceId === 'string'
      ? legacyIdMappingKey(entry.entityType, entry.sourceId)
      : null;
    if (
      !isObject(entry) ||
      !LEGACY_ID_MAPPING_ENTITY_TYPES.has(entry.entityType) ||
      !isCanonicalLegacyDatoId(entry.sourceId) ||
      typeof entry.reason !== 'string' ||
      !entry.reason ||
      stableStringify(Object.keys(entry).sort()) !== stableStringify(['entityType', 'reason', 'sourceId']) ||
      sortKey === null ||
      (previousSkippedEntrySortKey !== null && sortKey.localeCompare(previousSkippedEntrySortKey) <= 0) ||
      sourceKey === null ||
      skippedSourceClaims.has(sourceKey)
    ) {
      throw runtimeError('INVALID_PLAN', 'Skipped legacy-ID mapping diagnostics must be canonical, unique, and deterministically sorted.');
    }
    previousSkippedEntrySortKey = sortKey;
    skippedSourceClaims.add(sourceKey);
  }
  const newSchemaEntries = [mappingSchema.model, mappingSchema.nameField, mappingSchema.mappingField]
    .filter(function (entry) { return entry.status === 'new'; });
  const managedSchemaIds = new Set();
  for (const itemType of plan.schema.itemTypes) {
    managedSchemaIds.add(itemType.id);
    for (const field of itemType.fields) managedSchemaIds.add(field.id);
  }
  if (
    new Set(newSchemaEntries.map(function (entry) { return entry.id; })).size !== newSchemaEntries.length ||
    newSchemaEntries.some(function (entry) { return managedSchemaIds.has(entry.id); })
  ) {
    throw runtimeError('INVALID_PLAN', 'Internal legacy-ID mapping schema IDs collide with managed schema IDs.');
  }

  const expectedTargetIds = {
    record: new Set(plan.records.filter(function (entry) { return entry.desired; }).map(function (entry) { return entry.id; })),
    block: managedNestedBlockIds,
    upload: new Set(plan.uploads.filter(function (entry) { return entry.desired; }).map(function (entry) { return entry.id; })),
    upload_collection: new Set(plan.uploadCollections.filter(function (entry) { return entry.desired; }).map(function (entry) { return entry.id; })),
  };
  const allPlannedTargetIds = {
    record: new Set(plan.records.map(function (entry) { return entry.id; })),
    block: plannedNestedBlockIds,
    upload: new Set(plan.uploads.map(function (entry) { return entry.id; })),
    upload_collection: new Set(plan.uploadCollections.map(function (entry) { return entry.id; })),
  };
  const expectedManagedAvailability = collectManagedLegacyIdMappingAvailability(plan);
  const expectedExternalAvailability = collectExternalLegacyIdMappingAvailability(plan);
  const sourceClaims = new Map();
  const targetClaims = new Map();
  let previousEntrySortKey = null;
  for (const entry of mappingPlan.entries) {
    validateLegacyIdMappingEntry(entry, true, 'plan entry');
    const sourceKey = legacyIdMappingKey(entry.entityType, entry.sourceId);
    const targetKey = legacyIdMappingKey(entry.entityType, entry.targetId);
    const entrySortKey = legacyIdMappingSortKey(entry.entityType, entry.sourceId);
    if (previousEntrySortKey !== null && entrySortKey.localeCompare(previousEntrySortKey) <= 0) {
      throw runtimeError('INVALID_PLAN', 'Legacy-ID mapping plan entries must be uniquely sorted by entity type and source ID.');
    }
    previousEntrySortKey = entrySortKey;
    if (sourceClaims.has(sourceKey) || targetClaims.has(targetKey)) {
      throw runtimeError('INVALID_PLAN', 'Legacy-ID mapping plan contains duplicate source or target claims.', {
        entityType: entry.entityType,
        sourceId: entry.sourceId,
        targetId: entry.targetId,
      });
    }
    if (skippedSourceClaims.has(sourceKey)) {
      throw runtimeError('INVALID_PLAN', 'A legacy source ID cannot be both migrated and reported as skipped.');
    }
    if (entry.managed) {
      if (!expectedTargetIds[entry.entityType].has(entry.targetId)) {
        throw runtimeError('INVALID_PLAN', 'Managed legacy-ID mapping target ' + entry.targetId + ' is not present as a final managed ' + entry.entityType + '.');
      }
      const expectedAvailability = expectedManagedAvailability.get(targetKey);
      if (!expectedAvailability || stableStringify(entry.requiredAvailability) !== stableStringify(expectedAvailability)) {
        throw runtimeError('INVALID_PLAN', 'Managed legacy-ID mapping target ' + entry.targetId + ' has availability metadata inconsistent with its final managed state.');
      }
    } else {
      if (entry.status !== 'existing' || entry.entityType !== 'record') {
        throw runtimeError('INVALID_PLAN', 'Only existing record aliases can be declared external to the managed content scope.');
      }
      const belongsToAnyPlannedEntity = entry.entityType === 'record' || entry.entityType === 'block'
        ? allPlannedTargetIds.record.has(entry.targetId) || allPlannedTargetIds.block.has(entry.targetId)
        : allPlannedTargetIds[entry.entityType].has(entry.targetId);
      if (belongsToAnyPlannedEntity) {
        throw runtimeError('INVALID_PLAN', 'External legacy-ID mapping target ' + entry.targetId + ' is also managed, deleted, or otherwise owned by this plan.');
      }
      const expectedAvailability = expectedExternalAvailability.get(targetKey);
      if (!expectedAvailability || stableStringify(entry.requiredAvailability) !== stableStringify(expectedAvailability)) {
        throw runtimeError('INVALID_PLAN', 'External legacy-ID mapping target ' + entry.targetId + ' is unused or has availability metadata inconsistent with final rewritten dependencies.');
      }
    }
    sourceClaims.set(sourceKey, entry);
    targetClaims.set(targetKey, entry);
  }

  const mappedItemTargetIds = new Set(mappingPlan.entries.filter(function (entry) {
    return entry.entityType === 'record' || entry.entityType === 'block';
  }).map(function (entry) { return entry.targetId; }));
  for (const targetId of mappedItemTargetIds) {
    if (existingMappingRecordIds.has(targetId)) {
      throw runtimeError('INVALID_PLAN', 'Legacy Item mapping target ' + targetId + ' collides with an existing internal mapping record ID.');
    }
  }

  const newEntries = mappingPlan.entries.filter(function (entry) { return entry.status === 'new'; });
  const mappingBatch = mappingPlan.newMappingBatch;
  if ((newEntries.length === 0) !== (mappingBatch === null)) {
    throw runtimeError('INVALID_PLAN', 'Legacy-ID mapping batch presence does not match the plan\'s new mappings.');
  }
  if (mappingBatch === null) return;
  if (
    !isPortableDatoId(mappingBatch.batchId) ||
    typeof mappingBatch.wholeHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(mappingBatch.wholeHash) ||
    !Array.isArray(mappingBatch.chunks) ||
    mappingBatch.chunks.length === 0 ||
    sha256(stableStringify(newEntries.map(function (entry) {
      return {
        entityType: entry.entityType,
        sourceId: entry.sourceId,
        targetId: entry.targetId,
      };
    }))) !== mappingBatch.wholeHash
  ) {
    throw runtimeError('INVALID_PLAN', 'Content diff plan has invalid legacy-ID mapping batch metadata.');
  }

  const coveredNewEntries = [];
  const mappingRecordIds = new Set();
  const mappingRecordNames = new Set();
  const reservedItemIds = new Set(plan.records.map(function (entry) { return entry.id; }));
  plannedNestedBlockIds.forEach(function (id) { reservedItemIds.add(id); });
  mappedItemTargetIds.forEach(function (id) { reservedItemIds.add(id); });

  for (let index = 0; index < mappingBatch.chunks.length; index += 1) {
    const mappingRecord = mappingBatch.chunks[index];
    if (
      !isObject(mappingRecord) ||
      !isPortableDatoId(mappingRecord.id) ||
      mappingRecordIds.has(mappingRecord.id) ||
      existingMappingRecordIds.has(mappingRecord.id) ||
      reservedItemIds.has(mappingRecord.id) ||
      typeof mappingRecord.name !== 'string' ||
      !mappingRecord.name ||
      mappingRecord.name !== legacyIdMappingChunkName(mappingBatch.batchId, index, mappingBatch.chunks.length) ||
      mappingRecordNames.has(mappingRecord.name) ||
      mappingRecord.chunkIndex !== index ||
      mappingRecord.chunkCount !== mappingBatch.chunks.length ||
      typeof mappingRecord.hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(mappingRecord.hash) ||
      !Number.isInteger(mappingRecord.byteLength) ||
      mappingRecord.byteLength <= 0 ||
      mappingRecord.byteLength > LEGACY_ID_MAPPING_MAX_DOCUMENT_BYTES ||
      typeof mappingRecord.serializedDocument !== 'string' ||
      !isObject(mappingRecord.document) ||
      mappingRecord.document.formatVersion !== LEGACY_ID_MAPPING_FORMAT_VERSION ||
      mappingRecord.document.projectId !== plan.target.siteId ||
      mappingRecord.document.batchId !== mappingBatch.batchId ||
      mappingRecord.document.chunkIndex !== mappingRecord.chunkIndex ||
      mappingRecord.document.chunkCount !== mappingRecord.chunkCount ||
      mappingRecord.document.wholeHash !== mappingBatch.wholeHash ||
      !Array.isArray(mappingRecord.document.entries) ||
      mappingRecord.document.entries.length === 0 ||
      stableStringify(Object.keys(mappingRecord.document).sort()) !==
        stableStringify(['batchId', 'chunkCount', 'chunkIndex', 'entries', 'formatVersion', 'projectId', 'wholeHash'].sort())
    ) {
      throw runtimeError('INVALID_PLAN', 'Legacy-ID mapping plan contains an invalid mapping record chunk.');
    }
    mappingRecordIds.add(mappingRecord.id);
    mappingRecordNames.add(mappingRecord.name);

    const documentBytes = canonicalPrettyStringify(mappingRecord.document);
    if (
      mappingRecord.serializedDocument !== documentBytes ||
      sha256(documentBytes) !== mappingRecord.hash ||
      utf8ByteLength(documentBytes) !== mappingRecord.byteLength
    ) {
      throw runtimeError('INVALID_PLAN', 'Legacy-ID mapping record ' + mappingRecord.id + ' has invalid hash or byte-length metadata.');
    }

    let previousDocumentEntrySortKey = null;
    for (const entry of mappingRecord.document.entries) {
      validateLegacyIdMappingEntry(entry, false, 'mapping document entry');
      const entryKey = legacyIdMappingKey(entry.entityType, entry.sourceId);
      const entrySortKey = legacyIdMappingSortKey(entry.entityType, entry.sourceId);
      if (previousDocumentEntrySortKey !== null && entrySortKey.localeCompare(previousDocumentEntrySortKey) <= 0) {
        throw runtimeError('INVALID_PLAN', 'Legacy-ID mapping document ' + mappingRecord.id + ' entries must be uniquely sorted.');
      }
      previousDocumentEntrySortKey = entrySortKey;
      const planned = sourceClaims.get(entryKey);
      if (!planned || planned.entityType !== entry.entityType || planned.status !== 'new' || planned.targetId !== entry.targetId) {
        throw runtimeError('INVALID_PLAN', 'Legacy-ID mapping document ' + mappingRecord.id + ' contains an entry not declared as new by the plan.');
      }
      coveredNewEntries.push(entry);
    }
  }
  if (
    stableStringify(coveredNewEntries) !==
    stableStringify(newEntries.map(function (entry) {
      return {
        entityType: entry.entityType,
        sourceId: entry.sourceId,
        targetId: entry.targetId,
      };
    }))
  ) {
    throw runtimeError('INVALID_PLAN', 'Legacy-ID mapping chunks do not cover every new mapping exactly once.');
  }
  const createsMappingSchema = [mappingSchema.model, mappingSchema.nameField, mappingSchema.mappingField]
    .some(function (entry) { return entry.status === 'new'; });
  if (mappingBatch !== null && createsMappingSchema && plan.requiredPermissions.editSchema !== true) {
    throw runtimeError('INVALID_PLAN', 'Creating the internal datocms_content_diff schema requires schema-edit permission.');
  }
}

function validateLegacyIdMappingEntry(entry, includeStatus, label) {
  if (
    !isObject(entry) ||
    !LEGACY_ID_MAPPING_ENTITY_TYPES.has(entry.entityType) ||
    typeof entry.sourceId !== 'string' ||
    !isCanonicalLegacyDatoId(entry.sourceId) ||
    typeof entry.targetId !== 'string' ||
    !isPortableDatoId(entry.targetId) ||
    entry.sourceId === entry.targetId ||
    (includeStatus && (
      !['existing', 'new'].includes(entry.status) ||
      typeof entry.managed !== 'boolean' ||
      !(entry.expectedItemTypeId === null || (typeof entry.expectedItemTypeId === 'string' && entry.expectedItemTypeId)) ||
      !isObject(entry.requiredAvailability) ||
      typeof entry.requiredAvailability.current !== 'boolean' ||
      typeof entry.requiredAvailability.published !== 'boolean' ||
      stableStringify(Object.keys(entry.requiredAvailability).sort()) !== stableStringify(['current', 'published']) ||
      stableStringify(Object.keys(entry).sort()) !== stableStringify(['entityType', 'expectedItemTypeId', 'managed', 'requiredAvailability', 'sourceId', 'status', 'targetId']) ||
      (entry.status === 'new' && entry.managed !== true) ||
      (entry.managed === true && entry.expectedItemTypeId !== null) ||
      (entry.managed === false && (entry.entityType !== 'record' || typeof entry.expectedItemTypeId !== 'string' || !entry.expectedItemTypeId))
    )) ||
    (!includeStatus && (
      Object.prototype.hasOwnProperty.call(entry, 'status') ||
      Object.prototype.hasOwnProperty.call(entry, 'managed') ||
      Object.prototype.hasOwnProperty.call(entry, 'expectedItemTypeId') ||
      Object.prototype.hasOwnProperty.call(entry, 'requiredAvailability') ||
      stableStringify(Object.keys(entry).sort()) !== stableStringify(['entityType', 'sourceId', 'targetId'])
    ))
  ) {
    throw runtimeError('INVALID_PLAN', 'Invalid legacy-ID ' + label + '.');
  }
}

function isCanonicalLegacyDatoId(id) {
  if (typeof id !== 'string' || !/^(0|[1-9]\d*)$/.test(id)) return false;
  try {
    return BigInt(id) <= BigInt('281474976710655');
  } catch (_error) {
    return false;
  }
}

function collectManagedLegacyIdMappingAvailability(plan) {
  const availability = new Map();
  for (const record of plan.records) {
    if (!record.desired) continue;
    availability.set(legacyIdMappingKey('record', record.id), {
      current: true,
      published: record.desired.published !== null,
    });
    const currentBlocks = new Map();
    collectNestedBlocks(record.desired.current.fields, currentBlocks);
    const publishedBlocks = new Map();
    if (record.desired.published) collectNestedBlocks(record.desired.published.fields, publishedBlocks);
    for (const blockId of new Set(Array.from(currentBlocks.keys()).concat(Array.from(publishedBlocks.keys())))) {
      availability.set(legacyIdMappingKey('block', blockId), {
        current: currentBlocks.has(blockId),
        published: publishedBlocks.has(blockId),
      });
    }
  }
  for (const upload of plan.uploads) {
    if (upload.desired) availability.set(legacyIdMappingKey('upload', upload.id), { current: true, published: false });
  }
  for (const collection of plan.uploadCollections) {
    if (collection.desired) availability.set(legacyIdMappingKey('upload_collection', collection.id), { current: true, published: false });
  }
  return availability;
}

function collectExternalLegacyIdMappingAvailability(plan) {
  const availability = new Map();
  const schemaById = new Map(plan.schema.itemTypes.map(function (entry) { return [entry.id, entry]; }));
  const captureSchemaById = new Map(plan.schema.itemTypes.concat(plan.targetInspection.itemTypes).map(function (entry) {
    return [entry.id, entry];
  }));
  const collectorContext = { schemaById, captureSchemaById };
  const mark = function (entityType, id, published) {
    const key = legacyIdMappingKey(entityType, id);
    const current = availability.get(key) || { current: false, published: false };
    current.current = true;
    if (published) current.published = true;
    availability.set(key, current);
  };
  for (const record of plan.records) {
    if (!record.desired) continue;
    const itemType = schemaById.get(record.itemTypeId);
    if (!itemType) continue;
    collectRecordReferencesFromFields(record.desired.current.fields, itemType, collectorContext).forEach(function (id) {
      mark('record', id, false);
    });
    if (record.desired.topology.parentId) mark('record', record.desired.topology.parentId, false);
    if (record.desired.published) {
      collectRecordReferencesFromFields(record.desired.published.fields, itemType, collectorContext).forEach(function (id) {
        mark('record', id, true);
      });
    }
    const currentUploads = new Set();
    collectUploadReferencesFromFields(record.desired.current.fields, itemType, collectorContext, currentUploads);
    currentUploads.forEach(function (id) { mark('upload', id, false); });
    if (record.desired.published) {
      const publishedUploads = new Set();
      collectUploadReferencesFromFields(record.desired.published.fields, itemType, collectorContext, publishedUploads);
      publishedUploads.forEach(function (id) { mark('upload', id, false); });
    }
  }
  for (const upload of plan.uploads) {
    if (upload.desired && upload.desired.manual.collectionId) {
      mark('upload_collection', upload.desired.manual.collectionId, false);
    }
  }
  return availability;
}

function legacyIdMappingKey(entityType, id) {
  return legacyIdMappingNamespace(entityType) + '\u0000' + id;
}

function legacyIdMappingNamespace(entityType) {
  return entityType === 'record' || entityType === 'block' ? 'item' : entityType;
}

function legacyIdMappingSortKey(entityType, id) {
  return entityType + '\u0000' + id;
}

function utf8ByteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function canonicalPrettyStringify(value) {
  return JSON.stringify(canonicalizeJson(value), null, 2);
}

function isPortableDatoId(id) {
  try {
    const bytes = Buffer.from(id, 'base64url');
    return bytes.length === 16 &&
      (bytes[6] & 0xf0) === 0x40 &&
      (bytes[8] & 0xc0) === 0x80 &&
      bytes.toString('base64url') === id;
  } catch (_error) {
    return false;
  }
}

function findNonPortableCreateIds(plan) {
  const candidates = new Set();
  const schemaById = new Map(plan.schema.itemTypes.map(function (itemType) {
    return [itemType.id, itemType];
  }));
  const captureSchemaById = new Map(
    plan.schema.itemTypes.concat(plan.targetInspection.itemTypes).map(function (itemType) {
      return [itemType.id, itemType];
    })
  );
  const collectorContext = { captureSchemaById: captureSchemaById };
  for (const record of plan.records) {
    if (record.action !== 'create' || !record.desired) continue;
    candidates.add(record.id);
    const itemType = schemaById.get(record.itemTypeId);
    if (!itemType) continue;
    const locations = new Map();
    collectBlockOwnershipLocations(
      record.desired.current.fields,
      itemType,
      collectorContext,
      record.id,
      locations,
      ''
    );
    if (record.desired.published) {
      collectBlockOwnershipLocations(
        record.desired.published.fields,
        itemType,
        collectorContext,
        record.id,
        locations,
        ''
      );
    }
    for (const blockId of locations.keys()) {
      candidates.add(blockId);
    }
  }
  for (const upload of plan.uploads) {
    if (upload.action === 'create') candidates.add(upload.id);
  }
  for (const collection of plan.uploadCollections) {
    if (collection.action === 'create') candidates.add(collection.id);
  }
  return Array.from(candidates).filter(function (id) {
    return !isPortableDatoId(id);
  }).sort();
}

function findRecordSnapshotIdentityMismatches(plan) {
  const mismatches = [];
  for (const record of plan.records) {
    if (record.baseline && record.baseline.id !== record.id) {
      mismatches.push(record.id + ':baseline=' + String(record.baseline.id));
    }
    if (record.baseline && record.baseline.itemTypeId !== record.itemTypeId) {
      mismatches.push(record.id + ':baselineItemType=' + String(record.baseline.itemTypeId));
    }
    if (record.desired && record.desired.id !== record.id) {
      mismatches.push(record.id + ':desired=' + String(record.desired.id));
    }
    if (record.desired && record.desired.itemTypeId !== record.itemTypeId) {
      mismatches.push(record.id + ':desiredItemType=' + String(record.desired.itemTypeId));
    }
  }
  return mismatches.sort();
}

function assertUniqueIds(entries, label) {
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) {
      throw runtimeError('INVALID_PLAN', 'Plan contains an invalid ' + label + ' ID.');
    }
    if (ids.has(entry.id)) {
      throw runtimeError('INVALID_PLAN', 'Plan contains duplicate ' + label + ' ID ' + entry.id + '.');
    }
    ids.add(entry.id);
  }
}

function assertOrderContains(order, requiredIds, label) {
  const ordered = new Set(order);
  const missing = requiredIds.filter(function (id) { return !ordered.has(id); });
  if (missing.length) {
    throw runtimeError('INVALID_PLAN', 'Execution order for ' + label + ' is missing: ' + missing.join(', ') + '.');
  }
}

function isValiditySnapshot(value) {
  return isObject(value) && typeof value.current === 'boolean' &&
    (value.published === null || typeof value.published === 'boolean');
}

function isEnvironmentSemantics(value) {
  return isObject(value) &&
    typeof value.timezone === 'string' && value.timezone.length > 0 &&
    typeof value.improvedTimezoneManagement === 'boolean' &&
    typeof value.improvedBooleanFields === 'boolean' &&
    typeof value.improvedValidationAtPublishing === 'boolean' &&
    typeof value.millisecondsInDatetime === 'boolean' &&
    typeof value.nonLocalizedFocalPoints === 'boolean' &&
    typeof value.improvedHexManagement === 'boolean' &&
    stableStringify(Object.keys(value).sort()) === stableStringify([
      'timezone',
      'improvedTimezoneManagement',
      'improvedBooleanFields',
      'improvedValidationAtPublishing',
      'millisecondsInDatetime',
      'nonLocalizedFocalPoints',
      'improvedHexManagement',
    ].sort());
}

function schemaWithValidatorRelaxations(schema, relaxations) {
  const byFieldId = new Map(relaxations.map(function (entry) { return [entry.fieldId, entry]; }));
  return {
    locales: schema.locales.slice(),
    environmentSemantics: canonicalizeJson(schema.environmentSemantics),
    itemTypes: schema.itemTypes.map(function (itemType) {
      return {
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
        fields: itemType.fields.map(function (field) {
          const relaxation = byFieldId.get(field.id);
          return {
            id: field.id,
            apiKey: field.apiKey,
            fieldType: field.fieldType,
            localized: field.localized,
            position: field.position,
            defaultValue: field.defaultValue === undefined ? null : field.defaultValue,
            validators: relaxation ? relaxation.relaxedValidators : field.validators,
          };
        }),
      };
    }),
    workflows: schema.workflows.map(function (workflow) {
      return {
        id: workflow.id,
        apiKey: workflow.apiKey,
        stages: workflow.stages.map(function (stage) {
          return { id: stage.id, name: stage.name, initial: stage.initial === true };
        }),
      };
    }),
  };
}

function deriveCreateDefaultValueSuppressions(plan) {
  const collected = new Map();
  const seedContext = {
    plan,
    schemaById: new Map(plan.schema.itemTypes.map(function (itemType) {
      return [itemType.id, itemType];
    })),
    recordPlansById: new Map(plan.records.map(function (record) {
      return [record.id, record];
    })),
  };
  for (const record of plan.records) {
    if (!record || record.action !== 'create' || !record.desired) continue;
    const itemType = plan.schema.itemTypes.find(function (entry) {
      return entry.id === record.itemTypeId;
    });
    if (!itemType) continue;
    const seedFields = expectedCreateSeedFields(seedContext, record);
    applyCreateDefaultsToFields(seedFields, itemType, plan.schema, {
      recordId: record.id,
      suppressions: collected,
    });
  }
  const candidates = Array.from(collected.values()).sort(function (left, right) {
    return left.fieldId.localeCompare(right.fieldId);
  }).map(function (entry) {
    const originalHash = semanticHash(entry.originalDefaultValue);
    const suppressedHash = semanticHash(entry.suppressedDefaultValue);
    return {
      fieldId: entry.fieldId,
      itemTypeId: entry.itemTypeId,
      originalDefaultValue: canonicalizeJson(entry.originalDefaultValue),
      suppressedDefaultValue: canonicalizeJson(entry.suppressedDefaultValue),
      originalHash,
      suppressedHash,
      allowedHashes: [originalHash, suppressedHash],
      affectedRecordIds: Array.from(entry.affectedRecordIds).sort(),
    };
  });
  const candidateSchema = schemaWithCreateDefaultSuppressions(plan.schema, candidates);
  const suppressions = candidates.filter(function (candidate) {
    const withoutCandidate = schemaWithCreateDefaultSuppressions(
      plan.schema,
      candidates.filter(function (entry) { return entry.fieldId !== candidate.fieldId; }),
    );
    return plan.records.some(function (record) {
      if (!record || record.action !== 'create' || !record.desired) return false;
      const seedFields = expectedCreateSeedFields(seedContext, record);
      const suppressedItemType = candidateSchema.itemTypes.find(function (entry) {
        return entry.id === record.itemTypeId;
      });
      const restoredItemType = withoutCandidate.itemTypes.find(function (entry) {
        return entry.id === record.itemTypeId;
      });
      if (!suppressedItemType || !restoredItemType) return false;
      return semanticHash(applyCreateDefaultsToFields(seedFields, suppressedItemType, candidateSchema)) !==
        semanticHash(applyCreateDefaultsToFields(seedFields, restoredItemType, withoutCandidate));
    });
  });
  const suppressedSchema = schemaWithCreateDefaultSuppressions(plan.schema, suppressions);
  const defaultsDisabledSchema = schemaWithAllCreateDefaultsDisabled(plan.schema);
  const suppressedContext = Object.assign({}, seedContext, {
    schemaById: new Map(suppressedSchema.itemTypes.map(function (itemType) {
      return [itemType.id, itemType];
    })),
  });
  for (const record of plan.records) {
    if (!record || record.action !== 'create' || !record.desired) continue;
    const itemType = suppressedContext.schemaById.get(record.itemTypeId);
    const defaultsDisabledItemType = defaultsDisabledSchema.itemTypes.find(function (entry) {
      return entry.id === record.itemTypeId;
    });
    if (!itemType || !defaultsDisabledItemType) continue;
    const seedFields = expectedCreateSeedFields(seedContext, record);
    const filled = applyCreateDefaultsToFields(seedFields, itemType, suppressedSchema);
    const expected = applyCreateDefaultsToFields(seedFields, defaultsDisabledItemType, defaultsDisabledSchema);
    if (semanticHash(filled) !== semanticHash(expected)) {
      throw runtimeError('INVALID_PLAN', 'Exact temporary field-default suppression cannot reproduce the planned create seed for record ' + record.id + '.', {
        recordId: record.id,
        expectedCreateHash: semanticHash(expected),
        modeledCreateHash: semanticHash(filled),
      });
    }
  }
  return suppressions;
}

function deriveSanitizedHtmlWriteRisks(plan, phaseManagedSchema) {
  const risks = [];
  const phaseSchema = schemaWithInspectionItemTypes(phaseManagedSchema, plan.targetInspection.itemTypes);
  const itemTypesById = new Map(phaseSchema.itemTypes.map(function (itemType) {
    return [itemType.id, itemType];
  }));
  const recordsById = new Map(plan.records.map(function (record) {
    return [record.id, record];
  }));
  const seedContext = {
    plan,
    schemaById: itemTypesById,
    recordPlansById: recordsById,
  };
  const states = new Map();
  const topologyStates = new Map();
  const publicationSeedIds = new Set(plan.execution.publicationSeedOrder);
  for (const record of plan.records) {
    const itemType = itemTypesById.get(record.itemTypeId);
    if (!itemType) {
      throw runtimeError('INVALID_PLAN', 'Sanitizer safety projection cannot resolve item type ' + record.itemTypeId + ' for record ' + record.id + '.');
    }
    if (record.action === 'create' && record.desired) {
      const fields = expectedCreateSeedFields(seedContext, record);
      inspectSanitizationFields(fields, itemType, itemTypesById, record.id, 'create', 'record:' + record.id, risks);
      states.set(record.id, {
        current: fields,
        publishedHash: !itemType.draftModeActive || publicationSeedIds.has(record.id)
          ? semanticHash(fields)
          : null,
      });
    } else if (record.baseline) {
      states.set(record.id, {
        current: record.baseline.current.fields,
        publishedHash: record.baseline.published ? record.baseline.published.hash : null,
      });
      topologyStates.set(record.id, {
        itemTypeId: record.itemTypeId,
        parentId: record.baseline.topology.parentId,
        position: record.baseline.topology.position,
      });
    }
  }

  const orderedRecords = plan.records.filter(function (record) {
    const itemType = itemTypesById.get(record.itemTypeId);
    return itemType && (itemType.tree || itemType.sortable);
  });
  for (const record of orderedPlans(plan.execution.createOrder, orderedRecords).filter(function (entry) {
    return entry.action === 'create';
  })) {
    if (!record.desired || typeof record.desired.topology.position !== 'number') continue;
    shiftForInsert(topologyStates, record.itemTypeId, record.desired.topology.parentId, record.desired.topology.position, record.id);
    topologyStates.set(record.id, {
      itemTypeId: record.itemTypeId,
      parentId: record.desired.topology.parentId,
      position: record.desired.topology.position,
    });
  }

  for (const release of plan.execution.uniqueReleases) {
    const record = recordsById.get(release.recordId);
    const itemType = record && itemTypesById.get(record.itemTypeId);
    const state = states.get(release.recordId);
    if (!record || !itemType || !state) {
      throw runtimeError('INVALID_PLAN', 'Sanitizer safety projection cannot resolve unique release record ' + release.recordId + '.');
    }
    const patch = projectedSanitizerVersionPatch(release.fields, state.current);
    const nextCurrent = Object.assign({}, state.current, release.fields);
    if (Object.keys(patch).length > 0) {
      inspectSanitizationFields(nextCurrent, itemType, itemTypesById, record.id, 'unique-release', 'record:' + record.id, risks);
    }
    state.current = nextCurrent;
    if (!itemType.draftModeActive && Object.keys(patch).length > 0) {
      state.publishedHash = semanticHash(state.current);
    }
  }

  const sanitizerContext = {
    plan,
    schemaById: itemTypesById,
  };
  for (const record of parentFirst(plan.records.filter(function (entry) {
    return entry.desired && entry.action !== 'noop';
  }))) {
    const itemType = itemTypesById.get(record.itemTypeId);
    const state = states.get(record.id);
    const topology = topologyStates.get(record.id);
    if (
      !record.desired || !itemType || !itemType.tree || !state || !topology ||
      topology.parentId === record.desired.topology.parentId
    ) {
      continue;
    }
    inspectSanitizationFields(state.current, itemType, itemTypesById, record.id, 'tree-reparent', 'record:' + record.id, risks);
    topology.parentId = record.desired.topology.parentId;
    topology.position = absoluteRecordPositionsReproducible(sanitizerContext)
      ? nextKnownPosition(topologyStates, record.itemTypeId, topology.parentId, record.id)
      : 'unknown-until-positioned';
  }

  for (const recordId of plan.execution.publishOrder) {
    const record = recordsById.get(recordId);
    if (!record || !record.desired || record.action === 'noop' || record.action === 'delete') continue;
    const itemType = itemTypesById.get(record.itemTypeId);
    const state = states.get(record.id);
    if (!itemType || !state) {
      throw runtimeError('INVALID_PLAN', 'Sanitizer safety projection cannot resolve published-stage record ' + record.id + '.');
    }
    if (record.desired.published) {
      if (state.publishedHash !== record.desired.published.hash) {
        const patch = projectedSanitizerVersionPatch(record.desired.published.fields, state.current);
        const nextCurrent = Object.assign({}, state.current, record.desired.published.fields);
        if (Object.keys(patch).length > 0) {
          inspectSanitizationFields(nextCurrent, itemType, itemTypesById, record.id, 'published-stage', 'record:' + record.id, risks);
        }
        state.current = nextCurrent;
        state.publishedHash = record.desired.published.hash;
      }
    } else {
      state.publishedHash = null;
    }
  }

  for (const record of orderedPlans(plan.execution.updateOrder, plan.records).filter(function (entry) {
    return entry.desired && entry.action !== 'noop' && entry.action !== 'delete';
  })) {
    const itemType = itemTypesById.get(record.itemTypeId);
    const state = states.get(record.id);
    if (!itemType || !state) {
      throw runtimeError('INVALID_PLAN', 'Sanitizer safety projection cannot resolve current-restore record ' + record.id + '.');
    }
    const patch = projectedSanitizerVersionPatch(record.desired.current.fields, state.current);
    const nextCurrent = Object.assign({}, state.current, record.desired.current.fields);
    if (Object.keys(patch).length > 0) {
      inspectSanitizationFields(nextCurrent, itemType, itemTypesById, record.id, 'current-restore', 'record:' + record.id, risks);
    }
    state.current = nextCurrent;
  }

  for (const release of plan.execution.deleteReleases) {
    const record = recordsById.get(release.recordId);
    const itemType = record && itemTypesById.get(record.itemTypeId);
    const state = states.get(release.recordId);
    if (!record || !itemType || !state) {
      throw runtimeError('INVALID_PLAN', 'Sanitizer safety projection cannot resolve delete release record ' + release.recordId + '.');
    }
    const patch = projectedSanitizerVersionPatch(release.fields, state.current);
    const nextCurrent = Object.assign({}, state.current, release.fields);
    if (Object.keys(patch).length > 0) {
      inspectSanitizationFields(nextCurrent, itemType, itemTypesById, record.id, 'delete-release', 'record:' + record.id, risks);
    }
    state.current = nextCurrent;
  }

  for (const record of orderedPlans(plan.execution.deleteOrder, plan.records).filter(function (entry) {
    return entry.action === 'delete';
  })) {
    const deleted = topologyStates.get(record.id);
    if (!deleted) continue;
    for (const child of topologyStates.values()) {
      if (child.itemTypeId === record.itemTypeId && child.parentId === record.id) {
        child.parentId = deleted.parentId;
        child.position = 'unknown-until-positioned';
      }
    }
    topologyStates.delete(record.id);
  }

  const affectedGroups = affectedRecordSiblingGroups(sanitizerContext);
  const positional = plan.records.filter(function (record) {
    if (!record.desired || typeof record.desired.topology.position !== 'number') return false;
    const itemType = itemTypesById.get(record.itemTypeId);
    return itemType && (itemType.tree || itemType.sortable) &&
      affectedGroups.has(recordSiblingGroupKey(record.itemTypeId, record.desired.topology.parentId));
  }).sort(function (left, right) {
    return left.itemTypeId.localeCompare(right.itemTypeId) ||
      compareNullable(left.desired.topology.parentId, right.desired.topology.parentId) ||
      left.desired.topology.position - right.desired.topology.position ||
      left.id.localeCompare(right.id);
  });
  const seenPositionStates = new Set();
  const maximumPositionSteps = 4 * positional.length * positional.length + 1;
  for (let step = 0; step < maximumPositionSteps; step += 1) {
    const signature = positionStateSignature(sanitizerContext, topologyStates);
    if (seenPositionStates.has(signature)) break;
    seenPositionStates.add(signature);
    if (recordPositionGoalReached(sanitizerContext, positional, topologyStates)) break;
    const next = positional.find(function (record) {
      const topology = topologyStates.get(record.id);
      return topology && topology.position !== record.desired.topology.position;
    });
    if (!next) break;
    const itemType = itemTypesById.get(next.itemTypeId);
    const state = states.get(next.id);
    if (!itemType || !state) {
      throw runtimeError('INVALID_PLAN', 'Sanitizer safety projection cannot resolve position-stage record ' + next.id + '.');
    }
    inspectSanitizationFields(state.current, itemType, itemTypesById, next.id, 'position-finalize', 'record:' + next.id, risks);
    moveStatePosition(topologyStates, next.id, next.desired.topology.position);
  }

  const deduplicated = new Map();
  for (const risk of risks) {
    deduplicated.set(risk.recordId + '\u0000' + risk.stage + '\u0000' + risk.fieldId + '\u0000' + risk.path, risk);
  }
  const stageOrder = ['create', 'unique-release', 'tree-reparent', 'published-stage', 'current-restore', 'delete-release', 'position-finalize'];
  return Array.from(deduplicated.values()).sort(function (left, right) {
    return left.recordId.localeCompare(right.recordId) ||
      stageOrder.indexOf(left.stage) - stageOrder.indexOf(right.stage) ||
      left.fieldId.localeCompare(right.fieldId) ||
      left.path.localeCompare(right.path);
  });
}

function projectedSanitizerVersionPatch(desiredFields, currentFields) {
  return buildVersionPatch(desiredFields, currentFields, { current: { fields: currentFields } });
}

function inspectSanitizationFields(fields, itemType, itemTypesById, recordId, stage, path, risks) {
  for (const field of itemType.fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, field.apiKey)) continue;
    const value = fields[field.apiKey];
    const fieldPath = path + '.' + field.apiKey;
    if (fieldUsesSanitizer(field)) {
      inspectSanitizedTextValue(value, field, recordId, itemType.id, stage, fieldPath, risks);
    }
    if (['rich_text', 'single_block', 'structured_text'].includes(field.fieldType)) {
      const inspect = function (embeddedValue, at) {
        if (field.fieldType === 'structured_text') {
          inspectSanitizationStructuredTextValue(embeddedValue, itemTypesById, recordId, stage, at, risks);
        } else {
          inspectSanitizationEmbeddedValue(embeddedValue, itemTypesById, recordId, stage, at, risks);
        }
      };
      if (field.localized && isObject(value)) {
        for (const locale of Object.keys(value)) {
          inspect(value[locale], fieldPath + '.' + locale);
        }
      } else {
        inspect(value, fieldPath);
      }
    }
  }
}

function inspectSanitizationStructuredTextValue(value, itemTypesById, recordId, stage, path, risks) {
  if (!isObject(value) || !isObject(value.document)) return;
  inspectSanitizationStructuredTextNode(value.document, itemTypesById, recordId, stage, path + '.document', risks);
}

function inspectSanitizationStructuredTextNode(value, itemTypesById, recordId, stage, path, risks) {
  if (!isObject(value) || typeof value.type !== 'string') return;
  if ((value.type === 'block' || value.type === 'inlineBlock') && Object.prototype.hasOwnProperty.call(value, 'item')) {
    inspectSanitizationEmbeddedValue(value.item, itemTypesById, recordId, stage, path + '.item', risks);
  }
  if (Array.isArray(value.children)) {
    value.children.forEach(function (child, index) {
      inspectSanitizationStructuredTextNode(child, itemTypesById, recordId, stage, path + '.children[' + index + ']', risks);
    });
  }
}

function inspectSanitizedTextValue(value, field, recordId, itemTypeId, stage, path, risks) {
  if (field.localized && isObject(value)) {
    for (const locale of Object.keys(value)) {
      if (!isProvablyLocalizedSanitizerByteStableText(value[locale])) {
        risks.push({ recordId, itemTypeId, fieldId: field.id, stage, path: path + '.' + locale, locale });
      }
    }
    return;
  }
  if (!isProvablySanitizerByteStableText(value)) {
    risks.push({ recordId, itemTypeId, fieldId: field.id, stage, path, locale: null });
  }
}

function inspectSanitizationEmbeddedValue(value, itemTypesById, recordId, stage, path, risks) {
  if (Array.isArray(value)) {
    value.forEach(function (child, index) {
      inspectSanitizationEmbeddedValue(child, itemTypesById, recordId, stage, path + '[' + index + ']', risks);
    });
    return;
  }
  if (!isObject(value)) return;
  const identity = nestedItemIdentity(value, path);
  if (identity) {
    const blockType = itemTypesById.get(identity.itemTypeId);
    if (!blockType || blockType.modularBlock !== true) {
      throw runtimeError('INVALID_PLAN', 'Sanitizer safety projection cannot resolve nested block model ' + identity.itemTypeId + ' at ' + path + '.');
    }
    const fields = isObject(value.attributes) ? value.attributes : nestedItemFields(value);
    inspectSanitizationFields(fields, blockType, itemTypesById, recordId, stage, path + '.block:' + identity.id, risks);
    return;
  }
  for (const key of Object.keys(value)) {
    inspectSanitizationEmbeddedValue(value[key], itemTypesById, recordId, stage, path + '.' + key, risks);
  }
}

function fieldUsesSanitizer(field) {
  if (field.fieldType !== 'text') return false;
  const validator = field.validators && field.validators.sanitized_html;
  return isObject(validator) && validator.sanitize_before_validation === true;
}

function isProvablySanitizerByteStableText(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  if (/[<>&\r]/u.test(value)) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint <= 0x08 || codePoint === 0x0b || codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x00a0 ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      (codePoint & 0xffff) === 0xfffe ||
      (codePoint & 0xffff) === 0xffff
    ) return false;
  }
  return true;
}

function isProvablyLocalizedSanitizerByteStableText(value) {
  if (typeof value !== 'string') return false;
  return isProvablySanitizerByteStableText(value);
}

function schemaWithAllCreateDefaultsDisabled(schema) {
  return Object.assign({}, schema, {
    itemTypes: schema.itemTypes.map(function (itemType) {
      return Object.assign({}, itemType, {
        fields: itemType.fields.map(function (field) {
          return Object.assign({}, field, { defaultValue: null });
        }),
      });
    }),
  });
}

function schemaWithCreateDefaultSuppressions(schema, suppressions) {
  const byFieldId = new Map(suppressions.map(function (entry) {
    return [entry.fieldId, entry];
  }));
  return Object.assign({}, schema, {
    itemTypes: schema.itemTypes.map(function (itemType) {
      return Object.assign({}, itemType, {
        fields: itemType.fields.map(function (field) {
          const suppression = byFieldId.get(field.id);
          return suppression
            ? Object.assign({}, field, { defaultValue: suppression.suppressedDefaultValue })
            : field;
        }),
      });
    }),
  });
}

function applyCreateDefaultsToFields(fields, itemType, schema, collection) {
  const locales = createDefaultLocales(fields, itemType, schema);
  const knownApiKeys = new Set(itemType.fields.map(function (field) {
    return field.apiKey;
  }));
  const result = {};
  for (const field of itemType.fields) {
    const hasValue = Object.prototype.hasOwnProperty.call(fields, field.apiKey);
    let value = hasValue
      ? fields[field.apiKey]
      : field.localized
        ? Object.fromEntries(locales.map(function (locale) { return [locale, null]; }))
        : null;
    if (field.localized && isObject(value)) {
      const localizedValue = Object.assign({}, value);
      for (const locale of locales) {
        if (!Object.prototype.hasOwnProperty.call(localizedValue, locale)) {
          localizedValue[locale] = null;
        }
      }
      const localizedDefault = isObject(field.defaultValue) ? field.defaultValue : null;
      if (localizedDefault !== null) {
        const suppressedLocales = Object.keys(localizedValue).filter(function (locale) {
          return localizedValue[locale] === null &&
            localizedDefault[locale] !== null &&
            localizedDefault[locale] !== undefined;
        });
        if (suppressedLocales.length > 0 && collection) {
          collectCreateDefaultSuppression(
            collection,
            itemType.id,
            field.id,
            localizedDefault,
            Object.fromEntries(Object.entries(localizedDefault).map(function (entry) {
              return [entry[0], suppressedLocales.includes(entry[0]) ? null : entry[1]];
            })),
          );
        }
      }
      value = Object.fromEntries(Object.entries(localizedValue).map(function (entry) {
        const locale = entry[0];
        const localeValue = entry[1];
        const filled = localeValue === null && localizedDefault !== null &&
          localizedDefault[locale] !== null && localizedDefault[locale] !== undefined
          ? localizedDefault[locale]
          : localeValue;
        return [locale, normalizeCreatedFieldValue(filled, field.fieldType, schema, collection)];
      }));
    } else {
      if (value === null && cmaDefaultIsActive(field.defaultValue)) {
        if (collection) {
          collectCreateDefaultSuppression(
            collection,
            itemType.id,
            field.id,
            field.defaultValue,
            null,
          );
        }
        value = field.defaultValue;
      }
      value = normalizeCreatedFieldValue(value, field.fieldType, schema, collection);
    }
    result[field.apiKey] = value;
  }
  for (const key of Object.keys(fields)) {
    if (!knownApiKeys.has(key)) result[key] = canonicalizeJson(fields[key]);
  }
  return canonicalizeJson(result);
}

function createDefaultLocales(fields, itemType, schema) {
  if (itemType.allLocalesRequired) return schema.locales.slice();
  const firstLocalizedField = itemType.fields.find(function (field) {
    return field.localized && Object.prototype.hasOwnProperty.call(fields, field.apiKey);
  });
  if (!firstLocalizedField || !isObject(fields[firstLocalizedField.apiKey])) return [];
  return Object.keys(fields[firstLocalizedField.apiKey]);
}

function normalizeCreatedFieldValue(value, fieldType, schema, collection) {
  if (value === null) {
    if (fieldType === 'string' || fieldType === 'text') return '';
    if (fieldType === 'boolean') return false;
    return null;
  }
  if (['rich_text', 'single_block', 'structured_text'].includes(fieldType)) {
    return applyCreateDefaultsToEmbeddedValue(value, schema, collection);
  }
  return canonicalizeJson(value);
}

function applyCreateDefaultsToEmbeddedValue(value, schema, collection) {
  if (Array.isArray(value)) {
    return value.map(function (child) {
      return applyCreateDefaultsToEmbeddedValue(child, schema, collection);
    });
  }
  if (!isObject(value)) return canonicalizeJson(value);
  if (isNestedItem(value)) {
    const itemTypeId = itemTypeIdFromItem(value);
    const blockType = schema.itemTypes.find(function (entry) { return entry.id === itemTypeId; });
    if (!blockType || blockType.modularBlock !== true) return canonicalizeJson(value);
    const attributes = isObject(value.attributes) ? value.attributes : nestedItemFields(value);
    return canonicalizeJson(Object.assign({}, value, {
      attributes: applyCreateDefaultsToFields(attributes, blockType, schema, collection),
    }));
  }
  return Object.fromEntries(Object.entries(value).map(function (entry) {
    return [entry[0], applyCreateDefaultsToEmbeddedValue(entry[1], schema, collection)];
  }));
}

function collectCreateDefaultSuppression(collection, itemTypeId, fieldId, originalDefaultValue, suppressedDefaultValue) {
  const existing = collection.suppressions.get(fieldId);
  if (!existing) {
    collection.suppressions.set(fieldId, {
      fieldId,
      itemTypeId,
      originalDefaultValue: canonicalizeJson(originalDefaultValue),
      suppressedDefaultValue: canonicalizeJson(suppressedDefaultValue),
      affectedRecordIds: new Set([collection.recordId]),
    });
    return;
  }
  existing.affectedRecordIds.add(collection.recordId);
  if (isObject(existing.suppressedDefaultValue) && isObject(suppressedDefaultValue)) {
    for (const locale of Object.keys(suppressedDefaultValue)) {
      if (suppressedDefaultValue[locale] === null || existing.suppressedDefaultValue[locale] === undefined) {
        existing.suppressedDefaultValue[locale] = canonicalizeJson(suppressedDefaultValue[locale]);
      }
    }
    existing.suppressedDefaultValue = canonicalizeJson(existing.suppressedDefaultValue);
  }
}

function cmaDefaultIsActive(value) {
  return value !== undefined && value !== null && value !== false;
}

function inspectionItemTypesDigest(itemTypes) {
  return semanticHash({
    itemTypes: itemTypes.slice().sort(function (left, right) {
      return left.id.localeCompare(right.id);
    }).map(function (itemType) {
      return {
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
        fields: itemType.fields.map(function (field) {
          return {
            id: field.id,
            apiKey: field.apiKey,
            fieldType: field.fieldType,
            localized: field.localized,
            position: field.position,
            defaultValue: field.defaultValue === undefined ? null : field.defaultValue,
            validators: field.validators,
          };
        }),
      };
    }),
  });
}

function schemaWithInspectionItemTypes(schema, itemTypes) {
  return Object.assign({}, schema, {
    itemTypes: schema.itemTypes.concat(itemTypes).slice().sort(function (left, right) {
      return left.id.localeCompare(right.id);
    }),
    digest: schema.digest,
  });
}

async function fetchTargetSchemaState(context) {
  const plan = context.plan;
  const results = await Promise.all([
    context.client.site.find(),
    context.client.itemTypes.list(),
    context.client.workflows.list(),
  ]);
  const site = results[0];
  const actualItemTypes = results[1];
  const actualWorkflows = results[2];

  if (String(site.id) !== String(plan.target.siteId)) {
    throw runtimeError('WRONG_TARGET_SITE', 'Migration client targets site ' + String(site.id) + ', but this plan targets ' + String(plan.target.siteId) + '.');
  }

  const actualEnvironmentSemantics = {
    timezone: site.timezone,
    improvedTimezoneManagement: site.meta && site.meta.improved_timezone_management,
    improvedBooleanFields: site.meta && site.meta.improved_boolean_fields,
    improvedValidationAtPublishing: site.meta && site.meta.improved_validation_at_publishing,
    millisecondsInDatetime: site.meta && site.meta.milliseconds_in_datetime,
    nonLocalizedFocalPoints: site.meta && site.meta.non_localized_focal_points,
    improvedHexManagement: site.meta && site.meta.improved_hex_management,
  };
  if (stableStringify(actualEnvironmentSemantics) !== stableStringify(plan.schema.environmentSemantics)) {
    throw runtimeError(
      'ENVIRONMENT_SEMANTICS_MISMATCH',
      'Target environment activation/settings changed after this content migration was generated. Align the destination timezone and content-affecting product-update activations with the source; schema autogeneration alone may not repair this mismatch.',
      {
        expected: plan.schema.environmentSemantics,
        actual: actualEnvironmentSemantics,
      },
    );
  }

  const actualItemTypesById = new Map(actualItemTypes.map(function (itemType) {
    return [itemType.id, itemType];
  }));
  const liveLegacyMappingModel = actualItemTypes.find(function (itemType) {
    return itemType.api_key === LEGACY_ID_MAPPING_MODEL_API_KEY;
  });
  const liveMigrationsModel = actualItemTypes.find(function (itemType) {
    return itemType.api_key === plan.options.migrationsModelApiKey;
  });
  context.liveLegacyMappingModelId = liveLegacyMappingModel ? liveLegacyMappingModel.id : null;
  const planItemTypes = plan.schema.itemTypes;
  const inspectionPlanItemTypes = plan.targetInspection.itemTypes;
  const requestedItemTypes = planItemTypes.concat(inspectionPlanItemTypes);
  const schemaFieldResults = await Promise.all([
    mapWithConcurrency(requestedItemTypes, 5, async function (planned) {
      const actual = actualItemTypesById.get(planned.id);
      if (!actual) {
        throw runtimeError('SCHEMA_MISMATCH', 'Target is missing item type ' + planned.id + '.');
      }
      return context.client.fields.list(planned.id);
    }),
    liveMigrationsModel ? context.client.fields.list(liveMigrationsModel.id) : Promise.resolve([]),
  ]);
  const requestedFieldLists = schemaFieldResults[0];
  const fieldLists = requestedFieldLists.slice(0, planItemTypes.length);
  const inspectionFieldLists = requestedFieldLists.slice(planItemTypes.length);
  const migrationsModelFields = schemaFieldResults[1];
  if (liveMigrationsModel) {
    assertExactMigrationsTrackingModel(liveMigrationsModel, migrationsModelFields, plan.options.migrationsModelApiKey);
  }
  context.targetItemTypes = actualItemTypes.filter(function (itemType) {
    return itemType.api_key !== LEGACY_ID_MAPPING_MODEL_API_KEY &&
      (!liveMigrationsModel || itemType.id !== liveMigrationsModel.id);
  }).map(function (itemType) {
    return {
      id: itemType.id,
      modularBlock: itemType.modular_block === true,
      workflowId: itemType.workflow && itemType.workflow.id ? itemType.workflow.id : null,
    };
  });

  const normalizedItemTypes = planItemTypes.map(function (planned, index) {
    const actual = actualItemTypesById.get(planned.id);
    return {
      id: actual.id,
      apiKey: actual.api_key,
      modularBlock: actual.modular_block,
      singleton: actual.singleton,
      sortable: actual.sortable,
      tree: actual.tree,
      draftModeActive: actual.draft_mode_active,
      draftSavingActive: actual.draft_saving_active,
      allLocalesRequired: actual.all_locales_required,
      workflowId: actual.workflow && actual.workflow.id ? actual.workflow.id : null,
      fields: fieldLists[index].map(function (field) {
        return {
          id: field.id,
          apiKey: field.api_key,
          fieldType: field.field_type,
          localized: field.localized,
          position: field.position,
          defaultValue: field.default_value === undefined ? null : canonicalizeJson(field.default_value),
          validators: canonicalizeJson(field.validators),
        };
      }).sort(compareFieldSnapshots),
    };
  });
  const normalizedInspectionItemTypes = inspectionPlanItemTypes.map(function (planned, index) {
    const actual = actualItemTypesById.get(planned.id);
    return {
      id: actual.id,
      apiKey: actual.api_key,
      modularBlock: actual.modular_block,
      singleton: actual.singleton,
      sortable: actual.sortable,
      tree: actual.tree,
      draftModeActive: actual.draft_mode_active,
      draftSavingActive: actual.draft_saving_active,
      allLocalesRequired: actual.all_locales_required,
      workflowId: actual.workflow && actual.workflow.id ? actual.workflow.id : null,
      fields: inspectionFieldLists[index].map(function (field) {
        return {
          id: field.id,
          apiKey: field.api_key,
          fieldType: field.field_type,
          localized: field.localized,
          position: field.position,
          defaultValue: field.default_value === undefined ? null : canonicalizeJson(field.default_value),
          validators: canonicalizeJson(field.validators),
        };
      }).sort(compareFieldSnapshots),
    };
  });

  const workflowsById = new Map(actualWorkflows.map(function (workflow) {
    return [workflow.id, workflow];
  }));
  const normalizedWorkflows = plan.schema.workflows.map(function (planned) {
    const actual = workflowsById.get(planned.id);
    if (!actual) {
      throw runtimeError('SCHEMA_MISMATCH', 'Target is missing workflow ' + planned.id + '.');
    }
    return {
      id: actual.id,
      apiKey: actual.api_key,
      stages: actual.stages.map(function (stage) {
        return { id: stage.id, name: stage.name, initial: stage.initial === true };
      }),
    };
  });

  const actualSemanticSchema = {
    locales: Array.isArray(site.locales) ? site.locales.slice() : [],
    environmentSemantics: actualEnvironmentSemantics,
    itemTypes: normalizedItemTypes,
    workflows: normalizedWorkflows,
  };
  const fieldsById = new Map();
  for (const fields of fieldLists) {
    for (const field of fields) {
      fieldsById.set(field.id, field);
    }
  }
  return {
    semanticSchema: actualSemanticSchema,
    digest: semanticHash(actualSemanticSchema),
    inspectionDigest: inspectionItemTypesDigest(normalizedInspectionItemTypes),
    fieldsById,
  };
}

async function verifyTargetSchema(context) {
  const actual = await fetchTargetSchemaState(context);
  const actualDigest = actual.digest;
  const plan = context.plan;
  if (actualDigest !== plan.target.schemaDigest) {
    throw runtimeError('SCHEMA_MISMATCH', 'Target schema changed after this content migration was generated.', {
      expected: plan.target.schemaDigest,
      actual: actualDigest,
    });
  }
  if (actual.inspectionDigest !== plan.targetInspection.digest) {
    throw runtimeError('INSPECTION_SCHEMA_MISMATCH', 'Destination block schema needed to inspect invalid persisted content changed after this migration was generated.', {
      expected: plan.targetInspection.digest,
      actual: actual.inspectionDigest,
    });
  }
}

async function prepareManagedSchema(context) {
  const relaxations = context.plan.invalidContent.validatorRelaxations;
  const suppressions = Array.isArray(context.defaultValueSuppressions)
    ? context.defaultValueSuppressions
    : [];
  context.defaultValueSuppressions = suppressions;
  if (!(context.suppressedDefaultFieldIds instanceof Set)) {
    context.suppressedDefaultFieldIds = new Set();
  }
  if (context.defaultValueSuppressionStarted !== true) {
    context.defaultValueSuppressionStarted = false;
  }
  if (relaxations.length === 0 && suppressions.length === 0) {
    await verifyTargetSchema(context);
    await verifyRequiredPermissions(context);
    return;
  }

  const actual = await fetchTargetSchemaState(context);
  const classification = classifyManagedSchemaState(context, actual);
  await verifyRequiredPermissions(context);
  await assertSchemaMutationEnvironmentAllowed(context);

  if (classification.conflicts.length > 0) {
    const validatorOnlyConflict = suppressions.length === 0 && classification.conflicts.every(function (conflict) {
      return !conflict.attribute || conflict.attribute === 'validators';
    });
    throw runtimeError(validatorOnlyConflict ? 'SCHEMA_RELAXATION_CONFLICT' : 'SCHEMA_MUTATION_CONFLICT', 'One or more managed fields no longer match either the original or generated temporary schema state. No schema field was changed.', {
      fields: classification.conflicts,
    });
  }
  if (classification.normalizedDigest !== context.plan.target.schemaDigest) {
    throw runtimeError('SCHEMA_MISMATCH', 'Target schema changed outside the generated temporary schema-mutation contract.', {
      expected: context.plan.target.schemaDigest,
      actual: classification.normalizedDigest,
    });
  }

  if (
    classification.relaxedFieldIds.length === 0 &&
    classification.suppressedDefaultFieldIds.length === 0
  ) {
    if (actual.digest !== context.plan.invalidContent.schemaStates.originalDigest) {
      throw runtimeError('SCHEMA_MISMATCH', 'Target schema does not match the original managed schema digest.');
    }
    if (actual.inspectionDigest !== context.plan.targetInspection.digest) {
      throw runtimeError('INSPECTION_SCHEMA_MISMATCH', 'Destination block schema needed to inspect invalid persisted content changed after this migration was generated.', {
        expected: context.plan.targetInspection.digest,
        actual: actual.inspectionDigest,
      });
    }
    return;
  }

  if (classification.relaxedFieldIds.length > 0) {
    context.validatorRelaxationStarted = true;
    classification.relaxedFieldIds.forEach(function (id) { context.relaxedFieldIds.add(id); });
  }
  if (classification.suppressedDefaultFieldIds.length > 0) {
    context.defaultValueSuppressionStarted = true;
    classification.suppressedDefaultFieldIds.forEach(function (id) { context.suppressedDefaultFieldIds.add(id); });

    // Default suppression changes every CMA CREATE in the environment. Recover
    // it at the first safe point, before asset staging/checksum work or any
    // unrelated preflight can fail.
    logDefaultValueMutationWarning(context, 'recovering', suppressions);
    log(context, 'Detected an interrupted temporary default-suppression run. Restoring original field defaults before unrelated content preflight.');
    await restoreDefaultValueSuppressions(context, suppressions);
  }
  if (classification.relaxedFieldIds.length > 0) {
    logValidatorMutationWarning(context, 'recovering');
    log(context, 'Detected an interrupted temporary validator-relaxation run. Restoring original field validators before external asset staging or content preflight.');
    await restoreValidatorRelaxations(context);
  }
  await verifyTargetSchema(context);
  log(context, 'Recovered the original field schema; continuing with a fresh content preflight in this invocation.');
}

async function inspectLegacyIdMappings(context, requireCompleteBatch) {
  const mappingPlan = context.plan.legacyIdMappings;
  const requiresMappingState = mappingPlan.entries.length > 0 || mappingPlan.existingMappingRecords.length > 0 || mappingPlan.newMappingBatch !== null;
  if (!requiresMappingState && !context.liveLegacyMappingModelId) {
    context.legacyIdMappingState = emptyLegacyIdMappingState();
    return context.legacyIdMappingState;
  }

  const models = await context.client.itemTypes.list();
  const model = models.find(function (entry) {
    return entry.api_key === LEGACY_ID_MAPPING_MODEL_API_KEY;
  }) || null;
  const plannedModelId = mappingPlan.schema.model.id;
  const requestedIdCollision = models.find(function (entry) {
    return entry.id === plannedModelId && entry.api_key !== LEGACY_ID_MAPPING_MODEL_API_KEY;
  });
  const requestedNameCollision = models.find(function (entry) {
    return entry.name === LEGACY_ID_MAPPING_MODEL_NAME && entry.api_key !== LEGACY_ID_MAPPING_MODEL_API_KEY;
  });
  if (!model && requestedIdCollision) {
    throw runtimeError('LEGACY_MAPPING_SCHEMA_CONFLICT', 'Requested internal mapping model ID ' + plannedModelId + ' is already used by item type ' + requestedIdCollision.api_key + '.');
  }
  if (!model && requestedNameCollision) {
    throw runtimeError('LEGACY_MAPPING_SCHEMA_CONFLICT', 'Internal mapping model name ' + LEGACY_ID_MAPPING_MODEL_NAME + ' is already used by item type ' + requestedNameCollision.api_key + '.');
  }

  if (!model) {
    if (!requiresMappingState) {
      context.legacyIdMappingState = emptyLegacyIdMappingState();
      return context.legacyIdMappingState;
    }
    if (
      (requireCompleteBatch === true && mappingPlan.newMappingBatch !== null) ||
      mappingPlan.schema.model.status === 'existing' ||
      mappingPlan.existingMappingRecords.length > 0 ||
      mappingPlan.entries.some(function (entry) { return entry.status === 'existing'; })
    ) {
      throw runtimeError('LEGACY_MAPPING_MISSING', 'The plan relies on existing legacy-ID mappings, but the internal datocms_content_diff model is missing.');
    }
    await assertLegacyMappingFieldIdsAvailable(context, [
      mappingPlan.schema.nameField,
      mappingPlan.schema.mappingField,
    ]);
    await assertLegacyMappingRecordIdsAvailable(context, null, new Map());
    context.legacyIdMappingState = emptyLegacyIdMappingState();
    return context.legacyIdMappingState;
  }

  context.liveLegacyMappingModelId = model.id;
  assertExactLegacyMappingModel(model);
  if (mappingPlan.schema.model.status === 'existing' && model.id !== mappingPlan.schema.model.id) {
    throw runtimeError('LEGACY_MAPPING_SCHEMA_CONFLICT', 'Existing internal mapping model ID changed after generation.', {
      expected: mappingPlan.schema.model.id,
      actual: model.id,
    });
  }
  const fields = await context.client.fields.list(model.id);
  const fieldState = assertLegacyMappingFields(context, model, fields, requireCompleteBatch === true);
  await assertLegacyMappingFieldIdsAvailable(
    context,
    [
      fieldState.nameField ? null : mappingPlan.schema.nameField,
      fieldState.mappingField ? null : mappingPlan.schema.mappingField,
    ].filter(Boolean),
  );
  if (!fieldState.mappingField) {
    if (mappingPlan.entries.some(function (entry) { return entry.status === 'existing'; })) {
      throw runtimeError('LEGACY_MAPPING_MISSING', 'The plan relies on existing legacy-ID mappings, but the internal mapping field is missing.');
    }
    await assertLegacyMappingRecordIdsAvailable(context, model, new Map());
    context.legacyIdMappingState = Object.assign(emptyLegacyIdMappingState(), {
      model,
      nameField: fieldState.nameField,
    });
    return context.legacyIdMappingState;
  }

  const records = [];
  for await (const record of context.client.items.listPagedIterator(
    { filter: { type: model.id }, version: 'current', order_by: 'id_ASC' },
    { perPage: 500, concurrency: 5 },
  )) {
    records.push(record);
  }
  records.sort(function (left, right) { return String(left.id).localeCompare(String(right.id)); });

  const parsedRecords = records.map(function (record) {
    return parseLegacyIdMappingRecord(context, record, fieldState);
  });
  const registry = validateLegacyIdMappingRegistry(context, parsedRecords, requireCompleteBatch === true);
  for (const expectedRecord of mappingPlan.existingMappingRecords) {
    const actualRecord = registry.recordsById.get(expectedRecord.id);
    if (!actualRecord) {
      throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Existing mapping record ' + expectedRecord.id + ' captured at generation time is missing from the append-only ledger.');
    }
    if (actualRecord.hash !== expectedRecord.hash) {
      throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Existing mapping record ' + expectedRecord.id + ' changed after this migration was generated.', {
        expectedHash: expectedRecord.hash,
        actualHash: actualRecord.hash,
      });
    }
  }
  if (requireCompleteBatch === true && mappingPlan.newMappingBatch) {
    for (const chunk of mappingPlan.newMappingBatch.chunks) {
      if (!registry.recordsById.has(chunk.id)) {
        throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Planned mapping record ' + chunk.id + ' is missing from the completed append-only ledger batch.');
      }
    }
  }
  await assertLegacyMappingRecordIdsAvailable(context, model, registry.recordsById);
  verifyLegacyIdMappingRegistryPlanOwnership(context, registry);
  verifyPlannedLegacyIdMappings(context, registry);

  context.legacyIdMappingState = {
    model,
    nameField: fieldState.nameField,
    mappingField: fieldState.mappingField,
    recordsById: registry.recordsById,
    recordsByName: registry.recordsByName,
    sourceClaims: registry.sourceClaims,
    targetClaims: registry.targetClaims,
  };
  return context.legacyIdMappingState;
}

async function assertLegacyMappingFieldIdsAvailable(context, requestedFields) {
  const requested = requestedFields.filter(function (field) {
    return field && field.status === 'new';
  });
  if (requested.length === 0) return;
  if (!context.client.fields || typeof context.client.fields.find !== 'function') {
    throw runtimeError('UNSUPPORTED_CMA_CLIENT', 'The installed CMA client cannot prove global field-ID availability for the internal mapping schema.');
  }
  const internalModelId = context.liveLegacyMappingModelId;
  for (const expected of requested) {
    let collision;
    try {
      collision = await context.client.fields.find(expected.id);
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    const actualItemTypeId = entityRelationshipId(collision.item_type);
    if (internalModelId && actualItemTypeId === internalModelId && collision.api_key === expected.apiKey) {
      throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'Internal mapping field ' + expected.id + ' was directly readable but absent from the authoritative model field list.');
    }
    throw runtimeError('LEGACY_MAPPING_SCHEMA_CONFLICT', 'Requested internal mapping field ID ' + expected.id + ' is already used by field ' + String(collision.api_key) + ' on item type ' + String(actualItemTypeId) + '.');
  }
}

function emptyLegacyIdMappingState() {
  return {
    model: null,
    nameField: null,
    mappingField: null,
    recordsById: new Map(),
    recordsByName: new Map(),
    sourceClaims: new Map(),
    targetClaims: new Map(),
  };
}

function assertExactMigrationsTrackingModel(model, fields, apiKey) {
  const nameField = fields[0];
  const workflowId = model.workflow && model.workflow.id ? model.workflow.id : null;
  const exact = model.name === 'Schema migration' &&
    model.api_key === apiKey &&
    model.modular_block === false &&
    model.singleton === false &&
    model.sortable === false &&
    model.tree === false &&
    model.draft_mode_active === false &&
    model.draft_saving_active === false &&
    model.all_locales_required === false &&
    workflowId === null &&
    fields.length === 1 &&
    nameField &&
    nameField.api_key === 'name' &&
    nameField.field_type === 'string' &&
    nameField.localized === false &&
    nameField.default_value === null &&
    stableStringify(canonicalizeJson(nameField.validators)) === stableStringify({ required: {} });
  if (!exact) {
    throw runtimeError('MIGRATIONS_MODEL_CONFLICT', 'Configured migrations model ' + apiKey + ' does not match the exact internal tracking-model contract created by migrations:run.', {
      itemTypeId: model.id,
    });
  }
}

function assertExactLegacyMappingModel(model) {
  const mismatches = [];
  const checks = {
    name: LEGACY_ID_MAPPING_MODEL_NAME,
    api_key: LEGACY_ID_MAPPING_MODEL_API_KEY,
    modular_block: false,
    singleton: false,
    sortable: false,
    tree: false,
    draft_mode_active: true,
    draft_saving_active: false,
    all_locales_required: false,
    inverse_relationships_enabled: false,
    collection_appearance: 'compact',
    ordering_direction: null,
    ordering_meta: null,
    hint: null,
    has_singleton_item: false,
  };
  for (const [key, expected] of Object.entries(checks)) {
    if (model[key] !== expected) mismatches.push({ property: key, expected, actual: model[key] });
  }
  const workflowId = model.workflow && model.workflow.id ? model.workflow.id : null;
  if (workflowId !== null) mismatches.push({ property: 'workflow', expected: null, actual: workflowId });
  for (const relationship of ['ordering_field', 'presentation_image_field', 'image_preview_field', 'excerpt_field', 'singleton_item']) {
    const relationshipId = entityRelationshipId(model[relationship]);
    if (relationshipId !== null) mismatches.push({ property: relationship, expected: null, actual: relationshipId });
  }
  if (mismatches.length > 0) {
    throw runtimeError('LEGACY_MAPPING_SCHEMA_CONFLICT', 'Existing datocms_content_diff model does not have the exact internal model shape.', {
      modelId: model.id,
      mismatches,
    });
  }
}

function assertLegacyMappingFields(context, model, fields, requireComplete) {
  const mappingSchema = context.plan.legacyIdMappings.schema;
  const nameField = fields.find(function (field) { return field.api_key === LEGACY_ID_MAPPING_NAME_FIELD_API_KEY; }) || null;
  const mappingField = fields.find(function (field) { return field.api_key === LEGACY_ID_MAPPING_FIELD_API_KEY; }) || null;
  const extraFields = fields.filter(function (field) {
    return ![LEGACY_ID_MAPPING_NAME_FIELD_API_KEY, LEGACY_ID_MAPPING_FIELD_API_KEY].includes(field.api_key);
  });
  const mismatches = [];
  if (extraFields.length > 0) {
    mismatches.push({ property: 'extraFields', actual: extraFields.map(function (field) { return field.id; }) });
  }
  if (nameField) {
    collectLegacyMappingFieldMismatches(mismatches, nameField, mappingSchema.nameField);
    if (mappingSchema.nameField.status === 'existing' && nameField.id !== mappingSchema.nameField.id) {
      mismatches.push({ fieldId: nameField.id, property: 'id', expected: mappingSchema.nameField.id, actual: nameField.id });
    }
  }
  if (mappingField) {
    collectLegacyMappingFieldMismatches(mismatches, mappingField, mappingSchema.mappingField);
    if (mappingSchema.mappingField.status === 'existing' && mappingField.id !== mappingSchema.mappingField.id) {
      mismatches.push({ fieldId: mappingField.id, property: 'id', expected: mappingSchema.mappingField.id, actual: mappingField.id });
    }
  }
  const expectedTitleFieldId = nameField ? nameField.id : null;
  for (const relationship of ['title_field', 'presentation_title_field']) {
    const relationshipId = entityRelationshipId(model[relationship]);
    if (relationshipId !== expectedTitleFieldId) {
      mismatches.push({
        property: relationship,
        expected: expectedTitleFieldId,
        actual: relationshipId,
      });
    }
  }
  const permitsPartial = context.plan.legacyIdMappings.newMappingBatch !== null && !requireComplete;
  if (!nameField && mappingField) {
    mismatches.push({ property: 'partialFields', expected: 'name field before mapping field', actual: 'mapping field without name field' });
  }
  if (!nameField && mappingSchema.nameField.status === 'existing') {
    mismatches.push({ property: 'nameField', expected: mappingSchema.nameField.id, actual: 'missing' });
  }
  if (!mappingField && mappingSchema.mappingField.status === 'existing') {
    mismatches.push({ property: 'mappingField', expected: mappingSchema.mappingField.id, actual: 'missing' });
  }
  if ((!nameField || !mappingField) && !permitsPartial) {
    mismatches.push({ property: 'fieldCount', expected: 2, actual: fields.length });
  }
  if (mismatches.length > 0) {
    throw runtimeError('LEGACY_MAPPING_SCHEMA_CONFLICT', 'Existing datocms_content_diff fields do not have the exact internal schema.', {
      modelId: model.id,
      mismatches,
    });
  }
  return { nameField, mappingField };
}

function entityRelationshipId(value) {
  return value && typeof value.id === 'string' ? value.id : null;
}

function collectLegacyMappingFieldMismatches(mismatches, field, expected) {
  const expectedAppearance = expected.fieldType === 'string'
    ? { addons: [], editor: 'single_line', parameters: { heading: false, placeholder: null } }
    : { addons: [], editor: 'json', parameters: {} };
  const checks = {
    label: expected.label,
    api_key: expected.apiKey,
    field_type: expected.fieldType,
    localized: false,
    position: expected.position,
    default_value: null,
    hint: null,
    deep_filtering_enabled: false,
    content_link_enabled: true,
  };
  for (const [key, expectedValue] of Object.entries(checks)) {
    if (field[key] !== expectedValue) {
      mismatches.push({ fieldId: field.id, property: key, expected: expectedValue, actual: field[key] });
    }
  }
  if (stableStringify(canonicalizeJson(field.validators)) !== stableStringify(expected.validators)) {
    mismatches.push({ fieldId: field.id, property: 'validators', expected: expected.validators, actual: field.validators });
  }
  if (stableStringify(canonicalizeJson(field.appearance)) !== stableStringify(expectedAppearance)) {
    mismatches.push({ fieldId: field.id, property: 'appearance', expected: expectedAppearance, actual: field.appearance });
  }
  if (entityRelationshipId(field.fieldset) !== null) {
    mismatches.push({ fieldId: field.id, property: 'fieldset', expected: null, actual: entityRelationshipId(field.fieldset) });
  }
}

function parseLegacyIdMappingRecord(context, record, fieldState) {
  const name = record[LEGACY_ID_MAPPING_NAME_FIELD_API_KEY];
  const serializedDocument = record[LEGACY_ID_MAPPING_FIELD_API_KEY];
  const meta = isObject(record.meta) ? record.meta : {};
  if (
    !isPortableDatoId(record.id) ||
    itemTypeIdFromItem(record) !== context.liveLegacyMappingModelId ||
    typeof name !== 'string' ||
    !name ||
    typeof serializedDocument !== 'string'
  ) {
    throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping record ' + String(record.id) + ' has an invalid ID, model relationship, or field value shape.');
  }
  if (
    meta.status !== 'draft' ||
    meta.is_valid !== true ||
    meta.is_current_version_valid !== true ||
    meta.is_published_version_valid !== null ||
    meta.stage !== null ||
    meta.publication_scheduled_at !== null ||
    meta.unpublishing_scheduled_at !== null ||
    meta.published_at !== null ||
    meta.first_published_at !== null
  ) {
    throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping record ' + record.id + ' must remain a valid, unscheduled, workflow-free draft with no published version.');
  }
  if (utf8ByteLength(serializedDocument) > LEGACY_ID_MAPPING_MAX_DOCUMENT_BYTES) {
    throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping record ' + record.id + ' exceeds the 128 KiB serialized mapping limit.');
  }
  let document;
  try {
    document = JSON.parse(serializedDocument);
  } catch (error) {
    throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping record ' + record.id + ' contains malformed JSON.', {
      cause: error && error.message ? error.message : String(error),
    });
  }
  if (
    !isObject(document) ||
    document.formatVersion !== LEGACY_ID_MAPPING_FORMAT_VERSION ||
    document.projectId !== context.plan.target.siteId ||
    !isPortableDatoId(document.batchId) ||
    !Number.isInteger(document.chunkIndex) ||
    document.chunkIndex < 0 ||
    !Number.isInteger(document.chunkCount) ||
    document.chunkCount <= 0 ||
    document.chunkIndex >= document.chunkCount ||
    typeof document.wholeHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(document.wholeHash) ||
    !Array.isArray(document.entries) ||
    document.entries.length === 0 ||
    stableStringify(Object.keys(document).sort()) !==
      stableStringify(['batchId', 'chunkCount', 'chunkIndex', 'entries', 'formatVersion', 'projectId', 'wholeHash'].sort())
  ) {
    throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping record ' + record.id + ' has invalid chunk metadata.');
  }
  if (canonicalPrettyStringify(document) !== serializedDocument) {
    throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping record ' + record.id + ' is not encoded with canonical pretty JSON.');
  }
  if (name !== legacyIdMappingChunkName(document.batchId, document.chunkIndex, document.chunkCount)) {
    throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping record ' + record.id + ' has a name inconsistent with its deterministic batch position.');
  }
  let previousSortKey = null;
  for (const entry of document.entries) {
    validateStoredLegacyIdMappingEntry(entry, record.id);
    const sortKey = legacyIdMappingSortKey(entry.entityType, entry.sourceId);
    if (previousSortKey !== null && sortKey.localeCompare(previousSortKey) <= 0) {
      throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping record ' + record.id + ' entries are not uniquely sorted.');
    }
    previousSortKey = sortKey;
  }
  return {
    id: record.id,
    name,
    serializedDocument,
    hash: sha256(serializedDocument),
    byteLength: utf8ByteLength(serializedDocument),
    document,
    itemTypeId: itemTypeIdFromItem(record),
    fieldIds: {
      name: fieldState.nameField.id,
      mapping: fieldState.mappingField.id,
    },
  };
}

function validateStoredLegacyIdMappingEntry(entry, recordId) {
  try {
    validateLegacyIdMappingEntry(entry, false, 'stored mapping entry');
  } catch (error) {
    throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping record ' + recordId + ' contains an invalid mapping entry.', {
      cause: error && error.message ? error.message : String(error),
    });
  }
}

function legacyIdMappingChunkName(batchId, chunkIndex, chunkCount) {
  return 'legacy-id-map:' + batchId + ':' + String(chunkIndex + 1) + '/' + String(chunkCount);
}

function validateLegacyIdMappingRegistry(context, parsedRecords, requireCompleteBatch) {
  const recordsById = new Map();
  const recordsByName = new Map();
  const sourceClaims = new Map();
  const sourceClaimBatchIds = new Map();
  const targetClaims = new Map();
  const batches = new Map();

  for (const record of parsedRecords) {
    if (recordsById.has(record.id) || recordsByName.has(record.name)) {
      throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping records contain duplicate IDs or names.', {
        recordId: record.id,
        name: record.name,
      });
    }
    recordsById.set(record.id, record);
    recordsByName.set(record.name, record);
    const batchId = record.document.batchId;
    const batch = batches.get(batchId) || {
      batchId,
      chunkCount: record.document.chunkCount,
      wholeHash: record.document.wholeHash,
      chunks: new Map(),
    };
    if (
      batch.chunkCount !== record.document.chunkCount ||
      batch.wholeHash !== record.document.wholeHash ||
      batch.chunks.has(record.document.chunkIndex)
    ) {
      throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping batch ' + batchId + ' contains inconsistent or duplicate chunk metadata.');
    }
    batch.chunks.set(record.document.chunkIndex, record);
    batches.set(batchId, batch);
  }

  const plannedBatch = context.plan.legacyIdMappings.newMappingBatch;
  for (const batch of batches.values()) {
    const plannedCurrentBatch = plannedBatch && plannedBatch.batchId === batch.batchId
      ? plannedBatch
      : null;
    const presentIndexes = Array.from(batch.chunks.keys()).sort(function (left, right) { return left - right; });
    const complete = presentIndexes.length === batch.chunkCount && presentIndexes.every(function (value, index) {
      return value === index;
    });
    if (!complete) {
      const allowedPartial = !requireCompleteBatch && plannedCurrentBatch &&
        batch.chunkCount === plannedCurrentBatch.chunks.length &&
        batch.wholeHash === plannedCurrentBatch.wholeHash &&
        presentIndexes.every(function (value, index) { return value === index; });
      if (!allowedPartial) {
        throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping batch ' + batch.batchId + ' is incomplete and is not a recoverable prefix of this migration.');
      }
    }

    const combinedEntries = [];
    for (const index of presentIndexes) {
      const record = batch.chunks.get(index);
      if (plannedCurrentBatch) {
        const plannedChunk = plannedCurrentBatch.chunks[index];
        assertExactLegacyMappingChunkRecord(record, plannedChunk);
      }
      combinedEntries.push(...record.document.entries);
    }
    let previousSortKey = null;
    for (const entry of combinedEntries) {
      const sourceKey = legacyIdMappingKey(entry.entityType, entry.sourceId);
      const targetKey = legacyIdMappingKey(entry.entityType, entry.targetId);
      const sortKey = legacyIdMappingSortKey(entry.entityType, entry.sourceId);
      if (previousSortKey !== null && sortKey.localeCompare(previousSortKey) <= 0) {
        throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping batch ' + batch.batchId + ' entries are not uniquely sorted across chunks.');
      }
      previousSortKey = sortKey;
      const priorSource = sourceClaims.get(sourceKey);
      const priorTarget = targetClaims.get(targetKey);
      if (priorSource || priorTarget) {
        throw runtimeError('LEGACY_MAPPING_CONFLICT', 'Persistent legacy-ID mappings contain duplicate source or target claims.', {
          entityType: entry.entityType,
          sourceId: entry.sourceId,
          targetId: entry.targetId,
          priorSource: priorSource || null,
          priorTarget: priorTarget || null,
        });
      }
      sourceClaims.set(sourceKey, entry);
      sourceClaimBatchIds.set(sourceKey, batch.batchId);
      targetClaims.set(targetKey, entry);
    }
    if (complete && sha256(stableStringify(combinedEntries)) !== batch.wholeHash) {
      throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Internal mapping batch ' + batch.batchId + ' failed whole-batch integrity verification.');
    }
  }

  return { recordsById, recordsByName, sourceClaims, sourceClaimBatchIds, targetClaims };
}

function assertExactLegacyMappingChunkRecord(record, plannedChunk) {
  if (!legacyMappingChunkMatches(record, plannedChunk)) {
    throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Existing mapping chunk does not exactly match this migration\'s deterministic reservation.', {
      recordId: record.id,
      batchId: record.document.batchId,
      chunkIndex: record.document.chunkIndex,
    });
  }
}

function legacyMappingChunkMatches(record, plannedChunk) {
  return Boolean(
    record &&
    plannedChunk &&
    record.id === plannedChunk.id &&
    record.name === plannedChunk.name &&
    record.hash === plannedChunk.hash &&
    record.byteLength === plannedChunk.byteLength &&
    record.serializedDocument === plannedChunk.serializedDocument
  );
}

function verifyLegacyIdMappingRegistryPlanOwnership(context, registry) {
  const plannedClaimsByTarget = new Map(context.plan.legacyIdMappings.entries.map(function (entry) {
    return [legacyIdMappingKey(entry.entityType, entry.targetId), entry];
  }));
  const assertManagedTargetClaim = function (entityType, targetId) {
    const targetKey = legacyIdMappingKey(entityType, targetId);
    const durableClaim = registry.targetClaims.get(targetKey);
    if (!durableClaim) return;
    const plannedClaim = plannedClaimsByTarget.get(targetKey);
    if (
      !plannedClaim ||
      plannedClaim.managed !== true ||
      plannedClaim.entityType !== entityType ||
      durableClaim.entityType !== entityType ||
      plannedClaim.sourceId !== durableClaim.sourceId ||
      plannedClaim.targetId !== durableClaim.targetId
    ) {
      throw runtimeError('LEGACY_MAPPING_CONFLICT', 'Persistent legacy-ID mapping reserves final managed ' + entityType + ' ID ' + targetId + ' without the exact ownership declared by this plan.', {
        entityType,
        targetId,
        durableClaim,
        plannedClaim: plannedClaim || null,
      });
    }
  };

  for (const record of context.plan.records) {
    if (!record.desired) continue;
    assertManagedTargetClaim('record', record.id);
    const blocks = new Map();
    collectNestedBlocks(record.desired.current.fields, blocks);
    if (record.desired.published) collectNestedBlocks(record.desired.published.fields, blocks);
    for (const blockId of blocks.keys()) assertManagedTargetClaim('block', blockId);
  }
  for (const upload of context.plan.uploads) {
    if (upload.desired) assertManagedTargetClaim('upload', upload.id);
  }
  for (const collection of context.plan.uploadCollections) {
    if (collection.desired) assertManagedTargetClaim('upload_collection', collection.id);
  }

  const mappingRecordIds = new Set(context.plan.legacyIdMappings.existingMappingRecords.map(function (record) {
    return record.id;
  }));
  if (context.plan.legacyIdMappings.newMappingBatch) {
    for (const chunk of context.plan.legacyIdMappings.newMappingBatch.chunks) mappingRecordIds.add(chunk.id);
  }
  for (const recordId of registry.recordsById.keys()) mappingRecordIds.add(recordId);
  for (const recordId of mappingRecordIds) {
    const durableClaim = registry.targetClaims.get(legacyIdMappingKey('record', recordId));
    if (durableClaim) {
      throw runtimeError('LEGACY_MAPPING_CONFLICT', 'Persistent legacy-ID mapping target ' + recordId + ' collides with an internal append-only mapping record ID.', {
        recordId,
        durableClaim,
      });
    }
  }
}

function verifyPlannedLegacyIdMappings(context, registry) {
  const plannedBatch = context.plan.legacyIdMappings.newMappingBatch;
  for (const entry of context.plan.legacyIdMappings.entries) {
    const sourceKey = legacyIdMappingKey(entry.entityType, entry.sourceId);
    const targetKey = legacyIdMappingKey(entry.entityType, entry.targetId);
    const existingSource = registry.sourceClaims.get(sourceKey);
    const existingTarget = registry.targetClaims.get(targetKey);
    if (existingSource && (existingSource.entityType !== entry.entityType || existingSource.targetId !== entry.targetId)) {
      throw runtimeError('LEGACY_MAPPING_CONFLICT', 'Legacy ' + entry.entityType + ' ID ' + entry.sourceId + ' is already mapped to a different target.', {
        expected: entry.targetId,
        actual: existingSource.targetId,
        expectedEntityType: entry.entityType,
        actualEntityType: existingSource.entityType,
      });
    }
    if (existingTarget && (existingTarget.entityType !== entry.entityType || existingTarget.sourceId !== entry.sourceId)) {
      throw runtimeError('LEGACY_MAPPING_CONFLICT', 'Target ' + entry.entityType + ' ID ' + entry.targetId + ' is already reserved for a different legacy ID.', {
        expected: entry.sourceId,
        actual: existingTarget.sourceId,
        expectedEntityType: entry.entityType,
        actualEntityType: existingTarget.entityType,
      });
    }
    if (entry.status === 'existing' && !existingSource) {
      throw runtimeError('LEGACY_MAPPING_MISSING', 'Required persistent legacy-ID mapping is missing.', {
        entityType: entry.entityType,
        sourceId: entry.sourceId,
        targetId: entry.targetId,
      });
    }
    const existingSourceBatchId = registry.sourceClaimBatchIds.get(sourceKey);
    if (
      entry.status === 'new' &&
      existingSource &&
      (!plannedBatch || existingSourceBatchId !== plannedBatch.batchId)
    ) {
      throw runtimeError('LEGACY_MAPPING_CONCURRENT_APPEND', 'Legacy ' + entry.entityType + ' ID ' + entry.sourceId + ' was persistently mapped after this migration was generated, outside its complete deterministic batch. Regenerate the content diff before applying it.', {
        entityType: entry.entityType,
        sourceId: entry.sourceId,
        targetId: entry.targetId,
      });
    }
  }

  if (!plannedBatch) return;
  for (const chunk of plannedBatch.chunks) {
    const byId = registry.recordsById.get(chunk.id);
    const byName = registry.recordsByName.get(chunk.name);
    if (byId) assertExactLegacyMappingChunkRecord(byId, chunk);
    if (byName && byName.id !== chunk.id) {
      throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Mapping record name ' + chunk.name + ' is already used by another record.', {
        expectedRecordId: chunk.id,
        actualRecordId: byName.id,
      });
    }
  }
}

async function verifyLegacySourceIdsAbsent(context) {
  for (const entry of context.plan.legacyIdMappings.entries) {
    let existing = null;
    if (entry.entityType === 'record' || entry.entityType === 'block') {
      existing = await findItemCurrentShellMaybe(context.client, entry.sourceId);
    } else if (entry.entityType === 'upload') {
      existing = await findUploadMaybe(context.client, entry.sourceId);
    } else if (entry.entityType === 'upload_collection') {
      existing = await findCollectionMaybe(context.client, entry.sourceId);
    }
    if (existing) {
      throw runtimeError('LEGACY_SOURCE_ID_OCCUPIED', 'Legacy ' + entry.entityType + ' source ID ' + entry.sourceId + ' now exists in the destination namespace. Regenerate the content diff so the live target identity is handled safely.', {
        entityType: entry.entityType,
        sourceId: entry.sourceId,
        targetId: entry.targetId,
        actualId: existing.id || entry.sourceId,
        actualItemTypeId: entry.entityType === 'record' || entry.entityType === 'block'
          ? itemTypeIdFromItem(existing)
          : null,
      });
    }
  }
}

async function verifyExternalLegacyIdMappingTargets(context) {
  const externalEntries = context.plan.legacyIdMappings.entries.filter(function (entry) {
    return entry.managed === false;
  });
  for (const entry of externalEntries) {
    if (entry.entityType === 'record') {
      const current = await findItemCurrentShellMaybe(context.client, entry.targetId);
      if (!current) {
        throw runtimeError('LEGACY_MAPPING_TARGET_MISSING', 'External mapped record ' + entry.targetId + ' is missing from the destination current content slice.', {
          entityType: entry.entityType,
          sourceId: entry.sourceId,
          targetId: entry.targetId,
          slice: 'current',
        });
      }
      const itemTypeId = itemTypeIdFromItem(current);
      const itemType = context.targetItemTypes.find(function (candidate) { return candidate.id === itemTypeId; });
      if (!itemType || itemType.modularBlock === true || itemTypeId !== entry.expectedItemTypeId) {
        throw runtimeError('LEGACY_MAPPING_TARGET_CONFLICT', 'External record mapping target ' + entry.targetId + ' no longer belongs to its generation-time top-level model.', {
          sourceId: entry.sourceId,
          targetId: entry.targetId,
          expectedItemTypeId: entry.expectedItemTypeId,
          itemTypeId,
        });
      }
      if (entry.requiredAvailability.published) {
        const published = await findRecordPublishedMaybe(context.client, entry.targetId);
        if (!published) {
          throw runtimeError('LEGACY_MAPPING_TARGET_MISSING', 'External mapped record ' + entry.targetId + ' has no published destination version required by final content.', {
            entityType: entry.entityType,
            sourceId: entry.sourceId,
            targetId: entry.targetId,
            slice: 'published',
          });
        }
        const publishedItemTypeId = itemTypeIdFromItem(published);
        if (publishedItemTypeId !== entry.expectedItemTypeId) {
          throw runtimeError('LEGACY_MAPPING_TARGET_CONFLICT', 'External mapped record ' + entry.targetId + ' has a published version under a different model than its generation-time contract.', {
            sourceId: entry.sourceId,
            targetId: entry.targetId,
            expectedItemTypeId: entry.expectedItemTypeId,
            itemTypeId: publishedItemTypeId,
          });
        }
      }
    } else {
      throw runtimeError('INVALID_PLAN', 'Only existing record aliases can be external to the managed content scope.');
    }
  }
}

async function assertLegacyMappingRecordIdsAvailable(context, model, recordsById) {
  const batch = context.plan.legacyIdMappings.newMappingBatch;
  if (!batch) return;
  for (const chunk of batch.chunks) {
    if (recordsById.has(chunk.id)) continue;
    const existing = await findItemCurrentShellMaybe(context.client, chunk.id);
    if (!existing) continue;
    const actualItemTypeId = itemTypeIdFromItem(existing);
    if (!model || actualItemTypeId !== model.id) {
      throw runtimeError('LEGACY_MAPPING_RECORD_CONFLICT', 'Requested mapping record ID ' + chunk.id + ' is already used by unrelated content.', {
        actualItemTypeId,
      });
    }
    throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'Internal mapping record ' + chunk.id + ' was directly readable but absent from the authoritative model iterator.');
  }
}

async function persistLegacyIdMappingReservations(context) {
  const batch = context.plan.legacyIdMappings.newMappingBatch;
  if (!batch) return;

  let state = await inspectLegacyIdMappings(context, false);
  await verifyLegacySourceIdsAbsent(context);
  const alreadyComplete = batch.chunks.every(function (chunk) {
    const existing = state.recordsById.get(chunk.id);
    return legacyMappingChunkMatches(existing, chunk);
  });
  if (alreadyComplete) {
    await inspectLegacyIdMappings(context, true);
    return;
  }

  await assertLegacyMappingMutationEnvironmentAllowed(context);
  if (!state.model) {
    const schema = context.plan.legacyIdMappings.schema;
    await context.client.itemTypes.create({
      id: schema.model.id,
      name: schema.model.name,
      api_key: schema.model.apiKey,
      modular_block: false,
      singleton: false,
      sortable: false,
      tree: false,
      draft_mode_active: true,
      draft_saving_active: false,
      all_locales_required: false,
      inverse_relationships_enabled: false,
      collection_appearance: 'compact',
      ordering_direction: null,
      ordering_meta: null,
      hint: null,
    }, { skip_menu_item_creation: true });
    context.mutationCount += 1;
    state = await inspectLegacyIdMappings(context, false);
    if (!state.model) {
      throw runtimeError('LEGACY_MAPPING_SCHEMA_VERIFY_FAILURE', 'Internal datocms_content_diff model was not readable after creation.');
    }
  }

  if (!state.nameField) {
    const expected = context.plan.legacyIdMappings.schema.nameField;
    await context.client.fields.create(state.model.id, {
      id: expected.id,
      label: expected.label,
      api_key: expected.apiKey,
      field_type: expected.fieldType,
      localized: false,
      position: expected.position,
      validators: canonicalizeJson(expected.validators),
      appearance: { addons: [], editor: 'single_line', parameters: { heading: false, placeholder: null } },
      default_value: null,
      hint: null,
      deep_filtering_enabled: false,
      content_link_enabled: true,
    });
    context.mutationCount += 1;
    state = await inspectLegacyIdMappings(context, false);
  }
  if (!state.mappingField) {
    const expected = context.plan.legacyIdMappings.schema.mappingField;
    await context.client.fields.create(state.model.id, {
      id: expected.id,
      label: expected.label,
      api_key: expected.apiKey,
      field_type: expected.fieldType,
      localized: false,
      position: expected.position,
      validators: canonicalizeJson(expected.validators),
      appearance: { addons: [], editor: 'json', parameters: {} },
      default_value: null,
      hint: null,
      deep_filtering_enabled: false,
      content_link_enabled: true,
    });
    context.mutationCount += 1;
    state = await inspectLegacyIdMappings(context, false);
  }
  if (!state.nameField || !state.mappingField) {
    throw runtimeError('LEGACY_MAPPING_SCHEMA_VERIFY_FAILURE', 'Internal datocms_content_diff fields were not readable after creation.');
  }

  for (const chunk of batch.chunks) {
    state = await inspectLegacyIdMappings(context, false);
    const existing = state.recordsById.get(chunk.id);
    if (existing) {
      assertExactLegacyMappingChunkRecord(existing, chunk);
      continue;
    }
    await assertLegacyMappingMutationEnvironmentAllowed(context);
    await context.client.items.create({
      id: chunk.id,
      item_type: entityRef('item_type', state.model.id),
      [LEGACY_ID_MAPPING_NAME_FIELD_API_KEY]: chunk.name,
      [LEGACY_ID_MAPPING_FIELD_API_KEY]: chunk.serializedDocument,
    });
    context.mutationCount += 1;
    state = await inspectLegacyIdMappings(context, false);
    const created = state.recordsById.get(chunk.id);
    if (!created) {
      throw runtimeError('LEGACY_MAPPING_RECORD_VERIFY_FAILURE', 'Internal mapping record ' + chunk.id + ' was not readable after creation.');
    }
    assertExactLegacyMappingChunkRecord(created, chunk);
  }

  await inspectLegacyIdMappings(context, true);
  log(context, 'Reserved ' + context.plan.legacyIdMappings.entries.filter(function (entry) { return entry.status === 'new'; }).length + ' legacy entity ID mapping(s) in ' + batch.chunks.length + ' append-only record(s).');
}

async function assertLegacyMappingMutationEnvironmentAllowed(context) {
  const environmentId = await resolveExecutionEnvironmentId(context);
  const executionContext = isObject(context.options.executionContext) ? context.options.executionContext : {};
  if (typeof executionContext.environmentId === 'string' && executionContext.environmentId !== environmentId) {
    throw runtimeError('EXECUTION_CONTEXT_MISMATCH', 'Migration execution context targets environment ' + executionContext.environmentId + ', but the CMA client targets ' + environmentId + '.');
  }
  if (!context.client.environments || typeof context.client.environments.list !== 'function') {
    throw runtimeError('ENVIRONMENT_PROOF_UNAVAILABLE', 'The installed CMA client cannot inspect the actual execution environment before creating persistent legacy-ID mappings.');
  }
  const environments = await context.client.environments.list();
  const environment = environments.find(function (entry) { return entry && entry.id === environmentId; });
  const primary = environments.find(function (entry) { return entry && entry.meta && entry.meta.primary === true; });
  if (!environment || !isObject(environment.meta) || !primary || (environment.meta.primary === true) !== (primary.id === environmentId)) {
    throw runtimeError('ENVIRONMENT_PROOF_UNAVAILABLE', 'Could not independently prove whether the actual execution environment is primary before creating persistent legacy-ID mappings.');
  }
  if (environment.meta.status !== 'ready' || environment.meta.read_only_mode === true) {
    throw runtimeError('ENVIRONMENT_NOT_WRITABLE', 'Persistent legacy-ID mappings require a ready, writable environment.');
  }
  if (environment.meta.primary === true && !(executionContext.inPlace === true && executionContext.allowPrimary === true)) {
    throw runtimeError('PRIMARY_MAPPING_SCHEMA_FORBIDDEN', 'Creating persistent legacy-ID mappings on the primary environment requires migrations:run --in-place --allow-primary. No internal schema or mapping record was changed.');
  }
}

function classifyManagedSchemaState(context, actual) {
  const relaxationsByFieldId = new Map(context.plan.invalidContent.validatorRelaxations.map(function (entry) {
    return [entry.fieldId, entry];
  }));
  const conflicts = [];
  const relaxedFieldIds = [];
  const suppressedDefaultFieldIds = [];
  const defaultValueSuppressions = Array.isArray(context.defaultValueSuppressions)
    ? context.defaultValueSuppressions
    : [];
  const suppressionsByFieldId = new Map(defaultValueSuppressions.map(function (entry) {
    return [entry.fieldId, entry];
  }));
  const normalized = canonicalizeJson(actual.semanticSchema);

  for (const itemType of normalized.itemTypes) {
    for (const field of itemType.fields) {
      const relaxation = relaxationsByFieldId.get(field.id);
      if (relaxation) {
        const validatorHash = semanticHash(field.validators);
        if (validatorHash === relaxation.relaxedHash) {
          relaxedFieldIds.push(field.id);
        } else if (validatorHash !== relaxation.originalHash) {
          conflicts.push({ fieldId: field.id, attribute: 'validators', actualHash: validatorHash, allowedHashes: relaxation.allowedValidatorHashes });
        }
        field.validators = canonicalizeJson(relaxation.originalValidators);
      }
      const suppression = suppressionsByFieldId.get(field.id);
      if (suppression) {
        const defaultHash = semanticHash(field.defaultValue === undefined ? null : field.defaultValue);
        if (defaultHash === suppression.suppressedHash) {
          suppressedDefaultFieldIds.push(field.id);
        } else if (defaultHash !== suppression.originalHash) {
          conflicts.push({ fieldId: field.id, attribute: 'default_value', actualHash: defaultHash, allowedHashes: suppression.allowedHashes });
        }
        field.defaultValue = canonicalizeJson(suppression.originalDefaultValue);
      }
    }
  }

  for (const relaxation of context.plan.invalidContent.validatorRelaxations) {
    if (!actual.fieldsById.has(relaxation.fieldId)) {
      conflicts.push({ fieldId: relaxation.fieldId, actualHash: 'missing', allowedHashes: relaxation.allowedValidatorHashes });
    }
  }
  for (const suppression of defaultValueSuppressions) {
    if (!actual.fieldsById.has(suppression.fieldId)) {
      conflicts.push({ fieldId: suppression.fieldId, attribute: 'default_value', actualHash: 'missing', allowedHashes: suppression.allowedHashes });
    }
  }

  return {
    conflicts,
    relaxedFieldIds,
    suppressedDefaultFieldIds,
    normalizedDigest: semanticHash(normalized),
  };
}

async function assertSchemaMutationEnvironmentAllowed(context) {
  const environmentId = await resolveExecutionEnvironmentId(context);
  const executionContext = isObject(context.options.executionContext) ? context.options.executionContext : {};
  if (typeof executionContext.environmentId === 'string' && executionContext.environmentId !== environmentId) {
    throw runtimeError('EXECUTION_CONTEXT_MISMATCH', 'Migration execution context targets environment ' + executionContext.environmentId + ', but the CMA client targets ' + environmentId + '.');
  }
  if (!context.client.environments || typeof context.client.environments.list !== 'function') {
    throw runtimeError('ENVIRONMENT_PROOF_UNAVAILABLE', 'The installed CMA client cannot inspect the actual execution environment before schema mutation.');
  }
  const environments = await context.client.environments.list();
  const environment = environments.find(function (entry) { return entry && entry.id === environmentId; });
  const primary = environments.find(function (entry) { return entry && entry.meta && entry.meta.primary === true; });
  if (!environment || !isObject(environment.meta)) {
    throw runtimeError('ENVIRONMENT_PROOF_UNAVAILABLE', 'Could not inspect the actual execution environment before schema mutation.');
  }
  if (!primary || (environment.meta.primary === true) !== (primary.id === environmentId)) {
    throw runtimeError('ENVIRONMENT_PROOF_UNAVAILABLE', 'Could not independently prove whether the actual execution environment is primary.');
  }
  context.executionEnvironment = environment;
  if (environment.meta.status !== 'ready' || environment.meta.read_only_mode === true) {
    throw runtimeError('ENVIRONMENT_NOT_WRITABLE', 'Temporary schema mutation requires a ready, writable environment.');
  }
  if (environment.meta.primary === true) {
    const doubleOptIn = context.plan.options.migrateInvalidContent === true &&
      context.plan.invalidContent.migrateInvalidContent === true &&
      executionContext.inPlace === true && executionContext.allowPrimary === true;
    if (!doubleOptIn) {
      throw runtimeError('PRIMARY_SCHEMA_RELAXATION_FORBIDDEN', 'Temporary validator/default suppression on the primary environment requires a plan generated with migrate-invalid-content plus migrations:run --in-place --allow-primary. No schema field was changed.');
    }
  }
}

async function applyValidatorRelaxations(context) {
  const relaxations = context.plan.invalidContent.validatorRelaxations;
  if (relaxations.length === 0) return;

  await verifySkippedRecords(context, true);
  await verifySkippedScheduleSafety(context, true);
  await assertSchemaMutationEnvironmentAllowed(context);
  context.validatorRelaxationStarted = true;
  logValidatorMutationWarning(context, 'temporarily relaxing');

  for (const relaxation of relaxations) {
    const current = await readFieldValidatorState(context, relaxation);
    if (current.hash === relaxation.relaxedHash) {
      context.relaxedFieldIds.add(relaxation.fieldId);
      continue;
    }
    if (current.hash !== relaxation.originalHash) {
      throw runtimeError('SCHEMA_RELAXATION_CONFLICT', 'Field ' + relaxation.fieldId + ' changed immediately before validator relaxation.', {
        fieldId: relaxation.fieldId,
        expected: relaxation.allowedValidatorHashes,
        actual: current.hash,
      });
    }
    await replaceFieldValidators(context, relaxation, relaxation.originalHash, relaxation.relaxedValidators, relaxation.relaxedHash, 'relax');
    context.relaxedFieldIds.add(relaxation.fieldId);
  }

  const actual = await fetchTargetSchemaState(context);
  if (actual.digest !== context.plan.invalidContent.schemaStates.fullyRelaxedDigest) {
    throw runtimeError('SCHEMA_RELAXATION_VERIFY_FAILURE', 'Target schema did not reach the exact fully-relaxed digest before content writes.', {
      expected: context.plan.invalidContent.schemaStates.fullyRelaxedDigest,
      actual: actual.digest,
    });
  }
}

async function applyDefaultValueSuppressions(context, requestedSuppressions) {
  const suppressions = Array.isArray(requestedSuppressions)
    ? requestedSuppressions
    : context.defaultValueSuppressions;
  if (suppressions.length === 0) return;

  await verifySkippedRecords(context, true);
  await verifySkippedScheduleSafety(context, true);
  await assertSchemaMutationEnvironmentAllowed(context);
  context.defaultValueSuppressionStarted = true;
  logDefaultValueMutationWarning(context, 'temporarily suppressing', suppressions);

  for (const suppression of suppressions) {
    const current = await readFieldDefaultValueState(context, suppression);
    if (current.hash === suppression.suppressedHash) {
      context.suppressedDefaultFieldIds.add(suppression.fieldId);
      continue;
    }
    if (current.hash !== suppression.originalHash) {
      throw runtimeError('SCHEMA_DEFAULT_SUPPRESSION_CONFLICT', 'Field ' + suppression.fieldId + ' changed immediately before default-value suppression.', {
        fieldId: suppression.fieldId,
        expected: suppression.allowedHashes,
        actual: current.hash,
      });
    }
    await replaceFieldDefaultValue(
      context,
      suppression,
      suppression.originalHash,
      suppression.suppressedDefaultValue,
      suppression.suppressedHash,
      'suppress',
    );
    context.suppressedDefaultFieldIds.add(suppression.fieldId);
  }

  const actual = await fetchTargetSchemaState(context);
  const classification = classifyManagedSchemaState(context, actual);
  if (
    classification.conflicts.length > 0 ||
    classification.normalizedDigest !== context.plan.target.schemaDigest ||
    stableStringify(classification.suppressedDefaultFieldIds.slice().sort()) !==
      stableStringify(suppressions.map(function (entry) { return entry.fieldId; }).sort()) ||
    classification.relaxedFieldIds.length !== context.plan.invalidContent.validatorRelaxations.length
  ) {
    throw runtimeError('SCHEMA_DEFAULT_SUPPRESSION_VERIFY_FAILURE', 'Target schema did not reach the exact generated validator/default suppression state before content writes.', {
      expectedSuppressedFieldIds: suppressions.map(function (entry) { return entry.fieldId; }),
      actualSuppressedFieldIds: classification.suppressedDefaultFieldIds,
      conflicts: classification.conflicts,
      normalizedDigest: classification.normalizedDigest,
    });
  }
}

function logValidatorMutationWarning(context, operation) {
  log(context, 'Warning: ' + operation + ' ' + context.plan.invalidContent.validatorRelaxations.length + ' field validator configuration(s). A hard process kill can prevent in-process restoration; rerunning this exact migration recovers generated partial states. Field updates have no CMA version token, so an unavoidable read/write race remains.');
}

function logDefaultValueMutationWarning(context, operation, requestedSuppressions) {
  const suppressions = Array.isArray(requestedSuppressions)
    ? requestedSuppressions
    : context.defaultValueSuppressions;
  log(context, 'Warning: ' + operation + ' ' + suppressions.length + ' field default configuration(s) so CMA CREATE cannot replace historical nulls. Concurrent creates during this narrow project-wide window will not receive those defaults; use a quiet or maintenance window. A hard process kill can prevent in-process restoration; rerunning this exact migration recovers generated partial states. Field updates have no CMA version token, so an unavoidable read/write race remains.');
}

async function restoreValidatorRelaxations(context) {
  const relaxations = context.plan.invalidContent.validatorRelaxations;
  if (!context.validatorRelaxationStarted || relaxations.length === 0) return;

  const failures = [];
  for (const relaxation of relaxations.slice().reverse()) {
    try {
      const current = await readFieldValidatorState(context, relaxation);
      if (current.hash === relaxation.originalHash) {
        context.relaxedFieldIds.delete(relaxation.fieldId);
        continue;
      }
      if (current.hash !== relaxation.relaxedHash) {
        failures.push({
          fieldId: relaxation.fieldId,
          code: 'SCHEMA_RESTORATION_CONFLICT',
          message: 'Field validators match neither the original nor generated relaxed state; the runtime did not overwrite them.',
          actualHash: current.hash,
          allowedHashes: relaxation.allowedValidatorHashes,
        });
        continue;
      }
      await replaceFieldValidators(context, relaxation, relaxation.relaxedHash, relaxation.originalValidators, relaxation.originalHash, 'restore');
      context.relaxedFieldIds.delete(relaxation.fieldId);
    } catch (error) {
      failures.push({
        fieldId: relaxation.fieldId,
        code: error && error.code ? error.code : 'SCHEMA_RESTORATION_ERROR',
        message: error && error.message ? error.message : String(error),
      });
    }
  }

  try {
    const actual = await fetchTargetSchemaState(context);
    const classification = classifyManagedSchemaState(context, actual);
    if (
      classification.conflicts.length > 0 ||
      classification.relaxedFieldIds.length > 0 ||
      classification.normalizedDigest !== context.plan.target.schemaDigest
    ) {
      failures.push({
        fieldId: null,
        code: 'SCHEMA_DIGEST_MISMATCH',
        message: 'Managed validators are not fully restored to the original generated state.',
        expected: context.plan.target.schemaDigest,
        actual: classification.normalizedDigest,
        relaxedFieldIds: classification.relaxedFieldIds,
        conflicts: classification.conflicts,
      });
    }
  } catch (error) {
    failures.push({
      fieldId: null,
      code: error && error.code ? error.code : 'SCHEMA_RESTORATION_VERIFY_ERROR',
      message: error && error.message ? error.message : String(error),
    });
  }

  if (failures.length > 0) {
    throw runtimeError('SCHEMA_RESTORATION_FAILURE', 'Could not prove restoration of every original field validator. Do not promote this environment; rerun this exact migration or restore the listed fields manually.', {
      failures,
    });
  }
  context.validatorRelaxationStarted = false;
}

async function restoreDefaultValueSuppressions(context, requestedSuppressions) {
  const suppressions = Array.isArray(requestedSuppressions)
    ? requestedSuppressions
    : context.defaultValueSuppressions;
  if (!context.defaultValueSuppressionStarted || suppressions.length === 0) return;

  const failures = [];
  for (const suppression of suppressions.slice().reverse()) {
    try {
      const current = await readFieldDefaultValueState(context, suppression);
      if (current.hash === suppression.originalHash) {
        context.suppressedDefaultFieldIds.delete(suppression.fieldId);
        continue;
      }
      if (current.hash !== suppression.suppressedHash) {
        failures.push({
          fieldId: suppression.fieldId,
          code: 'SCHEMA_DEFAULT_RESTORATION_CONFLICT',
          message: 'Field default matches neither the original nor generated suppressed state; the runtime did not overwrite it.',
          actualHash: current.hash,
          allowedHashes: suppression.allowedHashes,
        });
        continue;
      }
      await replaceFieldDefaultValue(
        context,
        suppression,
        suppression.suppressedHash,
        suppression.originalDefaultValue,
        suppression.originalHash,
        'restore',
      );
      context.suppressedDefaultFieldIds.delete(suppression.fieldId);
    } catch (error) {
      failures.push({
        fieldId: suppression.fieldId,
        code: error && error.code ? error.code : 'SCHEMA_DEFAULT_RESTORATION_ERROR',
        message: error && error.message ? error.message : String(error),
      });
    }
  }

  try {
    const actual = await fetchTargetSchemaState(context);
    const classification = classifyManagedSchemaState(context, actual);
    if (
      classification.conflicts.length > 0 ||
      classification.suppressedDefaultFieldIds.length > 0 ||
      classification.normalizedDigest !== context.plan.target.schemaDigest
    ) {
      failures.push({
        fieldId: null,
        code: 'SCHEMA_DEFAULT_DIGEST_MISMATCH',
        message: 'Managed field defaults are not fully restored to the original generated state.',
        expected: context.plan.target.schemaDigest,
        actual: classification.normalizedDigest,
        suppressedFieldIds: classification.suppressedDefaultFieldIds,
        conflicts: classification.conflicts,
      });
    }
  } catch (error) {
    failures.push({
      fieldId: null,
      code: error && error.code ? error.code : 'SCHEMA_DEFAULT_RESTORATION_VERIFY_ERROR',
      message: error && error.message ? error.message : String(error),
    });
  }

  if (failures.length > 0) {
    throw runtimeError('SCHEMA_DEFAULT_RESTORATION_FAILURE', 'Could not prove restoration of every original field default. Do not promote this environment; rerun this exact migration or restore the listed fields manually.', {
      failures,
    });
  }
  context.defaultValueSuppressionStarted = false;
}

async function restoreManagedSchema(context) {
  if (!context.defaultValueSuppressionStarted && !context.validatorRelaxationStarted) return;
  const failures = [];
  try {
    await restoreDefaultValueSuppressions(context);
  } catch (error) {
    failures.push(errorSummary(error));
  }
  try {
    await restoreValidatorRelaxations(context);
  } catch (error) {
    failures.push(errorSummary(error));
  }
  if (failures.length > 0) {
    throw runtimeError('SCHEMA_RESTORATION_FAILURE', 'Could not prove restoration of the complete original field schema. Do not promote this environment; rerun this exact migration or restore the listed fields manually.', {
      failures,
    });
  }
}

async function readFieldValidatorState(context, relaxation) {
  const fields = await context.client.fields.list(relaxation.itemTypeId);
  const field = fields.find(function (entry) { return entry.id === relaxation.fieldId; });
  if (!field) {
    throw runtimeError('SCHEMA_MISMATCH', 'Target is missing validator-relaxation field ' + relaxation.fieldId + '.');
  }
  const validators = canonicalizeJson(field.validators);
  return { field, validators, hash: semanticHash(validators) };
}

async function readFieldDefaultValueState(context, suppression) {
  const fields = await context.client.fields.list(suppression.itemTypeId);
  const field = fields.find(function (entry) { return entry.id === suppression.fieldId; });
  if (!field) {
    throw runtimeError('SCHEMA_MISMATCH', 'Target is missing default-suppression field ' + suppression.fieldId + '.');
  }
  const defaultValue = field.default_value === undefined
    ? null
    : canonicalizeJson(field.default_value);
  return { field, defaultValue, hash: semanticHash(defaultValue) };
}

async function replaceFieldValidators(context, relaxation, expectedHash, validators, desiredHash, operation) {
  const before = await readFieldValidatorState(context, relaxation);
  if (before.hash !== expectedHash) {
    throw runtimeError('SCHEMA_RELAXATION_CONFLICT', 'Field ' + relaxation.fieldId + ' changed immediately before validator ' + operation + '.', {
      fieldId: relaxation.fieldId,
      expected: expectedHash,
      actual: before.hash,
    });
  }
  if (!context.client.fields || typeof context.client.fields.update !== 'function') {
    throw runtimeError('UNSUPPORTED_CMA_CLIENT', 'The installed CMA client cannot update field validators.');
  }
  await context.client.fields.update(relaxation.fieldId, { validators: canonicalizeJson(validators) });
  context.mutationCount += 1;
  const after = await readFieldValidatorState(context, relaxation);
  if (after.hash !== desiredHash) {
    throw runtimeError('SCHEMA_RELAXATION_VERIFY_FAILURE', 'Field ' + relaxation.fieldId + ' validator ' + operation + ' did not reach the exact generated state.', {
      fieldId: relaxation.fieldId,
      expected: desiredHash,
      actual: after.hash,
    });
  }
}

async function replaceFieldDefaultValue(context, suppression, expectedHash, defaultValue, desiredHash, operation) {
  const before = await readFieldDefaultValueState(context, suppression);
  if (before.hash !== expectedHash) {
    throw runtimeError('SCHEMA_DEFAULT_SUPPRESSION_CONFLICT', 'Field ' + suppression.fieldId + ' changed immediately before default-value ' + operation + '.', {
      fieldId: suppression.fieldId,
      expected: expectedHash,
      actual: before.hash,
    });
  }
  if (!context.client.fields || typeof context.client.fields.update !== 'function') {
    throw runtimeError('UNSUPPORTED_CMA_CLIENT', 'The installed CMA client cannot update field defaults.');
  }
  await context.client.fields.update(suppression.fieldId, {
    default_value: canonicalizeJson(defaultValue),
  });
  context.mutationCount += 1;
  const after = await readFieldDefaultValueState(context, suppression);
  if (after.hash !== desiredHash) {
    throw runtimeError('SCHEMA_DEFAULT_SUPPRESSION_VERIFY_FAILURE', 'Field ' + suppression.fieldId + ' default-value ' + operation + ' did not reach the exact generated state.', {
      fieldId: suppression.fieldId,
      expected: desiredHash,
      actual: after.hash,
    });
  }
}

function combineMigrationAndRestorationErrors(contentError, restorationError) {
  if (contentError && !restorationError) return contentError;
  if (restorationError && !contentError) return restorationError;
  return runtimeError('MIGRATION_AND_SCHEMA_RESTORATION_FAILURE', 'Content migration failed and the original field schema could not be fully restored. The environment must not be promoted.', {
    migration: errorSummary(contentError),
    restoration: errorSummary(restorationError),
  });
}

function errorSummary(error) {
  return {
    name: error && error.name ? error.name : 'Error',
    code: error && error.code ? error.code : null,
    message: error && error.message ? error.message : String(error),
    details: error && error.details ? error.details : null,
  };
}

async function verifyRequiredPermissions(context) {
  const required = context.plan.requiredPermissions;
  if (!isObject(required)) {
    throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'The plan does not declare the permissions required for safe execution. Regenerate it with the current plugin.');
  }
  const quiescesSchedules = planHasCmaMutations(context.plan);
  const scheduledItemTypeIds = unique(context.plan.records.filter(function (recordPlan) {
    const desiredSchedules = recordPlan.desired && recordPlan.desired.schedules;
    const baselineSchedules = recordPlan.baseline && recordPlan.baseline.schedules;
    return quiescesSchedules && Boolean(
      (desiredSchedules && (desiredSchedules.publication || desiredSchedules.unpublishing)) ||
      (baselineSchedules && (baselineSchedules.publication || baselineSchedules.unpublishing)),
    );
  }).map(function (recordPlan) { return recordPlan.itemTypeId; }));
  const itemTypeRequirements = Array.isArray(required.itemTypes) ? required.itemTypes : [];
  const checksReferences = context.plan.records.some(function (entry) {
    return entry.action === 'delete' ||
      (entry.action !== 'noop' && entry.baseline && entry.baseline.published && entry.desired && !entry.desired.published) ||
      (entry.desired && entry.desired.published && entry.publishedDependencies.length > 0);
  }) || context.plan.uploads.some(function (entry) { return entry.action === 'delete'; }) ||
    context.plan.execution.publicationSeedOrder.length > 0 ||
    context.plan.legacyIdMappings.newMappingBatch !== null ||
    context.plan.legacyIdMappings.entries.some(function (entry) {
      return entry.entityType === 'record' || entry.entityType === 'block';
    });
  const declaredReadItemTypes = Array.isArray(required.readItemTypes)
    ? required.readItemTypes.slice().sort(function (left, right) { return String(left.id).localeCompare(String(right.id)); })
    : null;
  if (checksReferences) {
    if (!declaredReadItemTypes || declaredReadItemTypes.some(function (entry) {
      return !isObject(entry) || typeof entry.id !== 'string' || (entry.workflowId !== null && typeof entry.workflowId !== 'string');
    })) {
      throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'A plan using authoritative publication, deletion, or Item-ID reservation checks must declare every regular model needed for permission-complete reads. Regenerate it with the current plugin.');
    }
    const liveReadItemTypes = context.targetItemTypes.filter(function (entry) { return !entry.modularBlock; }).map(function (entry) {
      return { id: entry.id, workflowId: entry.workflowId };
    }).sort(function (left, right) { return left.id.localeCompare(right.id); });
    if (stableStringify(declaredReadItemTypes) !== stableStringify(liveReadItemTypes)) {
      throw runtimeError('SCHEMA_MISMATCH', 'The project\'s regular-model set changed after this plan was generated.', {
        expected: declaredReadItemTypes,
        actual: liveReadItemTypes,
      });
    }
  }
  if (
    deriveRequiredManageUploadCollections(context.plan.uploadCollections) &&
    required.manageUploadCollections !== true
  ) {
    throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'The plan does not declare Media Area collection access required to inspect its managed upload collections. Regenerate it with the current plugin.');
  }
  for (const itemTypeId of scheduledItemTypeIds) {
    const declaration = itemTypeRequirements.find(function (entry) { return entry && entry.id === itemTypeId; });
    if (required.manageSchedules !== true || !declaration || !Array.isArray(declaration.actions) || !declaration.actions.includes('publish')) {
      throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'The plan does not declare publish permission needed to quiesce scheduled content on item type ' + itemTypeId + '. Regenerate it with the current plugin.');
    }
  }
  if (!context.client.users || typeof context.client.users.findMe !== 'function') {
    throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'The installed CMA client cannot inspect the effective credential role.');
  }

  let identity;
  try {
    identity = await context.client.users.findMe({ include: 'role' });
  } catch (error) {
    throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'Could not inspect the current CMA credential before applying content changes.', {
      cause: error && error.message ? error.message : String(error),
    });
  }

  if (identity.type === 'account' || identity.type === 'organization') {
    return;
  }
  if (identity.type === 'access_token') {
    if (identity.can_access_cma !== true) {
      throw runtimeError('INSUFFICIENT_PERMISSIONS', 'The current API token cannot access the Content Management API.');
    }
    if (identity.hardcoded_type === 'admin') {
      return;
    }
    if (identity.hardcoded_type === 'readonly') {
      const writesRecords = itemTypeRequirements.some(function (entry) {
        return entry && Array.isArray(entry.actions) && entry.actions.some(function (action) { return action !== 'read'; });
      }) || context.plan.legacyIdMappings.newMappingBatch !== null;
      const writesUploads = Array.isArray(required.uploadActions) && required.uploadActions.some(function (action) { return action !== 'read'; });
      if (!writesRecords && !writesUploads && !required.manageUploadCollections && !required.manageSchedules && !required.editSchema) {
        return;
      }
      throw runtimeError('INSUFFICIENT_PERMISSIONS', 'The built-in read-only API token cannot perform this content migration.');
    }
  }

  let role = isObject(identity.role) && isObject(identity.role.meta) ? identity.role : null;
  if (!role && isObject(identity.role) && typeof identity.role.id === 'string' && context.client.roles && typeof context.client.roles.find === 'function') {
    role = await context.client.roles.find(identity.role.id);
  }
  const permissions = role && isObject(role.meta) && isObject(role.meta.final_permissions)
    ? role.meta.final_permissions
    : null;
  if (!permissions) {
    throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'The current credential does not expose effective role permissions. Use an owner/admin credential or a custom role whose final_permissions can be inspected.');
  }

  if (required.manageUploadCollections && permissions.can_manage_upload_collections !== true) {
    throw runtimeError('INSUFFICIENT_PERMISSIONS', 'The current role cannot manage upload collections.');
  }
  if (required.editSchema && permissions.can_edit_schema !== true) {
    throw runtimeError('INSUFFICIENT_PERMISSIONS', 'The current role cannot edit the schema required by this content migration.');
  }

  const environmentId = await resolveExecutionEnvironmentId(context);
  const positiveItems = Array.isArray(permissions.positive_item_type_permissions) ? permissions.positive_item_type_permissions : [];
  const negativeItems = Array.isArray(permissions.negative_item_type_permissions) ? permissions.negative_item_type_permissions : [];
  for (const itemTypeRequirement of itemTypeRequirements) {
    if (!isObject(itemTypeRequirement) || typeof itemTypeRequirement.id !== 'string' || !Array.isArray(itemTypeRequirement.actions)) {
      throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'The plan has an invalid per-model permission declaration. Regenerate it with the current plugin.');
    }
    const itemType = context.schemaById.get(itemTypeRequirement.id);
    if (!itemType) {
      throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'The plan requests permissions for unknown item type ' + itemTypeRequirement.id + '.');
    }
    for (const action of itemTypeRequirement.actions) {
      if (!permissionSetAllowsItem(positiveItems, negativeItems, environmentId, itemType, action)) {
        throw runtimeError('INSUFFICIENT_PERMISSIONS', 'The effective role cannot prove unrestricted ' + action + ' permission for item type ' + itemTypeRequirement.id + ' in environment ' + environmentId + '.');
      }
    }
  }

  const mappingEntries = context.plan.legacyIdMappings.entries;
  if (
    mappingEntries.length > 0 ||
    context.plan.legacyIdMappings.existingMappingRecords.length > 0 ||
    context.plan.legacyIdMappings.newMappingBatch !== null ||
    context.liveLegacyMappingModelId
  ) {
    const internalMappingItemType = {
      id: context.liveLegacyMappingModelId || '__datocms_content_diff__',
      workflowId: null,
    };
    const mappingActions = context.plan.legacyIdMappings.newMappingBatch === null
      ? ['read']
      : ['read', 'create'];
    for (const action of mappingActions) {
      if (!permissionSetAllowsItem(positiveItems, negativeItems, environmentId, internalMappingItemType, action)) {
        throw runtimeError('INSUFFICIENT_PERMISSIONS', 'The effective role cannot prove broad ' + action + ' permission needed for the internal datocms_content_diff mapping model in environment ' + environmentId + '.');
      }
    }
  }

  // Reference and direct Item lookups are permission-filtered. Before a
  // destructive plan or a new Item-ID reservation relies on absence, prove
  // unrestricted reads across every regular model, including models outside
  // the selected content scope.
  if (checksReferences) {
    for (const itemType of declaredReadItemTypes) {
      if (!permissionSetAllowsItem(positiveItems, negativeItems, environmentId, itemType, 'read')) {
        throw runtimeError('INSUFFICIENT_PERMISSIONS', 'This content migration requires unrestricted read permission for every regular model so reference and Item-ID collision checks cannot hide retained records. Missing read permission for item type ' + itemType.id + '.');
      }
    }
  }

  const uploadActions = Array.isArray(required.uploadActions) ? required.uploadActions : [];
  const positiveUploads = Array.isArray(permissions.positive_upload_permissions) ? permissions.positive_upload_permissions : [];
  const negativeUploads = Array.isArray(permissions.negative_upload_permissions) ? permissions.negative_upload_permissions : [];
  for (const action of uploadActions) {
    if (!permissionSetAllowsUpload(positiveUploads, negativeUploads, environmentId, action)) {
      throw runtimeError('INSUFFICIENT_PERMISSIONS', 'The effective role cannot prove unrestricted ' + action + ' permission for uploads in environment ' + environmentId + '.');
    }
  }
}

async function resolveExecutionEnvironmentId(context) {
  if (context.executionEnvironmentId) {
    return context.executionEnvironmentId;
  }
  const configured = context.client.config && context.client.config.environment;
  const executionContext = isObject(context.options.executionContext) ? context.options.executionContext : {};
  const declared = typeof executionContext.environmentId === 'string' && executionContext.environmentId
    ? executionContext.environmentId
    : null;
  if (typeof configured === 'string' && configured && declared && configured !== declared) {
    throw runtimeError('EXECUTION_CONTEXT_MISMATCH', 'Migration execution context targets environment ' + declared + ', but the CMA client is configured for ' + configured + '.');
  }
  if (typeof configured === 'string' && configured) {
    context.executionEnvironmentId = configured;
    return configured;
  }
  if (!context.client.environments || typeof context.client.environments.list !== 'function') {
    throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'Cannot determine the environment targeted by the migration client.');
  }
  const environments = await context.client.environments.list();
  const primary = environments.find(function (environment) {
    return environment && environment.meta && environment.meta.primary === true;
  });
  if (!primary) {
    throw runtimeError('PERMISSION_PROOF_UNAVAILABLE', 'Cannot determine the current primary environment for permission validation.');
  }
  if (declared && declared !== primary.id) {
    throw runtimeError('EXECUTION_CONTEXT_MISMATCH', 'A CMA client without an explicit environment targets primary (' + primary.id + '), but the execution context declared ' + declared + '.');
  }
  context.executionEnvironmentId = primary.id;
  return primary.id;
}

function permissionSetAllowsItem(positive, negative, environmentId, itemType, action) {
  if (!itemType) {
    return false;
  }
  const targetOverlaps = function (entry) {
    return entry.item_type == null
      ? (entry.workflow == null || entry.workflow === itemType.workflowId)
      : entry.item_type === itemType.id;
  };
  const grantsBroadly = function (entry) {
    const environmentMatches = entry.environment === environmentId;
    const actionMatches = entry.action === 'all' || entry.action === action;
    const creatorIsBroad = entry.on_creator == null || entry.on_creator === 'anyone';
    const localeIsBroad = entry.localization_scope == null || entry.localization_scope === 'all';
    const stageIsBroad = entry.on_stage == null && entry.to_stage == null;
    return environmentMatches && actionMatches && targetOverlaps(entry) && creatorIsBroad && localeIsBroad && stageIsBroad;
  };
  const deniesAnySubset = function (entry) {
    return entry.environment === environmentId &&
      (entry.action === 'all' || entry.action === action) &&
      targetOverlaps(entry);
  };
  return positive.some(grantsBroadly) && !negative.some(deniesAnySubset);
}

function permissionSetAllowsUpload(positive, negative, environmentId, action) {
  const grantsBroadly = function (entry) {
    return entry.environment === environmentId &&
      (entry.action === 'all' || entry.action === action) &&
      entry.upload_collection == null &&
      (entry.on_creator == null || entry.on_creator === 'anyone') &&
      (entry.localization_scope == null || entry.localization_scope === 'all') &&
      entry.move_to_upload_collection == null;
  };
  const deniesAnySubset = function (entry) {
    return entry.environment === environmentId && (entry.action === 'all' || entry.action === action);
  };
  return positive.some(grantsBroadly) && !negative.some(deniesAnySubset);
}

async function verifyTargetSetPreconditions(context, finalCheck) {
  const preconditions = context.plan.targetPreconditions;
  if (!preconditions) {
    return;
  }

  const itemTypeIds = Array.isArray(preconditions.itemTypeIds)
    ? preconditions.itemTypeIds.slice().sort()
    : unique(context.plan.records.map(function (entry) { return entry.itemTypeId; })).sort();
  const actualRecordIds = [];
  for (const itemTypeId of itemTypeIds) {
    for await (const record of context.client.items.listPagedIterator(
      { filter: { type: itemTypeId }, version: 'current', order_by: 'id_ASC' },
      { perPage: 500, concurrency: 5 },
    )) {
      actualRecordIds.push(record.id);
    }
  }
  actualRecordIds.sort();

  const baselineRecordIds = preconditions.selectedRecordIds.slice().sort();
  const desiredRecordIds = Array.isArray(preconditions.desiredRecordIds)
    ? preconditions.desiredRecordIds.slice().sort()
    : applyPlanToIdSet(preconditions.selectedRecordIds, context.plan.records);
  const expectedRecordIds = finalCheck ? desiredRecordIds : baselineRecordIds;
  if (finalCheck ? !sameStringArray(actualRecordIds, expectedRecordIds) : !isPlannedIntermediateIdSet(actualRecordIds, baselineRecordIds, desiredRecordIds)) {
    throw runtimeError('TARGET_SET_CONFLICT', 'The destination record set changed after this migration was generated.', {
      expected: expectedRecordIds,
      desired: desiredRecordIds,
      actual: actualRecordIds,
    });
  }

  let actualUploadIds;
  if (context.plan.options.uploads === 'all') {
    actualUploadIds = [];
    for await (const upload of context.client.uploads.listPagedIterator({}, { perPage: 500, concurrency: 5 })) {
      actualUploadIds.push(upload.id);
    }
    actualUploadIds.sort();
  } else {
    const candidates = unique(preconditions.selectedUploadIds.concat(
      Array.isArray(preconditions.desiredUploadIds)
        ? preconditions.desiredUploadIds
        : applyPlanToIdSet(preconditions.selectedUploadIds, context.plan.uploads),
    ));
    const found = await mapWithConcurrency(candidates, 5, async function (id) {
      const upload = await findUploadMaybe(context.client, id);
      return upload ? id : null;
    });
    actualUploadIds = found.filter(Boolean).sort();
  }

  const baselineUploadIds = preconditions.selectedUploadIds.slice().sort();
  const desiredUploadIds = Array.isArray(preconditions.desiredUploadIds)
    ? preconditions.desiredUploadIds.slice().sort()
    : applyPlanToIdSet(preconditions.selectedUploadIds, context.plan.uploads);
  const expectedUploadIds = finalCheck ? desiredUploadIds : baselineUploadIds;
  if (finalCheck ? !sameStringArray(actualUploadIds, expectedUploadIds) : !isPlannedIntermediateIdSet(actualUploadIds, baselineUploadIds, desiredUploadIds)) {
    throw runtimeError('TARGET_SET_CONFLICT', 'The destination upload set changed after this migration was generated.', {
      expected: expectedUploadIds,
      desired: desiredUploadIds,
      actual: actualUploadIds,
    });
  }
}

function isPlannedIntermediateIdSet(actualIds, baselineIds, desiredIds) {
  const actual = new Set(actualIds);
  const baseline = new Set(baselineIds);
  const desired = new Set(desiredIds);
  const allowed = new Set(baselineIds.concat(desiredIds));

  if (actualIds.some(function (id) { return !allowed.has(id); })) {
    return false;
  }
  for (const id of baseline) {
    if (desired.has(id) && !actual.has(id)) {
      return false;
    }
  }
  return true;
}

async function classifyInitialState(context) {
  for (const recordPlan of context.plan.records) {
    const live = await captureRecordMaybe(context, recordPlan.id, recordPlan.itemTypeId);
    context.initialRecords.set(recordPlan.id, live);
    classifyRecord(context, recordPlan, live);
  }

  for (const collectionPlan of context.plan.uploadCollections) {
    const liveResource = await findCollectionMaybe(context.client, collectionPlan.id);
    const live = liveResource ? canonicalizeUploadCollection(liveResource) : null;
    context.initialCollections.set(collectionPlan.id, live);
  }
  verifyInitialCollectionState(context);

  await classifyInitialUploads(context);
}

async function classifyInitialUploads(context) {
  for (const uploadPlan of context.plan.uploads) {
    const initialResource = await findUploadMaybe(context.client, uploadPlan.id);
    const liveResource = initialResource
      ? await waitForUploadReady(context, uploadPlan.id)
      : null;
    const live = liveResource ? canonicalizeUpload(liveResource, context.plan.schema.locales) : null;
    context.initialUploads.set(uploadPlan.id, live);
    classifyUpload(uploadPlan, live);
  }
}

function planAlreadyConverged(context) {
  const mappingBatch = context.plan.legacyIdMappings.newMappingBatch;
  if (mappingBatch) {
    const mappingState = context.legacyIdMappingState;
    if (!mappingState || !mappingBatch.chunks.every(function (chunk) {
      return legacyMappingChunkMatches(mappingState.recordsById.get(chunk.id), chunk);
    })) {
      return false;
    }
  }
  for (const recordPlan of context.plan.records) {
    const live = context.initialRecords.get(recordPlan.id);
    if (!recordPlan.desired) {
      if (live) return false;
    } else if (
      !live || live.hash !== recordPlan.desired.hash ||
      stableStringify(live.validity) !== stableStringify(recordPlan.desired.validity)
    ) {
      return false;
    }
  }
  for (const uploadPlan of context.plan.uploads) {
    const live = context.initialUploads.get(uploadPlan.id);
    if (!uploadPlan.desired ? Boolean(live) : !live || live.hash !== uploadPlan.desired.hash) {
      return false;
    }
  }
  for (const collectionPlan of context.plan.uploadCollections) {
    const live = context.initialCollections.get(collectionPlan.id);
    if (!live || live.hash !== collectionPlan.desired.hash) return false;
  }
  const orderingFailures = [];
  verifyFinalRecordOrdering(context, context.initialRecords, orderingFailures);
  if (orderingFailures.length > 0) return false;
  return true;
}

function planHasCmaMutations(plan) {
  return (Array.isArray(plan.records) && plan.records.some(function (entry) { return entry.action !== 'noop'; })) ||
    (Array.isArray(plan.uploads) && plan.uploads.some(function (entry) { return entry.action !== 'noop'; })) ||
    (Array.isArray(plan.uploadCollections) && plan.uploadCollections.some(function (entry) { return entry.action !== 'noop'; })) ||
    Boolean(plan.requiredPermissions && plan.requiredPermissions.editSchema) ||
    Boolean(plan.legacyIdMappings && plan.legacyIdMappings.newMappingBatch);
}

async function verifyLiveUploadCollectionLabelSafety(context) {
  const changed = orderedPlans(
    context.plan.execution.collectionOrder,
    context.plan.uploadCollections
  ).filter(function (plan) { return plan.action !== 'noop'; });
  if (changed.length === 0) return;

  const resources = await context.client.uploadCollections.list();
  const live = new Map(resources.map(function (resource) {
    const snapshot = canonicalizeUploadCollection(resource);
    return [snapshot.id, snapshot];
  }));
  for (const plan of changed) {
    const current = live.get(plan.id);
    if (current && current.hash === plan.desired.hash) continue;
    const desiredKey = uploadCollectionLabelKey(plan.desired);
    const occupant = Array.from(live.entries()).find(function (entry) {
      return entry[0] !== plan.id && uploadCollectionLabelKey(entry[1]) === desiredKey;
    });
    if (occupant) {
      throw runtimeError(
        'UPLOAD_COLLECTION_LABEL_CONFLICT',
        'Upload collection ' + plan.id + ' cannot claim label ' +
          JSON.stringify(plan.desired.label) + ' under parent ' +
          String(plan.desired.parentId) + ' because it is occupied by ' + occupant[0] + '.',
        { collectionId: plan.id, occupantId: occupant[0] }
      );
    }
    live.set(plan.id, plan.desired);
  }
}

async function verifySkippedRecords(context, finalCheck) {
  for (const skipped of context.plan.invalidContent.skippedRecords) {
    if (skipped.disposition === 'preserve_external') {
      const external = await findRecordCurrentMaybe(context.client, skipped.id);
      if (!finalCheck) context.initialSkippedRecords.set(skipped.id, external);
      if (!external) {
        throw runtimeError('SKIPPED_RECORD_TARGET_CONFLICT', 'External record ' + skipped.id + ' that collided with skipped source content no longer exists in the destination.', {
          recordId: skipped.id,
          finalCheck: finalCheck === true,
        });
      }
      continue;
    }
    const live = await captureRecordMaybe(context, skipped.id, skipped.itemTypeId);
    if (!finalCheck) context.initialSkippedRecords.set(skipped.id, live);
    if (skipped.disposition === 'must_remain_absent') {
      if (live) {
        throw runtimeError('SKIPPED_RECORD_TARGET_CONFLICT', 'Skipped source-only record ' + skipped.id + ' must remain absent, but it exists in the destination.', {
          recordId: skipped.id,
          finalCheck: finalCheck === true,
        });
      }
    } else {
      if (
        !live || live.hash !== skipped.expectedTargetHash ||
        live.topology.position !== skipped.expectedTargetPosition ||
        stableStringify(live.validity) !== stableStringify(skipped.targetValidity)
      ) {
        throw runtimeError('SKIPPED_RECORD_TARGET_CONFLICT', 'Skipped record ' + skipped.id + ' no longer matches the exact destination state that this plan promised to preserve.', {
          recordId: skipped.id,
          expectedHash: skipped.expectedTargetHash,
          actualHash: live ? live.hash : null,
          expectedPosition: skipped.expectedTargetPosition,
          actualPosition: live ? live.topology.position : null,
          expectedValidity: skipped.targetValidity,
          actualValidity: live ? live.validity : null,
          finalCheck: finalCheck === true,
        });
      }
    }

    const targetBlockIds = new Set(skipped.targetNestedBlockIds);
    const preservedExternalBlockIds = new Set(skipped.preservedExternalBlockIds);
    for (const blockId of skipped.sourceNestedBlockIds) {
      if (targetBlockIds.has(blockId)) continue;
      const collision = await findRecordCurrentMaybe(context.client, blockId);
      if (preservedExternalBlockIds.has(blockId)) {
        if (!collision) {
          throw runtimeError('BLOCK_OWNERSHIP_CONFLICT', 'External nested block ' + blockId + ' whose ID collided with skipped source content no longer exists in the destination.', {
            blockId,
            skippedRecordId: skipped.id,
            finalCheck: finalCheck === true,
          });
        }
      } else if (collision) {
        throw runtimeError('BLOCK_OWNERSHIP_CONFLICT', 'Nested block ID ' + blockId + ' belongs to skipped source content but is already present in the destination.', {
          blockId,
          skippedRecordId: skipped.id,
          finalCheck: finalCheck === true,
        });
      }
    }
  }
}

async function verifySkippedScheduleSafety(context, recapture) {
  if (!planHasCmaMutations(context.plan)) return;
  for (const skipped of context.plan.invalidContent.skippedRecords) {
    if (skipped.disposition !== 'preserve_target') continue;
    const live = recapture
      ? await captureRecordMaybe(context, skipped.id, skipped.itemTypeId)
      : context.initialSkippedRecords.get(skipped.id);
    if (!live) continue;
    if (live.schedules.publication || live.schedules.unpublishing) {
      throw runtimeError('SKIPPED_RECORD_SCHEDULE_CONFLICT', 'Skipped record ' + skipped.id + ' has a live publication or unpublishing schedule. Cancel it and regenerate before running this mutating plan; skipped schedule state is not serialized and cannot be quiesced safely across resume.', {
        recordId: skipped.id,
        schedules: live.schedules,
      });
    }
  }
}

function verifySkippedOrderingSafety(context) {
  for (const skipped of context.plan.invalidContent.skippedRecords) {
    if (skipped.disposition !== 'preserve_target') continue;
    const live = context.initialSkippedRecords.get(skipped.id);
    const itemType = context.schemaById.get(skipped.itemTypeId);
    if (!live || !itemType || (!itemType.tree && !itemType.sortable)) continue;
    const parentId = live.topology.parentId;
    const unsafe = context.plan.records.filter(function (recordPlan) {
      if (recordPlan.id === skipped.id || recordPlan.itemTypeId !== skipped.itemTypeId) return false;
      const baselineParent = recordPlan.baseline ? recordPlan.baseline.topology.parentId : null;
      const desiredParent = recordPlan.desired ? recordPlan.desired.topology.parentId : null;
      if (recordPlan.action === 'create') return desiredParent === parentId;
      if (recordPlan.action === 'delete') return baselineParent === parentId;
      return recordPlan.changes.topology && (baselineParent === parentId || desiredParent === parentId);
    }).map(function (recordPlan) { return recordPlan.id; });
    if (unsafe.length > 0) {
      throw runtimeError('SKIPPED_RECORD_ORDERING_CONFLICT', 'Planned topology or position writes can implicitly move skipped record ' + skipped.id + '. Regenerate with the affected sibling aggregate skipped as a closed ordering group.', {
        skippedRecordId: skipped.id,
        unsafeRecordIds: unsafe,
      });
    }
  }
}

function verifyInitialCollectionState(context) {
  const actual = liveCollectionStateSignature(context, context.initialCollections);
  const match = matchesPlannedCollectionState(context, actual);
  if (!match.matched) {
    throw runtimeError('TARGET_CONFLICT', 'Destination upload collection ordering/topology is not a planned migration intermediate.', {
      actual: JSON.parse(actual),
      allowedStateCount: match.allowedStateCount,
    });
  }
}

function collectionStateSignature(context, state) {
  return stableStringify(context.plan.uploadCollections.slice().sort(function (left, right) {
    return left.id.localeCompare(right.id);
  }).map(function (collectionPlan) {
    const entry = state.get(collectionPlan.id);
    return entry
      ? { id: collectionPlan.id, label: entry.label, parentId: entry.parentId, position: entry.position }
      : { id: collectionPlan.id, missing: true };
  }));
}

function liveCollectionStateSignature(context, collections) {
  const state = new Map();
  for (const collectionPlan of context.plan.uploadCollections) {
    const live = collections.get(collectionPlan.id);
    if (live) {
      state.set(collectionPlan.id, {
        label: live.label,
        parentId: live.parentId,
        position: live.position,
      });
    }
  }
  return collectionStateSignature(context, state);
}

function matchesPlannedCollectionState(context, actualSignature) {
  let actualRows;
  try {
    actualRows = JSON.parse(actualSignature);
  } catch (_error) {
    return { matched: false, allowedStateCount: 0 };
  }
  const state = new Map();
  for (const collectionPlan of context.plan.uploadCollections) {
    if (collectionPlan.baseline) {
      state.set(collectionPlan.id, {
        label: collectionPlan.baseline.label,
        parentId: collectionPlan.baseline.parentId,
        position: collectionPlan.baseline.position,
      });
    }
  }
  let allowedStateCount = 1;
  const matches = function () { return collectionStateMatches(context, state, actualRows); };
  const remember = function () {
    allowedStateCount += 1;
    return matches();
  };
  if (matches()) return { matched: true, allowedStateCount };

  const changed = orderedPlans(context.plan.execution.collectionOrder, context.plan.uploadCollections).filter(function (entry) {
    return entry.action !== 'noop';
  });
  for (const collectionPlan of changed) {
    if (collectionPlan.action === 'create' && !state.has(collectionPlan.id)) {
      state.set(collectionPlan.id, {
        label: collectionPlan.desired.label,
        parentId: collectionPlan.desired.parentId,
        // Create always appends after every live sibling, including retained
        // target-only collections that are intentionally absent from the
        // manifest. Only the new collection's numeric position is unknown.
        position: 'unknown-created-position',
      });
      if (remember()) return { matched: true, allowedStateCount };
    }
    applyCollectionMetadataState(state, collectionPlan);
    if (remember()) return { matched: true, allowedStateCount };
  }

  const affectedParents = affectedCollectionParentKeys(context);
  const finalOrder = context.plan.uploadCollections.filter(function (entry) {
    return affectedParents.has(String(entry.desired.parentId));
  }).sort(function (left, right) {
    return compareNullable(left.desired.parentId, right.desired.parentId) || left.desired.position - right.desired.position || left.id.localeCompare(right.id);
  });
  const seenStates = new Set();
  const maximumSteps = 4 * finalOrder.length * finalOrder.length + 1;
  for (let step = 0; step < maximumSteps; step += 1) {
    const beforeStep = collectionStateSignature(context, state);
    if (seenStates.has(beforeStep)) break;
    seenStates.add(beforeStep);
    const next = finalOrder.find(function (collectionPlan) {
      const entry = state.get(collectionPlan.id);
      return entry && entry.position !== collectionPlan.desired.position;
    });
    if (!next) break;
    // The executor restarts this canonical scan after every single write. A
    // crash therefore resumes at exactly the next simulated state instead of
    // introducing a prefix/restart combination outside the allowed graph.
    moveCollectionStatePosition(state, next.id, next.desired.position);
    if (remember()) return { matched: true, allowedStateCount };
  }
  return { matched: false, allowedStateCount };
}

function collectionStateMatches(context, expectedState, actualRows) {
  if (!Array.isArray(actualRows)) return false;
  const expectedRows = JSON.parse(collectionStateSignature(context, expectedState));
  if (expectedRows.length !== actualRows.length) return false;
  for (let index = 0; index < expectedRows.length; index += 1) {
    const expected = expectedRows[index];
    const actual = actualRows[index];
    if (!isObject(actual) || actual.id !== expected.id || Boolean(actual.missing) !== Boolean(expected.missing)) return false;
    if (expected.missing) continue;
    if (actual.label !== expected.label || actual.parentId !== expected.parentId) return false;
    if (expected.position === 'unknown-created-position') {
      if (typeof actual.position !== 'number' || !Number.isFinite(actual.position)) return false;
    } else if (actual.position !== expected.position) {
      return false;
    }
  }
  return true;
}

function applyCollectionMetadataState(state, collectionPlan) {
  const entry = state.get(collectionPlan.id);
  if (!entry) return;
  const desired = collectionPlan.desired;
  if (entry.parentId !== desired.parentId) {
    const retainedPosition = entry.position;
    if (typeof entry.position === 'number') {
      for (const [id, sibling] of state) {
        if (id !== collectionPlan.id && sibling.parentId === entry.parentId && typeof sibling.position === 'number' && sibling.position > entry.position) {
          sibling.position -= 1;
        }
      }
    }
    for (const [id, sibling] of state) {
      if (id !== collectionPlan.id && sibling.parentId === desired.parentId && typeof sibling.position === 'number' && sibling.position >= retainedPosition) {
        sibling.position += 1;
      }
    }
    entry.parentId = desired.parentId;
    entry.position = retainedPosition;
  }
  entry.label = desired.label;
}

function moveCollectionStatePosition(state, collectionId, desiredPosition) {
  const moved = state.get(collectionId);
  if (!moved) return;
  const previous = moved.position;
  for (const [id, sibling] of state) {
    if (id === collectionId || sibling.parentId !== moved.parentId || typeof sibling.position !== 'number') continue;
    if (typeof previous !== 'number') {
      if (sibling.position >= desiredPosition) sibling.position += 1;
    } else if (previous < desiredPosition && sibling.position > previous && sibling.position <= desiredPosition) {
      sibling.position -= 1;
    } else if (previous > desiredPosition && sibling.position >= desiredPosition && sibling.position < previous) {
      sibling.position += 1;
    }
  }
  moved.position = desiredPosition;
}

function affectedCollectionParentKeys(context) {
  const parents = new Set();
  for (const collectionPlan of context.plan.uploadCollections) {
    if (collectionPlan.action === 'noop') continue;
    parents.add(String(collectionPlan.desired.parentId));
    if (collectionPlan.baseline) parents.add(String(collectionPlan.baseline.parentId));
  }
  return parents;
}

async function assertLiveCollectionStateSafe(context) {
  const liveCollections = new Map();
  for (const collectionPlan of context.plan.uploadCollections) {
    const resource = await findCollectionMaybe(context.client, collectionPlan.id);
    liveCollections.set(collectionPlan.id, resource ? canonicalizeUploadCollection(resource) : null);
  }
  const actual = liveCollectionStateSignature(context, liveCollections);
  const match = matchesPlannedCollectionState(context, actual);
  if (!match.matched) {
    throw runtimeError('TARGET_CONFLICT', 'Upload collections changed to a state this migration does not produce.', {
      actual: JSON.parse(actual),
      allowedStateCount: match.allowedStateCount,
    });
  }
}

function verifyInitialRecordPositions(context) {
  // Absolute positions are excluded from semantic hashes because this runtime
  // itself shifts siblings. Accept only the exact global position/topology
  // snapshots produced after a prefix of phases 5, 6, 9, and 10. This keeps an
  // unrelated external reorder from hiding behind a legitimate partial create
  // or delete elsewhere in the plan.
  const actual = liveRecordPositionStateSignature(context);
  const match = matchesPlannedRecordPositionState(context, actual);
  if (!match.matched) {
    throw runtimeError('TARGET_CONFLICT', 'Destination record ordering/topology is not a planned migration intermediate.', {
      actual: JSON.parse(actual),
      allowedStateCount: match.allowedStateCount,
    });
  }
}

function orderedRecordPlans(context) {
  return context.plan.records.filter(function (recordPlan) {
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    return Boolean(itemType && (itemType.tree || itemType.sortable));
  });
}

function positionStateSignature(context, state) {
  return stableStringify(orderedRecordPlans(context).slice().sort(function (left, right) {
    return left.id.localeCompare(right.id);
  }).map(function (recordPlan) {
    const entry = state.get(recordPlan.id);
    return entry
      ? { id: recordPlan.id, parentId: entry.parentId, position: entry.position }
      : { id: recordPlan.id, missing: true };
  }));
}

function liveRecordPositionStateSignature(context) {
  const state = new Map();
  for (const recordPlan of orderedRecordPlans(context)) {
    const live = context.initialRecords.get(recordPlan.id);
    if (live) {
      state.set(recordPlan.id, {
        itemTypeId: recordPlan.itemTypeId,
        parentId: live.topology.parentId,
        position: live.topology.position,
      });
    }
  }
  return positionStateSignature(context, state);
}

async function captureLiveRecordPositionStateSignature(context) {
  const plans = orderedRecordPlans(context);
  const resources = await mapWithConcurrency(plans, 5, async function (recordPlan) {
    return {
      recordPlan,
      resource: await findItemCurrentShellMaybe(context.client, recordPlan.id),
    };
  });
  const state = new Map();
  for (const entry of resources) {
    if (!entry.resource) continue;
    state.set(entry.recordPlan.id, {
      itemTypeId: entry.recordPlan.itemTypeId,
      parentId: typeof entry.resource.parent_id === 'string' ? entry.resource.parent_id : null,
      position: typeof entry.resource.position === 'number' ? entry.resource.position : null,
    });
  }
  return positionStateSignature(context, state);
}

async function assertLiveRecordPositionStateSafe(context) {
  const actual = await captureLiveRecordPositionStateSignature(context);
  const match = matchesPlannedRecordPositionState(context, actual);
  if (!match.matched) {
    throw runtimeError('TARGET_CONFLICT', 'Record ordering/topology changed to a state this migration does not produce.', {
      actual: JSON.parse(actual),
      allowedStateCount: match.allowedStateCount,
    });
  }
  return actual;
}

function matchesPlannedRecordPositionState(context, actualSignature) {
  let actualState;
  try {
    actualState = JSON.parse(actualSignature);
  } catch (_error) {
    return { matched: false, allowedStateCount: 0 };
  }
  const state = new Map();
  for (const recordPlan of orderedRecordPlans(context)) {
    if (recordPlan.baseline) {
      state.set(recordPlan.id, {
        itemTypeId: recordPlan.itemTypeId,
        parentId: recordPlan.baseline.topology.parentId,
        position: recordPlan.baseline.topology.position,
      });
    }
  }
  let allowedStateCount = 1;
  const matches = function () { return positionStateMatches(context, state, actualState); };
  const remember = function () {
    allowedStateCount += 1;
    return matches();
  };
  if (matches()) return { matched: true, allowedStateCount };

  // Phase 5: creating at a requested position shifts every following sibling.
  for (const recordPlan of orderedPlans(context.plan.execution.createOrder, orderedRecordPlans(context)).filter(function (entry) {
    return entry.action === 'create';
  })) {
    const position = recordPlan.desired.topology.position;
    if (typeof position !== 'number') {
      continue;
    }
    shiftForInsert(state, recordPlan.itemTypeId, recordPlan.desired.topology.parentId, position, recordPlan.id);
    state.set(recordPlan.id, { itemTypeId: recordPlan.itemTypeId, parentId: recordPlan.desired.topology.parentId, position });
    if (remember()) return { matched: true, allowedStateCount };
  }

  // Phase 6: parent-only moves place the record at the end of its new sibling
  // group. If retained destination-only ordered records make that position
  // unknowable, use a sentinel so only a later explicit position write can be
  // accepted on resume.
  const canKnowGroupEnd = absoluteRecordPositionsReproducible(context);
  for (const recordPlan of parentFirst(context.plan.records.filter(function (entry) {
    return entry.desired && entry.action !== 'noop';
  }))) {
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    const entry = state.get(recordPlan.id);
    if (!itemType || !itemType.tree || !entry || entry.parentId === recordPlan.desired.topology.parentId) {
      continue;
    }
    entry.parentId = recordPlan.desired.topology.parentId;
    entry.position = canKnowGroupEnd
      ? nextKnownPosition(state, recordPlan.itemTypeId, entry.parentId, recordPlan.id)
      : 'unknown-until-positioned';
    if (remember()) return { matched: true, allowedStateCount };
  }

  // Phase 9: deletion does not compact ordinary sibling positions. Tree
  // children should already have been deleted child-first or reparented in
  // phase 6; fail closed with an unknown sentinel if a malformed plan leaves
  // one behind.
  for (const recordPlan of orderedPlans(context.plan.execution.deleteOrder, context.plan.records).filter(function (entry) {
    return entry.action === 'delete';
  })) {
    const deleted = state.get(recordPlan.id);
    if (!deleted) continue;
    for (const child of state.values()) {
      if (child.itemTypeId === recordPlan.itemTypeId && child.parentId === recordPlan.id) {
        child.parentId = deleted.parentId;
        child.position = 'unknown-until-positioned';
      }
    }
    state.delete(recordPlan.id);
    if (remember()) return { matched: true, allowedStateCount };
  }

  // Phase 10: exact ordered writes have deterministic sibling-shift effects.
  const affectedGroups = affectedRecordSiblingGroups(context);
  const positional = context.plan.records.filter(function (entry) {
    if (!entry.desired || typeof entry.desired.topology.position !== 'number') return false;
    const itemType = context.schemaById.get(entry.itemTypeId);
    return itemType && (itemType.tree || itemType.sortable) &&
      affectedGroups.has(recordSiblingGroupKey(entry.itemTypeId, entry.desired.topology.parentId));
  }).sort(function (left, right) {
    return left.itemTypeId.localeCompare(right.itemTypeId) ||
      compareNullable(left.desired.topology.parentId, right.desired.topology.parentId) ||
      left.desired.topology.position - right.desired.topology.position ||
      left.id.localeCompare(right.id);
  });
  const seenStates = new Set();
  const maximumSteps = 4 * positional.length * positional.length + 1;
  for (let step = 0; step < maximumSteps; step += 1) {
    const beforeStep = positionStateSignature(context, state);
    if (seenStates.has(beforeStep)) break;
    seenStates.add(beforeStep);
    if (recordPositionGoalReached(context, positional, state)) break;
    const next = positional.find(function (recordPlan) {
      const entry = state.get(recordPlan.id);
      return entry && entry.position !== recordPlan.desired.topology.position;
    });
    if (!next) break;
    moveStatePosition(state, next.id, next.desired.topology.position);
    if (remember()) return { matched: true, allowedStateCount };
  }
  return { matched: false, allowedStateCount };
}

function recordPositionGoalReached(context, positional, state) {
  if (absoluteRecordPositionsReproducible(context)) {
    return positional.every(function (recordPlan) {
      const entry = state.get(recordPlan.id);
      return entry && entry.parentId === recordPlan.desired.topology.parentId && entry.position === recordPlan.desired.topology.position;
    });
  }

  const groups = new Map();
  for (const recordPlan of positional) {
    const entry = state.get(recordPlan.id);
    if (!entry || entry.parentId !== recordPlan.desired.topology.parentId || typeof entry.position !== 'number') return false;
    const key = recordSiblingGroupKey(recordPlan.itemTypeId, recordPlan.desired.topology.parentId);
    const group = groups.get(key) || { actual: [], desired: [] };
    group.actual.push({ id: recordPlan.id, position: entry.position });
    group.desired.push({ id: recordPlan.id, position: recordPlan.desired.topology.position });
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const compare = function (left, right) { return left.position - right.position || left.id.localeCompare(right.id); };
    const actualIds = group.actual.slice().sort(compare).map(function (entry) { return entry.id; });
    const desiredIds = group.desired.slice().sort(compare).map(function (entry) { return entry.id; });
    if (!sameStringArray(actualIds, desiredIds)) return false;
  }
  return true;
}

function absoluteRecordPositionsReproducible(context) {
  // Disabling deletions does not by itself make positions ambiguous. Only a
  // retained destination-only sibling, recorded explicitly by the planner,
  // reduces the attainable contract to managed relative order.
  const retainedOrdered = context.plan.warnings.some(function (warning) {
    return warning && warning.code === 'ABSOLUTE_POSITION_NOT_REPRODUCIBLE';
  });
  return context.plan.options.includeDeletions === true || !retainedOrdered;
}

function positionStateMatches(context, expectedState, actualRows) {
  if (!Array.isArray(actualRows)) {
    return false;
  }
  const expectedRows = JSON.parse(positionStateSignature(context, expectedState));
  if (expectedRows.length !== actualRows.length) {
    return false;
  }
  for (let index = 0; index < expectedRows.length; index += 1) {
    const expected = expectedRows[index];
    const actual = actualRows[index];
    if (!isObject(actual) || actual.id !== expected.id || Boolean(actual.missing) !== Boolean(expected.missing)) {
      return false;
    }
    if (expected.missing) {
      continue;
    }
    if (actual.parentId !== expected.parentId) {
      return false;
    }
    if (expected.position === 'unknown-until-positioned') {
      // Reparenting places a record at the end, but retained destination-only
      // siblings are deliberately absent from the manifest. Treat only this
      // one numeric position as unknown; every other managed topology and
      // position remains exact, so unrelated reorders are still rejected.
      if (typeof actual.position !== 'number' || !Number.isFinite(actual.position)) {
        return false;
      }
    } else if (actual.position !== expected.position) {
      return false;
    }
  }
  return true;
}

function shiftForInsert(state, itemTypeId, parentId, position, excludedId) {
  for (const [id, entry] of state) {
    if (id !== excludedId && entry.itemTypeId === itemTypeId && entry.parentId === parentId && typeof entry.position === 'number' && entry.position >= position) {
      entry.position += 1;
    }
  }
}

function nextKnownPosition(state, itemTypeId, parentId, excludedId) {
  let maximum = 0;
  let found = false;
  for (const [id, entry] of state) {
    if (id !== excludedId && entry.itemTypeId === itemTypeId && entry.parentId === parentId && typeof entry.position === 'number') {
      found = true;
      maximum = Math.max(maximum, entry.position);
    }
  }
  return found ? maximum + 1 : 1;
}

function moveStatePosition(state, recordId, desiredPosition) {
  const moved = state.get(recordId);
  if (!moved) return;
  const previous = moved.position;
  for (const [id, entry] of state) {
    if (id === recordId || entry.itemTypeId !== moved.itemTypeId || entry.parentId !== moved.parentId || typeof entry.position !== 'number') {
      continue;
    }
    if (typeof previous !== 'number') {
      if (entry.position >= desiredPosition) entry.position += 1;
    } else if (previous < desiredPosition && entry.position > previous && entry.position <= desiredPosition) {
      entry.position -= 1;
    } else if (previous > desiredPosition && entry.position >= desiredPosition && entry.position < previous) {
      entry.position += 1;
    }
  }
  moved.position = desiredPosition;
}

function affectedRecordSiblingGroups(context) {
  const groups = new Set();
  for (const recordPlan of context.plan.records) {
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    if (!itemType || (!itemType.tree && !itemType.sortable) || recordPlan.action === 'noop') {
      continue;
    }
    if (recordPlan.action === 'create' || recordPlan.action === 'delete' || recordPlan.changes.topology) {
      if (recordPlan.baseline) {
        groups.add(recordSiblingGroupKey(recordPlan.itemTypeId, recordPlan.baseline.topology.parentId));
      }
      if (recordPlan.desired) {
        groups.add(recordSiblingGroupKey(recordPlan.itemTypeId, recordPlan.desired.topology.parentId));
      }
    }
  }
  return groups;
}

async function verifyExternalDependencies(context) {
  const checked = new Set();
  for (const recordPlan of context.plan.records) {
    if (!recordPlan.desired || !Array.isArray(recordPlan.dependencies)) {
      continue;
    }
    for (const dependencyId of recordPlan.dependencies) {
      const dependencyPlan = context.recordPlansById.get(dependencyId);
      if (dependencyPlan) {
        if (dependencyPlan.action === 'delete') {
          throw runtimeError('MISSING_EXTERNAL_REFERENCE', 'Record ' + recordPlan.id + ' depends on record ' + dependencyId + ', but the same plan deletes it.');
        }
        continue;
      }
      if (checked.has(dependencyId)) {
        continue;
      }
      checked.add(dependencyId);
      const dependency = await findRecordCurrentMaybe(context.client, dependencyId);
      if (!dependency) {
        throw runtimeError('MISSING_EXTERNAL_REFERENCE', 'Out-of-scope record dependency ' + dependencyId + ' no longer exists in the destination.', {
          dependencyId,
          requiredBy: recordPlan.id,
        });
      }
    }
  }
}

async function verifyPublicationSafety(context) {
  for (const recordPlan of context.plan.records) {
    if (recordPlan.action !== 'create' || !recordPlan.desired) continue;
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    if (itemType.draftModeActive) continue;
    const dependencies = collectRecordReferencesFromFields(expectedCreateSeedFields(context, recordPlan), itemType, context);
    if (recordPlan.desired.topology.parentId) dependencies.add(recordPlan.desired.topology.parentId);
    const mustExistBeforeCreate = Array.from(dependencies).filter(function (dependencyId) {
      const dependencyPlan = context.recordPlansById.get(dependencyId);
      return !dependencyPlan || dependencyPlan.action !== 'create';
    });
    await assertDependencyIdsPublished(context, mustExistBeforeCreate, recordPlan.id, false);
  }

  for (const recordPlan of context.plan.records) {
    if (!recordPlan.desired || !recordPlan.desired.published) {
      continue;
    }
    await assertDependencyIdsPublished(context, recordPlan.publishedDependencies, recordPlan.id, true);
  }

  for (const recordId of context.plan.execution.publicationSeedOrder) {
    const recordPlan = context.recordPlansById.get(recordId);
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    const seedFields = expectedCreateSeedFields(context, recordPlan);
    const dependencies = collectRecordReferencesFromFields(seedFields, itemType, context);
    if (recordPlan.desired.topology.parentId) dependencies.add(recordPlan.desired.topology.parentId);
    await assertDependencyIdsPublished(context, Array.from(dependencies), recordPlan.id, true);
  }

  for (const release of context.plan.execution.deleteReleases) {
    const recordPlan = context.recordPlansById.get(release.recordId);
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    if (!release.publish && itemType.draftModeActive) continue;
    const dependencies = collectRecordReferencesFromFields(release.fields, itemType, context);
    if (recordPlan.baseline && recordPlan.baseline.topology.parentId) {
      dependencies.add(recordPlan.baseline.topology.parentId);
    }
    const external = [];
    for (const dependencyId of dependencies) {
      const dependencyPlan = context.recordPlansById.get(dependencyId);
      if (!dependencyPlan) {
        external.push(dependencyId);
        continue;
      }
      if (
        (dependencyPlan.desired && dependencyPlan.desired.published) ||
        (dependencyPlan.action === 'delete' && dependencyPlan.baseline && dependencyPlan.baseline.published)
      ) {
        continue;
      }
      throw runtimeError('UNPUBLISHED_RECORD_DEPENDENCY', 'Deletion release for record ' + recordPlan.id + ' depends on managed record ' + dependencyId + ' that will not be published in phase 9.', {
        recordId: recordPlan.id,
        dependencyId,
      });
    }
    await assertDependencyIdsPublished(context, external, recordPlan.id, false);
  }

  for (const recordPlan of context.plan.records) {
    if (
      recordPlan.action === 'noop' || !recordPlan.baseline || !recordPlan.baseline.published ||
      !recordPlan.desired || recordPlan.desired.published
    ) {
      continue;
    }
    const live = context.initialRecords.get(recordPlan.id);
    if (live && live.published) {
      await assertNoUnsafePublishedReferrers(context, recordPlan, true);
      await assertNoUnsafeTreeChildren(context, recordPlan, 'published', true, 'unpublish');
    }
  }
}

async function assertDependencyIdsPublished(context, dependencyIds, ownerRecordId, externalOnly) {
  for (const dependencyId of unique(dependencyIds)) {
    if (dependencyId === ownerRecordId) continue;
    if (externalOnly && context.recordPlansById.has(dependencyId)) continue;
    const published = await findRecordPublishedMaybe(context.client, dependencyId);
    if (!published) {
      throw runtimeError('UNPUBLISHED_RECORD_DEPENDENCY', 'Record ' + ownerRecordId + ' cannot be published without recursively publishing dependency ' + dependencyId + '.', {
        recordId: ownerRecordId,
        dependencyId,
      });
    }
  }
}

async function assertNoUnsafePublishedReferrers(context, recordPlan, preflight) {
  const published = await context.client.items.references(recordPlan.id, { version: 'published', nested: false });
  const referrerIds = unique(published.map(function (record) { return record.id; })).filter(function (id) {
    return id !== recordPlan.id;
  });
  if (!referrerIds.length) return;

  if (preflight) {
    const order = context.plan.execution.publishOrder;
    const targetIndex = order.indexOf(recordPlan.id);
    const unsafe = referrerIds.filter(function (referrerId) {
      const referrerPlan = context.recordPlansById.get(referrerId);
      if (!referrerPlan || referrerPlan.action === 'delete' || referrerPlan.action === 'noop' || !referrerPlan.desired) {
        return true;
      }
      const referrerIndex = order.indexOf(referrerId);
      if (targetIndex < 0 || referrerIndex < 0 || referrerIndex >= targetIndex) {
        return true;
      }
      return Boolean(
        referrerPlan.desired.published &&
        referrerPlan.publishedDependencies.includes(recordPlan.id),
      );
    });
    if (!unsafe.length) return;
    throw runtimeError('PUBLISHED_RECORD_STILL_REFERENCED', 'Record ' + recordPlan.id + ' has retained, out-of-scope, or unsafely ordered published referrers.', {
      recordId: recordPlan.id,
      recordIds: unsafe,
    });
  }

  throw runtimeError('PUBLISHED_RECORD_STILL_REFERENCED', 'Refusing to unpublish record ' + recordPlan.id + ' while published records still reference it.', {
    recordId: recordPlan.id,
    recordIds: referrerIds,
  });
}

async function verifyRecordDeletionSafety(context, preflight) {
  const deletes = context.plan.records.filter(function (entry) { return entry.action === 'delete'; });
  for (const recordPlan of deletes) {
    if (await findRecordCurrentMaybe(context.client, recordPlan.id)) {
      await assertNoUnexpectedRecordReferrers(context, recordPlan.id, preflight);
      await assertNoUnsafeTreeChildren(context, recordPlan, 'current', preflight, 'delete');
    }
  }
}

async function assertNoUnsafeTreeChildren(context, recordPlan, version, preflight, operation) {
  const itemType = context.schemaById.get(recordPlan.itemTypeId);
  if (!itemType || !itemType.tree) return;

  const children = [];
  for await (const candidate of context.client.items.listPagedIterator(
    { filter: { type: recordPlan.itemTypeId }, version, nested: false, order_by: 'id_ASC' },
    { perPage: 500, concurrency: 5 },
  )) {
    if (candidate.parent_id === recordPlan.id) children.push(candidate.id);
  }
  if (!children.length) return;

  if (preflight) {
    const unsafe = children.filter(function (childId) {
      const childPlan = context.recordPlansById.get(childId);
      if (!childPlan) return true;
      if (childPlan.desired && childPlan.desired.topology.parentId !== recordPlan.id) {
        return false;
      }
      if (operation === 'delete' && childPlan.action === 'delete') {
        const deleteIndex = context.plan.execution.deleteOrder.indexOf(recordPlan.id);
        const childIndex = context.plan.execution.deleteOrder.indexOf(childId);
        return childIndex < 0 || deleteIndex < 0 || childIndex >= deleteIndex;
      }
      if (
        operation === 'unpublish' && childPlan.action !== 'delete' && childPlan.desired &&
        childPlan.desired.published === null
      ) {
        const order = context.plan.execution.publishOrder;
        const parentIndex = order.indexOf(recordPlan.id);
        const childIndex = order.indexOf(childId);
        return childIndex < 0 || parentIndex < 0 || childIndex >= parentIndex;
      }
      return true;
    });
    if (!unsafe.length) return;
    throw runtimeError('TREE_RECORD_STILL_HAS_CHILDREN', 'Record ' + recordPlan.id + ' has retained, out-of-scope, or out-of-order tree children.', {
      recordId: recordPlan.id,
      recordIds: unsafe,
      version,
    });
  }

  throw runtimeError('TREE_RECORD_STILL_HAS_CHILDREN', 'Refusing to mutate tree record ' + recordPlan.id + ' while it still has ' + version + ' children.', {
    recordId: recordPlan.id,
    recordIds: children,
    version,
  });
}

async function verifyBlockOwnershipSafety(context) {
  const baselineBlockIds = new Set();
  const desiredBlockLocations = new Map();
  const liveBlockLocations = new Map();
  const topLevelIds = new Set(context.plan.records.map(function (entry) { return entry.id; }));

  for (const recordPlan of context.plan.records) {
    for (const dependencyId of recordPlan.dependencies || []) {
      topLevelIds.add(dependencyId);
    }
    if (recordPlan.baseline) {
      collectNestedBlockIds(recordPlan.baseline.current.fields, baselineBlockIds);
      if (recordPlan.baseline.published) {
        collectNestedBlockIds(recordPlan.baseline.published.fields, baselineBlockIds);
      }
    }
    if (recordPlan.desired) {
      const itemType = context.schemaById.get(recordPlan.itemTypeId);
      collectBlockOwnershipLocations(recordPlan.desired.current.fields, itemType, context, recordPlan.id, desiredBlockLocations);
      if (recordPlan.desired.published) {
        collectBlockOwnershipLocations(recordPlan.desired.published.fields, itemType, context, recordPlan.id, desiredBlockLocations);
      }
    }
    const live = context.initialRecords.get(recordPlan.id);
    if (live) {
      const itemType = context.schemaById.get(recordPlan.itemTypeId);
      collectBlockOwnershipLocations(live.current.fields, itemType, context, recordPlan.id, liveBlockLocations);
      if (live.published) {
        collectBlockOwnershipLocations(live.published.fields, itemType, context, recordPlan.id, liveBlockLocations);
      }
    }
  }

  for (const [blockId, desiredLocations] of desiredBlockLocations) {
    if (topLevelIds.has(blockId)) {
      throw runtimeError('BLOCK_OWNERSHIP_CONFLICT', 'Desired nested block ' + blockId + ' collides with a top-level record ID.', {
        blockId,
        desiredLocations: Array.from(desiredLocations).sort(),
      });
    }
    if (baselineBlockIds.has(blockId)) {
      continue;
    }
    const existing = await findItemCurrentShellMaybe(context.client, blockId);
    if (existing) {
      const liveLocations = liveBlockLocations.get(blockId) || new Set();
      if (sameStringSet(liveLocations, desiredLocations)) {
        // A prior partial run may already have created this source-only block.
        // Accept it only when nested capture proves the ID remains at the exact
        // planned top record, block model, field path, and locale. A bare block
        // lookup cannot prove ownership and must otherwise fail closed.
        continue;
      }
      throw runtimeError('BLOCK_OWNERSHIP_CONFLICT', 'Desired nested block ' + blockId + ' already exists outside its planned owner.', {
        blockId,
        desiredLocations: Array.from(desiredLocations).sort(),
        actualLocations: Array.from(liveLocations).sort(),
      });
    }
  }
}

async function verifyTransientDeleteReleaseBlockIds(context) {
  for (const release of context.plan.execution.deleteReleases) {
    if (!release.transientNestedBlockIds.length) continue;

    const declaredIds = new Set(release.transientNestedBlockIds);
    const plannedBlocks = [];
    collectNestedBlockIdentities(release.fields, plannedBlocks);
    const plannedById = new Map(plannedBlocks.map(function (block) {
      return [block.id, block];
    }));
    const initial = context.initialRecords.get(release.recordId);
    const isResumedRelease = Boolean(
      initial && initial.current.hash === release.intermediateCurrentHash,
    );

    if (isResumedRelease) {
      const liveBlocks = [];
      collectNestedBlockIdentities(initial.current.fields, liveBlocks);
      const liveById = new Map(liveBlocks.map(function (block) {
        return [block.id, block];
      }));
      const liveTransientIds = new Set(
        liveBlocks.filter(function (block) { return declaredIds.has(block.id); }).map(function (block) { return block.id; }),
      );
      if (!sameStringSet(liveTransientIds, declaredIds)) {
        throw runtimeError('BLOCK_OWNERSHIP_CONFLICT', 'A resumed deletion-reference release for ' + release.recordId + ' does not own every planned transient nested block.', {
          recordId: release.recordId,
          expectedBlockIds: Array.from(declaredIds).sort(),
          actualBlockIds: Array.from(liveTransientIds).sort(),
        });
      }
      for (const id of release.transientNestedBlockIds) {
        const planned = plannedById.get(id);
        const live = liveById.get(id);
        if (!planned || !live || planned.itemTypeId !== live.itemTypeId) {
          throw runtimeError('BLOCK_OWNERSHIP_CONFLICT', 'A resumed deletion-reference release changed transient nested block ' + id + '.', {
            recordId: release.recordId,
            blockId: id,
          });
        }
      }
    }

    for (const id of release.transientNestedBlockIds) {
      const occupied = await findItemCurrentShellMaybe(context.client, id);
      if (!isResumedRelease) {
        if (occupied) {
          throw runtimeError('BLOCK_OWNERSHIP_CONFLICT', 'Transient nested block ' + id + ' is already occupied before its deletion-reference release.', {
            recordId: release.recordId,
            blockId: id,
          });
        }
        continue;
      }
      const planned = plannedById.get(id);
      if (!occupied || !planned || itemTypeIdFromItem(occupied) !== planned.itemTypeId) {
        throw runtimeError('BLOCK_OWNERSHIP_CONFLICT', 'Transient nested block ' + id + ' is missing or has a different model during deletion-reference release recovery.', {
          recordId: release.recordId,
          blockId: id,
          expectedItemTypeId: planned ? planned.itemTypeId : null,
          actualItemTypeId: occupied ? itemTypeIdFromItem(occupied) : null,
        });
      }
    }
  }
}

function collectNestedBlockIds(value, output) {
  if (Array.isArray(value)) {
    value.forEach(function (child) { collectNestedBlockIds(child, output); });
    return;
  }
  if (!isObject(value)) {
    return;
  }
  if (isNestedItem(value)) {
    output.add(value.id);
  }
  Object.values(value).forEach(function (child) { collectNestedBlockIds(child, output); });
}

function collectBlockOwnershipLocations(fields, itemType, context, topRecordId, output, prefix) {
  if (!itemType) {
    throw runtimeError('SCHEMA_MISMATCH', 'Cannot inspect nested block ownership for an unknown item type.');
  }
  const pathPrefix = prefix || '';
  for (const field of itemType.fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, field.apiKey)) {
      continue;
    }
    const value = fields[field.apiKey];
    const fieldPath = pathPrefix ? pathPrefix + '.' + field.apiKey : field.apiKey;
    if (field.localized && isObject(value)) {
      for (const locale of Object.keys(value)) {
        collectBlockOwnershipFieldValue(value[locale], field, context, topRecordId, output, fieldPath, locale);
      }
    } else {
      collectBlockOwnershipFieldValue(value, field, context, topRecordId, output, fieldPath, null);
    }
  }
}

function collectBlockOwnershipFieldValue(value, field, context, topRecordId, output, fieldPath, locale) {
  if (field.fieldType === 'structured_text') {
    if (!isObject(value) || !isObject(value.document)) return;
    collectBlockOwnershipStructuredTextNode(value.document, context, topRecordId, output, fieldPath, locale);
    return;
  }
  if (field.fieldType === 'rich_text' || field.fieldType === 'single_block') {
    collectBlockOwnershipValue(value, context, topRecordId, output, fieldPath, locale);
  }
}

function collectBlockOwnershipStructuredTextNode(value, context, topRecordId, output, fieldPath, locale) {
  if (!isStructuredTextNode(value)) return;
  if (
    (value.type === 'block' || value.type === 'inlineBlock') &&
    isObject(value.item) && isNestedItem(value.item)
  ) {
    collectBlockOwnershipValue(value.item, context, topRecordId, output, fieldPath, locale);
  }
  if (Array.isArray(value.children)) {
    value.children.forEach(function (child) {
      collectBlockOwnershipStructuredTextNode(child, context, topRecordId, output, fieldPath, locale);
    });
  }
}

function collectBlockOwnershipValue(value, context, topRecordId, output, fieldPath, locale) {
  if (Array.isArray(value)) {
    value.forEach(function (child) {
      collectBlockOwnershipValue(child, context, topRecordId, output, fieldPath, locale);
    });
    return;
  }
  if (!isObject(value)) {
    return;
  }
  if (isNestedItem(value)) {
    const blockTypeId = itemTypeIdFromItem(value);
    const locations = output.get(value.id) || new Set();
    locations.add(blockOwnershipLocationKey(topRecordId, blockTypeId, fieldPath, locale));
    output.set(value.id, locations);
    const blockType = context.captureSchemaById.get(blockTypeId);
    if (!blockType) {
      throw runtimeError('SCHEMA_MISMATCH', 'Nested block ' + value.id + ' refers to missing item type ' + blockTypeId + '.');
    }
    const blockFields = isObject(value.attributes) ? value.attributes : nestedItemFields(value);
    collectBlockOwnershipLocations(blockFields, blockType, context, topRecordId, output, fieldPath + '.block:' + value.id);
    return;
  }
  Object.values(value).forEach(function (child) {
    collectBlockOwnershipValue(child, context, topRecordId, output, fieldPath, locale);
  });
}

function nestedItemFields(value) {
  const output = {};
  for (const key of Object.keys(value)) {
    if (!['id', 'type', 'item_type', '__itemTypeId', 'relationships', 'attributes', 'meta', 'creator'].includes(key)) {
      output[key] = value[key];
    }
  }
  return output;
}

function blockOwnershipLocationKey(topRecordId, itemTypeId, fieldPath, locale) {
  return [topRecordId, itemTypeId, fieldPath, locale || ''].join(':');
}

function sameStringSet(left, right) {
  return left.size === right.size && Array.from(left).every(function (value) { return right.has(value); });
}

async function assertNoUnexpectedRecordReferrers(context, recordId, preflight) {
  const current = await context.client.items.references(recordId, { version: 'current', nested: false });
  const published = await context.client.items.references(recordId, { version: 'published', nested: false });
  // Self-references disappear with the deleted record itself and the CMA
  // destroy transaction explicitly exempts them from retained-referrer checks.
  const referrerIds = unique(current.concat(published).map(function (record) { return record.id; })).filter(function (id) {
    return id !== recordId;
  });
  if (!referrerIds.length) {
    return;
  }

  if (preflight) {
    const order = context.plan.execution.deleteOrder;
    const targetIndex = order.indexOf(recordId);
    const unsafe = referrerIds.filter(function (referrerId) {
      const referrerPlan = context.recordPlansById.get(referrerId);
      if (!referrerPlan) {
        return true;
      }
      if (referrerPlan.action === 'delete') {
        if (deleteReleaseRemovesReference(context, referrerPlan, recordId)) {
          return false;
        }
        return order.indexOf(referrerId) < 0 || order.indexOf(referrerId) >= targetIndex;
      }
      return !referrerPlan.desired || !Array.isArray(referrerPlan.dependencies) || referrerPlan.dependencies.includes(recordId);
    });
    if (!unsafe.length) {
      return;
    }
    throw runtimeError('RECORD_STILL_REFERENCED', 'Refusing the destructive plan because record ' + recordId + ' has retained or out-of-order referrers.', {
      recordId,
      recordIds: unsafe,
    });
  }

  throw runtimeError('RECORD_STILL_REFERENCED', 'Refusing to delete record ' + recordId + ' because current or published records still reference it.', {
    recordId,
    recordIds: referrerIds,
  });
}

function deleteReleaseRemovesReference(context, referrerPlan, deletedRecordId) {
  const release = context.plan.execution.deleteReleases.find(function (entry) {
    return entry.recordId === referrerPlan.id;
  });
  if (!release || !referrerPlan.baseline) {
    return false;
  }
  const itemType = context.schemaById.get(referrerPlan.itemTypeId);
  if (!itemType) {
    return false;
  }
  const releasedCurrentReferences = collectRecordReferencesFromFields(release.fields, itemType, context);
  if (releasedCurrentReferences.has(deletedRecordId)) {
    return false;
  }
  if (!referrerPlan.baseline.published) {
    return true;
  }
  const publishedReferences = collectRecordReferencesFromFields(referrerPlan.baseline.published.fields, itemType, context);
  return !publishedReferences.has(deletedRecordId) || release.publish || !itemType.draftModeActive;
}

function collectRecordReferencesFromFields(fields, itemType, context, output) {
  const result = output || new Set();
  for (const field of itemType.fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, field.apiKey)) continue;
    const value = fields[field.apiKey];
    const values = field.localized && isObject(value) ? Object.values(value) : [value];
    for (const fieldValue of values) {
      if (field.fieldType === 'link') {
        const id = referenceId(fieldValue);
        if (id) result.add(id);
      } else if (field.fieldType === 'links' && Array.isArray(fieldValue)) {
        fieldValue.forEach(function (entry) {
          const id = referenceId(entry);
          if (id) result.add(id);
        });
      } else if (field.fieldType === 'structured_text') {
        collectRecordReferencesFromStructuredText(fieldValue, context, result);
      } else if (['rich_text', 'single_block'].includes(field.fieldType)) {
        collectRecordReferencesFromEmbedded(fieldValue, context, result);
      }
    }
  }
  return result;
}

function collectRecordReferencesFromStructuredText(value, context, output) {
  if (!isObject(value) || !isObject(value.document)) return;
  collectRecordReferencesFromStructuredTextNode(value.document, context, output);
}

function collectRecordReferencesFromStructuredTextNode(value, context, output) {
  if (!isStructuredTextNode(value)) return;
  if ((value.type === 'inlineItem' || value.type === 'itemLink') && typeof value.item === 'string') {
    output.add(value.item);
  }
  if (
    (value.type === 'block' || value.type === 'inlineBlock') &&
    isObject(value.item) && isNestedItem(value.item)
  ) {
    const blockType = context.captureSchemaById.get(itemTypeIdFromItem(value.item));
    if (!blockType) throw runtimeError('SCHEMA_MISMATCH', 'Structured Text nested record reference uses an unknown block model.');
    collectRecordReferencesFromFields(isObject(value.item.attributes) ? value.item.attributes : value.item, blockType, context, output);
  }
  if (Array.isArray(value.children)) {
    value.children.forEach(function (child) {
      collectRecordReferencesFromStructuredTextNode(child, context, output);
    });
  }
}

function collectRecordReferencesFromEmbedded(value, context, output) {
  if (Array.isArray(value)) {
    value.forEach(function (child) { collectRecordReferencesFromEmbedded(child, context, output); });
    return;
  }
  if (!isObject(value)) return;
  if ((value.type === 'inlineItem' || value.type === 'itemLink') && typeof value.item === 'string') {
    output.add(value.item);
  }
  if (isNestedItem(value)) {
    const blockType = context.captureSchemaById.get(itemTypeIdFromItem(value));
    if (!blockType) throw runtimeError('SCHEMA_MISMATCH', 'Nested record reference uses an unknown block model.');
    collectRecordReferencesFromFields(isObject(value.attributes) ? value.attributes : value, blockType, context, output);
    return;
  }
  if (value.type === 'item' && typeof value.id === 'string' && !itemTypeIdFromItem(value)) {
    output.add(value.id);
  }
  Object.values(value).forEach(function (child) { collectRecordReferencesFromEmbedded(child, context, output); });
}

async function verifyUploadDeletionSafety(context) {
  const deletes = context.plan.uploads.filter(function (entry) { return entry.action === 'delete'; });
  for (const uploadPlan of deletes) {
    if (!context.initialUploads.get(uploadPlan.id)) {
      continue;
    }
    const current = await context.client.uploads.references(uploadPlan.id, { version: 'current' });
    const published = await context.client.uploads.references(uploadPlan.id, { version: 'published' });
    const referrerIds = unique(current.concat(published).map(function (record) { return record.id; }));
    const unsafe = referrerIds.filter(function (recordId) {
      const recordPlan = context.recordPlansById.get(recordId);
      if (!recordPlan || !recordPlan.desired) {
        return !recordPlan || recordPlan.action !== 'delete';
      }
      return collectDesiredUploadReferences(recordPlan, context).has(uploadPlan.id);
    });
    if (unsafe.length) {
      throw runtimeError('UPLOAD_STILL_REFERENCED', 'Refusing the destructive plan because upload ' + uploadPlan.id + ' has retained or out-of-scope referrers.', {
        uploadId: uploadPlan.id,
        recordIds: unsafe,
      });
    }
  }
}

async function verifyPublishedDeleteReleases(context, validatorsAreRelaxed) {
  const validatorRelaxedRecordIds = new Set();
  for (const relaxation of context.plan.invalidContent.validatorRelaxations) {
    for (const recordId of relaxation.affectedRecordIds) {
      validatorRelaxedRecordIds.add(recordId);
    }
  }
  const releases = context.plan.execution.deleteReleases.filter(function (release) {
    if (!context.initialRecords.get(release.recordId) ||
      (validatorsAreRelaxed !== true && validatorRelaxedRecordIds.has(release.recordId))) {
      return false;
    }
    const recordPlan = context.recordPlansById.get(release.recordId);
    const itemType = recordPlan && context.captureSchemaById.get(recordPlan.itemTypeId);
    return release.publish === true || !itemType || !itemType.draftModeActive || !itemType.draftSavingActive;
  });
  if (!releases.length) {
    return;
  }
  if (!context.client.items || typeof context.client.items.validateExisting !== 'function') {
    throw runtimeError('DELETE_RELEASE_VALIDATION_UNAVAILABLE', 'The installed CMA client cannot preflight strict deletion-reference releases. Upgrade the DatoCMS CLI before applying this migration.');
  }
  for (const release of releases) {
    const recordPlan = context.recordPlansById.get(release.recordId);
    if (!recordPlan) {
      throw runtimeError('INVALID_PLAN', 'Strict deletion release ' + release.recordId + ' has no record plan.');
    }
    try {
      // release.fields is the complete high-level, request-compatible current
      // field body. Nested block IDs are omitted only for this diagnostic:
      // validateExisting associates IDs with a concrete current/published
      // slot and would otherwise reject a valid published-derived projection
      // before exercising its nested field validators.
      await context.client.items.validateExisting(
        release.recordId,
        buildRuntimeRecordValidationPayload(context, release.fields, recordPlan.itemTypeId),
      );
    } catch (error) {
      throw runtimeError('DELETE_RELEASE_VALIDATION_FAILURE', 'Record ' + release.recordId + ' cannot pass strict validation after its planned deletion-reference release.', {
        recordId: release.recordId,
        validatorsAreRelaxed: validatorsAreRelaxed === true,
        cause: error && error.message ? error.message : String(error),
      });
    }
  }
}

function buildRuntimeRecordValidationPayload(context, fields, itemTypeId) {
  const itemType = context.captureSchemaById.get(itemTypeId);
  if (!itemType) {
    throw runtimeError('INVALID_PLAN', 'Validation payload refers to unknown item type ' + itemTypeId + '.');
  }
  return convertRuntimeValidationRecordFields(context, fields, itemType);
}

function convertRuntimeValidationRecordFields(context, fields, itemType) {
  const fieldsByApiKey = new Map(itemType.fields.map(function (field) {
    return [field.apiKey, field];
  }));
  return Object.fromEntries(Object.entries(fields).map(function (entry) {
    const apiKey = entry[0];
    const value = entry[1];
    const field = fieldsByApiKey.get(apiKey);
    if (!field || !['rich_text', 'single_block', 'structured_text'].includes(field.fieldType)) {
      return [apiKey, value];
    }
    if (!field.localized || !isObject(value)) {
      return [apiKey, convertRuntimeValidationEmbeddedValue(context, value)];
    }
    return [apiKey, Object.fromEntries(Object.entries(value).map(function (localizedEntry) {
      return [localizedEntry[0], convertRuntimeValidationEmbeddedValue(context, localizedEntry[1])];
    }))];
  }));
}

function convertRuntimeValidationEmbeddedValue(context, value) {
  if (Array.isArray(value)) {
    return value.map(function (child) {
      return convertRuntimeValidationEmbeddedValue(context, child);
    });
  }
  if (!isObject(value)) return value;
  if (isNestedItem(value)) {
    const blockTypeId = itemTypeIdFromItem(value);
    const blockType = context.captureSchemaById.get(blockTypeId);
    if (!blockType || blockType.modularBlock !== true) {
      throw runtimeError('INVALID_PLAN', 'Nested validation payload refers to unknown or non-block model ' + blockTypeId + '.');
    }
    const attributes = isObject(value.attributes)
      ? value.attributes
      : Object.fromEntries(Object.entries(value).filter(function (entry) {
        return !['__itemTypeId', 'attributes', 'creator', 'id', 'item_type', 'meta', 'relationships', 'type'].includes(entry[0]);
      }));
    return {
      type: 'item',
      attributes: convertRuntimeValidationRecordFields(context, attributes, blockType),
      relationships: {
        item_type: { data: entityRef('item_type', blockTypeId) },
      },
    };
  }
  return Object.fromEntries(Object.entries(value).map(function (entry) {
    return [entry[0], convertRuntimeValidationEmbeddedValue(context, entry[1])];
  }));
}

function collectDesiredUploadReferences(recordPlan, context) {
  const output = new Set();
  const itemType = context.schemaById.get(recordPlan.itemTypeId);
  if (!recordPlan.desired || !itemType) {
    return output;
  }
  collectUploadReferencesFromFields(recordPlan.desired.current.fields, itemType, context, output);
  if (recordPlan.desired.published) {
    collectUploadReferencesFromFields(recordPlan.desired.published.fields, itemType, context, output);
  }
  return output;
}

function collectUploadReferencesFromFields(fields, itemType, context, output) {
  for (const field of itemType.fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, field.apiKey)) {
      continue;
    }
    const value = fields[field.apiKey];
    const values = field.localized && isObject(value) ? Object.values(value) : [value];
    for (const fieldValue of values) {
      if (field.fieldType === 'file') {
        const uploadId = uploadIdFromValue(fieldValue);
        if (uploadId) output.add(uploadId);
      } else if (field.fieldType === 'gallery' && Array.isArray(fieldValue)) {
        fieldValue.forEach(function (child) {
          const uploadId = uploadIdFromValue(child);
          if (uploadId) output.add(uploadId);
        });
      } else if (field.fieldType === 'seo' && isObject(fieldValue) && typeof fieldValue.image === 'string') {
        output.add(fieldValue.image);
      } else if (field.fieldType === 'structured_text') {
        collectUploadReferencesFromStructuredText(fieldValue, context, output);
      } else if (['rich_text', 'single_block'].includes(field.fieldType)) {
        collectUploadReferencesFromEmbedded(fieldValue, context, output);
      }
    }
  }
}

function collectUploadReferencesFromStructuredText(value, context, output) {
  if (!isObject(value) || !isObject(value.document)) return;
  collectUploadReferencesFromStructuredTextNode(value.document, context, output);
}

function collectUploadReferencesFromStructuredTextNode(value, context, output) {
  if (!isStructuredTextNode(value)) return;
  if (
    (value.type === 'block' || value.type === 'inlineBlock') &&
    isObject(value.item) && isNestedItem(value.item)
  ) {
    const blockType = context.captureSchemaById.get(itemTypeIdFromItem(value.item));
    if (!blockType) {
      throw runtimeError('SCHEMA_MISMATCH', 'Structured Text nested upload reference uses an unknown block model.');
    }
    const fields = isObject(value.item.attributes) ? value.item.attributes : value.item;
    collectUploadReferencesFromFields(fields, blockType, context, output);
  }
  if (Array.isArray(value.children)) {
    value.children.forEach(function (child) {
      collectUploadReferencesFromStructuredTextNode(child, context, output);
    });
  }
}

function collectUploadReferencesFromEmbedded(value, context, output) {
  if (Array.isArray(value)) {
    value.forEach(function (child) { collectUploadReferencesFromEmbedded(child, context, output); });
    return;
  }
  if (!isObject(value)) {
    return;
  }
  if (isNestedItem(value)) {
    const blockType = context.captureSchemaById.get(itemTypeIdFromItem(value));
    if (!blockType) {
      throw runtimeError('SCHEMA_MISMATCH', 'Nested upload reference uses an unknown block model.');
    }
    const fields = isObject(value.attributes) ? value.attributes : value;
    collectUploadReferencesFromFields(fields, blockType, context, output);
    return;
  }
  Object.values(value).forEach(function (child) { collectUploadReferencesFromEmbedded(child, context, output); });
}

function uploadIdFromValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  return isObject(value) && typeof value.upload_id === 'string' ? value.upload_id : null;
}

function classifyRecord(context, plan, live) {
  if (!live) {
    if (plan.action === 'create' || plan.action === 'delete') {
      return plan.action === 'create' ? 'pending' : 'converged';
    }
    throw conflict('record', plan.id, 'was deleted');
  }
  if (plan.desired && live.hash === plan.desired.hash) {
    if (stableStringify(live.validity) === stableStringify(plan.desired.validity)) {
      return 'converged';
    }
    if (recordHasValidatorRelaxation(context, plan.id)) return 'resumable';
    throw conflict('record', plan.id, 'has unexpected validity', stableStringify(plan.desired.validity), stableStringify(live.validity));
  }
  if (plan.baseline && live.hash === plan.baseline.hash) {
    if (stableStringify(live.validity) === stableStringify(plan.baseline.validity)) {
      return 'pending';
    }
    if (recordHasValidatorRelaxation(context, plan.id)) return 'resumable';
    throw conflict('record', plan.id, 'has unexpected validity', stableStringify(plan.baseline.validity), stableStringify(live.validity));
  }
  if (Array.isArray(plan.allowedIntermediateHashes) && plan.allowedIntermediateHashes.includes(live.hash)) {
    return 'resumable';
  }
  if (isSafeRecordIntermediate(context, live, plan)) {
    return 'resumable';
  }
  throw conflict('record', plan.id, 'has unexpected content', plan.expectedTargetHash, live.hash);
}

function recordHasValidatorRelaxation(context, recordId) {
  return context.plan.invalidContent.validatorRelaxations.some(function (entry) {
    return entry.affectedRecordIds.includes(recordId);
  });
}

function classifyUpload(plan, live) {
  if (!live) {
    if (plan.action === 'create' || plan.action === 'delete') {
      return plan.action === 'create' ? 'pending' : 'converged';
    }
    throw conflict('upload', plan.id, 'was deleted');
  }
  if (plan.desired && live.hash === plan.desired.hash) {
    return 'converged';
  }
  if (plan.baseline && live.hash === plan.baseline.hash) {
    return 'pending';
  }
  if (isSafeUploadIntermediate(live, plan)) {
    return 'resumable';
  }
  throw conflict('upload', plan.id, 'has unexpected content', plan.expectedTargetHash, live.hash);
}

function classifyCollection(plan, live) {
  if (!live) {
    if (plan.action === 'create') {
      return 'pending';
    }
    throw conflict('upload collection', plan.id, 'was deleted');
  }
  if (live.hash === plan.desired.hash) {
    return 'converged';
  }
  if (plan.action === 'noop') {
    throw conflict('upload collection', plan.id, 'has unexpected content', plan.expectedTargetHash, live.hash);
  }
  if (plan.expectedTargetHash && live.hash === plan.expectedTargetHash) {
    return 'pending';
  }
  if (isSafeCollectionIntermediate(live, plan)) {
    return 'resumable';
  }
  throw conflict('upload collection', plan.id, 'has unexpected content', plan.expectedTargetHash, live.hash);
}

function conflict(kind, id, reason, expected, actual) {
  let message = 'Destination ' + kind + ' ' + id + ' ' + reason + ' since this migration was generated.';
  if (expected || actual) {
    message += ' Expected ' + String(expected || 'missing') + ', received ' + String(actual || 'missing') + '.';
  }
  return runtimeError('TARGET_CONFLICT', message, { kind, id, expected: expected || null, actual: actual || null });
}

function validateCreateSeeds(context) {
  for (const recordPlan of context.plan.records.filter(function (entry) { return entry.action === 'create'; })) {
    expectedCreateSeedFields(context, recordPlan);
    const parentPlan = recordPlan.desired.topology.parentId
      ? context.recordPlansById.get(recordPlan.desired.topology.parentId)
      : null;
    if (parentPlan && parentPlan.action === 'create') {
      const parentIndex = context.plan.execution.createOrder.indexOf(parentPlan.id);
      const childIndex = context.plan.execution.createOrder.indexOf(recordPlan.id);
      if (parentIndex < 0 || childIndex < 0 || parentIndex >= childIndex) {
        throw runtimeError('INVALID_CREATE_ORDER', 'Tree parent ' + parentPlan.id + ' must be created before child ' + recordPlan.id + '.');
      }
    }
  }
}

function expectedCreateSeedFields(context, recordPlan) {
  const order = context.plan.execution.createOrder;
  const recordIndex = order.indexOf(recordPlan.id);
  if (recordIndex < 0) {
    throw runtimeError('INVALID_CREATE_ORDER', 'Execution createOrder is missing record ' + recordPlan.id + '.');
  }
  const laterCreates = new Set(context.plan.records.filter(function (entry) {
    return entry.action === 'create' && entry.id !== recordPlan.id && order.indexOf(entry.id) > recordIndex;
  }).map(function (entry) { return entry.id; }));
  const isDeclaredShell = context.plan.execution.shellRecordIds.includes(recordPlan.id);
  if (isDeclaredShell) {
    const component = context.plan.execution.shellComponents.find(function (ids) {
      return ids.includes(recordPlan.id);
    });
    if (!component) {
      throw runtimeError('INVALID_PLAN', 'Execution shellComponents is missing shell record ' + recordPlan.id + '.');
    }
    for (const shellId of component) {
      laterCreates.add(shellId);
    }
  }
  const seed = recordPlan.desired.published || recordPlan.desired.current;
  return stripUnavailableReferences(
    seed.fields,
    context.schemaById.get(recordPlan.itemTypeId),
    context,
    laterCreates,
    'record ' + recordPlan.id,
    isDeclaredShell,
  );
}

function relaxedCreateSeedRecordIds(context) {
  const result = new Set();
  for (const relaxation of context.plan.invalidContent.validatorRelaxations) {
    for (const recordId of relaxation.affectedRecordIds) {
      const recordPlan = context.recordPlansById.get(recordId);
      if (!recordPlan || recordPlan.action !== 'create' || !recordPlan.desired) continue;
      const seed = recordPlan.desired.published || recordPlan.desired.current;
      const fields = expectedCreateSeedFields(context, recordPlan);
      if (
        context.plan.execution.shellRecordIds.includes(recordId) ||
        semanticHash(fields) !== seed.hash
      ) {
        result.add(recordId);
      }
    }
  }
  return result;
}

async function verifyRelaxedCreateSeeds(context, onlyCurrentlyResolvable) {
  const recordIds = relaxedCreateSeedRecordIds(context);
  for (const recordId of context.plan.execution.createOrder) {
    if (!recordIds.has(recordId) || context.initialRecords.get(recordId)) continue;
    const recordPlan = context.recordPlansById.get(recordId);
    await verifyOneRelaxedCreateSeed(context, recordPlan, onlyCurrentlyResolvable === true);
  }
}

async function verifyOneRelaxedCreateSeed(context, recordPlan, onlyCurrentlyResolvable) {
  if (!recordPlan || recordPlan.action !== 'create' || !recordPlan.desired) return;
  if (!relaxedCreateSeedRecordIds(context).has(recordPlan.id)) return;

  const itemType = context.schemaById.get(recordPlan.itemTypeId);
  if (!itemType) {
    throw runtimeError('INVALID_PLAN', 'Relaxed create seed ' + recordPlan.id + ' refers to an unknown item type.');
  }
  const fields = expectedCreateSeedFields(context, recordPlan);
  if (onlyCurrentlyResolvable) {
    const references = collectRecordReferencesFromFields(fields, itemType, context);
    const unavailable = Array.from(references).some(function (recordId) {
      const dependencyPlan = context.recordPlansById.get(recordId);
      return dependencyPlan && dependencyPlan.action === 'create' && !context.initialRecords.get(recordId);
    });
    if (unavailable) return;
  }
  if (!context.client.items || typeof context.client.items.validateNew !== 'function') {
    throw runtimeError('CREATE_SEED_VALIDATION_UNAVAILABLE', 'The installed CMA client cannot preflight strict cyclic create seeds. Upgrade the DatoCMS CLI before applying this migration.');
  }
  try {
    await context.client.items.validateNew(Object.assign({
      item_type: entityRef('item_type', recordPlan.itemTypeId),
    }, buildRuntimeRecordValidationPayload(context, fields, recordPlan.itemTypeId)));
  } catch (error) {
    throw runtimeError('CREATE_SEED_VALIDATION_FAILURE', 'Record ' + recordPlan.id + ' cannot pass strict validation with its exact planned create seed after validator relaxation.', {
      recordId: recordPlan.id,
      seedHash: semanticHash(fields),
      cause: error && error.message ? error.message : String(error),
    });
  }
}

function validateDesiredSchedules(context) {
  const now = Date.now();
  const lead = Number.isFinite(context.options.scheduleSafetyWindowMs)
    ? context.options.scheduleSafetyWindowMs
    : DEFAULT_SCHEDULE_SAFETY_WINDOW_MS;

  for (const recordPlan of context.plan.records) {
    if (!recordPlan.desired) {
      continue;
    }
    for (const key of ['publication', 'unpublishing']) {
      const desired = recordPlan.desired.schedules[key];
      if (!desired) {
        continue;
      }
      const timestamp = Date.parse(desired.at);
      if (!Number.isFinite(timestamp)) {
        throw runtimeError('INVALID_SCHEDULE', 'Record ' + recordPlan.id + ' has an invalid ' + key + ' schedule timestamp.');
      }
      if (timestamp <= now + lead) {
        throw runtimeError('SCHEDULE_TOO_CLOSE', 'Record ' + recordPlan.id + ' has a ' + key + ' schedule too close to execution time. Regenerate the migration with a later schedule.', {
          recordId: recordPlan.id,
          scheduledAt: desired.at,
          minimumLeadMilliseconds: lead,
        });
      }
    }
  }
}

function validateSchedulesBeforeCancellation(context) {
  if (!planHasCmaMutations(context.plan)) {
    return;
  }
  const now = Date.now();
  const lead = Number.isFinite(context.options.scheduleSafetyWindowMs)
    ? context.options.scheduleSafetyWindowMs
    : DEFAULT_SCHEDULE_SAFETY_WINDOW_MS;

  for (const recordPlan of context.plan.records) {
    const live = context.initialRecords.get(recordPlan.id);
    if (!live) continue;
    for (const key of ['publication', 'unpublishing']) {
      const scheduled = live.schedules[key];
      if (!scheduled) continue;
      const timestamp = Date.parse(scheduled.at);
      if (!Number.isFinite(timestamp) || timestamp <= now + lead) {
        throw runtimeError('SCHEDULE_TOO_CLOSE', 'Record ' + recordPlan.id + ' has a live ' + key + ' schedule that may fire before phase 2 can cancel it. Cancel the live schedule or regenerate the migration.', {
          recordId: recordPlan.id,
          scheduledAt: scheduled.at,
          minimumLeadMilliseconds: lead,
        });
      }
    }
  }
}

async function stageUploadBinaries(context) {
  const uploadPlans = context.plan.uploads.filter(function (entry) {
    if (!entry.desired || entry.action === 'delete' || entry.action === 'noop') {
      return false;
    }
    if (context.stagedUploads.has(entry.id)) {
      return false;
    }
    const initial = context.initialUploads.get(entry.id);
    return uploadNeedsBinaryTransfer(initial, entry.desired);
  });
  if (!uploadPlans.length) {
    return;
  }

  if (!context.stagedDirectory) {
    context.stagedDirectory = await mkdtemp(join(tmpdir(), 'datocms-content-diff-'));
  }
  await mapWithConcurrency(uploadPlans, 2, async function (uploadPlan) {
    const desired = uploadPlan.desired;
    const destination = join(context.stagedDirectory, safeFilename(uploadPlan.id) + '.bin');
    const transport = desired.transport;
    const bundledPath = transport.bundledPath;
    const bundledSha256 = transport.sha256;
    let hashes;

    if (bundledPath) {
      if (typeof bundledSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(bundledSha256)) {
        throw runtimeError('MISSING_BUNDLED_CHECKSUM', 'Bundled upload ' + uploadPlan.id + ' requires a valid SHA-256 checksum in the manifest.');
      }
      if (!context.options.manifestPath) {
        throw runtimeError('MISSING_MANIFEST_PATH', 'Bundled upload ' + uploadPlan.id + ' requires manifestPath.');
      }
      const manifestDirectory = dirname(context.options.manifestPath);
      const source = resolve(manifestDirectory, bundledPath);
      const pathFromManifest = relative(manifestDirectory, source);
      if (isAbsolute(bundledPath) || pathFromManifest === '..' || pathFromManifest.startsWith('..' + requirePathSeparator())) {
        throw runtimeError('UNSAFE_BUNDLED_PATH', 'Bundled upload path escapes the manifest directory: ' + bundledPath + '.');
      }
      hashes = await copyAndHash(source, destination);
      if (!constantTimeEqualHex(hashes.sha256, bundledSha256)) {
        throw runtimeError('UPLOAD_CHECKSUM_FAILURE', 'Bundled upload ' + uploadPlan.id + ' failed SHA-256 validation.');
      }
    } else {
      const sourceUrl = transport.sourceUrl;
      if (typeof sourceUrl !== 'string' || !isAbsoluteHttpUrl(sourceUrl)) {
        throw runtimeError('MISSING_UPLOAD_SOURCE', 'Upload ' + uploadPlan.id + ' has neither a bundled binary nor an HTTP(S) source URL.');
      }
      hashes = await downloadAndHash(context, sourceUrl, destination);
    }

    if (!constantTimeEqualHex(hashes.md5, desired.md5)) {
      throw runtimeError('UPLOAD_CHECKSUM_FAILURE', 'Upload ' + uploadPlan.id + ' changed after this migration was generated.', {
        expectedMd5: desired.md5,
        actualMd5: hashes.md5,
      });
    }
    if (typeof desired.size === 'number' && hashes.size !== desired.size) {
      throw runtimeError('UPLOAD_SIZE_FAILURE', 'Upload ' + uploadPlan.id + ' has unexpected byte size.', {
        expectedSize: desired.size,
        actualSize: hashes.size,
      });
    }
    context.stagedUploads.set(uploadPlan.id, destination);
  });
}

async function copyAndHash(source, destination) {
  return streamAndHash(createReadStream(source), destination);
}

async function downloadAndHash(context, url, destination) {
  const fetchFn = typeof context.options.fetchFn === 'function' ? context.options.fetchFn : globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw runtimeError('FETCH_UNAVAILABLE', 'Node.js fetch is unavailable for source upload transfer.');
  }
  const response = await fetchFn(url);
  if (!response.ok) {
    throw runtimeError('UPLOAD_DOWNLOAD_FAILURE', 'Cannot download upload binary (' + response.status + ' ' + response.statusText + ').');
  }
  if (!response.body) {
    throw runtimeError('UPLOAD_DOWNLOAD_FAILURE', 'Cannot download upload binary: response has no body.');
  }
  return streamAndHash(Readable.fromWeb(response.body), destination);
}

async function streamAndHash(readable, destination) {
  const md5 = createHash('md5');
  const sha = createHash('sha256');
  let size = 0;
  const hasher = new Transform({
    transform: function (chunk, encoding, callback) {
      md5.update(chunk);
      sha.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(readable, hasher, createWriteStream(destination, { flags: 'wx' }));
  return { md5: md5.digest('hex'), sha256: sha.digest('hex'), size };
}

async function cancelLiveSchedules(context) {
  if (!context.scheduleQuiescenceRequired) {
    return;
  }
  for (const recordPlan of context.plan.records) {
    const live = await captureRecordMaybe(context, recordPlan.id, recordPlan.itemTypeId);
    if (!live) {
      continue;
    }
    assertRecordSafeForResume(context, recordPlan, live);
    if (live.schedules.publication) {
      assertScheduleStillSafe(context, recordPlan.id, 'live publication cancellation', live.schedules.publication.at);
      await destroyScheduleMaybe(context.client.scheduledPublication, recordPlan.id);
      context.mutationCount += 1;
    }
    if (live.schedules.unpublishing) {
      assertScheduleStillSafe(context, recordPlan.id, 'live unpublishing cancellation', live.schedules.unpublishing.at);
      await destroyScheduleMaybe(context.client.scheduledUnpublishing, recordPlan.id);
      context.mutationCount += 1;
    }
  }
  context.schedulesQuiesced = true;
  await verifySchedulesRemainQuiesced(context);
}

async function verifySchedulesRemainQuiesced(context) {
  if (!context.schedulesQuiesced) return;
  for (const recordPlan of context.plan.records) {
    const current = await findItemCurrentShellMaybe(context.client, recordPlan.id);
    if (!current) continue;
    const schedules = await readSchedules(context, current);
    if (schedules.publication || schedules.unpublishing) {
      throw runtimeError('SCHEDULE_RECREATED_DURING_MIGRATION', 'Record ' + recordPlan.id + ' acquired a publication or unpublishing schedule while this migration required schedules to remain quiesced.', {
        recordId: recordPlan.id,
        schedules,
      });
    }
  }
}

async function destroyScheduleMaybe(resource, recordId) {
  try {
    await resource.destroy(recordId);
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

async function reconcileUploadCollections(context) {
  const ordered = orderedPlans(context.plan.execution.collectionOrder, context.plan.uploadCollections).filter(function (entry) {
    return entry.action !== 'noop';
  });
  for (const collectionPlan of ordered) {
    let resource = await findCollectionMaybe(context.client, collectionPlan.id);
    if (!resource) {
      if (collectionPlan.action !== 'create') {
        throw conflict('upload collection', collectionPlan.id, 'was deleted during execution');
      }
      await context.client.uploadCollections.create({
        id: collectionPlan.id,
        label: collectionPlan.desired.label,
        parent: collectionPlan.desired.parentId ? entityRef('upload_collection', collectionPlan.desired.parentId) : null,
      });
      context.mutationCount += 1;
      resource = await context.client.uploadCollections.find(collectionPlan.id);
      await assertLiveCollectionStateSafe(context);
    }

    const live = canonicalizeUploadCollection(resource);
    if (
      live.label !== collectionPlan.desired.label ||
      live.parentId !== collectionPlan.desired.parentId
    ) {
      await assertLiveCollectionStateSafe(context);
      await context.client.uploadCollections.update(collectionPlan.id, {
        label: collectionPlan.desired.label,
        parent: collectionPlan.desired.parentId ? entityRef('upload_collection', collectionPlan.desired.parentId) : null,
      });
      context.mutationCount += 1;
    }
  }

  // Position writes shift siblings. Replaying all desired positions after every
  // collection exists makes this phase deterministic and resumable.
  const affectedCollectionParents = affectedCollectionParentKeys(context);
  const finalOrder = context.plan.uploadCollections.filter(function (entry) {
    return entry.desired && affectedCollectionParents.has(String(entry.desired.parentId));
  }).sort(function (left, right) {
    return compareNullable(left.desired.parentId, right.desired.parentId) || left.desired.position - right.desired.position || left.id.localeCompare(right.id);
  });
  const seenStates = new Set();
  const maximumSteps = 4 * finalOrder.length * finalOrder.length + 1;
  for (let step = 0; step < maximumSteps; step += 1) {
    const liveCollections = new Map();
    for (const collectionPlan of context.plan.uploadCollections) {
      const resource = await findCollectionMaybe(context.client, collectionPlan.id);
      liveCollections.set(collectionPlan.id, resource ? canonicalizeUploadCollection(resource) : null);
    }
    const beforeStep = liveCollectionStateSignature(context, liveCollections);
    if (seenStates.has(beforeStep)) {
      throw runtimeError('COLLECTION_ORDER_DID_NOT_CONVERGE', 'Upload collection ordering repeated a prior state before reaching the desired positions.');
    }
    seenStates.add(beforeStep);
    const next = finalOrder.find(function (collectionPlan) {
      const live = liveCollections.get(collectionPlan.id);
      return live && live.position !== collectionPlan.desired.position;
    });
    if (!next) return;

    // Restart from the first mismatch after every write. This makes the
    // executor's state graph identical whether a process continues or crashes
    // and reruns at any mutation boundary.
    await assertLiveCollectionStateSafe(context);
    await context.client.uploadCollections.update(next.id, {
      position: next.desired.position,
    });
    context.mutationCount += 1;
  }
  throw runtimeError('COLLECTION_ORDER_DID_NOT_CONVERGE', 'Upload collection ordering did not reach the desired positions within the bounded reconciliation steps.');
}

async function releaseUniqueValues(context) {
  const releases = Array.isArray(context.plan.execution.uniqueReleases)
    ? context.plan.execution.uniqueReleases
    : [];
  for (const release of releases) {
    const recordPlan = context.recordPlansById.get(release.recordId);
    if (!recordPlan || !recordPlan.desired || !isObject(release.fields)) {
      throw runtimeError('INVALID_PLAN', 'Unique-value release refers to an invalid record or field payload.');
    }
    let live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, live);
    const alreadyReleased = Object.keys(release.fields).every(function (field) {
      return stableStringify(live.current.fields[field]) === stableStringify(release.fields[field]);
    });
    if (!alreadyReleased) {
      const patch = buildVersionPatch(release.fields, live.current.fields, live);
      await updateRecordWithLock(context, recordPlan, patch, live.consistency.currentVersion);
      live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    }
    const allowed = Array.isArray(recordPlan.allowedIntermediateHashes)
      ? recordPlan.allowedIntermediateHashes
      : [];
    if (live.current.hash !== recordPlan.desired.current.hash && !allowed.includes(live.current.hash)) {
      throw runtimeError('UNIQUE_RELEASE_VERIFY_FAILURE', 'Record ' + recordPlan.id + ' did not reach its planned unique-value release state.', {
        currentVersionHash: live.current.hash,
      });
    }
  }
}

async function reconcileUploads(context) {
  const ordered = orderedPlans(context.plan.execution.uploadOrder, context.plan.uploads).filter(function (entry) {
    return entry.action !== 'delete' && entry.action !== 'noop';
  });
  for (const uploadPlan of ordered) {
    const desired = uploadPlan.desired;
    let resource = await findUploadMaybe(context.client, uploadPlan.id);
    let live = resource ? canonicalizeUpload(resource, context.plan.schema.locales) : null;

    if (!live) {
      if (uploadPlan.action !== 'create') {
        throw conflict('upload', uploadPlan.id, 'was deleted during execution');
      }
      const stagedPath = context.stagedUploads.get(uploadPlan.id);
      if (!stagedPath) {
        throw runtimeError('MISSING_STAGED_UPLOAD', 'No staged binary exists for upload ' + uploadPlan.id + '.');
      }
      await waitForUploadFilenameWindow(context, desired.filename);
      await context.client.uploads.createFromLocalFile(Object.assign({
        id: uploadPlan.id,
        localPath: stagedPath,
        filename: desired.filename,
        skipCreationIfAlreadyExists: false,
      }, uploadManualCreateBody(desired)));
      context.mutationCount += 1;
      resource = await waitForUploadReady(context, uploadPlan.id, desired.md5);
      live = canonicalizeUpload(resource, context.plan.schema.locales);
    }

    if (live.hash === desired.hash) {
      continue;
    }
    if (!isSafeUploadIntermediate(live, uploadPlan)) {
      throw conflict('upload', uploadPlan.id, 'changed during execution', uploadPlan.expectedTargetHash, live.hash);
    }

    if (uploadNeedsBinaryTransfer(live, desired)) {
      const stagedPath = context.stagedUploads.get(uploadPlan.id);
      if (!stagedPath) {
        throw runtimeError('MISSING_STAGED_UPLOAD', 'No staged binary exists for upload ' + uploadPlan.id + '.');
      }
      await waitForUploadFilenameWindow(context, desired.filename);
      await context.client.uploads.updateFromLocalFile(
        uploadPlan.id,
        uploadBinaryUpdateBody(uploadPlan, stagedPath)
      );
      context.mutationCount += 1;
      resource = await waitForUploadReady(context, uploadPlan.id, desired.md5);
      live = canonicalizeUpload(resource, context.plan.schema.locales);
      if (uploadNeedsBinaryTransfer(live, desired)) {
        throw runtimeError('UPLOAD_VERIFY_FAILURE', 'Upload ' + uploadPlan.id + ' did not retain the expected binary checksum and filename extension.');
      }
    }

    if (live.hash !== desired.hash) {
      if (uploadManualUpdateNeedsFilenameWindow(live, desired)) {
        await waitForUploadFilenameWindow(context, desired.filename);
      }
      const updateBody = uploadManualUpdateBody(live, desired);
      if (Object.keys(updateBody).length === 0) {
        throw runtimeError('UPLOAD_UNREPRODUCIBLE_STATE', 'Upload ' + uploadPlan.id + ' differs from the desired semantic state but has no safe minimal CMA update.');
      }
      await context.client.uploads.update(uploadPlan.id, updateBody);
      context.mutationCount += 1;
    }

    const verified = canonicalizeUpload(await waitForUploadReady(context, uploadPlan.id, desired.md5), context.plan.schema.locales);
    if (verified.hash !== desired.hash) {
      throw runtimeError('UPLOAD_VERIFY_FAILURE', 'Upload ' + uploadPlan.id + ' did not converge to its desired semantic state.', {
        expected: desired.hash,
        actual: verified.hash,
      });
    }
  }
}

async function waitForUploadFilenameWindow(context, filename) {
  const collisionWindow = Number.isFinite(context.options.uploadFilenameCollisionWindowMs)
    ? Math.max(0, context.options.uploadFilenameCollisionWindowMs)
    : DEFAULT_UPLOAD_FILENAME_COLLISION_WINDOW_MS;
  if (!Number.isFinite(context.uploadFilenameWindowStartedAt)) {
    context.uploadFilenameWindowStartedAt = Date.now();
  }
  const previous = context.uploadRequestTimes.get(filename);
  const safeAfter = (typeof previous === 'number'
    ? previous
    : context.uploadFilenameWindowStartedAt) + collisionWindow;
  const remaining = safeAfter - Date.now();
  if (remaining > 0) {
    await delay(remaining);
  }
  // The API collision key is site-wide, so the first request must wait out a
  // possible request made before this runtime started. Later same-name
  // requests are serialized from the prior local reservation. Unrelated
  // filenames remain unthrottled.
  context.uploadRequestTimes.set(filename, Date.now());
}

async function waitForUploadReady(context, uploadId, expectedMd5) {
  const timeout = Number.isFinite(context.options.uploadProcessingTimeoutMs)
    ? Math.max(0, context.options.uploadProcessingTimeoutMs)
    : DEFAULT_UPLOAD_PROCESSING_TIMEOUT_MS;
  const interval = Number.isFinite(context.options.uploadProcessingPollIntervalMs)
    ? Math.max(0, context.options.uploadProcessingPollIntervalMs)
    : DEFAULT_UPLOAD_PROCESSING_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;
  let lastStatus = null;
  let lastMd5 = null;

  while (true) {
    const resource = await findUploadMaybe(context.client, uploadId);
    if (resource) {
      const meta = isObject(resource.meta) ? resource.meta : {};
      const antivirus = isObject(meta.antivirus) ? meta.antivirus : {};
      lastStatus = antivirus.status;
      lastMd5 = typeof resource.md5 === 'string' ? resource.md5 : null;
      if (lastStatus === 'infected' || lastStatus === 'failed') {
        throw runtimeError('UNHEALTHY_UPLOAD', 'Upload ' + uploadId + ' failed antivirus processing with status ' + lastStatus + '.');
      }
      if (!['pending', 'clean', 'skipped'].includes(lastStatus)) {
        throw runtimeError('INVALID_CMA_RESPONSE', 'Upload ' + uploadId + ' has an unknown antivirus status while processing.');
      }
      const checksumReady = typeof expectedMd5 !== 'string' ||
        (lastMd5 && constantTimeEqualHex(lastMd5, expectedMd5));
      if ((lastStatus === 'clean' || lastStatus === 'skipped') && checksumReady) {
        return resource;
      }
    }

    if (Date.now() >= deadline) {
      throw runtimeError('UPLOAD_PROCESSING_TIMEOUT', 'Upload ' + uploadId + ' did not finish antivirus/checksum processing before the timeout.', {
        uploadId,
        lastStatus,
        expectedMd5: expectedMd5 || null,
        actualMd5: lastMd5,
        timeoutMilliseconds: timeout,
      });
    }
    await delay(Math.min(interval, Math.max(0, deadline - Date.now())));
  }
}

function delay(milliseconds) {
  return new Promise(function (resolvePromise) {
    setTimeout(resolvePromise, milliseconds);
  });
}

function uploadManualCreateBody(desired) {
  return {
    author: desired.manual.author,
    copyright: desired.manual.copyright,
    notes: desired.manual.notes,
    default_field_metadata: desired.manual.defaultFieldMetadata,
    tags: desired.manual.tags,
    upload_collection: desired.manual.collectionId ? entityRef('upload_collection', desired.manual.collectionId) : null,
  };
}

function uploadBinaryUpdateBody(uploadPlan, stagedPath) {
  const body = {
    localPath: stagedPath,
    filename: uploadPlan.desired.filename,
  };
  for (const key of ['author', 'copyright', 'notes']) {
    if (uploadPlan.baseline.manual[key] === null) {
      body[key] = UPLOAD_NULL_MANUAL_SENTINEL;
    }
  }
  return body;
}

function uploadManualUpdateBody(live, desired) {
  const body = {};
  if (live.basename !== desired.basename || live.filename !== desired.filename) {
    body.basename = desired.basename || basenameFromFilename(desired.filename);
  }
  for (const key of ['author', 'copyright', 'notes']) {
    if (live.manual[key] !== desired.manual[key]) {
      body[key] = desired.manual[key];
    }
  }
  if (stableStringify(live.manual.defaultFieldMetadata) !== stableStringify(desired.manual.defaultFieldMetadata)) {
    body.default_field_metadata = desired.manual.defaultFieldMetadata;
  }
  if (stableStringify(live.manual.tags) !== stableStringify(desired.manual.tags)) {
    body.tags = desired.manual.tags;
  }
  if (live.manual.collectionId !== desired.manual.collectionId) {
    body.upload_collection = desired.manual.collectionId
      ? entityRef('upload_collection', desired.manual.collectionId)
      : null;
  }
  return body;
}

async function findMissingCreateRecordIds(context) {
  const missing = new Set();
  for (const id of context.plan.execution.createOrder) {
    const recordPlan = context.recordPlansById.get(id);
    if (!recordPlan || recordPlan.action !== 'create') continue;
    if (!await findRecordCurrentMaybe(context.client, id)) {
      missing.add(id);
    }
  }
  return missing;
}

async function createMissingRecords(context, requestedMissingRecordIds) {
  const missingRecordIds = requestedMissingRecordIds instanceof Set
    ? requestedMissingRecordIds
    : await findMissingCreateRecordIds(context);

  for (const id of context.plan.execution.createOrder) {
    const recordPlan = context.recordPlansById.get(id);
    if (!recordPlan || recordPlan.action !== 'create' || !missingRecordIds.has(id)) {
      continue;
    }
    const desired = recordPlan.desired;
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    const seedFields = expectedCreateSeedFields(context, recordPlan);
    const body = Object.assign({
      id: recordPlan.id,
      item_type: entityRef('item_type', recordPlan.itemTypeId),
      meta: {
        created_at: desired.lifecycle.createdAt,
        first_published_at: desired.lifecycle.firstPublishedAt,
      },
    }, seedFields);
    if (itemType.tree) {
      body.parent_id = desired.topology.parentId;
    }
    if (itemType.tree || itemType.sortable) {
      body.position = desired.topology.position;
    }

    if (!itemType.draftModeActive) {
      const dependencies = collectRecordReferencesFromFields(seedFields, itemType, context);
      if (desired.topology.parentId) dependencies.add(desired.topology.parentId);
      await assertDependencyIdsPublished(context, Array.from(dependencies), recordPlan.id, false);
    }

    if (itemType.tree || itemType.sortable) {
      await assertLiveRecordPositionStateSafe(context);
    }

    await verifyOneRelaxedCreateSeed(context, recordPlan, false);
    await context.client.items.create(body);
    context.mutationCount += 1;
    const created = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, created);
  }
}

async function reconcileTreeParents(context) {
  const records = parentFirst(context.plan.records.filter(function (entry) {
    return entry.desired && entry.action !== 'noop';
  }));
  for (const recordPlan of records) {
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    if (!itemType || !itemType.tree) {
      continue;
    }
    const live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, live);
    if (live.topology.parentId === recordPlan.desired.topology.parentId) {
      continue;
    }
    const guardedSignature = await assertLiveRecordPositionStateSafe(context);
    const guarded = JSON.parse(guardedSignature).find(function (row) { return row.id === recordPlan.id; });
    const writeLive = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, writeLive);
    if (
      !guarded || guarded.missing ||
      writeLive.topology.parentId !== guarded.parentId ||
      writeLive.topology.position !== guarded.position
    ) {
      throw conflict('record', recordPlan.id, 'ordering changed immediately before a reparent write', stableStringify(guarded), stableStringify(writeLive.topology));
    }
    if (writeLive.topology.parentId === recordPlan.desired.topology.parentId) {
      continue;
    }
    await updateRecordWithLock(context, recordPlan, {
      parent_id: recordPlan.desired.topology.parentId,
    }, writeLive.consistency.currentVersion);
  }
}

async function reconcilePublishedVersions(context) {
  await publishCreationSeeds(context);
  for (const recordId of context.plan.execution.publishOrder) {
    const recordPlan = context.recordPlansById.get(recordId);
    if (!recordPlan || recordPlan.action === 'noop' || !recordPlan.desired) continue;
    if (recordPlan.desired.published) {
      await reconcileOnePublishedRecord(context, recordPlan);
    } else {
      await unpublishOneRecord(context, recordPlan);
    }
  }
}

async function publishCreationSeeds(context) {
  for (const recordId of context.plan.execution.publicationSeedOrder) {
    const recordPlan = context.recordPlansById.get(recordId);
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    const fields = expectedCreateSeedFields(context, recordPlan);
    const seed = { fields, hash: semanticHash(fields) };
    let live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, live);
    if (
      (live.published && live.published.hash === seed.hash) ||
      (recordPlan.desired.published && live.published && live.published.hash === recordPlan.desired.published.hash)
    ) {
      continue;
    }
    if (live.current.hash !== seed.hash) {
      await writeCurrentVersion(context, recordPlan, seed);
      live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    }
    const dependencies = collectRecordReferencesFromFields(fields, itemType, context);
    if (recordPlan.desired.topology.parentId) dependencies.add(recordPlan.desired.topology.parentId);
    await assertDependencyIdsPublished(context, Array.from(dependencies), recordPlan.id, false);
    live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, live);
    if (live.current.hash !== seed.hash) {
      throw runtimeError('RECORD_VERIFY_FAILURE', 'Record ' + recordPlan.id + ' seed changed immediately before publishing.');
    }
    live = await ensureCurrentValidityBeforePublish(context, recordPlan, seed.hash, live);
    await context.client.items.publish(recordPlan.id, undefined, { recursive: false });
    context.mutationCount += 1;
    live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    if (!live.published || live.published.hash !== seed.hash) {
      throw runtimeError('PUBLISH_VERIFY_FAILURE', 'Record ' + recordPlan.id + ' did not reach its planned seed publication state.');
    }
  }
}

async function reconcileOnePublishedRecord(context, recordPlan) {
  const desired = recordPlan.desired;
  let live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
  assertRecordSafeForResume(context, recordPlan, live);
  if (live.published && live.published.hash === desired.published.hash) return;

  // recursive=false is a final server-side guard, but prove every dependency
  // published first so this migration never relies on recursive side effects.
  await assertDependencyIdsPublished(context, recordPlan.publishedDependencies, recordPlan.id, false);
  live = await ensureCurrentValidityBeforePublish(context, recordPlan, desired.published.hash, live);
  await writeCurrentVersion(context, recordPlan, desired.published);
  live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
  const itemType = context.schemaById.get(recordPlan.itemTypeId);
  if (itemType.draftModeActive) {
    assertRecordSafeForResume(context, recordPlan, live);
    if (live.current.hash !== desired.published.hash) {
      throw runtimeError('RECORD_VERIFY_FAILURE', 'Record ' + recordPlan.id + ' current state changed immediately before publishing.');
    }
    live = await ensureCurrentValidityBeforePublish(context, recordPlan, desired.published.hash, live);
    live = await ensureLifecycleBeforePublication(context, recordPlan, live);
    await assertDependencyIdsPublished(context, recordPlan.publishedDependencies, recordPlan.id, false);
    live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, live);
    if (live.current.hash !== desired.published.hash) {
      throw runtimeError('RECORD_VERIFY_FAILURE', 'Record ' + recordPlan.id + ' changed immediately before publishing.');
    }
    live = await ensureCurrentValidityBeforePublish(context, recordPlan, desired.published.hash, live);
    await context.client.items.publish(recordPlan.id, undefined, { recursive: false });
    context.mutationCount += 1;
  }

  live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
  if (!live.published || live.published.hash !== desired.published.hash) {
    throw runtimeError('PUBLISH_VERIFY_FAILURE', 'Record ' + recordPlan.id + ' did not reach the desired published state.');
  }
}

async function ensureCurrentValidityBeforePublish(context, recordPlan, expectedCurrentHash, live) {
  if (!context.plan.execution.revalidateBeforePublishIds.includes(recordPlan.id)) {
    return live;
  }
  if (live.current.hash !== expectedCurrentHash) {
    return live;
  }
  if (live.validity.current === true) {
    return live;
  }

  // CMA publish checks the cached current-validity flag. An update with the
  // exact current_version forces synchronous full validation even when the
  // content body itself is unchanged.
  await updateRecordWithLock(context, recordPlan, {}, live.consistency.currentVersion);
  const verified = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
  assertRecordSafeForResume(context, recordPlan, verified);
  if (verified.current.hash !== expectedCurrentHash || verified.validity.current !== true) {
    throw runtimeError('VALIDITY_REFRESH_FAILURE', 'Record ' + recordPlan.id + ' did not become synchronously valid under the generated relaxed schema before publishing.', {
      recordId: recordPlan.id,
      expectedCurrentHash,
      actualCurrentHash: verified.current.hash,
      actualValidity: verified.validity,
    });
  }
  return verified;
}

async function ensureLifecycleBeforePublication(context, recordPlan, live) {
  const desired = recordPlan.desired;
  if (
    live.lifecycle.createdAt === desired.lifecycle.createdAt &&
    live.lifecycle.firstPublishedAt === desired.lifecycle.firstPublishedAt
  ) {
    return live;
  }
  // Publishing assigns first_published_at when it is still null. Restore the
  // portable value first so no wall-clock intermediate escapes classification.
  await updateRecordWithLock(context, recordPlan, {
    meta: {
      created_at: desired.lifecycle.createdAt,
      first_published_at: desired.lifecycle.firstPublishedAt,
    },
  }, live.consistency.currentVersion);
  const verified = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
  assertRecordSafeForResume(context, recordPlan, verified);
  if (
    verified.lifecycle.createdAt !== desired.lifecycle.createdAt ||
    verified.lifecycle.firstPublishedAt !== desired.lifecycle.firstPublishedAt
  ) {
    throw runtimeError('RECORD_VERIFY_FAILURE', 'Record ' + recordPlan.id + ' lifecycle metadata did not converge before publishing.');
  }
  return verified;
}

async function unpublishOneRecord(context, recordPlan) {
  let live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
  assertRecordSafeForResume(context, recordPlan, live);
  if (!live.published) return;
  await assertNoUnsafePublishedReferrers(context, recordPlan, false);
  await assertNoUnsafeTreeChildren(context, recordPlan, 'published', false, 'unpublish');
  live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
  assertRecordSafeForResume(context, recordPlan, live);
  await assertNoUnsafePublishedReferrers(context, recordPlan, false);
  await assertNoUnsafeTreeChildren(context, recordPlan, 'published', false, 'unpublish');
  // Unpublish has no current_version precondition. These immediately adjacent
  // full-content and authoritative-referrer checks are the narrowest guards.
  await context.client.items.unpublish(recordPlan.id, undefined, { recursive: false });
  context.mutationCount += 1;
  const verified = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
  if (verified.published) {
    throw runtimeError('UNPUBLISH_VERIFY_FAILURE', 'Record ' + recordPlan.id + ' remained published after unpublishing.');
  }
}

async function reconcileCurrentVersionsAndLifecycle(context) {
  const ordered = orderedPlans(context.plan.execution.updateOrder, context.plan.records).filter(function (entry) {
    return entry.desired && entry.action !== 'noop';
  });
  for (const recordPlan of ordered) {
    await writeCurrentVersion(context, recordPlan, recordPlan.desired.current);
    const live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, live);
    if (
      live.lifecycle.createdAt !== recordPlan.desired.lifecycle.createdAt ||
      live.lifecycle.firstPublishedAt !== recordPlan.desired.lifecycle.firstPublishedAt
    ) {
      await updateRecordWithLock(context, recordPlan, {
        meta: {
          created_at: recordPlan.desired.lifecycle.createdAt,
          first_published_at: recordPlan.desired.lifecycle.firstPublishedAt,
        },
      }, live.consistency.currentVersion);
    }
  }
}

async function writeCurrentVersion(context, recordPlan, desiredVersion) {
  let live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
  assertRecordSafeForResume(context, recordPlan, live);
  if (live.current.hash === desiredVersion.hash) {
    return;
  }
  const patch = buildVersionPatch(desiredVersion.fields, live.current.fields, live);
  if (!Object.keys(patch).length) {
    throw runtimeError('PATCH_FAILURE', 'Record ' + recordPlan.id + ' differs, but no safe field patch could be generated.');
  }
  await updateRecordWithLock(context, recordPlan, patch, live.consistency.currentVersion);
  live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
  if (live.current.hash !== desiredVersion.hash) {
    throw runtimeError('RECORD_VERIFY_FAILURE', 'Record ' + recordPlan.id + ' current version did not converge.', {
      expected: desiredVersion.hash,
      actual: live.current.hash,
    });
  }
}

function findUnsupportedFreshNestedBlockUpdates(records) {
  const issues = [];
  for (const record of records.slice().sort(function (left, right) { return left.id.localeCompare(right.id); })) {
    if (!record.desired || record.action === 'delete' || record.action === 'noop') continue;

    if (!record.baseline) {
      // Phase 5 CREATE may introduce new block IDs. A later phase-8 UPDATE may
      // only reuse IDs already present in that deterministic creation seed.
      const seed = record.desired.published || record.desired.current;
      collectFreshNestedUpdateIssue(issues, record.id, 'current-restore', 'current', seed, record.desired.current);
      continue;
    }

    let precedingCurrent = record.baseline.current;
    if (
      record.desired.published &&
      record.desired.published.hash !== (record.baseline.published && record.baseline.published.hash)
    ) {
      collectFreshNestedUpdateIssue(issues, record.id, 'published-stage', 'published', precedingCurrent, record.desired.published);
      precedingCurrent = record.desired.published;
    }
    collectFreshNestedUpdateIssue(issues, record.id, 'current-restore', 'current', precedingCurrent, record.desired.current);
  }
  return issues;
}

function collectFreshNestedUpdateIssue(output, recordId, stage, slice, precedingCurrent, desired) {
  if (precedingCurrent.hash === desired.hash) return;
  const precedingBlocks = new Map();
  const desiredBlocks = new Map();
  collectNestedBlocks(precedingCurrent.fields, precedingBlocks);
  collectNestedBlocks(desired.fields, desiredBlocks);
  const blockId = Array.from(desiredBlocks.keys()).filter(function (id) {
    return !precedingBlocks.has(id);
  }).sort()[0];
  if (blockId) output.push({ recordId, stage, slice, blockId });
}

function buildVersionPatch(desiredFields, currentFields, liveRecord) {
  const existingBlocks = new Map();
  // A nested item ID is a valid shorthand only when the desired block is
  // already present in the live current version. Published blocks can differ
  // from the draft while sharing an ID; compacting against them would preserve
  // the wrong live draft payload instead of restoring the desired block.
  collectNestedBlocks(liveRecord.current.fields, existingBlocks);
  const patch = {};
  for (const key of Object.keys(desiredFields)) {
    if (stableStringify(desiredFields[key]) === stableStringify(currentFields[key])) {
      continue;
    }
    patch[key] = compactNestedValue(desiredFields[key], existingBlocks);
  }
  return patch;
}

function compactNestedValue(value, existingBlocks) {
  if (Array.isArray(value)) {
    return value.map(function (child) { return compactNestedValue(child, existingBlocks); });
  }
  if (!isObject(value)) {
    return value;
  }
  if (isNestedItem(value)) {
    const existing = existingBlocks.get(value.id);
    if (existing && stableStringify(existing) === stableStringify(value)) {
      return value.id;
    }
  }
  const result = {};
  for (const key of Object.keys(value)) {
    result[key] = compactNestedValue(value[key], existingBlocks);
  }
  return result;
}

function collectNestedBlocks(value, output) {
  if (Array.isArray(value)) {
    value.forEach(function (child) { collectNestedBlocks(child, output); });
    return;
  }
  if (!isObject(value)) {
    return;
  }
  if (isNestedItem(value)) {
    output.set(value.id, value);
  }
  Object.values(value).forEach(function (child) { collectNestedBlocks(child, output); });
}

function collectNestedBlockIdentities(value, output) {
  if (Array.isArray(value)) {
    value.forEach(function (child) { collectNestedBlockIdentities(child, output); });
    return;
  }
  if (!isObject(value)) {
    return;
  }
  if (isNestedItem(value)) {
    output.push({ id: value.id, itemTypeId: itemTypeIdFromItem(value) });
  }
  Object.values(value).forEach(function (child) { collectNestedBlockIdentities(child, output); });
}

async function updateRecordWithLock(context, recordPlan, body, expectedCurrentVersion) {
  const recordId = recordPlan.id;
  const current = await context.client.items.find(recordId, { version: 'current', nested: false });
  if (!current.meta || typeof current.meta.current_version !== 'string') {
    throw runtimeError('MISSING_CURRENT_VERSION', 'Record ' + recordId + ' did not return meta.current_version.');
  }
  if (current.meta.current_version !== expectedCurrentVersion) {
    throw conflict('record', recordId, 'changed immediately before a write', expectedCurrentVersion, current.meta.current_version);
  }
  const callerMeta = isObject(body.meta) ? body.meta : {};
  await context.client.items.update(recordId, Object.assign({}, body, {
    meta: Object.assign({}, callerMeta, { current_version: current.meta.current_version }),
  }));
  context.mutationCount += 1;
}

async function releaseDeleteReferences(context) {
  // Repeat the namespace reservation immediately before phase-9 writes so a
  // late external Item creation cannot hide behind the phase-1 proof.
  await verifyTransientDeleteReleaseBlockIds(context);

  // Revalidate every temporary version before any phase-9 write. This keeps
  // validation failures outside the strict destructive island even on rerun.
  await verifyPublishedDeleteReleases(context, true);

  // Prove every operation that can publish (explicitly or through a no-draft
  // update) before the first release mutation. Each operation repeats this
  // check immediately before its own write to narrow the remaining race.
  for (const release of context.plan.execution.deleteReleases) {
    const recordPlan = context.recordPlansById.get(release.recordId);
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    if (!release.publish && itemType.draftModeActive) continue;
    const live = await captureRecordMaybe(context, release.recordId, recordPlan.itemTypeId);
    if (!live) continue;
    assertRecordSafeForResume(context, recordPlan, live);
    const dependencies = collectRecordReferencesFromFields(release.fields, itemType, context);
    if (live.topology.parentId) dependencies.add(live.topology.parentId);
    await assertDependencyIdsPublished(context, Array.from(dependencies), recordPlan.id, false);
  }

  // First make every planned unlink current. Publishing is deliberately a
  // separate pass so a published release can depend on another deletion
  // candidate's already-released current without exposing mixed SCC states.
  for (const release of context.plan.execution.deleteReleases) {
    const recordPlan = context.recordPlansById.get(release.recordId);
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    let live = await captureRecordMaybe(context, release.recordId, recordPlan.itemTypeId);
    if (!live) {
      continue;
    }
    assertRecordSafeForResume(context, recordPlan, live);
    if (live.current.hash !== release.intermediateCurrentHash) {
      if (release.publish || !itemType.draftModeActive) {
        const dependencies = collectRecordReferencesFromFields(release.fields, itemType, context);
        if (live.topology.parentId) dependencies.add(live.topology.parentId);
        await assertDependencyIdsPublished(context, Array.from(dependencies), recordPlan.id, false);
      }
      const patch = buildVersionPatch(release.fields, live.current.fields, live);
      if (!Object.keys(patch).length) {
        throw runtimeError('DELETE_RELEASE_FAILURE', 'Record ' + release.recordId + ' needs a reference release but no safe patch could be generated.');
      }
      await updateRecordWithLock(context, recordPlan, patch, live.consistency.currentVersion);
      live = await captureRecord(context, release.recordId, recordPlan.itemTypeId);
    }
    if (live.current.hash !== release.intermediateCurrentHash) {
      throw runtimeError('DELETE_RELEASE_FAILURE', 'Record ' + release.recordId + ' did not reach its planned reference-release current state.');
    }
  }

  for (const release of context.plan.execution.deleteReleases) {
    if (!release.publish) continue;
    const recordPlan = context.recordPlansById.get(release.recordId);
    let live = await captureRecordMaybe(context, release.recordId, recordPlan.itemTypeId);
    if (!live) continue;
    assertRecordSafeForResume(context, recordPlan, live);
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    if (live.published && live.published.hash !== release.intermediateCurrentHash) {
      const dependencies = collectRecordReferencesFromFields(release.fields, itemType, context);
      if (live.topology.parentId) dependencies.add(live.topology.parentId);
      await assertDependencyIdsPublished(context, Array.from(dependencies), recordPlan.id, false);
      live = await captureRecord(context, release.recordId, recordPlan.itemTypeId);
      assertRecordSafeForResume(context, recordPlan, live);
      if (live.current.hash !== release.intermediateCurrentHash) {
        throw runtimeError('DELETE_RELEASE_FAILURE', 'Record ' + release.recordId + ' changed immediately before publishing its reference-release state.');
      }
      live = await ensureCurrentValidityBeforePublish(context, recordPlan, release.intermediateCurrentHash, live);
      // Publish has no current_version token. The immediately preceding full
      // capture/classification is the narrowest available race guard.
      await context.client.items.publish(recordPlan.id, undefined, { recursive: false });
      context.mutationCount += 1;
      live = await captureRecord(context, release.recordId, recordPlan.itemTypeId);
    }
    if (
      (live.published || (itemType && !itemType.draftModeActive)) &&
      (!live.published || live.published.hash !== release.intermediateCurrentHash)
    ) {
      throw runtimeError('DELETE_RELEASE_FAILURE', 'Record ' + release.recordId + ' did not reach its planned reference-release published state.');
    }
  }

  // The releases remove only approved, canonically projected SCC edges. Re-read authoritative
  // current and published referrers before the first destroy in this island.
  await verifyRecordDeletionSafety(context, true);
}

async function deleteRecords(context) {
  const ordered = orderedPlans(context.plan.execution.deleteOrder, context.plan.records).filter(function (entry) {
    return entry.action === 'delete';
  });
  for (const recordPlan of ordered) {
    const live = await captureRecordMaybe(context, recordPlan.id, recordPlan.itemTypeId);
    if (!live) {
      continue;
    }
    assertRecordSafeForResume(context, recordPlan, live);
    await assertNoUnexpectedRecordReferrers(context, recordPlan.id, false);
    // Destroy has no version precondition. Reclassify after the reference
    // checks so an intervening content edit cannot be silently discarded.
    const deleteLive = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, deleteLive);
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    if (itemType && (itemType.tree || itemType.sortable)) {
      await assertLiveRecordPositionStateSafe(context);
    }
    await assertNoUnsafeTreeChildren(context, recordPlan, 'current', false, 'delete');
    await context.client.items.destroy(recordPlan.id);
    context.mutationCount += 1;
  }
}

async function finalizePositionsAndStages(context) {
  const allDesiredPlans = context.plan.records.filter(function (entry) { return entry.desired; });
  const changedDesiredPlans = allDesiredPlans.filter(function (entry) { return entry.action !== 'noop'; });
  const affectedSiblingGroups = affectedRecordSiblingGroups(context);
  const positional = allDesiredPlans.filter(function (entry) {
    const itemType = context.schemaById.get(entry.itemTypeId);
    return itemType && (itemType.tree || itemType.sortable) &&
      typeof entry.desired.topology.position === 'number' &&
      affectedSiblingGroups.has(recordSiblingGroupKey(entry.itemTypeId, entry.desired.topology.parentId));
  }).sort(function (left, right) {
    return left.itemTypeId.localeCompare(right.itemTypeId) ||
      compareNullable(left.desired.topology.parentId, right.desired.topology.parentId) ||
      left.desired.topology.position - right.desired.topology.position ||
      left.id.localeCompare(right.id);
  });

  const seenStates = new Set();
  const maximumSteps = 4 * positional.length * positional.length + 1;
  for (let step = 0; step < maximumSteps; step += 1) {
    const liveSignature = await assertLiveRecordPositionStateSafe(context);
    if (seenStates.has(liveSignature)) {
      throw runtimeError('RECORD_ORDER_DID_NOT_CONVERGE', 'Record ordering repeated a prior state before reaching the desired positions.');
    }
    seenStates.add(liveSignature);
    const rows = JSON.parse(liveSignature);
    const rowsById = new Map(rows.map(function (row) { return [row.id, row]; }));
    if (recordPositionGoalReached(context, positional, rowsById)) break;
    const next = positional.find(function (recordPlan) {
      const row = rowsById.get(recordPlan.id);
      return row && !row.missing && row.position !== recordPlan.desired.topology.position;
    });
    if (!next) break;

    const live = await captureRecord(context, next.id, next.itemTypeId);
    assertRecordSafeForResume(context, next, live);
    const guarded = rowsById.get(next.id);
    if (
      live.topology.parentId !== guarded.parentId ||
      live.topology.position !== guarded.position
    ) {
      throw conflict('record', next.id, 'ordering changed immediately before a position write', stableStringify(guarded), stableStringify(live.topology));
    }
    await updateRecordWithLock(context, next, { position: next.desired.topology.position }, live.consistency.currentVersion);
  }
  const finalPositionSignature = await assertLiveRecordPositionStateSafe(context);
  const finalPositionRows = new Map(JSON.parse(finalPositionSignature).map(function (row) { return [row.id, row]; }));
  if (!recordPositionGoalReached(context, positional, finalPositionRows)) {
    throw runtimeError('RECORD_ORDER_DID_NOT_CONVERGE', 'Record ordering did not reach the desired positions within the bounded reconciliation steps.');
  }

  const ordered = orderedPlans(context.plan.execution.updateOrder, changedDesiredPlans);
  for (const recordPlan of ordered) {
    const live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, live);
    if (live.stage !== recordPlan.desired.stage) {
      await updateRecordWithLock(context, recordPlan, {
        meta: { stage: recordPlan.desired.stage },
      }, live.consistency.currentVersion);
    }
  }
}

function recordSiblingGroupKey(itemTypeId, parentId) {
  return itemTypeId + '\u0000' + String(parentId);
}

async function restoreSchedules(context) {
  if (!context.scheduleQuiescenceRequired) {
    return;
  }
  for (const recordPlan of context.plan.records) {
    if (!recordPlan.desired) {
      continue;
    }
    let live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    assertRecordSafeForResume(context, recordPlan, live);
    const desired = recordPlan.desired.schedules;

    if (stableStringify(live.schedules.publication) !== stableStringify(desired.publication)) {
      if (live.schedules.publication) {
        await destroyScheduleMaybe(context.client.scheduledPublication, recordPlan.id);
        context.mutationCount += 1;
      }
      if (desired.publication) {
        assertScheduleStillSafe(context, recordPlan.id, 'publication', desired.publication.at);
        await context.client.scheduledPublication.create(recordPlan.id, {
          publication_scheduled_at: desired.publication.at,
          selective_publication: desired.publication.selective
            ? {
                content_in_locales: desired.publication.selective.locales,
                non_localized_content: desired.publication.selective.nonLocalized,
              }
            : null,
        });
        context.mutationCount += 1;
      }
    }

    live = await captureRecord(context, recordPlan.id, recordPlan.itemTypeId);
    if (stableStringify(live.schedules.unpublishing) !== stableStringify(desired.unpublishing)) {
      if (live.schedules.unpublishing) {
        await destroyScheduleMaybe(context.client.scheduledUnpublishing, recordPlan.id);
        context.mutationCount += 1;
      }
      if (desired.unpublishing) {
        assertScheduleStillSafe(context, recordPlan.id, 'unpublishing', desired.unpublishing.at);
        await context.client.scheduledUnpublishing.create(recordPlan.id, {
          unpublishing_scheduled_at: desired.unpublishing.at,
          content_in_locales: desired.unpublishing.locales,
        });
        context.mutationCount += 1;
      }
    }
  }
}

function assertScheduleStillSafe(context, recordId, kind, at) {
  const lead = Number.isFinite(context.options.scheduleSafetyWindowMs)
    ? context.options.scheduleSafetyWindowMs
    : DEFAULT_SCHEDULE_SAFETY_WINDOW_MS;
  if (Date.parse(at) <= Date.now() + lead) {
    throw runtimeError('SCHEDULE_TOO_CLOSE', 'Record ' + recordId + ' ' + kind + ' schedule became too close while the migration was running.');
  }
}

async function pruneUploads(context) {
  const ordered = orderedPlans(context.plan.execution.uploadOrder, context.plan.uploads).filter(function (entry) {
    return entry.action === 'delete';
  });
  for (const uploadPlan of ordered) {
    const found = await findUploadMaybe(context.client, uploadPlan.id);
    if (!found) {
      continue;
    }
    const resource = await waitForUploadReady(context, uploadPlan.id);
    const live = canonicalizeUpload(resource, context.plan.schema.locales);
    if (!uploadPlan.baseline || (live.hash !== uploadPlan.baseline.hash && !isSafeUploadIntermediate(live, uploadPlan))) {
      throw conflict('upload', uploadPlan.id, 'changed during execution', uploadPlan.expectedTargetHash, live.hash);
    }
    const currentReferences = await context.client.uploads.references(uploadPlan.id, { version: 'current' });
    const publishedReferences = await context.client.uploads.references(uploadPlan.id, { version: 'published' });
    const references = unique(currentReferences.concat(publishedReferences).map(function (record) { return record.id; }));
    if (references.length) {
      throw runtimeError('UPLOAD_STILL_REFERENCED', 'Refusing to delete upload ' + uploadPlan.id + ' because records still reference it.', {
        uploadId: uploadPlan.id,
        recordIds: references,
      });
    }
    const foundDeleteResource = await findUploadMaybe(context.client, uploadPlan.id);
    if (!foundDeleteResource) {
      continue;
    }
    const deleteResource = await waitForUploadReady(context, uploadPlan.id);
    const deleteLive = canonicalizeUpload(deleteResource, context.plan.schema.locales);
    if (!uploadPlan.baseline || (deleteLive.hash !== uploadPlan.baseline.hash && !isSafeUploadIntermediate(deleteLive, uploadPlan))) {
      throw conflict('upload', uploadPlan.id, 'changed immediately before deletion', uploadPlan.expectedTargetHash, deleteLive.hash);
    }
    // Upload destroy has no version precondition; this immediate recheck is the
    // narrowest available guard before the destructive call.
    await context.client.uploads.destroy(uploadPlan.id);
    context.mutationCount += 1;
  }
}

async function waitForExpectedRecordValidity(context) {
  if (context.plan.invalidContent.validatorRelaxations.length === 0) return;
  const recordIds = new Set(context.plan.execution.revalidateBeforePublishIds);
  for (const relaxation of context.plan.invalidContent.validatorRelaxations) {
    relaxation.affectedRecordIds.forEach(function (id) { recordIds.add(id); });
  }
  for (const recordPlan of context.plan.records) {
    if (recordPlan.desired && (recordPlan.desired.validity.current === false || recordPlan.desired.validity.published === false)) {
      recordIds.add(recordPlan.id);
    }
  }
  const preservedSkipped = context.plan.invalidContent.skippedRecords.some(function (entry) {
    return entry.disposition === 'preserve_target';
  });
  if (recordIds.size === 0 && !preservedSkipped) return;

  const timeout = Number.isFinite(context.options.validityProcessingTimeoutMs)
    ? context.options.validityProcessingTimeoutMs
    : DEFAULT_VALIDITY_PROCESSING_TIMEOUT_MS;
  const interval = Number.isFinite(context.options.validityProcessingPollIntervalMs)
    ? context.options.validityProcessingPollIntervalMs
    : DEFAULT_VALIDITY_PROCESSING_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;
  let pending = [];

  do {
    pending = [];
    for (const recordId of recordIds) {
      const recordPlan = context.recordPlansById.get(recordId);
      if (!recordPlan || !recordPlan.desired) continue;
      const current = await findItemCurrentShellMaybe(context.client, recordId);
      const validity = current ? recordValidityFromCurrentResource(current) : null;
      if (!validity || stableStringify(validity) !== stableStringify(recordPlan.desired.validity)) {
        pending.push({
          recordId,
          expected: recordPlan.desired.validity,
          actual: validity,
        });
      }
    }
    for (const skipped of context.plan.invalidContent.skippedRecords) {
      if (skipped.disposition !== 'preserve_target') continue;
      const current = await findItemCurrentShellMaybe(context.client, skipped.id);
      const validity = current ? recordValidityFromCurrentResource(current) : null;
      if (!validity || stableStringify(validity) !== stableStringify(skipped.targetValidity)) {
        pending.push({
          recordId: skipped.id,
          skipped: true,
          expected: skipped.targetValidity,
          actual: validity,
        });
      }
    }
    if (pending.length === 0) return;
    if (Date.now() >= deadline) break;
    await delay(Math.min(interval, Math.max(0, deadline - Date.now())));
  } while (Date.now() <= deadline);

  throw runtimeError('VALIDITY_REVALIDATION_TIMEOUT', 'Original validators were restored, but CMA validity flags did not converge to the planned current/published expectations before timeout. Pending: ' + stableStringify(pending), {
    pending,
    timeoutMs: timeout,
  });
}

function recordValidityFromCurrentResource(current) {
  if (!isObject(current) || typeof current.id !== 'string') {
    throw runtimeError('INVALID_CMA_RESPONSE', 'CMA returned an invalid current record resource while reading validity.');
  }
  const meta = isObject(current.meta) ? current.meta : {};
  const currentValid = requiredCmaBoolean(meta.is_current_version_valid, 'record ' + current.id + ' meta.is_current_version_valid');
  const currentSliceValid = requiredCmaBoolean(meta.is_valid, 'record ' + current.id + ' current meta.is_valid');
  if (currentValid !== currentSliceValid) {
    throw runtimeError('INVALID_CMA_RESPONSE', 'Record ' + current.id + ' reports inconsistent current validity flags.');
  }
  const publishedValid = meta.is_published_version_valid === null
    ? null
    : requiredCmaBoolean(meta.is_published_version_valid, 'record ' + current.id + ' meta.is_published_version_valid');
  return { current: currentValid, published: publishedValid };
}

async function verifyFinalState(context, options) {
  const includeSchedules = !options || options.includeSchedules !== false;
  const failures = [];
  const liveRecords = new Map();
  for (const recordPlan of context.plan.records) {
    const live = await captureRecordMaybe(context, recordPlan.id, recordPlan.itemTypeId);
    if (live) {
      liveRecords.set(recordPlan.id, live);
    }
    if (!recordPlan.desired) {
      if (live) {
        failures.push('record ' + recordPlan.id + ' still exists');
      }
    } else if (
      !live ||
      (includeSchedules
        ? live.hash !== recordPlan.desired.hash
        : stableStringify(recordStateWithoutSchedules(live)) !==
          stableStringify(recordStateWithoutSchedules(recordPlan.desired)))
    ) {
      failures.push('record ' + recordPlan.id + ' expected ' + recordPlan.desired.hash + ', received ' + (live ? live.hash : 'missing'));
    } else if (stableStringify(live.validity) !== stableStringify(recordPlan.desired.validity)) {
      failures.push('record ' + recordPlan.id + ' expected validity ' + stableStringify(recordPlan.desired.validity) + ', received ' + stableStringify(live.validity));
    }
  }

  verifyFinalRecordOrdering(context, liveRecords, failures);

  for (const uploadPlan of context.plan.uploads) {
    const initialResource = await findUploadMaybe(context.client, uploadPlan.id);
    const resource = uploadPlan.desired && initialResource
      ? await waitForUploadReady(
          context,
          uploadPlan.id,
          uploadPlan.action === 'create' || uploadPlan.changes.binary ? uploadPlan.desired.md5 : undefined,
        )
      : initialResource;
    const live = resource ? canonicalizeUpload(resource, context.plan.schema.locales) : null;
    if (!uploadPlan.desired) {
      if (live) {
        failures.push('upload ' + uploadPlan.id + ' still exists');
      }
    } else if (!live || live.hash !== uploadPlan.desired.hash) {
      failures.push('upload ' + uploadPlan.id + ' expected ' + uploadPlan.desired.hash + ', received ' + (live ? live.hash : 'missing'));
    }
  }

  for (const collectionPlan of context.plan.uploadCollections) {
    const resource = await findCollectionMaybe(context.client, collectionPlan.id);
    const live = resource ? canonicalizeUploadCollection(resource) : null;
    if (!live || live.hash !== collectionPlan.desired.hash) {
      failures.push('upload collection ' + collectionPlan.id + ' expected ' + collectionPlan.desired.hash + ', received ' + (live ? live.hash : 'missing'));
    }
  }

  if (failures.length) {
    throw runtimeError('FINAL_VERIFICATION_FAILURE', 'Content migration completed its calls but final semantic verification failed:\n- ' + failures.join('\n- '));
  }
  await verifyTargetSetPreconditions(context, true);
  await inspectLegacyIdMappings(context, true);
  await verifyLegacySourceIdsAbsent(context);
  await verifyExternalLegacyIdMappingTargets(context);
}

function recordStateWithoutSchedules(record) {
  return {
    current: record.current.hash,
    published: record.published ? record.published.hash : null,
    parentId: record.topology.parentId,
    lifecycle: record.lifecycle,
    stage: record.stage,
  };
}

async function verifyFinalRecordSchedules(context) {
  const failures = [];
  for (const recordPlan of context.plan.records) {
    const live = await captureRecordMaybe(context, recordPlan.id, recordPlan.itemTypeId);
    if (!recordPlan.desired) {
      if (live) failures.push('record ' + recordPlan.id + ' still exists');
      continue;
    }
    if (!live) {
      failures.push('record ' + recordPlan.id + ' is missing after schedule restoration');
      continue;
    }
    if (stableStringify(live.schedules) !== stableStringify(recordPlan.desired.schedules)) {
      failures.push('record ' + recordPlan.id + ' expected schedules ' + stableStringify(recordPlan.desired.schedules) + ', received ' + stableStringify(live.schedules));
    }
    if (stableStringify(recordStateWithoutSchedules(live)) !== stableStringify(recordStateWithoutSchedules(recordPlan.desired))) {
      failures.push('record ' + recordPlan.id + ' content changed during schedule restoration');
    }
    if (stableStringify(live.validity) !== stableStringify(recordPlan.desired.validity)) {
      failures.push('record ' + recordPlan.id + ' validity changed during schedule restoration');
    }
  }
  if (failures.length) {
    throw runtimeError('FINAL_VERIFICATION_FAILURE', 'Publication schedule restoration did not preserve the proven final record state:\n- ' + failures.join('\n- '));
  }
}

function verifyFinalRecordOrdering(context, liveRecords, failures) {
  const positional = context.plan.records.filter(function (recordPlan) {
    if (!recordPlan.desired || typeof recordPlan.desired.topology.position !== 'number') {
      return false;
    }
    const itemType = context.schemaById.get(recordPlan.itemTypeId);
    return Boolean(itemType && (itemType.tree || itemType.sortable));
  });

  if (absoluteRecordPositionsReproducible(context)) {
    for (const recordPlan of positional) {
      const live = liveRecords.get(recordPlan.id);
      if (live && live.topology.position !== recordPlan.desired.topology.position) {
        failures.push('record ' + recordPlan.id + ' expected position ' + recordPlan.desired.topology.position + ', received ' + String(live.topology.position));
      }
    }
    return;
  }

  const groups = new Map();
  for (const recordPlan of positional) {
    const key = recordPlan.itemTypeId + '\u0000' + String(recordPlan.desired.topology.parentId);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(recordPlan);
  }
  for (const [key, group] of groups) {
    for (const entry of group) {
      const live = liveRecords.get(entry.id);
      if (live && typeof live.topology.position !== 'number') {
        failures.push('record ' + entry.id + ' has no numeric sibling position');
      }
    }
    const expected = group.slice().sort(function (left, right) {
      return left.desired.topology.position - right.desired.topology.position || left.id.localeCompare(right.id);
    }).map(function (entry) { return entry.id; });
    const actual = group.filter(function (entry) {
      const live = liveRecords.get(entry.id);
      return live && typeof live.topology.position === 'number';
    }).sort(function (left, right) {
      const leftLive = liveRecords.get(left.id);
      const rightLive = liveRecords.get(right.id);
      return leftLive.topology.position - rightLive.topology.position || left.id.localeCompare(right.id);
    }).map(function (entry) { return entry.id; });
    if (!sameStringArray(actual, expected)) {
      failures.push('managed sibling order ' + key.replace('\u0000', '/') + ' expected ' + expected.join(',') + ', received ' + actual.join(','));
    }
  }
}

async function captureRecordMaybe(context, id, itemTypeId) {
  const current = await findRecordCurrentMaybe(context.client, id);
  if (!current) {
    return null;
  }
  return captureRecordFromCurrent(context, current, itemTypeId);
}

async function captureRecord(context, id, itemTypeId) {
  const record = await captureRecordMaybe(context, id, itemTypeId);
  if (!record) {
    throw conflict('record', id, 'was deleted during execution');
  }
  return record;
}

async function captureRecordFromCurrent(context, current, itemTypeId) {
  const actualItemTypeId = itemTypeIdFromItem(current);
  if (actualItemTypeId && actualItemTypeId !== itemTypeId) {
    throw runtimeError('ITEM_TYPE_CONFLICT', 'Record ' + current.id + ' belongs to item type ' + actualItemTypeId + ', expected ' + itemTypeId + '.');
  }
  const itemType = context.captureSchemaById.get(itemTypeId);
  if (!itemType) {
    throw runtimeError('SCHEMA_MISMATCH', 'Plan has no schema for item type ' + itemTypeId + '.');
  }
  const published = await findRecordPublishedMaybe(context.client, current.id);
  const schedules = await readSchedules(context, current);
  return canonicalizeRecord(current, published, itemType, context.captureSchema, schedules);
}

async function findRecordCurrentMaybe(client, id) {
  try {
    return await client.items.find(id, { version: 'current', nested: true });
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function findItemCurrentShellMaybe(client, id) {
  try {
    return await client.items.find(id, { version: 'current', nested: false });
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function findRecordPublishedMaybe(client, id) {
  try {
    return await client.items.find(id, { version: 'published', nested: true });
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function findUploadMaybe(client, id) {
  try {
    return await client.uploads.find(id);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function findCollectionMaybe(client, id) {
  try {
    return await client.uploadCollections.find(id);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function readSchedules(context, current) {
  const meta = isObject(current.meta) ? current.meta : {};
  const hasPublication = typeof meta.publication_scheduled_at === 'string';
  const hasUnpublishing = typeof meta.unpublishing_scheduled_at === 'string';
  if (!hasPublication && !hasUnpublishing) {
    return { publication: null, unpublishing: null };
  }
  if (!context.client.items || typeof context.client.items.rawCurrentVsPublishedState !== 'function') {
    throw runtimeError('SCHEDULE_CONTRACT_CHANGED', 'The installed CMA client cannot read exact record schedule scopes.');
  }
  const raw = await context.client.items.rawCurrentVsPublishedState(current.id);
  if (!isObject(raw) || !isObject(raw.data) || !isObject(raw.data.relationships) || !Array.isArray(raw.included)) {
    throw runtimeError('SCHEDULE_CONTRACT_CHANGED', 'The current-vs-published schedule response has an unsupported shape.');
  }
  const publicationResource = includedRelationship(raw, 'scheduled_publication', 'scheduled_publication');
  const unpublishingResource = includedRelationship(raw, 'scheduled_unpublishing', 'scheduled_unpublishing');
  if (hasPublication && !publicationResource) {
    throw runtimeError('SCHEDULE_CONTRACT_CHANGED', 'Publication schedule metadata exists but its exact scope was not included.');
  }
  if (hasUnpublishing && !unpublishingResource) {
    throw runtimeError('SCHEDULE_CONTRACT_CHANGED', 'Unpublishing schedule metadata exists but its exact scope was not included.');
  }
  const publicationAttributes = publicationResource ? publicationResource.attributes : null;
  const unpublishingAttributes = unpublishingResource ? unpublishingResource.attributes : null;
  const publication = publicationAttributes
    ? {
        at: publicationAttributes.publication_scheduled_at,
        selective: publicationAttributes.selective_publication
          ? {
              locales: publicationAttributes.selective_publication.content_in_locales,
              nonLocalized: publicationAttributes.selective_publication.non_localized_content,
            }
          : null,
      }
    : null;
  const unpublishing = unpublishingAttributes
    ? {
        at: unpublishingAttributes.unpublishing_scheduled_at,
        locales: unpublishingAttributes.content_in_locales,
      }
    : null;
  return canonicalizeSchedules({ publication, unpublishing }, context.plan.schema.locales);
}

function includedRelationship(raw, relationshipName, resourceType) {
  const relationship = raw.data.relationships[relationshipName];
  if (!relationship || !relationship.data) {
    return null;
  }
  const id = relationship.data.id;
  return raw.included.find(function (entry) {
    return entry && entry.type === resourceType && entry.id === id && isObject(entry.attributes);
  }) || null;
}

function canonicalizeRecord(currentInput, publishedInput, itemType, schema, schedules) {
  const current = canonicalizeRecordVersion(currentInput, itemType, schema);
  const published = publishedInput ? canonicalizeRecordVersion(publishedInput, itemType, schema) : null;
  const currentMeta = isObject(currentInput.meta) ? currentInput.meta : {};
  const publishedMeta = publishedInput && isObject(publishedInput.meta) ? publishedInput.meta : null;
  const currentValid = requiredCmaBoolean(currentMeta.is_current_version_valid, 'record ' + String(currentInput.id) + ' meta.is_current_version_valid');
  const currentSliceValid = requiredCmaBoolean(currentMeta.is_valid, 'record ' + String(currentInput.id) + ' current meta.is_valid');
  if (currentValid !== currentSliceValid) {
    throw runtimeError('INVALID_CMA_RESPONSE', 'Record ' + String(currentInput.id) + ' reports inconsistent current validity flags.');
  }
  let publishedValid = null;
  if (publishedMeta) {
    publishedValid = requiredCmaBoolean(currentMeta.is_published_version_valid, 'record ' + String(currentInput.id) + ' meta.is_published_version_valid');
    const publishedSliceValid = requiredCmaBoolean(publishedMeta.is_valid, 'record ' + String(currentInput.id) + ' published meta.is_valid');
    if (publishedValid !== publishedSliceValid) {
      throw runtimeError('INVALID_CMA_RESPONSE', 'Record ' + String(currentInput.id) + ' reports inconsistent published validity flags.');
    }
  }
  const snapshotState = {
    id: String(currentInput.id),
    itemTypeId: itemType.id,
    current,
    published,
    topology: {
      parentId: typeof currentInput.parent_id === 'string' ? currentInput.parent_id : null,
      position: typeof currentInput.position === 'number' ? currentInput.position : null,
    },
    lifecycle: {
      createdAt: requiredTimestamp(currentMeta.created_at, 'meta.created_at'),
      firstPublishedAt: typeof currentMeta.first_published_at === 'string'
        ? requiredTimestamp(currentMeta.first_published_at, 'meta.first_published_at')
        : null,
    },
    validity: { current: currentValid, published: publishedValid },
    stage: typeof currentMeta.stage === 'string' ? currentMeta.stage : null,
    schedules: canonicalizeSchedules(schedules, schema.locales),
  };
  const semanticState = Object.assign({}, snapshotState);
  delete semanticState.validity;
  return Object.assign({}, snapshotState, {
    // Absolute sibling positions are deliberately not conflict state: a
    // retained destination-only sibling can shift every following record.
    hash: semanticHash(Object.assign({}, semanticState, {
      topology: { parentId: semanticState.topology.parentId },
    })),
    consistency: {
      currentVersion: requiredString(currentMeta.current_version, 'meta.current_version'),
      updatedAt: requiredString(currentMeta.updated_at, 'meta.updated_at'),
      publishedAt: typeof currentMeta.published_at === 'string' ? currentMeta.published_at : null,
      currentValid,
      publishedValid,
    },
  });
}

function canonicalizeRecordVersion(input, itemType, schema) {
  if (!isObject(input) || typeof input.id !== 'string') {
    throw runtimeError('INVALID_CMA_RESPONSE', 'CMA returned an invalid record resource.');
  }
  const fields = {};
  for (const field of itemType.fields.slice().sort(compareFieldSnapshots)) {
    if (Object.prototype.hasOwnProperty.call(input, field.apiKey)) {
      fields[field.apiKey] = canonicalizeFieldValue(input[field.apiKey], field, schema);
    }
  }
  for (const key of Object.keys(input).sort()) {
    if (ITEM_RESERVED_KEYS.has(key) || Object.prototype.hasOwnProperty.call(fields, key) || input[key] === undefined) {
      continue;
    }
    fields[key] = canonicalizeJson(input[key]);
  }
  return { fields, hash: semanticHash(fields) };
}

function canonicalizeFieldValue(input, field, schema) {
  if (field.localized && isObject(input)) {
    const ordered = sortLocalesObject(input, schema.locales);
    const output = {};
    for (const locale of Object.keys(ordered)) {
      output[locale] = canonicalizeNonLocalizedFieldValue(ordered[locale], field, schema);
    }
    return output;
  }
  return canonicalizeNonLocalizedFieldValue(input, field, schema);
}

function canonicalizeNonLocalizedFieldValue(input, field, schema) {
  if (['rich_text', 'single_block', 'structured_text'].includes(field.fieldType)) {
    return canonicalizeEmbeddedContent(input, schema);
  }
  return canonicalizeJson(input);
}

function canonicalizeEmbeddedContent(input, schema) {
  if (Array.isArray(input)) {
    return input.map(function (value) { return canonicalizeEmbeddedContent(value, schema); });
  }
  if (!isObject(input)) {
    return canonicalizeJson(input);
  }
  const identity = nestedItemIdentity(input, 'embedded content');
  if (identity) {
    const itemTypeId = identity.itemTypeId;
    const itemType = schema.itemTypes.find(function (candidate) { return candidate.id === itemTypeId; });
    if (!itemType || !itemType.modularBlock) {
      throw runtimeError('INVALID_CMA_RESPONSE', 'Nested item ' + String(input.id) + ' refers to unknown block model ' + itemTypeId + '.');
    }
    if (Object.prototype.hasOwnProperty.call(input, 'attributes') && !isObject(input.attributes)) {
      throw runtimeError('INVALID_CMA_RESPONSE', 'Nested item ' + identity.id + ' has malformed attributes.');
    }
    const attributes = isObject(input.attributes) ? input.attributes : input;
    const version = canonicalizeRecordVersion(Object.assign({ id: identity.id }, attributes), itemType, schema);
    return {
      id: identity.id,
      type: 'item',
      attributes: version.fields,
      relationships: {
        item_type: { data: entityRef('item_type', itemTypeId) },
      },
    };
  }
  const output = {};
  for (const key of Object.keys(input).sort()) {
    if (input[key] !== undefined) {
      output[key] = canonicalizeEmbeddedContent(input[key], schema);
    }
  }
  return output;
}

function canonicalizeUpload(input, localeOrder) {
  if (!isObject(input)) {
    throw runtimeError('INVALID_CMA_RESPONSE', 'CMA returned an invalid upload resource.');
  }
  const meta = isObject(input.meta) ? input.meta : {};
  const antivirus = isObject(meta.antivirus) ? meta.antivirus : {};
  const status = antivirus.status;
  if (!['pending', 'clean', 'infected', 'failed', 'skipped'].includes(status)) {
    throw runtimeError('INVALID_CMA_RESPONSE', 'Upload ' + String(input.id) + ' has an unknown antivirus status.');
  }
  if (status === 'pending' || status === 'infected' || status === 'failed') {
    throw runtimeError('UNHEALTHY_UPLOAD', 'Upload ' + String(input.id) + ' has antivirus status ' + String(status) + '.');
  }
  const collection = isObject(input.upload_collection) ? input.upload_collection : null;
  const manual = {
    author: typeof input.author === 'string' ? input.author : null,
    copyright: typeof input.copyright === 'string' ? input.copyright : null,
    notes: typeof input.notes === 'string' ? input.notes : null,
    defaultFieldMetadata: canonicalizeDefaultFieldMetadata(input.default_field_metadata, localeOrder),
    tags: Array.isArray(input.tags) ? unique(input.tags.map(String)).sort() : [],
    collectionId: collection && typeof collection.id === 'string' ? collection.id : null,
  };
  const semanticState = {
    id: requiredString(input.id, 'upload.id'),
    md5: requiredString(input.md5, 'upload.md5'),
    basename: requiredString(input.basename, 'upload.basename'),
    filename: requiredString(input.filename, 'upload.filename'),
    manual,
  };
  return Object.assign({}, semanticState, {
    size: requiredNumber(input.size, 'upload.size'),
    mimeType: typeof input.mime_type === 'string' ? input.mime_type : null,
    hash: semanticHash(semanticState),
    consistency: {
      updatedAt: typeof input.updated_at === 'string' ? input.updated_at : null,
      antivirusStatus: status,
    },
  });
}

function canonicalizeDefaultFieldMetadata(input, localeOrder) {
  if (!isObject(input)) {
    return {};
  }
  const fieldKeyed = ['alt', 'title', 'custom_data', 'focal_point', 'poster_time'].some(function (key) {
    return Object.prototype.hasOwnProperty.call(input, key);
  });
  if (!fieldKeyed) {
    return sortLocalesObject(input, localeOrder);
  }
  const output = {};
  for (const key of ['alt', 'title', 'custom_data']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      output[key] = sortLocalesObject(input[key], localeOrder);
    }
  }
  for (const key of ['focal_point', 'poster_time']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      output[key] = canonicalizeJson(input[key]);
    }
  }
  return output;
}

function canonicalizeUploadCollection(input) {
  if (!isObject(input)) {
    throw runtimeError('INVALID_CMA_RESPONSE', 'CMA returned an invalid upload collection.');
  }
  const parent = isObject(input.parent) ? input.parent : null;
  const semanticState = {
    id: requiredString(input.id, 'uploadCollection.id'),
    label: requiredString(input.label, 'uploadCollection.label'),
    parentId: parent ? requiredString(parent.id, 'uploadCollection.parent.id') : null,
    position: requiredNumber(input.position, 'uploadCollection.position'),
  };
  return Object.assign({}, semanticState, { hash: semanticHash(semanticState) });
}

function canonicalizeSchedules(schedules, localeOrder) {
  function sortLocales(locales) {
    const rank = new Map(localeOrder.map(function (locale, index) { return [locale, index]; }));
    return unique(locales).sort(function (left, right) {
      const leftRank = rank.has(left) ? rank.get(left) : Number.MAX_SAFE_INTEGER;
      const rightRank = rank.has(right) ? rank.get(right) : Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.localeCompare(right);
    });
  }
  return {
    publication: schedules.publication
      ? {
          at: requiredTimestamp(schedules.publication.at, 'scheduledPublication.at'),
          selective: schedules.publication.selective
            ? {
                locales: sortLocales(schedules.publication.selective.locales),
                nonLocalized: schedules.publication.selective.nonLocalized,
              }
            : null,
        }
      : null,
    unpublishing: schedules.unpublishing
      ? {
          at: requiredTimestamp(schedules.unpublishing.at, 'scheduledUnpublishing.at'),
          locales: schedules.unpublishing.locales ? sortLocales(schedules.unpublishing.locales) : null,
        }
      : null,
  };
}

function assertRecordSafeForResume(context, recordPlan, live) {
  if (
    context.schedulesQuiesced &&
    (live.schedules.publication || live.schedules.unpublishing)
  ) {
    throw runtimeError('SCHEDULE_RECREATED_DURING_MIGRATION', 'Record ' + recordPlan.id + ' acquired a publication or unpublishing schedule while this migration required schedules to remain quiesced.', {
      recordId: recordPlan.id,
      schedules: live.schedules,
    });
  }
  const hashes = [];
  if (recordPlan.baseline) {
    hashes.push(recordPlan.baseline.hash);
  }
  if (recordPlan.desired) {
    hashes.push(recordPlan.desired.hash);
  }
  if (Array.isArray(recordPlan.allowedIntermediateHashes)) {
    hashes.push.apply(hashes, recordPlan.allowedIntermediateHashes);
  }
  if (hashes.includes(live.hash) || isSafeRecordIntermediate(context, live, recordPlan)) {
    return;
  }
  throw conflict('record', recordPlan.id, 'changed during execution', hashes.join(' or '), live.hash);
}

function isSafeRecordIntermediate(context, live, recordPlan) {
  const itemType = context.schemaById.get(recordPlan.itemTypeId);
  return recordPlan.action === 'create'
    ? isKnownCreateRecordPhaseState(context, live, recordPlan, itemType)
    : isKnownExistingRecordPhaseState(context, live, recordPlan, itemType);
}

function isKnownCreateRecordPhaseState(context, live, recordPlan, itemType) {
  if (recordPlan.baseline !== null || !recordPlan.desired || !itemType) {
    return false;
  }
  const known = new Set();
  const signature = function (state) {
    return stableStringify({
      current: state.current,
      published: state.published,
      parentId: state.parentId,
      lifecycle: state.lifecycle,
      stage: state.stage,
      schedules: state.schedules,
    });
  };
  const remember = function (state) { known.add(signature(state)); };
  const state = {
    current: semanticHash(expectedCreateSeedFields(context, recordPlan)),
    published: null,
    parentId: recordPlan.desired.topology.parentId,
    lifecycle: recordPlan.desired.lifecycle,
    stage: initialStageForItemType(context, itemType),
    schedules: { publication: null, unpublishing: null },
  };
  if (state.stage === undefined) {
    return false;
  }
  if (!itemType.draftModeActive) {
    state.published = state.current;
  }
  remember(state);

  // Optional create cycles (and their transitive source-only prerequisites)
  // can publish their deterministic creation seed before the final published
  // slice is written. Model both the freshly published seed and the following
  // current-only write so reruns recognize exactly those phase states.
  if (
    itemType.draftModeActive &&
    context.plan.execution.publicationSeedOrder.includes(recordPlan.id)
  ) {
    state.published = state.current;
    remember(state);
  }

  const desiredPublished = recordPlan.desired.published
    ? recordPlan.desired.published.hash
    : null;
  if (desiredPublished === null) {
    if (state.published !== null) {
      state.published = null;
      remember(state);
    }
  } else {
    if (state.current !== desiredPublished) {
      state.current = desiredPublished;
      if (!itemType.draftModeActive) {
        state.published = desiredPublished;
      }
      remember(state);
    }
    if (state.published !== desiredPublished) {
      state.published = desiredPublished;
      remember(state);
    }
  }

  if (state.current !== recordPlan.desired.current.hash) {
    state.current = recordPlan.desired.current.hash;
    if (!itemType.draftModeActive) {
      state.published = state.current;
    }
    remember(state);
  }
  if (state.stage !== recordPlan.desired.stage) {
    state.stage = recordPlan.desired.stage;
    remember(state);
  }
  for (const key of ['publication', 'unpublishing']) {
    if (stableStringify(state.schedules[key]) !== stableStringify(recordPlan.desired.schedules[key])) {
      state.schedules[key] = recordPlan.desired.schedules[key];
      remember(state);
    }
  }

  return known.has(signature({
    current: live.current.hash,
    published: live.published ? live.published.hash : null,
    parentId: live.topology.parentId,
    lifecycle: live.lifecycle,
    stage: live.stage,
    schedules: live.schedules,
  }));
}

function initialStageForItemType(context, itemType) {
  if (!itemType.workflowId) {
    return null;
  }
  const workflow = context.plan.schema.workflows.find(function (entry) { return entry.id === itemType.workflowId; });
  const initial = workflow && workflow.stages.find(function (stage) { return stage.initial === true; });
  return initial ? initial.id : undefined;
}

function isKnownExistingRecordPhaseState(context, live, recordPlan, itemType) {
  if (!recordPlan.baseline) {
    return false;
  }
  const known = new Set();
  const signature = function (state) {
    return stableStringify({
      current: state.current,
      published: state.published,
      parentId: state.parentId,
      lifecycle: state.lifecycle,
      stage: state.stage,
      schedules: state.schedules,
    });
  };
  const fromSnapshot = function (snapshot) {
    return {
      current: snapshot.current.hash,
      published: snapshot.published ? snapshot.published.hash : null,
      parentId: snapshot.topology.parentId,
      lifecycle: snapshot.lifecycle,
      stage: snapshot.stage,
      schedules: snapshot.schedules,
    };
  };
  const clone = function (state) {
    return JSON.parse(stableStringify(state));
  };
  const remember = function (state) {
    known.add(signature(state));
  };

  let states = [fromSnapshot(recordPlan.baseline)];
  states.forEach(remember);
  const quiescesSchedules = planHasCmaMutations(context.plan);
  if (recordPlan.action === 'noop' && !quiescesSchedules) {
    return known.has(signature({
      current: live.current.hash,
      published: live.published ? live.published.hash : null,
      parentId: live.topology.parentId,
      lifecycle: live.lifecycle,
      stage: live.stage,
      schedules: live.schedules,
    }));
  }

  // Phase 2 quiesces each live schedule independently.
  for (const key of ['publication', 'unpublishing']) {
    states = states.map(function (state) {
      const next = clone(state);
      if (quiescesSchedules && next.schedules[key]) {
        next.schedules[key] = null;
        remember(next);
      }
      return next;
    });
  }

  if (recordPlan.action === 'noop') {
    return known.has(signature({
      current: live.current.hash,
      published: live.published ? live.published.hash : null,
      parentId: live.topology.parentId,
      lifecycle: live.lifecycle,
      stage: live.stage,
      schedules: live.schedules,
    }));
  }

  if (recordPlan.action === 'delete') {
    const deleteReleases = context.plan.execution.deleteReleases.filter(function (release) {
      return release.recordId === recordPlan.id;
    });
    for (const release of deleteReleases) {
      states = states.map(function (state) {
        const next = clone(state);
        next.current = release.intermediateCurrentHash;
        if (itemType && !itemType.draftModeActive) {
          next.published = release.intermediateCurrentHash;
        }
        remember(next);
        if (release.publish) {
          next.published = release.intermediateCurrentHash;
          remember(next);
        }
        return next;
      });
    }
    const liveState = {
      current: live.current.hash,
      published: live.published ? live.published.hash : null,
      parentId: live.topology.parentId,
      lifecycle: live.lifecycle,
      stage: live.stage,
      schedules: live.schedules,
    };
    return known.has(signature(liveState));
  }

  // Phase 3 can leave an owner at one of the explicitly planned release
  // hashes. A no-draft model auto-publishes the same version atomically.
  const releases = Array.isArray(recordPlan.allowedIntermediateHashes)
    ? recordPlan.allowedIntermediateHashes
    : [];
  if (releases.length) {
    states = states.flatMap(function (state) {
      return releases.map(function (releaseHash) {
        const next = clone(state);
        next.current = releaseHash;
        if (itemType && !itemType.draftModeActive) {
          next.published = releaseHash;
        }
        remember(next);
        return next;
      });
    });
  }

  // Phase 6 moves tree parents before version reconciliation.
  states = states.map(function (state) {
    const next = clone(state);
    if (next.parentId !== recordPlan.desired.topology.parentId) {
      next.parentId = recordPlan.desired.topology.parentId;
      remember(next);
    }
    return next;
  });

  // Phase 7 rebuilds the published version. Draft models expose a narrow
  // current-updated/published-old state between the locked update and publish.
  states = states.map(function (state) {
    const next = clone(state);
    const desiredPublished = recordPlan.desired.published
      ? recordPlan.desired.published.hash
      : null;
    if (next.published === desiredPublished) {
      return next;
    }
    if (desiredPublished === null) {
      next.published = null;
      remember(next);
      return next;
    }
    next.current = desiredPublished;
    if (itemType && itemType.draftModeActive) {
      remember(next);
      if (stableStringify(next.lifecycle) !== stableStringify(recordPlan.desired.lifecycle)) {
        next.lifecycle = recordPlan.desired.lifecycle;
        remember(next);
      }
      next.published = desiredPublished;
    } else {
      next.published = desiredPublished;
    }
    remember(next);
    return next;
  });

  // Phases 8, 10, and 11 restore current content, lifecycle, stage, and each
  // schedule in their actual call order.
  states = states.map(function (state) {
    const next = clone(state);
    if (next.current !== recordPlan.desired.current.hash) {
      next.current = recordPlan.desired.current.hash;
      if (itemType && !itemType.draftModeActive) {
        next.published = next.current;
      }
      remember(next);
    }
    if (stableStringify(next.lifecycle) !== stableStringify(recordPlan.desired.lifecycle)) {
      next.lifecycle = recordPlan.desired.lifecycle;
      remember(next);
    }
    if (next.stage !== recordPlan.desired.stage) {
      next.stage = recordPlan.desired.stage;
      remember(next);
    }
    for (const key of ['publication', 'unpublishing']) {
      if (stableStringify(next.schedules[key]) !== stableStringify(recordPlan.desired.schedules[key])) {
        next.schedules[key] = recordPlan.desired.schedules[key];
        remember(next);
      }
    }
    return next;
  });

  const liveState = {
    current: live.current.hash,
    published: live.published ? live.published.hash : null,
    parentId: live.topology.parentId,
    lifecycle: live.lifecycle,
    stage: live.stage,
    schedules: live.schedules,
  };
  return known.has(signature(liveState));
}

function isSafeUploadIntermediate(live, uploadPlan) {
  const candidates = [uploadPlan.baseline, uploadPlan.desired].filter(Boolean);
  if (candidates.some(function (candidate) { return sameUploadSemanticState(live, candidate); })) {
    return true;
  }
  if (!uploadPlan.desired || !uploadPlan.changes.binary) {
    return false;
  }

  if (uploadPlan.action === 'create') {
    // createFromLocalFile writes the desired binary and manual metadata in one
    // call; the fixed-point filename contract guarantees the derived basename
    // already equals the canonical desired basename.
    return sameUploadSemanticState(live, {
      md5: uploadPlan.desired.md5,
      filename: uploadPlan.desired.filename,
      basename: basenameFromFilename(uploadPlan.desired.filename),
      manual: uploadPlan.desired.manual,
    });
  }
  if (!uploadPlan.baseline) {
    return false;
  }

  // updateFromLocalFile atomically installs the complete desired binary name.
  // Baseline-null EXIF-backed fields carry a reserved nonblank sentinel so
  // server-side extraction cannot make the crash prefix nondeterministic. The
  // broad Cartesian product of baseline/desired components is not a
  // runtime-produced state and could otherwise mask a collaborator's edit.
  return sameUploadSemanticState(live, {
    md5: uploadPlan.desired.md5,
    filename: uploadPlan.desired.filename,
    basename: basenameFromFilename(uploadPlan.desired.filename),
    manual: uploadBinaryIntermediateManual(uploadPlan),
  });
}

function uploadBinaryIntermediateManual(uploadPlan) {
  const manual = Object.assign({}, uploadPlan.baseline.manual);
  for (const key of ['author', 'copyright', 'notes']) {
    if (manual[key] === null) manual[key] = UPLOAD_NULL_MANUAL_SENTINEL;
  }
  return manual;
}

function sameUploadSemanticState(live, expected) {
  return constantTimeEqualHex(live.md5, expected.md5) &&
    live.filename === expected.filename &&
    live.basename === (expected.basename || basenameFromFilename(expected.filename)) &&
    stableStringify(live.manual) === stableStringify(expected.manual);
}

function isSafeCollectionIntermediate(live, collectionPlan) {
  return Boolean(
    (collectionPlan.baseline && live.hash === collectionPlan.baseline.hash) ||
    live.hash === collectionPlan.desired.hash,
  );
}

const REMOVE_UNAVAILABLE_REFERENCE = Symbol('REMOVE_UNAVAILABLE_REFERENCE');
const UNWRAP_UNAVAILABLE_REFERENCE_CHILDREN = Symbol('UNWRAP_UNAVAILABLE_REFERENCE_CHILDREN');

function stripUnavailableReferences(fields, itemType, context, unavailable, path, allowRequiredShell) {
  if (!itemType) {
    throw runtimeError('SCHEMA_MISMATCH', 'No schema exists while preparing ' + path + '.');
  }
  const output = {};
  for (const field of itemType.fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, field.apiKey)) {
      continue;
    }
    const value = stripFieldReferenceValue(fields[field.apiKey], field, context, unavailable, path + '.' + field.apiKey, allowRequiredShell);
    output[field.apiKey] = value;
  }
  for (const key of Object.keys(fields)) {
    if (!Object.prototype.hasOwnProperty.call(output, key) && !itemType.fields.some(function (field) { return field.apiKey === key; })) {
      output[key] = fields[key];
    }
  }
  return output;
}

function stripFieldReferenceValue(value, field, context, unavailable, path, allowRequiredShell) {
  if (field.localized && isObject(value)) {
    const localized = {};
    for (const locale of Object.keys(value)) {
      const childField = Object.assign({}, field, { localized: false });
      const child = stripFieldReferenceValue(value[locale], childField, context, unavailable, path + '.' + locale, allowRequiredShell);
      localized[locale] = child;
    }
    return localized;
  }
  if (field.fieldType === 'link') {
    const id = referenceId(value);
    if (id && unavailable.has(id)) {
      if (fieldIsRequired(field) && !allowRequiredShell) {
        throw runtimeError('REQUIRED_REFERENCE_CYCLE', path + ' requires record ' + id + ' before it can be created.');
      }
      return null;
    }
    return value;
  }
  if (field.fieldType === 'links') {
    const filtered = Array.isArray(value) ? value.filter(function (entry) {
      const id = referenceId(entry);
      return !id || !unavailable.has(id);
    }) : value;
    if (Array.isArray(value) && filtered.length !== value.length && fieldIsRequired(field) && !allowRequiredShell) {
      throw runtimeError('REQUIRED_REFERENCE_CYCLE', path + ' contains references that cannot be seeded safely.');
    }
    return filtered;
  }
  if (field.fieldType === 'structured_text') {
    if (containsUnavailableStructuredTextRecordReference(value, unavailable) && fieldIsRequired(field) && !allowRequiredShell) {
      throw runtimeError('REQUIRED_REFERENCE_CYCLE', path + ' contains a required cyclic record reference.');
    }
    const stripped = stripStructuredTextReferences(value, context, unavailable, path, allowRequiredShell);
    return canonicalProjectedStructuredText(value, stripped);
  }
  if (['rich_text', 'single_block'].includes(field.fieldType)) {
    if (containsUnavailableTopRecordReference(value, unavailable) && fieldIsRequired(field) && !allowRequiredShell) {
      throw runtimeError('REQUIRED_REFERENCE_CYCLE', path + ' contains a required cyclic record reference.');
    }
    const stripped = stripNestedBlockReferences(value, context, unavailable, path, allowRequiredShell);
    return isUnwrappedUnavailableReferenceChildren(stripped)
      ? stripped.children
      : stripped === REMOVE_UNAVAILABLE_REFERENCE ? null : stripped;
  }
  return value;
}

function stripStructuredTextReferences(value, context, unavailable, path, allowRequiredShell) {
  if (!isObject(value) || !isObject(value.document)) return value;
  const strippedDocument = stripStructuredTextNodeReferences(
    value.document,
    context,
    unavailable,
    path + '.document',
    allowRequiredShell,
    value.schema === 'dast',
  );
  if (
    strippedDocument === REMOVE_UNAVAILABLE_REFERENCE ||
    isUnwrappedUnavailableReferenceChildren(strippedDocument)
  ) {
    return strippedDocument;
  }
  return Object.assign({}, value, { document: strippedDocument });
}

function stripStructuredTextNodeReferences(value, context, unavailable, path, allowRequiredShell, normalizeDast) {
  if (!isStructuredTextNode(value)) return value;
  if (value.type === 'inlineItem' && typeof value.item === 'string' && unavailable.has(value.item)) {
    return REMOVE_UNAVAILABLE_REFERENCE;
  }

  const strippedChildren = Array.isArray(value.children)
    ? value.children.flatMap(function (child, index) {
        const stripped = stripStructuredTextNodeReferences(
          child,
          context,
          unavailable,
          path + '.children[' + index + ']',
          allowRequiredShell,
          normalizeDast,
        );
        if (stripped === REMOVE_UNAVAILABLE_REFERENCE) return [];
        if (isUnwrappedUnavailableReferenceChildren(stripped)) return stripped.children;
        return [stripped];
      })
    : null;
  const normalizedChildren = strippedChildren && normalizeDast
    ? normalizeProjectedDastChildren(strippedChildren)
    : strippedChildren;

  if (value.type === 'itemLink' && typeof value.item === 'string' && unavailable.has(value.item)) {
    return {
      kind: UNWRAP_UNAVAILABLE_REFERENCE_CHILDREN,
      children: normalizedChildren || [],
    };
  }

  const output = Object.assign({}, value);
  if (normalizedChildren) output.children = normalizedChildren;
  if (
    (value.type === 'block' || value.type === 'inlineBlock') &&
    isObject(value.item) && isNestedItem(value.item)
  ) {
    const strippedItem = stripNestedBlockReferences(
      value.item,
      context,
      unavailable,
      path + '.item',
      allowRequiredShell,
    );
    if (
      strippedItem !== REMOVE_UNAVAILABLE_REFERENCE &&
      !isUnwrappedUnavailableReferenceChildren(strippedItem)
    ) {
      output.item = strippedItem;
    }
  }

  if (!normalizeDast) return output;
  if (Array.isArray(output.children) && output.children.length === 0) {
    return REMOVE_UNAVAILABLE_REFERENCE;
  }
  if (
    (output.type === 'link' || output.type === 'itemLink') &&
    Array.isArray(output.children) && output.children.length === 1 &&
    isEmptyDastSpan(output.children[0])
  ) {
    return { type: 'span', value: '' };
  }
  if (isEmptyDastSpan(output)) delete output.marks;
  return output;
}

function stripNestedBlockReferences(value, context, unavailable, path, allowRequiredShell) {
  if (Array.isArray(value)) {
    const children = value.flatMap(function (child, index) {
      const stripped = stripNestedBlockReferences(child, context, unavailable, path + '[' + index + ']', allowRequiredShell);
      if (stripped === REMOVE_UNAVAILABLE_REFERENCE) return [];
      if (isUnwrappedUnavailableReferenceChildren(stripped)) return stripped.children;
      return [stripped];
    });
    return normalizeProjectedDastChildren(children);
  }
  if (!isObject(value)) {
    return value;
  }
  if (value.type === 'inlineItem' && typeof value.item === 'string' && unavailable.has(value.item)) {
    return REMOVE_UNAVAILABLE_REFERENCE;
  }
  if (value.type === 'itemLink' && typeof value.item === 'string' && unavailable.has(value.item)) {
    const strippedChildren = stripNestedBlockReferences(
      Array.isArray(value.children) ? value.children : [],
      context,
      unavailable,
      path + '.children',
      allowRequiredShell,
    );
    return {
      kind: UNWRAP_UNAVAILABLE_REFERENCE_CHILDREN,
      children: Array.isArray(strippedChildren) ? strippedChildren : [],
    };
  }
  if (isNestedItem(value)) {
    const blockTypeId = itemTypeIdFromItem(value);
    const blockType = context.schemaById.get(blockTypeId);
    const rawAttributes = isObject(value.attributes) ? value.attributes : value;
    const blockFields = {};
    for (const key of Object.keys(rawAttributes)) {
      if (!['id', 'type', 'item_type', '__itemTypeId', 'relationships', 'attributes', 'meta', 'creator'].includes(key)) {
        blockFields[key] = rawAttributes[key];
      }
    }
    return {
      id: value.id,
      type: 'item',
      attributes: stripUnavailableReferences(blockFields, blockType, context, unavailable, path + '.block(' + value.id + ')', allowRequiredShell),
      relationships: {
        item_type: { data: entityRef('item_type', blockTypeId) },
      },
    };
  }
  const output = {};
  for (const key of Object.keys(value)) {
    const stripped = stripNestedBlockReferences(value[key], context, unavailable, path + '.' + key, allowRequiredShell);
    if (stripped !== REMOVE_UNAVAILABLE_REFERENCE) {
      output[key] = isUnwrappedUnavailableReferenceChildren(stripped)
        ? stripped.children
        : stripped;
    }
  }
  if (Array.isArray(output.children) && output.children.length === 0) {
    return REMOVE_UNAVAILABLE_REFERENCE;
  }
  if (
    (output.type === 'link' || output.type === 'itemLink') &&
    Array.isArray(output.children) && output.children.length === 1 &&
    isEmptyDastSpan(output.children[0])
  ) {
    return { type: 'span', value: '' };
  }
  if (isEmptyDastSpan(output)) {
    delete output.marks;
  }
  return output;
}

function isUnwrappedUnavailableReferenceChildren(value) {
  return isObject(value) && value.kind === UNWRAP_UNAVAILABLE_REFERENCE_CHILDREN;
}

function normalizeProjectedDastChildren(children) {
  const result = [];
  for (const child of children) {
    if (result.length > 0 && isEmptyDastSpan(result[result.length - 1])) {
      result.pop();
    }
    result.push(child);
    if (
      result.length >= 2 &&
      areMergeableDastSpans(result[result.length - 2], result[result.length - 1])
    ) {
      const right = result.pop();
      const left = result[result.length - 1];
      left.value = String(left.value) + String(right.value);
    }
    if (
      result.length >= 2 &&
      areMergeableDastLists(result[result.length - 2], result[result.length - 1])
    ) {
      const right = result.pop();
      const left = result[result.length - 1];
      left.children = left.children.concat(right.children);
    }
  }
  if (result.length > 1 && isEmptyDastSpan(result[result.length - 1])) {
    result.pop();
  }
  return result;
}

function areMergeableDastSpans(left, right) {
  if (!isObject(left) || !isObject(right) || left.type !== 'span' || right.type !== 'span') {
    return false;
  }
  if (typeof left.value !== 'string' || typeof right.value !== 'string') return false;
  const leftMarks = Array.isArray(left.marks) ? left.marks.map(String) : [];
  const rightMarks = Array.isArray(right.marks) ? right.marks.map(String) : [];
  return leftMarks.length === rightMarks.length && leftMarks.every(function (mark) {
    return rightMarks.includes(mark);
  });
}

function areMergeableDastLists(left, right) {
  return isObject(left) && isObject(right) && left.type === 'list' && right.type === 'list' &&
    left.style === right.style && Array.isArray(left.children) && Array.isArray(right.children);
}

function isEmptyDastSpan(value) {
  return isObject(value) && value.type === 'span' && value.value === '';
}

function canonicalProjectedStructuredText(original, stripped) {
  if (!isObject(original) || original.schema !== 'dast') {
    if (stripped === REMOVE_UNAVAILABLE_REFERENCE) return null;
    return isUnwrappedUnavailableReferenceChildren(stripped) ? stripped.children : stripped;
  }
  if (
    stripped === REMOVE_UNAVAILABLE_REFERENCE ||
    isUnwrappedUnavailableReferenceChildren(stripped) ||
    !isObject(stripped) || !isObject(stripped.document)
  ) {
    // Keep create-shell writes identical to the generator's canonical DAST
    // projection. Raw validateExisting payloads and real writes must observe
    // the same empty Structured Text value.
    return emptyDastValue();
  }
  return stripped;
}

function emptyDastValue() {
  return {
    schema: 'dast',
    document: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'span', value: '' }] }],
    },
  };
}

function containsUnavailableStructuredTextRecordReference(value, unavailable) {
  if (!isObject(value) || !isObject(value.document)) return false;
  return structuredTextNodeContainsUnavailableRecordReference(value.document, unavailable);
}

function structuredTextNodeContainsUnavailableRecordReference(value, unavailable) {
  if (!isStructuredTextNode(value)) return false;
  if ((value.type === 'inlineItem' || value.type === 'itemLink') && typeof value.item === 'string') {
    if (unavailable.has(value.item)) return true;
  }
  // References inside a real nested block are governed by the nested block's
  // own typed fields, not by the outer Structured Text validator.
  if (Array.isArray(value.children)) {
    return value.children.some(function (child) {
      return structuredTextNodeContainsUnavailableRecordReference(child, unavailable);
    });
  }
  return false;
}

function containsUnavailableTopRecordReference(value, unavailable) {
  if (Array.isArray(value)) {
    return value.some(function (child) { return containsUnavailableTopRecordReference(child, unavailable); });
  }
  if (!isObject(value)) {
    return false;
  }
  if ((value.type === 'inlineItem' || value.type === 'itemLink') && typeof value.item === 'string') {
    return unavailable.has(value.item);
  }
  if (isNestedItem(value)) {
    return false;
  }
  if (value.type === 'item' && typeof value.id === 'string' && !itemTypeIdFromItem(value)) {
    return unavailable.has(value.id);
  }
  return Object.values(value).some(function (child) { return containsUnavailableTopRecordReference(child, unavailable); });
}

function fieldIsRequired(field) {
  const validators = isObject(field.validators) ? field.validators : {};
  if (Object.prototype.hasOwnProperty.call(validators, 'required')) {
    return true;
  }
  const validatorKey = field.fieldType === 'structured_text' ? 'length' : 'size';
  const minimum = isObject(validators[validatorKey]) ? validators[validatorKey] : {};
  return (typeof minimum.min === 'number' && minimum.min > 0) ||
    (typeof minimum.eq === 'number' && minimum.eq > 0);
}

function referenceId(value) {
  if (typeof value === 'string') {
    return value;
  }
  return isObject(value) && typeof value.id === 'string' ? value.id : null;
}

function isStructuredTextNode(value) {
  return isObject(value) && typeof value.type === 'string' && value.type !== '';
}

function parentFirst(entries) {
  const byId = new Map(entries.map(function (entry) { return [entry.id, entry]; }));
  const depthCache = new Map();
  function depth(entry, visiting) {
    if (depthCache.has(entry.id)) {
      return depthCache.get(entry.id);
    }
    if (visiting.has(entry.id)) {
      throw runtimeError('TREE_CYCLE', 'Tree cycle includes record ' + entry.id + '.');
    }
    const next = new Set(visiting);
    next.add(entry.id);
    const parentId = entry.desired && entry.desired.topology.parentId;
    const parent = parentId ? byId.get(parentId) : null;
    const value = parent ? depth(parent, next) + 1 : 0;
    depthCache.set(entry.id, value);
    return value;
  }
  return entries.slice().sort(function (left, right) {
    return depth(left, new Set()) - depth(right, new Set()) || left.id.localeCompare(right.id);
  });
}

function childFirst(entries) {
  return parentFirst(entries).reverse();
}

function orderedPlans(order, entries) {
  const byId = new Map(entries.map(function (entry) { return [entry.id, entry]; }));
  const output = [];
  const seen = new Set();
  for (const id of order) {
    if (byId.has(id) && !seen.has(id)) {
      output.push(byId.get(id));
      seen.add(id);
    }
  }
  for (const entry of entries.slice().sort(function (left, right) { return left.id.localeCompare(right.id); })) {
    if (!seen.has(entry.id)) {
      output.push(entry);
    }
  }
  return output;
}

function itemTypeIdFromItem(value) {
  if (isObject(value.item_type) && typeof value.item_type.id === 'string') {
    return value.item_type.id;
  }
  if (
    isObject(value.relationships) &&
    isObject(value.relationships.item_type) &&
    isObject(value.relationships.item_type.data) &&
    typeof value.relationships.item_type.data.id === 'string'
  ) {
    return value.relationships.item_type.data.id;
  }
  return typeof value.__itemTypeId === 'string' ? value.__itemTypeId : '';
}

function nestedItemIdentity(value, path) {
  if (!isObject(value)) return null;
  const hasItemType = Object.prototype.hasOwnProperty.call(value, 'item_type');
  const hasRelationshipItemType = isObject(value.relationships) && Object.prototype.hasOwnProperty.call(value.relationships, 'item_type');
  const hasInternalItemType = Object.prototype.hasOwnProperty.call(value, '__itemTypeId');
  const claimsNestedItem = value.type === 'item' || (
    Object.prototype.hasOwnProperty.call(value, 'id') &&
    (hasItemType || hasRelationshipItemType || hasInternalItemType)
  );
  if (!claimsNestedItem) return null;
  if (value.type !== 'item' || typeof value.id !== 'string' || !value.id) {
    throw runtimeError('INVALID_CMA_RESPONSE', 'Nested content at ' + path + ' has a malformed item identity.');
  }
  const candidates = [];
  if (hasItemType) {
    if (!isObject(value.item_type) || typeof value.item_type.id !== 'string' || !value.item_type.id) {
      throw runtimeError('INVALID_CMA_RESPONSE', 'Nested item ' + value.id + ' has a malformed item_type identity.');
    }
    candidates.push(value.item_type.id);
  }
  if (hasRelationshipItemType) {
    const relationship = value.relationships.item_type;
    if (!isObject(relationship) || !isObject(relationship.data) || typeof relationship.data.id !== 'string' || !relationship.data.id) {
      throw runtimeError('INVALID_CMA_RESPONSE', 'Nested item ' + value.id + ' has a malformed relationships.item_type identity.');
    }
    candidates.push(relationship.data.id);
  }
  if (hasInternalItemType) {
    if (typeof value.__itemTypeId !== 'string' || !value.__itemTypeId) {
      throw runtimeError('INVALID_CMA_RESPONSE', 'Nested item ' + value.id + ' has a malformed __itemTypeId identity.');
    }
    candidates.push(value.__itemTypeId);
  }
  const uniqueIds = unique(candidates);
  if (uniqueIds.length !== 1) {
    throw runtimeError('INVALID_CMA_RESPONSE', 'Nested item ' + value.id + ' has missing or conflicting block model identities.', {
      blockId: value.id,
      itemTypeIds: uniqueIds.sort(),
    });
  }
  return { id: value.id, itemTypeId: uniqueIds[0] };
}

function isNestedItem(value) {
  return nestedItemIdentity(value, 'embedded content') !== null;
}

function entityRef(type, id) {
  return { id, type };
}

function sortLocalesObject(input, localeOrder) {
  if (!isObject(input)) {
    return canonicalizeJson(input);
  }
  const rank = new Map(localeOrder.map(function (locale, index) { return [locale, index]; }));
  const output = {};
  for (const key of Object.keys(input).filter(function (locale) { return input[locale] !== undefined; }).sort(function (left, right) {
    const leftRank = rank.has(left) ? rank.get(left) : Number.MAX_SAFE_INTEGER;
    const rightRank = rank.has(right) ? rank.get(right) : Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.localeCompare(right);
  })) {
    output[key] = canonicalizeJson(input[key]);
  }
  return output;
}

function compareFieldSnapshots(left, right) {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function compareNullable(left, right) {
  if (left === right) {
    return 0;
  }
  if (left === null || left === undefined) {
    return -1;
  }
  if (right === null || right === undefined) {
    return 1;
  }
  return String(left).localeCompare(String(right));
}

function canonicalizeJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw runtimeError('INVALID_JSON', 'Content contains a non-finite number.');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (isObject(value)) {
    const output = {};
    for (const key of Object.keys(value).filter(function (candidate) { return value[candidate] !== undefined; }).sort(function (left, right) { return left.localeCompare(right); })) {
      output[key] = canonicalizeJson(value[key]);
    }
    return output;
  }
  throw runtimeError('INVALID_JSON', 'Content contains a non-JSON value (' + typeof value + ').');
}

function stableStringify(value) {
  return JSON.stringify(canonicalizeJson(value));
}

function semanticHash(value) {
  return sha256(stableStringify(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function constantTimeEqualHex(left, right) {
  const normalizedLeft = String(left).toLowerCase();
  const normalizedRight = String(right).toLowerCase();
  if (!/^[a-f0-9]+$/.test(normalizedLeft) || !/^[a-f0-9]+$/.test(normalizedRight) || normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    difference |= normalizedLeft.charCodeAt(index) ^ normalizedRight.charCodeAt(index);
  }
  return difference === 0;
}

function requiredString(value, path) {
  if (typeof value !== 'string') {
    throw runtimeError('INVALID_CMA_RESPONSE', 'CMA response is missing ' + path + '.');
  }
  return value;
}

function requiredCmaBoolean(value, path) {
  if (typeof value !== 'boolean') {
    throw runtimeError('INVALID_CMA_RESPONSE', 'CMA response is missing boolean ' + path + '.');
  }
  return value;
}

function requiredTimestamp(value, path) {
  const input = requiredString(value, path);
  const milliseconds = Date.parse(input);
  if (!Number.isFinite(milliseconds)) {
    throw runtimeError('INVALID_CMA_RESPONSE', 'CMA response has an invalid timestamp at ' + path + '.');
  }
  return new Date(milliseconds).toISOString();
}

function requiredNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw runtimeError('INVALID_CMA_RESPONSE', 'CMA response is missing ' + path + '.');
  }
  return value;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(error) {
  if (!error) {
    return false;
  }
  if (error.response && error.response.status === 404) {
    return true;
  }
  if (Array.isArray(error.errors)) {
    return error.errors.some(function (entry) {
      return entry && ['NOT_FOUND', 'RECORD_NOT_FOUND', 'ITEM_NOT_FOUND'].includes(entry.code || entry.id);
    });
  }
  return false;
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every(function (value, index) { return value === right[index]; });
}

function applyPlanToIdSet(baselineIds, entries) {
  const ids = new Set(baselineIds);
  for (const entry of entries) {
    if (entry.desired) {
      ids.add(entry.id);
    } else {
      ids.delete(entry.id);
    }
  }
  return Array.from(ids).sort();
}

function unique(values) {
  return Array.from(new Set(values));
}

function safeFilename(id) {
  const value = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
  if (!value) {
    throw runtimeError('INVALID_UPLOAD_ID', 'Cannot derive a staging filename from upload ID ' + String(id) + '.');
  }
  return value;
}

function basenameFromFilename(filename) {
  const value = String(filename || '');
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  const dot = value.lastIndexOf('.');
  const stemEnd = dot > slash + 1 ? dot : value.length;
  return value.slice(slash + 1, stemEnd);
}

function compareUploadChanges(desired, baseline) {
  const desiredMetadata = {
    basename: desired.basename,
    filename: desired.filename,
    manual: Object.assign({}, desired.manual, { collectionId: null }),
  };
  const baselineMetadata = {
    basename: baseline.basename,
    filename: baseline.filename,
    manual: Object.assign({}, baseline.manual, { collectionId: null }),
  };
  return {
    binary: desired.md5 !== baseline.md5 || filenameExtension(desired.filename) !== filenameExtension(baseline.filename),
    metadata: stableStringify(desiredMetadata) !== stableStringify(baselineMetadata),
    collection: desired.manual.collectionId !== baseline.manual.collectionId,
  };
}

function uploadManualMetadataChanged(baseline, desired) {
  const baselineManual = Object.assign({}, baseline.manual, { collectionId: null });
  const desiredManual = Object.assign({}, desired.manual, { collectionId: null });
  return stableStringify(baselineManual) !== stableStringify(desiredManual);
}

function isUploadRequestFilenameFixedPoint(filename) {
  if (
    typeof filename !== 'string' ||
    filename.length === 0 ||
    filename.includes('/') ||
    filename.includes('\\') ||
    containsAsciiControl(filename)
  ) {
    return false;
  }
  const extension = filenameExtension(filename);
  const basename = basenameFromFilename(filename);
  const fixedPointPart = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
  if (!fixedPointPart.test(basename)) return false;
  if (extension && !fixedPointPart.test(extension.slice(1))) return false;
  return basename + extension === filename;
}

function uploadPlanRequiresFilenameRequest(uploadPlan) {
  if (uploadPlan.action === 'create') return true;
  if (uploadPlan.action !== 'update' || !uploadPlan.baseline || !uploadPlan.desired) return false;
  const changes = compareUploadChanges(uploadPlan.desired, uploadPlan.baseline);
  return changes.binary ||
    uploadPlan.baseline.basename !== uploadPlan.desired.basename ||
    uploadPlan.baseline.filename !== uploadPlan.desired.filename;
}

function uploadPlanRequiresBinaryTransfer(uploadPlan) {
  if (uploadPlan.action === 'create') return true;
  return uploadPlan.action === 'update' && Boolean(
    uploadPlan.baseline && uploadPlan.desired &&
    compareUploadChanges(uploadPlan.desired, uploadPlan.baseline).binary
  );
}

function expectedUploadPlanChanges(uploadPlan) {
  if (uploadPlan.action === 'create') {
    return { binary: true, metadata: true, collection: true };
  }
  if (uploadPlan.action === 'delete' || uploadPlan.action === 'noop') {
    return { binary: false, metadata: false, collection: false };
  }
  if (uploadPlan.action === 'update' && uploadPlan.baseline && uploadPlan.desired) {
    return compareUploadChanges(uploadPlan.desired, uploadPlan.baseline);
  }
  return null;
}

function uploadCollectionPlanContractError(collectionPlan) {
  if (!collectionPlan || !['create', 'update', 'noop'].includes(collectionPlan.action)) {
    return 'action is invalid';
  }
  if (collectionPlan.action === 'create' && !isPortableDatoId(collectionPlan.id)) {
    return 'create ID is not a portable DatoCMS ID';
  }
  const baseline = collectionPlan.baseline;
  const desired = collectionPlan.desired;
  if (
    (baseline && uploadCollectionSnapshotContractError(baseline)) ||
    !desired || uploadCollectionSnapshotContractError(desired)
  ) {
    return 'baseline or desired snapshot is malformed';
  }
  if (baseline && baseline.id !== collectionPlan.id) {
    return 'baseline ID does not match the plan ID';
  }
  if (desired.id !== collectionPlan.id) {
    return 'desired ID does not match the plan ID';
  }
  if (
    collectionPlan.action === 'create' &&
    (baseline !== null || collectionPlan.expectedTargetHash !== null)
  ) {
    return 'create action is inconsistent with baseline or expectedTargetHash';
  }
  if (
    collectionPlan.action === 'update' &&
    (!baseline || collectionPlan.expectedTargetHash !== baseline.hash)
  ) {
    return 'update action is inconsistent with baseline or expectedTargetHash';
  }
  if (
    collectionPlan.action === 'update' && baseline &&
    stableStringify(uploadCollectionSemanticState(baseline)) ===
      stableStringify(uploadCollectionSemanticState(desired))
  ) {
    return 'update action has no baseline/desired delta';
  }
  if (
    collectionPlan.action === 'noop' &&
    (!baseline || collectionPlan.expectedTargetHash !== baseline.hash ||
      stableStringify(uploadCollectionSemanticState(baseline)) !==
        stableStringify(uploadCollectionSemanticState(desired)))
  ) {
    return 'noop action does not contain identical baseline and desired state';
  }
  return null;
}

function deriveRequiredManageUploadCollections(collectionPlans) {
  return collectionPlans.length > 0;
}

function uploadCollectionOrderContractError(collectionPlans, collectionOrder) {
  const byId = new Map(collectionPlans.map(function (plan) { return [plan.id, plan]; }));
  const changedIds = collectionPlans.filter(function (plan) {
    return plan.action !== 'noop';
  }).map(function (plan) { return plan.id; }).sort();
  if (
    stableStringify(Array.from(new Set(collectionOrder)).sort()) !== stableStringify(changedIds) ||
    collectionOrder.length !== changedIds.length
  ) {
    return 'collectionOrder must contain every non-noop collection exactly once';
  }
  const live = new Map();
  for (const plan of collectionPlans) {
    if (plan.baseline) live.set(plan.id, plan.baseline);
  }
  for (const id of collectionOrder) {
    const plan = byId.get(id);
    if (!plan || plan.action === 'noop') {
      return 'collectionOrder contains invalid entry ' + id;
    }
    const desiredKey = uploadCollectionLabelKey(plan.desired);
    const occupant = Array.from(live.entries()).find(function (entry) {
      return entry[0] !== id && uploadCollectionLabelKey(entry[1]) === desiredKey;
    });
    if (occupant) {
      return 'collection ' + id + ' would claim label ' + JSON.stringify(plan.desired.label) +
        ' under parent ' + String(plan.desired.parentId) + ' while it is occupied by ' + occupant[0];
    }
    live.set(id, plan.desired);
  }
  return null;
}

function uploadCollectionSnapshotContractError(snapshot) {
  if (
    !isObject(snapshot) ||
    stableStringify(Object.keys(snapshot).sort()) !==
      stableStringify(['hash', 'id', 'label', 'parentId', 'position']) ||
    typeof snapshot.id !== 'string' || snapshot.id.length === 0 ||
    typeof snapshot.label !== 'string' || snapshot.label.trim().length === 0 ||
    (snapshot.parentId !== null &&
      (typeof snapshot.parentId !== 'string' || snapshot.parentId.length === 0)) ||
    !Number.isSafeInteger(snapshot.position) ||
    typeof snapshot.hash !== 'string'
  ) {
    return 'snapshot shape or scalar values are invalid';
  }
  return snapshot.hash === semanticHash(uploadCollectionSemanticState(snapshot))
    ? null
    : 'snapshot semantic hash does not match its state';
}

function uploadCollectionSemanticState(snapshot) {
  return {
    id: snapshot.id,
    label: snapshot.label,
    parentId: snapshot.parentId,
    position: snapshot.position,
  };
}

function uploadCollectionLabelKey(snapshot) {
  return String(snapshot.parentId || '') + '\u0000' + snapshot.label;
}

function uploadPlanContractError(uploadPlan, schema) {
  if (!uploadPlan || !['create', 'update', 'delete', 'noop'].includes(uploadPlan.action)) {
    return 'action is invalid';
  }
  const action = uploadPlan.action;
  const baseline = uploadPlan.baseline;
  const desired = uploadPlan.desired;
  if (action === 'create' && !isPortableDatoId(uploadPlan.id)) {
    return 'create ID is not a portable DatoCMS ID';
  }
  if (baseline && baseline.id !== uploadPlan.id) return 'baseline ID does not match the plan ID';
  if (desired && desired.id !== uploadPlan.id) return 'desired ID does not match the plan ID';
  if (
    (action === 'create' && (baseline !== null || !desired || uploadPlan.expectedTargetHash !== null)) ||
    (action === 'update' && (!baseline || !desired || uploadPlan.expectedTargetHash !== baseline.hash)) ||
    (action === 'delete' && (!baseline || desired !== null || uploadPlan.expectedTargetHash !== baseline.hash)) ||
    (action === 'noop' && (!baseline || !desired || baseline.hash !== desired.hash || uploadPlan.expectedTargetHash !== baseline.hash))
  ) {
    return 'action ' + action + ' is inconsistent with baseline, desired, or expectedTargetHash';
  }
  for (const entry of [['baseline', baseline], ['desired', desired]]) {
    const label = entry[0];
    const snapshot = entry[1];
    if (!snapshot) continue;
    if (
      stableStringify(Object.keys(snapshot).sort()) !== stableStringify([
        'basename', 'consistency', 'filename', 'hash', 'id', 'manual', 'md5',
        'mimeType', 'size', 'transport',
      ]) ||
      typeof snapshot.id !== 'string' || snapshot.id.length === 0 ||
      typeof snapshot.md5 !== 'string' || !/^[a-f0-9]{32}$/.test(snapshot.md5) ||
      typeof snapshot.basename !== 'string' || snapshot.basename.length === 0 ||
      typeof snapshot.filename !== 'string' || snapshot.filename.length === 0 ||
      typeof snapshot.hash !== 'string' ||
      !Number.isSafeInteger(snapshot.size) || snapshot.size < 0 ||
      (snapshot.mimeType !== null && typeof snapshot.mimeType !== 'string') ||
      uploadTransportContractError(snapshot.transport, false) !== null ||
      uploadConsistencyContractError(snapshot.consistency) !== null ||
      uploadManualContractError(snapshot, schema, false) !== null
    ) {
      return label + ' snapshot is malformed';
    }
    if (snapshot.basename !== basenameFromFilename(snapshot.filename)) {
      return label + ' basename does not match its filename stem';
    }
    if (snapshot.hash !== semanticHash({
      id: snapshot.id,
      md5: snapshot.md5,
      basename: snapshot.basename,
      filename: snapshot.filename,
      manual: snapshot.manual,
    })) {
      return label + ' semantic hash does not match its upload state';
    }
  }
  if (desired && uploadPlanRequiresDefaultFieldMetadataWrite(uploadPlan)) {
    const metadataError = uploadDefaultFieldMetadataContractError(
      desired.manual.defaultFieldMetadata,
      schema,
      desired,
      true
    );
    if (metadataError) {
      return 'desired defaultFieldMetadata is not safely writable: ' + metadataError;
    }
  }
  const expectedChanges = expectedUploadPlanChanges(uploadPlan);
  if (!expectedChanges || stableStringify(uploadPlan.changes) !== stableStringify(expectedChanges)) {
    return 'changes do not match the exact baseline/desired deltas';
  }
  if (action === 'update' && !Object.values(expectedChanges).some(Boolean)) {
    return 'update action has no baseline/desired delta';
  }
  if (desired && uploadPlanRequiresBinaryTransfer(uploadPlan) && uploadTransportContractError(desired.transport, true) !== null) {
    return 'desired binary transport is not an exact HTTP(S) or bundled source contract';
  }
  if (desired && uploadPlanRequiresFilenameRequest(uploadPlan) && !isUploadRequestFilenameFixedPoint(desired.filename)) {
    return 'desired filename is not a byte-stable UploadRequest normalization fixed point';
  }
  return null;
}

function uploadPlanRequiresDefaultFieldMetadataWrite(uploadPlan) {
  if (uploadPlan.action === 'create') return true;
  return uploadPlan.action === 'update' && Boolean(
    uploadPlan.baseline && uploadPlan.desired &&
    stableStringify(uploadPlan.baseline.manual.defaultFieldMetadata) !==
      stableStringify(uploadPlan.desired.manual.defaultFieldMetadata)
  );
}

function uploadManualContractError(snapshot, schema, requireWritableMetadata) {
  const value = snapshot.manual;
  if (!isObject(value)) return 'manual metadata must be an object';
  if (stableStringify(Object.keys(value).sort()) !== stableStringify([
    'author', 'collectionId', 'copyright', 'defaultFieldMetadata', 'notes', 'tags',
  ])) {
    return 'manual metadata keys are not exact';
  }
  for (const key of ['author', 'copyright', 'notes']) {
    if (value[key] !== null && typeof value[key] !== 'string') return key + ' is not string|null';
    if (typeof value[key] === 'string' && (isRubyBlank(value[key]) || value[key].includes('\u0000'))) {
      return key + ' is blank or contains NUL and cannot round-trip';
    }
  }
  if (value.collectionId !== null && (typeof value.collectionId !== 'string' || value.collectionId.length === 0)) {
    return 'collectionId is not string|null';
  }
  const metadataError = uploadDefaultFieldMetadataContractError(
    value.defaultFieldMetadata,
    schema,
    snapshot,
    requireWritableMetadata
  );
  if (metadataError) return metadataError;
  if (
    !Array.isArray(value.tags) || value.tags.some(function (tag) {
      return typeof tag !== 'string' || tag.length === 0 || containsAsciiControl(tag) ||
        tag !== rubySquish(tag).toLowerCase();
    }) ||
    stableStringify(value.tags) !== stableStringify(Array.from(new Set(value.tags)).sort())
  ) {
    return 'tags are not sorted unique strings';
  }
  return null;
}

function uploadDefaultFieldMetadataContractError(value, schema, snapshot, requireWritable) {
  if (!isObject(value)) return 'defaultFieldMetadata is not a plain JSON object';
  if (containsJsonNullByte(value)) {
    return 'defaultFieldMetadata contains a NUL byte that cannot be stored';
  }
  const locales = schema.locales;
  const localeKeys = locales.slice().sort();
  if (schema.environmentSemantics.nonLocalizedFocalPoints) {
    if (!hasExactKeys(value, ['alt', 'custom_data', 'focal_point', 'poster_time', 'title'])) {
      return 'defaultFieldMetadata field-keyed shape is not exact';
    }
    for (const key of ['alt', 'title']) {
      const localized = value[key];
      if (!isObject(localized) || !hasAllowedLocaleKeys(localized, localeKeys, requireWritable)) {
        return 'defaultFieldMetadata.' + key + ' locales are not ' +
          (requireWritable ? 'complete' : 'a canonical subset');
      }
      if (Object.values(localized).some(function (entry) {
        return entry !== null && (typeof entry !== 'string' || !isRubyStripFixedPoint(entry));
      })) {
        return 'defaultFieldMetadata.' + key + ' values are not canonical';
      }
    }
    const customData = value.custom_data;
    if (!isObject(customData) || !hasAllowedLocaleKeys(customData, localeKeys, requireWritable)) {
      return 'defaultFieldMetadata.custom_data locales are not ' +
        (requireWritable ? 'complete' : 'a canonical subset');
    }
    if (Object.values(customData).some(function (entry) {
      return !isObject(entry) || !isJsonValue(entry);
    })) {
      return 'defaultFieldMetadata.custom_data values are not JSON objects';
    }
    const focalPointError = uploadFocalPointContractError(value.focal_point, snapshot, requireWritable);
    if (focalPointError) return focalPointError;
    return uploadPosterTimeContractError(value.poster_time);
  }

  if (!hasAllowedLocaleKeys(value, localeKeys, requireWritable)) {
    return 'defaultFieldMetadata legacy locale set is not ' +
      (requireWritable ? 'complete' : 'a canonical subset');
  }
  let firstFocalPoint;
  let firstPosterTime;
  const presentLocales = Object.keys(value).sort();
  for (let index = 0; index < presentLocales.length; index += 1) {
    const locale = presentLocales[index];
    const entry = value[locale];
    if (!isObject(entry) || !hasExactKeys(entry, ['alt', 'custom_data', 'focal_point', 'poster_time', 'title'])) {
      return 'defaultFieldMetadata.' + locale + ' shape is not exact';
    }
    for (const key of ['alt', 'title']) {
      if (entry[key] !== null && (typeof entry[key] !== 'string' || !isRubyStripFixedPoint(entry[key]))) {
        return 'defaultFieldMetadata.' + locale + '.' + key + ' is not canonical';
      }
    }
    if (!isObject(entry.custom_data) || !isJsonValue(entry.custom_data)) {
      return 'defaultFieldMetadata.' + locale + '.custom_data is not a JSON object';
    }
    const focalPointError = uploadFocalPointContractError(entry.focal_point, snapshot, requireWritable);
    if (focalPointError) return focalPointError;
    const posterTimeError = uploadPosterTimeContractError(entry.poster_time);
    if (posterTimeError) return posterTimeError;
    if (index === 0) {
      firstFocalPoint = entry.focal_point;
      firstPosterTime = entry.poster_time;
    } else if (
      stableStringify(entry.focal_point) !== stableStringify(firstFocalPoint) ||
      stableStringify(entry.poster_time) !== stableStringify(firstPosterTime)
    ) {
      return 'defaultFieldMetadata legacy focal_point/poster_time values are not uniform';
    }
  }
  return null;
}

function uploadFocalPointContractError(value, snapshot, requireWritable) {
  if (value === null) return null;
  if (!isObject(value) || !hasExactKeys(value, ['x', 'y'])) {
    return 'defaultFieldMetadata focal_point is not exact';
  }
  for (const coordinate of [value.x, value.y]) {
    if (
      typeof coordinate !== 'number' || !Number.isFinite(coordinate) ||
      coordinate < 0 || coordinate > 1 || Math.round(coordinate * 100) / 100 !== coordinate
    ) {
      return 'defaultFieldMetadata focal_point coordinates are not canonical';
    }
  }
  const imgixExtensions = new Set([
    '.ai', '.avif', '.bmp', '.gif', '.heic', '.ico', '.icns', '.jpg', '.jpeg',
    '.pct', '.png', '.psd', '.tif', '.tiff', '.webp',
  ]);
  if (requireWritable && !imgixExtensions.has(filenameExtension(snapshot.filename).toLowerCase())) {
    return 'defaultFieldMetadata focal_point is unsupported for this upload format';
  }
  return null;
}

function hasAllowedLocaleKeys(value, locales, requireComplete) {
  const keys = Object.keys(value).sort();
  return requireComplete
    ? stableStringify(keys) === stableStringify(locales)
    : keys.every(function (key) { return locales.includes(key); });
}

function uploadPosterTimeContractError(value) {
  if (value === null) return null;
  if (
    typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
    Math.round(value * 1000) / 1000 !== value
  ) {
    return 'defaultFieldMetadata poster_time is not canonical';
  }
  return null;
}

function hasExactKeys(value, keys) {
  return stableStringify(Object.keys(value).sort()) === stableStringify(keys);
}

function isRubyStripFixedPoint(value) {
  return rubyStrip(value) === value;
}

function isRubyBlank(value) {
  return /^\p{White_Space}*$/u.test(value);
}

function rubySquish(value) {
  return rubyStrip(value.replace(/\p{White_Space}+/gu, ' '));
}

function rubyStrip(value) {
  const isStrippedByte = function (code) {
    return code === 0 || (code >= 9 && code <= 13) || code === 32;
  };
  let start = 0;
  let end = value.length;
  while (start < end && isStrippedByte(value.charCodeAt(start))) start += 1;
  while (end > start && isStrippedByte(value.charCodeAt(end - 1))) end -= 1;
  return value.slice(start, end);
}

function containsJsonNullByte(value) {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(containsJsonNullByte);
  if (!isObject(value)) return false;
  return Object.entries(value).some(function (entry) {
    return entry[0].includes('\u0000') || containsJsonNullByte(entry[1]);
  });
}

function isJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isObject(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function uploadTransportContractError(value, requireUsableSource) {
  if (!isObject(value)) return 'transport must be an object';
  if (stableStringify(Object.keys(value).sort()) !== stableStringify(['bundledPath', 'sha256', 'sourceUrl'])) {
    return 'transport keys are not exact';
  }
  const sourceUrl = value.sourceUrl;
  const bundledPath = value.bundledPath;
  const sha256 = value.sha256;
  if (typeof sourceUrl !== 'string') return 'sourceUrl is not a string';
  if (bundledPath !== null && typeof bundledPath !== 'string') return 'bundledPath is not string|null';
  if (sha256 !== null && typeof sha256 !== 'string') return 'sha256 is not string|null';
  const bundled = typeof bundledPath === 'string' && bundledPath.length > 0 &&
    !bundledPath.startsWith('/') && !/^[a-z]:/i.test(bundledPath) && !bundledPath.includes('\\') &&
    !containsAsciiControl(bundledPath) &&
    !bundledPath.split('/').some(function (part) { return part === '' || part === '.' || part === '..'; }) &&
    typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256);
  if ((bundledPath === null) !== (sha256 === null)) {
    return 'bundledPath and sha256 must be present together';
  }
  if (bundled) return null;
  if (bundledPath !== null || sha256 !== null) return 'bundled transport is malformed';
  if (!requireUsableSource) return null;
  return isAbsoluteHttpUrl(sourceUrl) ? null : 'sourceUrl is invalid';
}

function containsAsciiControl(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function isAbsoluteHttpUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
  } catch (_error) {
    return false;
  }
}

function uploadConsistencyContractError(value) {
  if (!isObject(value)) return 'consistency must be an object';
  if (stableStringify(Object.keys(value).sort()) !== stableStringify(['antivirusStatus', 'updatedAt'])) {
    return 'consistency keys are not exact';
  }
  if (value.updatedAt !== null && typeof value.updatedAt !== 'string') {
    return 'updatedAt is not string|null';
  }
  if (!['clean', 'skipped'].includes(String(value.antivirusStatus))) {
    return 'antivirusStatus is not terminal';
  }
  return null;
}

function deriveRequiredUploadActions(uploadPlans) {
  const actions = new Set(['read']);
  for (const uploadPlan of uploadPlans) {
    if (uploadPlan.action === 'create') actions.add('create');
    if (uploadPlan.action === 'delete') actions.add('delete');
    if (uploadPlan.action !== 'update' || !uploadPlan.baseline || !uploadPlan.desired) continue;
    const changes = compareUploadChanges(uploadPlan.desired, uploadPlan.baseline);
    if (
      uploadManualMetadataChanged(uploadPlan.baseline, uploadPlan.desired) ||
      (changes.binary && [
        'author', 'copyright', 'notes',
      ].some(function (key) {
        return uploadPlan.baseline.manual[key] === null &&
          uploadPlan.desired.manual[key] === null;
      }))
    ) {
      actions.add('update');
    }
    if (
      changes.binary ||
      uploadPlan.baseline.basename !== uploadPlan.desired.basename ||
      uploadPlan.baseline.filename !== uploadPlan.desired.filename
    ) {
      actions.add('replace_asset');
    }
    if (changes.collection) actions.add('move');
  }
  return ['read', 'create', 'update', 'replace_asset', 'move', 'delete'].filter(function (action) {
    return actions.has(action);
  });
}

function filenameExtension(filename) {
  const value = String(filename || '');
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  const dot = value.lastIndexOf('.');
  return dot > slash + 1 ? value.slice(dot) : '';
}

function uploadNeedsBinaryTransfer(live, desired) {
  return !live ||
    !constantTimeEqualHex(live.md5, desired.md5) ||
    filenameExtension(live.filename) !== filenameExtension(desired.filename);
}

function uploadManualUpdateNeedsFilenameWindow(live, desired) {
  return live.basename !== desired.basename || live.filename !== desired.filename;
}

function requirePathSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

function runtimeError(code, message, details) {
  return new ContentDiffRuntimeError(code, message, details);
}
`;
