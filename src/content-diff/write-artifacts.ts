import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { canonicalizeJson, stableStringify } from './canonicalize';
import {
  findNonPortableCreateIds,
  findRecordSnapshotIdentityMismatches,
} from './create-id-contract';
import { findSanitizedHtmlWriteRisks } from './create-sanitization';
import { projectCreateSeedFields } from './dependencies';
import { findUnsupportedFreshNestedBlockUpdates } from './fresh-nested-updates';
import { schemaWithInspectionItemTypes } from './inspection-schema';
import {
  RUNTIME_VERSION,
  renderEntrypoint,
  renderRuntime,
} from './runtime-template';
import {
  CONTENT_PLAN_FORMAT_VERSION,
  type ContentDiffPlan,
  INVALID_CONTENT_FORMAT_VERSION,
  type JsonValue,
  LEGACY_ID_MAPPING_FORMAT_VERSION,
  type UploadSnapshot,
} from './types';
import {
  deriveRequiredManageUploadCollections,
  uploadCollectionOrderContractError,
  uploadCollectionPlanContractError,
} from './upload-collection-contract';
import {
  deriveRequiredUploadActions,
  uploadPlanContractError,
} from './upload-contract';

export interface ContentPlanEnvelope {
  formatVersion: 10;
  runtimeVersion: typeof RUNTIME_VERSION;
  integrity: {
    algorithm: 'sha256';
    planSha256: string;
  };
  plan: ContentDiffPlan;
}

export interface WriteContentDiffArtifactsInput {
  plan: ContentDiffPlan;
  migrationFilePath: string;
  format: 'js' | 'ts';
  bundleAssets: boolean;
  fetchFn?: typeof fetch;
}

export interface WrittenContentDiffArtifacts {
  migrationPath: string;
  planPath: string;
  runtimePath: string;
  assetsPath?: string;
  manifestSha256: string;
}

const CONTENT_DIRECTORY = '.datocms-content';

export async function writeContentDiffArtifacts({
  plan,
  migrationFilePath,
  format,
  bundleAssets,
  fetchFn = fetch,
}: WriteContentDiffArtifactsInput): Promise<WrittenContentDiffArtifacts> {
  const migrationsDirectory = dirname(migrationFilePath);
  const contentDirectory = join(migrationsDirectory, CONTENT_DIRECTORY);
  const migrationBasename = basename(migrationFilePath, `.${format}`);
  const planBasename = `${migrationBasename}.plan.json`;
  const assetsBasename = `${migrationBasename}.assets`;
  const planPath = join(contentDirectory, planBasename);
  const runtimePath = join(
    contentDirectory,
    `runtime-v${RUNTIME_VERSION}.${format}`,
  );
  const assetsPath = join(contentDirectory, assetsBasename);
  const manifestPlan = clonePlan(plan);

  // Reject malformed or unauthorized plans before creating even a staging
  // directory, downloading an asset, or exposing a final artifact path.
  assertEnvelope(buildEnvelope(manifestPlan));

  await mkdir(migrationsDirectory, { recursive: true });
  await refuseExisting(migrationFilePath, 'migration');
  await refuseExisting(planPath, 'content plan');

  if (bundleAssets) {
    await refuseExisting(assetsPath, 'bundled asset directory');
  }

  const stagingDirectory = await mkdtemp(
    join(migrationsDirectory, '.datocms-content-stage-'),
  );
  const stagedMigrationPath = join(
    stagingDirectory,
    `${migrationBasename}.${format}`,
  );
  const stagedPlanPath = join(stagingDirectory, planBasename);
  const stagedRuntimePath = join(
    stagingDirectory,
    `runtime-v${RUNTIME_VERSION}.${format}`,
  );
  const stagedAssetsPath = join(stagingDirectory, assetsBasename);

  let installedPlan = false;
  let installedAssets = false;
  let installedMigration = false;

  try {
    if (bundleAssets) {
      await bundleChangedAssets({
        plan: manifestPlan,
        assetsDirectory: stagedAssetsPath,
        assetsBasename,
        fetchFn,
      });
    }

    const envelope = buildEnvelope(manifestPlan);
    const manifestContents = `${JSON.stringify(
      canonicalizeJson(envelope as unknown as JsonValue),
      null,
      2,
    )}\n`;
    const manifestSha256 = sha256(manifestContents);
    const runtimeContents = `${renderRuntime(format).trimEnd()}\n`;
    const entrypointContents = `${renderEntrypoint(
      format,
      planBasename,
      manifestSha256,
      manifestPlan.target.siteId,
    ).trimEnd()}\n`;

    // Validate everything before any final path becomes visible.
    assertEnvelope(JSON.parse(manifestContents) as ContentPlanEnvelope);
    await writeFile(stagedPlanPath, manifestContents, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await writeFile(stagedRuntimePath, runtimeContents, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await writeFile(stagedMigrationPath, entrypointContents, {
      encoding: 'utf8',
      flag: 'wx',
    });

    await mkdir(contentDirectory, { recursive: true });

    await installImmutableRuntime(
      stagedRuntimePath,
      runtimePath,
      runtimeContents,
    );

    if (bundleAssets) {
      await installDirectoryWithLinks(stagedAssetsPath, assetsPath);
      installedAssets = true;
    }

    await link(stagedPlanPath, planPath);
    installedPlan = true;

    // The top-level migration is deliberately installed last: migrations:run
    // cannot discover an entrypoint whose dependencies are only half-written.
    await link(stagedMigrationPath, migrationFilePath);
    installedMigration = true;

    return {
      migrationPath: migrationFilePath,
      planPath,
      runtimePath,
      ...(bundleAssets ? { assetsPath } : {}),
      manifestSha256,
    };
  } catch (error) {
    const cleanupErrors: unknown[] = [];

    if (installedMigration) {
      await unlink(migrationFilePath).catch((cleanupError) => {
        cleanupErrors.push(cleanupError);
      });
    }

    if (installedPlan) {
      await unlink(planPath).catch((cleanupError) => {
        cleanupErrors.push(cleanupError);
      });
    }

    if (installedAssets) {
      await rm(assetsPath, { recursive: true, force: true }).catch(
        (cleanupError) => {
          cleanupErrors.push(cleanupError);
        },
      );
    }

    // A versioned runtime is shared by every migration of the same format.
    // Once exposed, never remove it during rollback: a concurrent generator
    // may already have reused the byte-identical file.
    if (cleanupErrors.length > 0) {
      throw Object.assign(
        new Error(
          'Content migration generation failed and local artifact cleanup was incomplete.',
        ),
        { cause: error, cleanupErrors },
      );
    }

    throw error;
  } finally {
    // The staging directory is never referenced by installed artifacts. A
    // transient cleanup failure (for example, a Windows antivirus file lock)
    // must not turn an otherwise successful atomic install into a reported
    // generation failure or mask the original error.
    await rm(stagingDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

export function buildEnvelope(plan: ContentDiffPlan): ContentPlanEnvelope {
  return {
    formatVersion: 10,
    runtimeVersion: RUNTIME_VERSION,
    integrity: {
      algorithm: 'sha256',
      planSha256: sha256(stableStringify(plan as unknown as JsonValue)),
    },
    plan,
  };
}

function assertEnvelope(envelope: ContentPlanEnvelope): void {
  if (envelope.formatVersion !== 10) {
    throw new Error(
      `Unsupported content plan envelope version: ${String(
        envelope.formatVersion,
      )}`,
    );
  }

  if (envelope.runtimeVersion !== RUNTIME_VERSION) {
    throw new Error(
      `Content plan requires runtime ${envelope.runtimeVersion}, expected ${RUNTIME_VERSION}`,
    );
  }

  if (envelope.plan.formatVersion !== CONTENT_PLAN_FORMAT_VERSION) {
    throw new Error(
      `Unsupported content plan version: ${String(
        envelope.plan.formatVersion,
      )}`,
    );
  }

  if (
    envelope.plan.invalidContent.formatVersion !==
    INVALID_CONTENT_FORMAT_VERSION
  ) {
    throw new Error(
      `Unsupported invalid-content plan version: ${String(
        envelope.plan.invalidContent.formatVersion,
      )}`,
    );
  }

  if (
    envelope.plan.legacyIdMappings.formatVersion !==
    LEGACY_ID_MAPPING_FORMAT_VERSION
  ) {
    throw new Error(
      `Unsupported legacy-ID mapping plan version: ${String(
        envelope.plan.legacyIdMappings.formatVersion,
      )}`,
    );
  }

  const sourceSiteId = String(envelope.plan.source.siteId);
  const targetSiteId = String(envelope.plan.target.siteId);
  const { projectMode } = envelope.plan.options;
  if (
    (projectMode !== 'same_project' && projectMode !== 'aligned_projects') ||
    (projectMode === 'same_project' && sourceSiteId !== targetSiteId) ||
    (projectMode === 'aligned_projects' && sourceSiteId === targetSiteId)
  ) {
    throw new Error(
      `Content plan project mode ${projectMode} is inconsistent with its source and destination projects`,
    );
  }
  if (
    sourceSiteId === targetSiteId &&
    String(envelope.plan.source.environmentId) ===
      String(envelope.plan.target.environmentId)
  ) {
    throw new Error('Content plan source and destination endpoints are equal');
  }
  if (String(envelope.plan.schema.siteId) !== sourceSiteId) {
    throw new Error('Content plan schema is not bound to its source project');
  }

  if (
    envelope.plan.invalidContent.migrateInvalidContent !==
    envelope.plan.options.migrateInvalidContent
  ) {
    throw new Error('Content plan invalid-content options are inconsistent');
  }

  if (
    envelope.plan.invalidContent.validatorRelaxations.length > 0 &&
    envelope.plan.options.migrateInvalidContent !== true
  ) {
    throw new Error(
      'Content plan contains validator relaxations without --migrate-invalid-content authorization',
    );
  }

  const recordSnapshotIdentityMismatches = findRecordSnapshotIdentityMismatches(
    envelope.plan,
  );
  if (recordSnapshotIdentityMismatches.length > 0) {
    throw new Error(
      `Content plan record snapshot identities do not match their plan identities: ${recordSnapshotIdentityMismatches.join(
        ', ',
      )}`,
    );
  }

  const nonPortableCreateIds = findNonPortableCreateIds(envelope.plan);
  if (nonPortableCreateIds.length > 0) {
    throw new Error(
      `Content plan contains non-portable IDs for CMA creates: ${nonPortableCreateIds.join(
        ', ',
      )}`,
    );
  }

  const invalidUploadCollectionPlan = envelope.plan.uploadCollections
    .map((collection) => ({
      collection,
      error: uploadCollectionPlanContractError(collection),
    }))
    .find(({ error }) => error !== null);
  if (invalidUploadCollectionPlan) {
    throw new Error(
      `Upload collection ${invalidUploadCollectionPlan.collection.id} has an invalid executable contract: ${invalidUploadCollectionPlan.error}`,
    );
  }
  const uploadCollectionOrderError = uploadCollectionOrderContractError(
    envelope.plan.uploadCollections,
    envelope.plan.execution.collectionOrder,
  );
  if (uploadCollectionOrderError) {
    throw new Error(
      `Upload collection execution order is invalid: ${uploadCollectionOrderError}`,
    );
  }
  const requiredManageUploadCollections = deriveRequiredManageUploadCollections(
    envelope.plan.uploadCollections,
  );
  if (
    envelope.plan.requiredPermissions.manageUploadCollections !==
    requiredManageUploadCollections
  ) {
    throw new Error(
      `Content plan upload-collection permission does not match its exact operations: expected manageUploadCollections=${String(
        requiredManageUploadCollections,
      )}`,
    );
  }

  const invalidUploadPlan = envelope.plan.uploads
    .map((upload) => ({
      upload,
      error: uploadPlanContractError(upload, envelope.plan.schema),
    }))
    .find(({ error }) => error !== null);
  if (invalidUploadPlan) {
    throw new Error(
      `Upload ${invalidUploadPlan.upload.id} has an invalid executable contract: ${invalidUploadPlan.error}`,
    );
  }

  const declaredUploadActions = envelope.plan.requiredPermissions.uploadActions;
  const derivedUploadActions = deriveRequiredUploadActions(
    envelope.plan.uploads,
  );
  if (
    stableStringify(declaredUploadActions) !==
    stableStringify(derivedUploadActions)
  ) {
    throw new Error(
      `Content plan upload permissions do not match its exact operations: expected ${derivedUploadActions.join(
        ', ',
      )}`,
    );
  }

  const invalidUniqueRelease = findInvalidUniqueRelease(envelope.plan);
  if (invalidUniqueRelease) {
    throw new Error(
      `Unique-value release ${invalidUniqueRelease.recordId}.${invalidUniqueRelease.fieldApiKey} ${invalidUniqueRelease.reason} and cannot be serialized as an executable V10 content migration`,
    );
  }

  const unsupportedFreshNestedUpdate = findUnsupportedFreshNestedBlockUpdates(
    envelope.plan.records,
  )[0];
  if (unsupportedFreshNestedUpdate) {
    throw new Error(
      `Record ${unsupportedFreshNestedUpdate.recordId} would introduce fresh nested block ${unsupportedFreshNestedUpdate.blockId} during ${unsupportedFreshNestedUpdate.stage} and cannot be serialized as an executable V10 content migration`,
    );
  }

  const unsupportedDeleteRelease = envelope.plan.execution.deleteReleases.find(
    ({ transientNestedBlockIds }) => transientNestedBlockIds.length > 0,
  );
  if (unsupportedDeleteRelease) {
    throw new Error(
      `Delete-reference release ${unsupportedDeleteRelease.recordId} requires fresh published-derived nested block IDs and cannot be serialized as an executable V10 content migration`,
    );
  }

  const sanitizationRisk = sanitizedHtmlWriteRisks(envelope.plan)[0];
  if (sanitizationRisk) {
    throw new Error(
      `Record ${sanitizationRisk.recordId} field ${sanitizationRisk.fieldId} at ${sanitizationRisk.path} may be rewritten by CMA sanitized_html processing during ${sanitizationRisk.stage} and cannot be serialized as an exact content migration`,
    );
  }

  const actualPlanSha256 = sha256(
    stableStringify(envelope.plan as unknown as JsonValue),
  );

  if (actualPlanSha256 !== envelope.integrity.planSha256) {
    throw new Error('Content plan integrity validation failed');
  }
}

function sanitizedHtmlWriteRisks(plan: ContentDiffPlan) {
  const createRecords = plan.records.filter(
    (record) => record.action === 'create' && record.desired,
  );
  const createRecordIds = new Set(createRecords.map(({ id }) => id));
  const createOrder = plan.execution.createOrder.filter((id) =>
    createRecordIds.has(id),
  );
  const shellRecordIds = new Set(plan.execution.shellRecordIds);
  const projected = new Map(
    createRecords.map((record) => [
      record.id,
      projectCreateSeedFields(
        record.desired!,
        plan.schema,
        createOrder,
        createRecordIds,
        shellRecordIds,
        plan.execution.shellComponents,
      ),
    ]),
  );
  const relaxationsByFieldId = new Map(
    plan.invalidContent.validatorRelaxations.map((relaxation) => [
      relaxation.fieldId,
      relaxation,
    ]),
  );
  const phaseManagedSchema = {
    ...plan.schema,
    itemTypes: plan.schema.itemTypes.map((itemType) => ({
      ...itemType,
      fields: itemType.fields.map((field) => {
        const relaxation = relaxationsByFieldId.get(field.id);
        return relaxation
          ? { ...field, validators: relaxation.relaxedValidators }
          : field;
      }),
    })),
  };
  return findSanitizedHtmlWriteRisks(
    plan.records,
    schemaWithInspectionItemTypes(
      phaseManagedSchema,
      plan.targetInspection.itemTypes,
    ),
    projected,
    {
      ...plan.execution,
      absoluteRecordPositionsReproducible:
        plan.options.includeDeletions ||
        !plan.warnings.some(
          ({ code }) => code === 'ABSOLUTE_POSITION_NOT_REPRODUCIBLE',
        ),
    },
  );
}

function findInvalidUniqueRelease(
  plan: ContentDiffPlan,
): { recordId: string; fieldApiKey: string; reason: string } | null {
  for (const release of plan.execution.uniqueReleases) {
    const owner = plan.records.find(({ id }) => id === release.recordId);
    if (!owner || owner.action !== 'update') {
      return {
        recordId: release.recordId,
        fieldApiKey: '<owner>',
        reason: 'does not belong to an executable record update',
      };
    }
    const itemType = plan.schema.itemTypes.find(
      ({ id }) => id === owner.itemTypeId,
    );
    if (!itemType) {
      return {
        recordId: release.recordId,
        fieldApiKey: '<item-type>',
        reason: 'does not belong to a managed item type',
      };
    }
    const fieldApiKeys = Object.keys(release.fields).sort();
    if (fieldApiKeys.length === 0) {
      return {
        recordId: release.recordId,
        fieldApiKey: '<empty>',
        reason: 'contains no field release',
      };
    }
    for (const fieldApiKey of fieldApiKeys) {
      const field = itemType.fields.find(
        ({ apiKey }) => apiKey === fieldApiKey,
      );
      if (
        !field ||
        !['link', 'slug', 'string'].includes(field.fieldType) ||
        !Object.prototype.hasOwnProperty.call(field.validators, 'unique')
      ) {
        return {
          recordId: release.recordId,
          fieldApiKey,
          reason:
            'does not resolve to a string, slug, or link field carrying a unique validator',
        };
      }
      if (
        !isUniqueReleaseScalarValue(
          release.fields[fieldApiKey],
          field.localized,
        )
      ) {
        return {
          recordId: release.recordId,
          fieldApiKey,
          reason:
            'contains a non-scalar or embedded value instead of string/null unique data',
        };
      }
    }
  }
  return null;
}

function isUniqueReleaseScalarValue(
  value: JsonValue,
  localized: boolean,
): boolean {
  const isScalar = (candidate: JsonValue): boolean =>
    candidate === null || typeof candidate === 'string';
  if (!localized) return isScalar(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(isScalar);
}

async function bundleChangedAssets({
  plan,
  assetsDirectory,
  assetsBasename,
  fetchFn,
}: {
  plan: ContentDiffPlan;
  assetsDirectory: string;
  assetsBasename: string;
  fetchFn: typeof fetch;
}): Promise<void> {
  const uploads = plan.uploads.filter(
    (upload) =>
      upload.desired &&
      upload.action !== 'delete' &&
      (upload.action === 'create' || upload.changes.binary),
  );

  await mkdir(assetsDirectory, { recursive: false });

  await mapWithConcurrency(uploads, 2, async (upload) => {
    const desired = upload.desired as UploadSnapshot;
    const assetBasename = `${safeFilename(upload.id)}.bin`;
    const stagedPath = join(assetsDirectory, assetBasename);
    const hashes = await downloadAndHash(
      desired.transport.sourceUrl,
      stagedPath,
      fetchFn,
    );

    if (hashes.md5.toLowerCase() !== desired.md5.toLowerCase()) {
      throw new Error(
        `Upload "${upload.id}" changed while bundling: expected MD5 ${desired.md5}, received ${hashes.md5}`,
      );
    }

    // Manifest paths are portable across operating systems; the runtime
    // resolves the slash-separated path beneath the manifest directory.
    desired.transport.bundledPath = `${assetsBasename}/${assetBasename}`;
    desired.transport.sha256 = hashes.sha256;
  });
}

async function downloadAndHash(
  url: string,
  destination: string,
  fetchFn: typeof fetch,
): Promise<{ md5: string; sha256: string }> {
  const response = await fetchFn(url);

  if (!response.ok) {
    throw new Error(
      `Cannot download upload binary (${response.status} ${response.statusText})`,
    );
  }

  if (!response.body) {
    throw new Error('Cannot download upload binary: response has no body');
  }

  const md5 = createHash('md5');
  const sha = createHash('sha256');
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      md5.update(chunk);
      sha.update(chunk);
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as never),
    hasher,
    createWriteStream(destination, { flags: 'wx' }),
  );

  return { md5: md5.digest('hex'), sha256: sha.digest('hex') };
}

async function installImmutableRuntime(
  stagedPath: string,
  destinationPath: string,
  expectedContents: string,
): Promise<void> {
  try {
    await link(stagedPath, destinationPath);
    return;
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  }

  const existingContents = await readFile(destinationPath, 'utf8');

  if (existingContents !== expectedContents) {
    throw new Error(
      `Refusing to overwrite mismatched immutable runtime "${relative(
        process.cwd(),
        destinationPath,
      )}"`,
    );
  }
}

async function installDirectoryWithLinks(
  sourceDirectory: string,
  destinationDirectory: string,
): Promise<void> {
  await mkdir(destinationDirectory, { recursive: false });
  const sourceFiles = await readdir(sourceDirectory);

  try {
    for (const sourceFile of sourceFiles) {
      await link(
        join(sourceDirectory, sourceFile),
        join(destinationDirectory, sourceFile),
      );
    }
  } catch (error) {
    await rm(destinationDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function refuseExisting(path: string, label: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch {
    return;
  }

  throw new Error(
    `Refusing to overwrite existing ${label} "${relative(
      process.cwd(),
      path,
    )}"`,
  );
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await task(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );
}

function clonePlan(plan: ContentDiffPlan): ContentDiffPlan {
  return JSON.parse(JSON.stringify(plan)) as ContentDiffPlan;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeFilename(id: string): string {
  const filename = id.replace(/[^A-Za-z0-9_-]/g, '_');

  if (!filename) {
    throw new Error(
      `Cannot derive a safe asset filename from upload ID "${id}"`,
    );
  }

  return filename;
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}
