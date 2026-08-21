"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeContentDiffArtifacts = writeContentDiffArtifacts;
exports.buildEnvelope = buildEnvelope;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_stream_1 = require("node:stream");
const promises_2 = require("node:stream/promises");
const canonicalize_1 = require("./canonicalize");
const create_id_contract_1 = require("./create-id-contract");
const create_sanitization_1 = require("./create-sanitization");
const dependencies_1 = require("./dependencies");
const fresh_nested_updates_1 = require("./fresh-nested-updates");
const inspection_schema_1 = require("./inspection-schema");
const runtime_template_1 = require("./runtime-template");
const types_1 = require("./types");
const upload_collection_contract_1 = require("./upload-collection-contract");
const upload_contract_1 = require("./upload-contract");
const CONTENT_DIRECTORY = '.datocms-content';
async function writeContentDiffArtifacts({ plan, migrationFilePath, format, bundleAssets, fetchFn = fetch, }) {
    const migrationsDirectory = (0, node_path_1.dirname)(migrationFilePath);
    const contentDirectory = (0, node_path_1.join)(migrationsDirectory, CONTENT_DIRECTORY);
    const migrationBasename = (0, node_path_1.basename)(migrationFilePath, `.${format}`);
    const planBasename = `${migrationBasename}.plan.json`;
    const assetsBasename = `${migrationBasename}.assets`;
    const planPath = (0, node_path_1.join)(contentDirectory, planBasename);
    const runtimePath = (0, node_path_1.join)(contentDirectory, `runtime-v${runtime_template_1.RUNTIME_VERSION}.${format}`);
    const assetsPath = (0, node_path_1.join)(contentDirectory, assetsBasename);
    const manifestPlan = clonePlan(plan);
    // Reject malformed or unauthorized plans before creating even a staging
    // directory, downloading an asset, or exposing a final artifact path.
    assertEnvelope(buildEnvelope(manifestPlan));
    await (0, promises_1.mkdir)(migrationsDirectory, { recursive: true });
    await refuseExisting(migrationFilePath, 'migration');
    await refuseExisting(planPath, 'content plan');
    if (bundleAssets) {
        await refuseExisting(assetsPath, 'bundled asset directory');
    }
    const stagingDirectory = await (0, promises_1.mkdtemp)((0, node_path_1.join)(migrationsDirectory, '.datocms-content-stage-'));
    const stagedMigrationPath = (0, node_path_1.join)(stagingDirectory, `${migrationBasename}.${format}`);
    const stagedPlanPath = (0, node_path_1.join)(stagingDirectory, planBasename);
    const stagedRuntimePath = (0, node_path_1.join)(stagingDirectory, `runtime-v${runtime_template_1.RUNTIME_VERSION}.${format}`);
    const stagedAssetsPath = (0, node_path_1.join)(stagingDirectory, assetsBasename);
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
        const manifestContents = `${JSON.stringify((0, canonicalize_1.canonicalizeJson)(envelope), null, 2)}\n`;
        const manifestSha256 = sha256(manifestContents);
        const runtimeContents = `${(0, runtime_template_1.renderRuntime)(format).trimEnd()}\n`;
        const entrypointContents = `${(0, runtime_template_1.renderEntrypoint)(format, planBasename, manifestSha256, manifestPlan.target.siteId).trimEnd()}\n`;
        // Validate everything before any final path becomes visible.
        assertEnvelope(JSON.parse(manifestContents));
        await (0, promises_1.writeFile)(stagedPlanPath, manifestContents, {
            encoding: 'utf8',
            flag: 'wx',
        });
        await (0, promises_1.writeFile)(stagedRuntimePath, runtimeContents, {
            encoding: 'utf8',
            flag: 'wx',
        });
        await (0, promises_1.writeFile)(stagedMigrationPath, entrypointContents, {
            encoding: 'utf8',
            flag: 'wx',
        });
        await (0, promises_1.mkdir)(contentDirectory, { recursive: true });
        await installImmutableRuntime(stagedRuntimePath, runtimePath, runtimeContents);
        if (bundleAssets) {
            await installDirectoryWithLinks(stagedAssetsPath, assetsPath);
            installedAssets = true;
        }
        await (0, promises_1.link)(stagedPlanPath, planPath);
        installedPlan = true;
        // The top-level migration is deliberately installed last: migrations:run
        // cannot discover an entrypoint whose dependencies are only half-written.
        await (0, promises_1.link)(stagedMigrationPath, migrationFilePath);
        installedMigration = true;
        return {
            migrationPath: migrationFilePath,
            planPath,
            runtimePath,
            ...(bundleAssets ? { assetsPath } : {}),
            manifestSha256,
        };
    }
    catch (error) {
        const cleanupErrors = [];
        if (installedMigration) {
            await (0, promises_1.unlink)(migrationFilePath).catch((cleanupError) => {
                cleanupErrors.push(cleanupError);
            });
        }
        if (installedPlan) {
            await (0, promises_1.unlink)(planPath).catch((cleanupError) => {
                cleanupErrors.push(cleanupError);
            });
        }
        if (installedAssets) {
            await (0, promises_1.rm)(assetsPath, { recursive: true, force: true }).catch((cleanupError) => {
                cleanupErrors.push(cleanupError);
            });
        }
        // A versioned runtime is shared by every migration of the same format.
        // Once exposed, never remove it during rollback: a concurrent generator
        // may already have reused the byte-identical file.
        if (cleanupErrors.length > 0) {
            throw Object.assign(new Error('Content migration generation failed and local artifact cleanup was incomplete.'), { cause: error, cleanupErrors });
        }
        throw error;
    }
    finally {
        // The staging directory is never referenced by installed artifacts. A
        // transient cleanup failure (for example, a Windows antivirus file lock)
        // must not turn an otherwise successful atomic install into a reported
        // generation failure or mask the original error.
        await (0, promises_1.rm)(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
}
function buildEnvelope(plan) {
    return {
        formatVersion: 10,
        runtimeVersion: runtime_template_1.RUNTIME_VERSION,
        integrity: {
            algorithm: 'sha256',
            planSha256: sha256((0, canonicalize_1.stableStringify)(plan)),
        },
        plan,
    };
}
function assertEnvelope(envelope) {
    if (envelope.formatVersion !== 10) {
        throw new Error(`Unsupported content plan envelope version: ${String(envelope.formatVersion)}`);
    }
    if (envelope.runtimeVersion !== runtime_template_1.RUNTIME_VERSION) {
        throw new Error(`Content plan requires runtime ${envelope.runtimeVersion}, expected ${runtime_template_1.RUNTIME_VERSION}`);
    }
    if (envelope.plan.formatVersion !== types_1.CONTENT_PLAN_FORMAT_VERSION) {
        throw new Error(`Unsupported content plan version: ${String(envelope.plan.formatVersion)}`);
    }
    if (envelope.plan.invalidContent.formatVersion !==
        types_1.INVALID_CONTENT_FORMAT_VERSION) {
        throw new Error(`Unsupported invalid-content plan version: ${String(envelope.plan.invalidContent.formatVersion)}`);
    }
    if (envelope.plan.legacyIdMappings.formatVersion !==
        types_1.LEGACY_ID_MAPPING_FORMAT_VERSION) {
        throw new Error(`Unsupported legacy-ID mapping plan version: ${String(envelope.plan.legacyIdMappings.formatVersion)}`);
    }
    const sourceSiteId = String(envelope.plan.source.siteId);
    const targetSiteId = String(envelope.plan.target.siteId);
    const { projectMode } = envelope.plan.options;
    if ((projectMode !== 'same_project' && projectMode !== 'aligned_projects') ||
        (projectMode === 'same_project' && sourceSiteId !== targetSiteId) ||
        (projectMode === 'aligned_projects' && sourceSiteId === targetSiteId)) {
        throw new Error(`Content plan project mode ${projectMode} is inconsistent with its source and destination projects`);
    }
    if (sourceSiteId === targetSiteId &&
        String(envelope.plan.source.environmentId) ===
            String(envelope.plan.target.environmentId)) {
        throw new Error('Content plan source and destination endpoints are equal');
    }
    if (String(envelope.plan.schema.siteId) !== sourceSiteId) {
        throw new Error('Content plan schema is not bound to its source project');
    }
    if (envelope.plan.invalidContent.migrateInvalidContent !==
        envelope.plan.options.migrateInvalidContent) {
        throw new Error('Content plan invalid-content options are inconsistent');
    }
    if (envelope.plan.invalidContent.validatorRelaxations.length > 0 &&
        envelope.plan.options.migrateInvalidContent !== true) {
        throw new Error('Content plan contains validator relaxations without --migrate-invalid-content authorization');
    }
    const recordSnapshotIdentityMismatches = (0, create_id_contract_1.findRecordSnapshotIdentityMismatches)(envelope.plan);
    if (recordSnapshotIdentityMismatches.length > 0) {
        throw new Error(`Content plan record snapshot identities do not match their plan identities: ${recordSnapshotIdentityMismatches.join(', ')}`);
    }
    const nonPortableCreateIds = (0, create_id_contract_1.findNonPortableCreateIds)(envelope.plan);
    if (nonPortableCreateIds.length > 0) {
        throw new Error(`Content plan contains non-portable IDs for CMA creates: ${nonPortableCreateIds.join(', ')}`);
    }
    const invalidUploadCollectionPlan = envelope.plan.uploadCollections
        .map((collection) => ({
        collection,
        error: (0, upload_collection_contract_1.uploadCollectionPlanContractError)(collection),
    }))
        .find(({ error }) => error !== null);
    if (invalidUploadCollectionPlan) {
        throw new Error(`Upload collection ${invalidUploadCollectionPlan.collection.id} has an invalid executable contract: ${invalidUploadCollectionPlan.error}`);
    }
    const uploadCollectionOrderError = (0, upload_collection_contract_1.uploadCollectionOrderContractError)(envelope.plan.uploadCollections, envelope.plan.execution.collectionOrder);
    if (uploadCollectionOrderError) {
        throw new Error(`Upload collection execution order is invalid: ${uploadCollectionOrderError}`);
    }
    const requiredManageUploadCollections = (0, upload_collection_contract_1.deriveRequiredManageUploadCollections)(envelope.plan.uploadCollections);
    if (envelope.plan.requiredPermissions.manageUploadCollections !==
        requiredManageUploadCollections) {
        throw new Error(`Content plan upload-collection permission does not match its exact operations: expected manageUploadCollections=${String(requiredManageUploadCollections)}`);
    }
    const invalidUploadPlan = envelope.plan.uploads
        .map((upload) => ({
        upload,
        error: (0, upload_contract_1.uploadPlanContractError)(upload, envelope.plan.schema),
    }))
        .find(({ error }) => error !== null);
    if (invalidUploadPlan) {
        throw new Error(`Upload ${invalidUploadPlan.upload.id} has an invalid executable contract: ${invalidUploadPlan.error}`);
    }
    const declaredUploadActions = envelope.plan.requiredPermissions.uploadActions;
    const derivedUploadActions = (0, upload_contract_1.deriveRequiredUploadActions)(envelope.plan.uploads);
    if ((0, canonicalize_1.stableStringify)(declaredUploadActions) !==
        (0, canonicalize_1.stableStringify)(derivedUploadActions)) {
        throw new Error(`Content plan upload permissions do not match its exact operations: expected ${derivedUploadActions.join(', ')}`);
    }
    const invalidUniqueRelease = findInvalidUniqueRelease(envelope.plan);
    if (invalidUniqueRelease) {
        throw new Error(`Unique-value release ${invalidUniqueRelease.recordId}.${invalidUniqueRelease.fieldApiKey} ${invalidUniqueRelease.reason} and cannot be serialized as an executable V10 content migration`);
    }
    const unsupportedFreshNestedUpdate = (0, fresh_nested_updates_1.findUnsupportedFreshNestedBlockUpdates)(envelope.plan.records)[0];
    if (unsupportedFreshNestedUpdate) {
        throw new Error(`Record ${unsupportedFreshNestedUpdate.recordId} would introduce fresh nested block ${unsupportedFreshNestedUpdate.blockId} during ${unsupportedFreshNestedUpdate.stage} and cannot be serialized as an executable V10 content migration`);
    }
    const unsupportedDeleteRelease = envelope.plan.execution.deleteReleases.find(({ transientNestedBlockIds }) => transientNestedBlockIds.length > 0);
    if (unsupportedDeleteRelease) {
        throw new Error(`Delete-reference release ${unsupportedDeleteRelease.recordId} requires fresh published-derived nested block IDs and cannot be serialized as an executable V10 content migration`);
    }
    const sanitizationRisk = sanitizedHtmlWriteRisks(envelope.plan)[0];
    if (sanitizationRisk) {
        throw new Error(`Record ${sanitizationRisk.recordId} field ${sanitizationRisk.fieldId} at ${sanitizationRisk.path} may be rewritten by CMA sanitized_html processing during ${sanitizationRisk.stage} and cannot be serialized as an exact content migration`);
    }
    const actualPlanSha256 = sha256((0, canonicalize_1.stableStringify)(envelope.plan));
    if (actualPlanSha256 !== envelope.integrity.planSha256) {
        throw new Error('Content plan integrity validation failed');
    }
}
function sanitizedHtmlWriteRisks(plan) {
    const createRecords = plan.records.filter((record) => record.action === 'create' && record.desired);
    const createRecordIds = new Set(createRecords.map(({ id }) => id));
    const createOrder = plan.execution.createOrder.filter((id) => createRecordIds.has(id));
    const shellRecordIds = new Set(plan.execution.shellRecordIds);
    const projected = new Map(createRecords.map((record) => [
        record.id,
        (0, dependencies_1.projectCreateSeedFields)(record.desired, plan.schema, createOrder, createRecordIds, shellRecordIds, plan.execution.shellComponents),
    ]));
    const relaxationsByFieldId = new Map(plan.invalidContent.validatorRelaxations.map((relaxation) => [
        relaxation.fieldId,
        relaxation,
    ]));
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
    return (0, create_sanitization_1.findSanitizedHtmlWriteRisks)(plan.records, (0, inspection_schema_1.schemaWithInspectionItemTypes)(phaseManagedSchema, plan.targetInspection.itemTypes), projected, {
        ...plan.execution,
        absoluteRecordPositionsReproducible: plan.options.includeDeletions ||
            !plan.warnings.some(({ code }) => code === 'ABSOLUTE_POSITION_NOT_REPRODUCIBLE'),
    });
}
function findInvalidUniqueRelease(plan) {
    for (const release of plan.execution.uniqueReleases) {
        const owner = plan.records.find(({ id }) => id === release.recordId);
        if (!owner || owner.action !== 'update') {
            return {
                recordId: release.recordId,
                fieldApiKey: '<owner>',
                reason: 'does not belong to an executable record update',
            };
        }
        const itemType = plan.schema.itemTypes.find(({ id }) => id === owner.itemTypeId);
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
            const field = itemType.fields.find(({ apiKey }) => apiKey === fieldApiKey);
            if (!field ||
                !['link', 'slug', 'string'].includes(field.fieldType) ||
                !Object.prototype.hasOwnProperty.call(field.validators, 'unique')) {
                return {
                    recordId: release.recordId,
                    fieldApiKey,
                    reason: 'does not resolve to a string, slug, or link field carrying a unique validator',
                };
            }
            if (!isUniqueReleaseScalarValue(release.fields[fieldApiKey], field.localized)) {
                return {
                    recordId: release.recordId,
                    fieldApiKey,
                    reason: 'contains a non-scalar or embedded value instead of string/null unique data',
                };
            }
        }
    }
    return null;
}
function isUniqueReleaseScalarValue(value, localized) {
    const isScalar = (candidate) => candidate === null || typeof candidate === 'string';
    if (!localized)
        return isScalar(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    return Object.values(value).every(isScalar);
}
async function bundleChangedAssets({ plan, assetsDirectory, assetsBasename, fetchFn, }) {
    const uploads = plan.uploads.filter((upload) => upload.desired &&
        upload.action !== 'delete' &&
        (upload.action === 'create' || upload.changes.binary));
    await (0, promises_1.mkdir)(assetsDirectory, { recursive: false });
    await mapWithConcurrency(uploads, 2, async (upload) => {
        const desired = upload.desired;
        const assetBasename = `${safeFilename(upload.id)}.bin`;
        const stagedPath = (0, node_path_1.join)(assetsDirectory, assetBasename);
        const hashes = await downloadAndHash(desired.transport.sourceUrl, stagedPath, fetchFn);
        if (hashes.md5.toLowerCase() !== desired.md5.toLowerCase()) {
            throw new Error(`Upload "${upload.id}" changed while bundling: expected MD5 ${desired.md5}, received ${hashes.md5}`);
        }
        // Manifest paths are portable across operating systems; the runtime
        // resolves the slash-separated path beneath the manifest directory.
        desired.transport.bundledPath = `${assetsBasename}/${assetBasename}`;
        desired.transport.sha256 = hashes.sha256;
    });
}
async function downloadAndHash(url, destination, fetchFn) {
    const response = await fetchFn(url);
    if (!response.ok) {
        throw new Error(`Cannot download upload binary (${response.status} ${response.statusText})`);
    }
    if (!response.body) {
        throw new Error('Cannot download upload binary: response has no body');
    }
    const md5 = (0, node_crypto_1.createHash)('md5');
    const sha = (0, node_crypto_1.createHash)('sha256');
    const hasher = new node_stream_1.Transform({
        transform(chunk, _encoding, callback) {
            md5.update(chunk);
            sha.update(chunk);
            callback(null, chunk);
        },
    });
    await (0, promises_2.pipeline)(node_stream_1.Readable.fromWeb(response.body), hasher, (0, node_fs_1.createWriteStream)(destination, { flags: 'wx' }));
    return { md5: md5.digest('hex'), sha256: sha.digest('hex') };
}
async function installImmutableRuntime(stagedPath, destinationPath, expectedContents) {
    try {
        await (0, promises_1.link)(stagedPath, destinationPath);
        return;
    }
    catch (error) {
        if (!isAlreadyExistsError(error)) {
            throw error;
        }
    }
    const existingContents = await (0, promises_1.readFile)(destinationPath, 'utf8');
    if (existingContents !== expectedContents) {
        throw new Error(`Refusing to overwrite mismatched immutable runtime "${(0, node_path_1.relative)(process.cwd(), destinationPath)}"`);
    }
}
async function installDirectoryWithLinks(sourceDirectory, destinationDirectory) {
    await (0, promises_1.mkdir)(destinationDirectory, { recursive: false });
    const sourceFiles = await (0, promises_1.readdir)(sourceDirectory);
    try {
        for (const sourceFile of sourceFiles) {
            await (0, promises_1.link)((0, node_path_1.join)(sourceDirectory, sourceFile), (0, node_path_1.join)(destinationDirectory, sourceFile));
        }
    }
    catch (error) {
        await (0, promises_1.rm)(destinationDirectory, { recursive: true, force: true });
        throw error;
    }
}
async function refuseExisting(path, label) {
    try {
        await (0, promises_1.access)(path, node_fs_1.constants.F_OK);
    }
    catch {
        return;
    }
    throw new Error(`Refusing to overwrite existing ${label} "${(0, node_path_1.relative)(process.cwd(), path)}"`);
}
async function mapWithConcurrency(values, concurrency, task) {
    let cursor = 0;
    async function worker() {
        while (cursor < values.length) {
            const index = cursor;
            cursor += 1;
            await task(values[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
}
function clonePlan(plan) {
    return JSON.parse(JSON.stringify(plan));
}
function sha256(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
}
function safeFilename(id) {
    const filename = id.replace(/[^A-Za-z0-9_-]/g, '_');
    if (!filename) {
        throw new Error(`Cannot derive a safe asset filename from upload ID "${id}"`);
    }
    return filename;
}
function isAlreadyExistsError(error) {
    return (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST');
}
