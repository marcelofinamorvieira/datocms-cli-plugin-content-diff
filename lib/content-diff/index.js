"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateContentDiffMigration = generateContentDiffMigration;
exports.assertNoLegacyDestinationIdCollisions = assertNoLegacyDestinationIdCollisions;
exports.diagnoseInvalidSourceContent = diagnoseInvalidSourceContent;
exports.diagnoseDesiredContentAgainstDestination = diagnoseDesiredContentAgainstDestination;
exports.diagnoseDeletionCycleReleasesAgainstDestination = diagnoseDeletionCycleReleasesAgainstDestination;
exports.assertPublicationBoundarySafety = assertPublicationBoundarySafety;
exports.assertPublishedDeleteReleasesValid = assertPublishedDeleteReleasesValid;
exports.assertTransientDeleteReleaseIdsUnoccupied = assertTransientDeleteReleaseIdsUnoccupied;
exports.findDestinationIdCollisions = findDestinationIdCollisions;
exports.summarizeForCommand = summarizeForCommand;
const tslib_1 = require("tslib");
const canonicalize_1 = require("./canonicalize");
const dependencies_1 = require("./dependencies");
const inspection_schema_1 = require("./inspection-schema");
const legacy_ids_1 = require("./legacy-ids");
const permissions_1 = require("./permissions");
const plan_1 = require("./plan");
const schema_1 = require("./schema");
const snapshot_1 = require("./snapshot");
const types_1 = require("./types");
const types_2 = require("./types");
const validation_payload_1 = require("./validation-payload");
const write_artifacts_1 = require("./write-artifacts");
async function generateContentDiffMigration({ client, buildClientForEnvironment, sourceEnvironmentId, destinationEnvironmentId, migrationFilePath, format, options, }) {
    var _a, _b;
    if (sourceEnvironmentId === destinationEnvironmentId) {
        throw new Error('Source and destination environments must be different');
    }
    const contentDiffModelApiKey = (_a = options.contentDiffModelApiKey) !== null && _a !== void 0 ? _a : types_2.DEFAULT_CONTENT_DIFF_MODEL_API_KEY;
    const migrationsModelApiKey = (_b = options.migrationsModelApiKey) !== null && _b !== void 0 ? _b : 'schema_migration';
    if (migrationsModelApiKey === contentDiffModelApiKey) {
        throw new types_1.ContentDiffError('INVALID_SCOPE', `The migrations tracking model and internal content-diff ledger cannot both use API key ${contentDiffModelApiKey}. Configure a different migrations model API key.`, { contentDiffModelApiKey });
    }
    const [sourceClient, destinationClient] = await Promise.all([
        buildClientForEnvironment(sourceEnvironmentId),
        buildClientForEnvironment(destinationEnvironmentId),
    ]);
    const [sourceSchema, destinationSchema] = await Promise.all([
        (0, schema_1.fetchSchemaSnapshot)(sourceClient, sourceEnvironmentId),
        (0, schema_1.fetchSchemaSnapshot)(destinationClient, destinationEnvironmentId),
    ]);
    (0, schema_1.assertSameProject)(sourceSchema, destinationSchema);
    (0, legacy_ids_1.assertNoManagedRelationshipToMappingModel)(sourceSchema, contentDiffModelApiKey);
    (0, legacy_ids_1.assertNoManagedRelationshipToMappingModel)(destinationSchema, contentDiffModelApiKey);
    const sourceScopedSchema = (0, schema_1.schemaForScope)(sourceSchema, options.itemTypes, migrationsModelApiKey, contentDiffModelApiKey);
    let destinationScopedSchema;
    try {
        destinationScopedSchema = (0, schema_1.schemaForScope)(destinationSchema, options.itemTypes, migrationsModelApiKey, contentDiffModelApiKey);
    }
    catch (error) {
        if (error instanceof types_1.ContentDiffError && error.code === 'INVALID_SCOPE') {
            throw (0, schema_1.schemaMismatch)(sourceScopedSchema, destinationSchema);
        }
        throw error;
    }
    (0, schema_1.assertSchemasCompatible)(sourceScopedSchema, destinationScopedSchema);
    await Promise.all([
        (0, legacy_ids_1.readLegacyIdMappingRegistry)(sourceClient, sourceSchema, contentDiffModelApiKey, false),
        (0, legacy_ids_1.readLegacyIdMappingRegistry)(destinationClient, destinationSchema, contentDiffModelApiKey, false),
    ]);
    const sourceMigrationsModelId = (0, schema_1.migrationsTrackingModelId)(sourceSchema, migrationsModelApiKey);
    const destinationMigrationsModelId = (0, schema_1.migrationsTrackingModelId)(destinationSchema, migrationsModelApiKey);
    await Promise.all([
        (0, permissions_1.assertUnrestrictedReadAccess)(client, [sourceEnvironmentId], sourceSchema.itemTypes.filter(({ id }) => id !== sourceMigrationsModelId)),
        (0, permissions_1.assertUnrestrictedReadAccess)(client, [destinationEnvironmentId], destinationSchema.itemTypes.filter(({ id }) => id !== destinationMigrationsModelId)),
    ]);
    const scope = {
        itemTypes: options.itemTypes,
        uploads: options.uploads,
        migrationsModelApiKey,
        contentDiffModelApiKey,
    };
    const sourceSnapshot = await (0, snapshot_1.captureContentSnapshot)({
        client: sourceClient,
        environmentId: sourceEnvironmentId,
        schema: sourceSchema,
        scope,
        maxAttempts: 3,
        fullAccessVerified: true,
    });
    const legacyRegistry = await (0, legacy_ids_1.readLegacyIdMappingRegistry)(destinationClient, destinationSchema, contentDiffModelApiKey, true);
    const sourceUploadIds = new Set(Object.keys(sourceSnapshot.uploads));
    const sourceCollectionIds = new Set(Object.keys(sourceSnapshot.uploadCollections));
    const destinationSnapshot = await (0, snapshot_1.captureContentSnapshot)({
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
                    .filter(({ entityType, sourceId }) => entityType === 'upload' && sourceUploadIds.has(sourceId))
                    .map(({ targetId }) => targetId),
            ],
            baselineUploadCollectionIds: [
                ...sourceCollectionIds,
                ...legacyRegistry.entries
                    .filter(({ entityType, sourceId }) => entityType === 'upload_collection' &&
                    sourceCollectionIds.has(sourceId))
                    .map(({ targetId }) => targetId),
            ],
            allUploadCollections: true,
        },
        maxAttempts: 3,
        fullAccessVerified: true,
    });
    assertNoLegacyDestinationIdCollisions(await findDestinationIdCollisions(sourceSnapshot, destinationSnapshot, destinationClient));
    const legacyIdMappings = (0, legacy_ids_1.prepareLegacyIdMappings)(sourceSnapshot, destinationSnapshot, legacyRegistry);
    const externalLegacyRecordTargets = await inspectExistingLegacyRecordTargets(destinationClient, destinationSnapshot, legacyIdMappings);
    const normalizedSourceSnapshot = (0, legacy_ids_1.applyLegacyIdMappingsToSnapshot)(sourceSnapshot, legacyIdMappings);
    const legacyRecordTargets = new Map(legacyIdMappings.entries
        .filter(({ entityType }) => entityType === 'record')
        .map(({ sourceId, targetId }) => [sourceId, targetId]));
    const entityIdCollisions = await findDestinationIdCollisions(normalizedSourceSnapshot, destinationSnapshot, destinationClient);
    const structurallyInvalidSourceIds = new Set(sourceSnapshot.inspection.structuralIssues.map(({ recordId }) => recordId));
    const sourceItemTypesById = new Map(sourceSnapshot.schema.itemTypes.map((itemType) => [itemType.id, itemType]));
    const createCycleIntermediateCandidates = (0, dependencies_1.collectCreateCycleIntermediateCandidates)(Object.fromEntries(Object.entries(sourceSnapshot.records).filter(([id]) => !structurallyInvalidSourceIds.has(id))), (0, inspection_schema_1.contentTraversalSchema)(sourceSnapshot), new Set(Object.keys(sourceSnapshot.records).filter((id) => {
        var _a;
        return !(((_a = legacyRecordTargets.get(id)) !== null && _a !== void 0 ? _a : id) in destinationSnapshot.records);
    }))).filter(({ recordId, itemTypeId, topologyCycle }) => {
        if (topologyCycle)
            return false;
        const record = sourceSnapshot.records[recordId];
        const itemType = sourceItemTypesById.get(itemTypeId);
        return Boolean(record &&
            itemType &&
            (record.published ||
                !itemType.draftModeActive ||
                !itemType.draftSavingActive));
    });
    const runtimeUniqueIntermediateCandidates = options.migrateInvalidContent
        ? (0, dependencies_1.analyzeRuntimeCurrentUniqueTransitions)(sourceSnapshot, destinationSnapshot).conflicts.flatMap(({ recordId, phase }) => {
            var _a;
            const record = sourceSnapshot.records[recordId];
            const version = phase === 'current-restore'
                ? record === null || record === void 0 ? void 0 : record.current
                : phase === 'create-seed'
                    ? (_a = record === null || record === void 0 ? void 0 : record.published) !== null && _a !== void 0 ? _a : record === null || record === void 0 ? void 0 : record.current
                    : record === null || record === void 0 ? void 0 : record.published;
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
        ...new Map([
            ...createCycleIntermediateCandidates,
            ...runtimeUniqueIntermediateCandidates,
        ].map((candidate) => [
            `${candidate.recordId}\0${candidate.versionHash}`,
            candidate,
        ])).values(),
    ];
    const targetOnlyRecords = Object.fromEntries(Object.entries(destinationSnapshot.records).filter(([id]) => !normalizedSourceSnapshot.records[id]));
    const destinationTraversalSchema = (0, inspection_schema_1.contentTraversalSchema)(destinationSnapshot);
    const destinationItemTypes = new Map(destinationTraversalSchema.itemTypes.map((itemType) => [
        itemType.id,
        itemType,
    ]));
    const deletionCandidateOptions = {
        reservedItemIds: (0, dependencies_1.contentItemNamespaceIds)(normalizedSourceSnapshot, destinationSnapshot),
    };
    const requiredDeletionCycleReleaseCandidates = options.migrateInvalidContent && options.includeDeletions
        ? (0, dependencies_1.collectRequiredDeletionCycleReleaseCandidates)(targetOnlyRecords, destinationTraversalSchema, deletionCandidateOptions)
        : [];
    const optionalDeletionCycleReleaseCandidates = options.includeDeletions
        ? (0, dependencies_1.collectOptionalDeletionCycleReleaseCandidates)(targetOnlyRecords, destinationTraversalSchema, deletionCandidateOptions)
        : [];
    const requiredDeletionReleaseKeys = new Set(requiredDeletionCycleReleaseCandidates.flatMap(({ releases }) => releases.map(({ recordId, intermediateCurrentHash }) => `${recordId}\0${intermediateCurrentHash}`)));
    const deletionCycleReleaseCandidates = [
        ...requiredDeletionCycleReleaseCandidates,
        ...optionalDeletionCycleReleaseCandidates,
    ]
        // Published-derived releases that need fresh nested block IDs are
        // classified as fail-closed skips by the planner. Do not ask the raw
        // validation endpoint to diagnose a payload the CMA update path cannot
        // execute safely.
        .filter(({ releases }) => releases.every(({ transientNestedBlockIds }) => transientNestedBlockIds.length === 0))
        .flatMap(({ releases }) => releases)
        // Optional releases can still be strict writes even though they do not
        // publish explicitly: no-draft models auto-publish, and models with
        // invalid-draft saving disabled validate every update.
        .filter((release) => {
        if (requiredDeletionReleaseKeys.has(`${release.recordId}\0${release.intermediateCurrentHash}`)) {
            return true;
        }
        const record = targetOnlyRecords[release.recordId];
        const itemType = record
            ? destinationItemTypes.get(record.itemTypeId)
            : undefined;
        return Boolean(release.publish ||
            !(itemType === null || itemType === void 0 ? void 0 : itemType.draftModeActive) ||
            !itemType.draftSavingActive);
    });
    const [sourceDiagnostics, destinationDiagnostics, deletionCycleDiagnostics] = await Promise.all([
        // Source invalidity is authoritative even in default mode. These private,
        // read-only calls let the planner prove whether an invalid native draft
        // depends on a uniqueness peer that another safety rule will skip.
        diagnoseInvalidSourceContent(sourceClient, sourceSnapshot, intermediateCandidates),
        options.migrateInvalidContent
            ? diagnoseDesiredContentAgainstDestination(destinationClient, normalizedSourceSnapshot, destinationSnapshot)
            : Promise.resolve([]),
        deletionCycleReleaseCandidates.length > 0
            ? diagnoseDeletionCycleReleasesAgainstDestination(destinationClient, destinationSnapshot, deletionCycleReleaseCandidates)
            : Promise.resolve([]),
    ]);
    const resolvedInvalidContentDiagnostics = [
        ...(0, legacy_ids_1.remapInvalidContentDiagnostics)(sourceDiagnostics, sourceSnapshot, normalizedSourceSnapshot, destinationSnapshot, legacyIdMappings),
        ...destinationDiagnostics,
        ...deletionCycleDiagnostics,
    ];
    const plan = (0, plan_1.buildContentDiffPlan)(sourceSnapshot, destinationSnapshot, {
        includeDeletions: options.includeDeletions,
        uploads: options.uploads,
        migrationsModelApiKey,
        migrateInvalidContent: options.migrateInvalidContent,
        invalidContentDiagnostics: resolvedInvalidContentDiagnostics,
        entityIdCollisions,
        legacyIdMappings,
        externalLegacyRecordTargets,
        legacyIdMappingOccupiedItemIds: legacyRegistry.entries
            .filter(({ entityType }) => entityType === 'record' || entityType === 'block')
            .map(({ targetId }) => targetId),
    });
    await assertTransientDeleteReleaseIdsUnoccupied(destinationClient, plan.execution.deleteReleases);
    if (plan.requiredPermissions.editSchema) {
        await (0, permissions_1.assertCanEditSchema)(destinationClient);
    }
    await assertPublicationBoundarySafety(destinationClient, plan);
    await assertPublishedDeleteReleasesValid(destinationClient, plan.execution.deleteReleases, new Set(plan.invalidContent.validatorRelaxations.flatMap(({ affectedRecordIds }) => affectedRecordIds)), destinationSnapshot);
    const artifacts = await (0, write_artifacts_1.writeContentDiffArtifacts)({
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
function assertNoLegacyDestinationIdCollisions(collisions) {
    const legacyCollisions = collisions.filter(({ id }) => !(0, canonicalize_1.isPortableDatoId)(id));
    if (legacyCollisions.length === 0)
        return;
    throw new types_1.ContentDiffError('DUPLICATE_ENTITY_ID', `Legacy source IDs already belong to out-of-scope destination Items: ${legacyCollisions
        .map(({ id }) => id)
        .sort()
        .join(', ')}. Widen --item-types so the existing entities can be reconciled in place, or resolve the ID collision before generating a content migration.`, { entityIds: legacyCollisions.map(({ id }) => id).sort() });
}
async function inspectExistingLegacyRecordTargets(destinationClient, destination, mappings) {
    const visible = new Set(destination.visibleRecordIds);
    const candidates = mappings.entries.filter(({ entityType, status, targetId }) => entityType === 'record' && status === 'existing' && visible.has(targetId));
    const result = {};
    let cursor = 0;
    async function worker() {
        while (cursor < candidates.length) {
            const candidate = candidates[cursor];
            cursor += 1;
            let current;
            try {
                current = await destinationClient.items.find(candidate.targetId, {
                    version: 'current',
                    nested: false,
                });
            }
            catch (error) {
                if (isNotFoundError(error))
                    continue;
                throw error;
            }
            const itemTypeId = recordItemTypeId(current);
            if (!itemTypeId) {
                throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Mapped destination record ${candidate.targetId} has no authoritative item type.`, { targetId: candidate.targetId });
            }
            let published = false;
            try {
                const publishedRecord = await destinationClient.items.find(candidate.targetId, { version: 'published', nested: false });
                const publishedItemTypeId = recordItemTypeId(publishedRecord);
                if (publishedItemTypeId !== itemTypeId) {
                    throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Mapped destination record ${candidate.targetId} changed item type between current and published reads.`, { targetId: candidate.targetId });
                }
                published = true;
            }
            catch (error) {
                if (!isNotFoundError(error))
                    throw error;
            }
            result[candidate.targetId] = {
                itemTypeId,
                current: true,
                published,
            };
        }
    }
    await Promise.all(Array.from({ length: Math.min(5, candidates.length) }, () => worker()));
    return result;
}
function recordItemTypeId(value) {
    if (!value || typeof value !== 'object')
        return null;
    const record = value;
    const itemType = record.item_type;
    if (itemType && typeof itemType === 'object') {
        const id = itemType.id;
        if (typeof id === 'string')
            return id;
    }
    const relationships = record.relationships;
    if (!relationships || typeof relationships !== 'object')
        return null;
    const relationship = relationships.item_type;
    if (!relationship || typeof relationship !== 'object')
        return null;
    const data = relationship.data;
    if (!data || typeof data !== 'object')
        return null;
    const id = data.id;
    return typeof id === 'string' ? id : null;
}
/**
 * Runs private, non-mutating validation calls only for source slices whose CMA
 * validity flag is false. Unknown error shapes are retained as an explicit
 * contract diagnostic so the planner can skip the aggregate fail-closed.
 */
async function diagnoseInvalidSourceContent(sourceClient, source, intermediateCandidates = []) {
    const structurallyInvalidRecordIds = new Set(source.inspection.structuralIssues.map(({ recordId }) => recordId));
    const traversalSchema = (0, inspection_schema_1.contentTraversalSchema)(source);
    const tasks = Object.values(source.records)
        .sort((left, right) => left.id.localeCompare(right.id))
        .flatMap((record) => {
        if (structurallyInvalidRecordIds.has(record.id))
            return [];
        const values = [];
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
        .concat([...intermediateCandidates]
        .filter(({ recordId }) => !structurallyInvalidRecordIds.has(recordId))
        .sort((left, right) => left.recordId.localeCompare(right.recordId) ||
        left.versionHash.localeCompare(right.versionHash))
        .map(({ recordId, versionHash, fields }) => ({
        recordId,
        itemTypeId: source.records[recordId].itemTypeId,
        slice: 'intermediate',
        versionHash,
        fields,
    })));
    const diagnostics = new Array(tasks.length);
    let cursor = 0;
    async function worker() {
        while (cursor < tasks.length) {
            const index = cursor;
            cursor += 1;
            const task = tasks[index];
            try {
                await sourceClient.items.validateExisting(task.recordId, (0, validation_payload_1.buildRecordValidationPayload)(task.fields, task.itemTypeId, traversalSchema));
                diagnostics[index] = {
                    recordId: task.recordId,
                    slice: task.slice,
                    versionHash: task.versionHash,
                    valid: true,
                    issues: [],
                };
            }
            catch (error) {
                const issues = validationIssuesFromError(error);
                if (!issues)
                    throw error;
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
    await Promise.all(Array.from({ length: Math.min(5, tasks.length) }, () => worker()));
    return diagnostics;
}
/**
 * Diagnoses destination-side validator conflicts (notably unique-value
 * handoffs) for exact desired payloads of records that already exist there.
 * Source-only creates continue to use source-side shell diagnostics because
 * unavailable destination dependencies would make validateNew ambiguous.
 */
async function diagnoseDesiredContentAgainstDestination(destinationClient, source, destination) {
    const structurallyInvalidRecordIds = new Set(source.inspection.structuralIssues.map(({ recordId }) => recordId));
    const traversalSchema = (0, inspection_schema_1.contentTraversalSchema)(source);
    const tasks = Object.values(source.records)
        .sort((left, right) => left.id.localeCompare(right.id))
        .flatMap((record) => {
        var _a;
        if (structurallyInvalidRecordIds.has(record.id))
            return [];
        const baseline = destination.records[record.id];
        if (!baseline)
            return [];
        const values = [];
        if (record.current.hash !== baseline.current.hash) {
            values.push({
                recordId: record.id,
                itemTypeId: record.itemTypeId,
                slice: 'current',
                versionHash: record.current.hash,
                fields: record.current.fields,
            });
        }
        if (record.published &&
            record.published.hash !== ((_a = baseline.published) === null || _a === void 0 ? void 0 : _a.hash)) {
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
    const diagnostics = new Array(tasks.length);
    let cursor = 0;
    async function worker() {
        while (cursor < tasks.length) {
            const index = cursor;
            cursor += 1;
            const task = tasks[index];
            try {
                await destinationClient.items.validateExisting(task.recordId, (0, validation_payload_1.buildRecordValidationPayload)(task.fields, task.itemTypeId, traversalSchema));
                diagnostics[index] = {
                    recordId: task.recordId,
                    slice: task.slice,
                    versionHash: task.versionHash,
                    valid: true,
                    issues: [],
                };
            }
            catch (error) {
                const issues = validationIssuesFromError(error);
                if (!issues)
                    throw error;
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
    await Promise.all(Array.from({ length: Math.min(5, tasks.length) }, () => worker()));
    return diagnostics;
}
/**
 * Diagnoses the canonical intermediate versions used to release a
 * destination-only reference SCC before deletion. These payloads are
 * validated against the destination because the records do not exist in the
 * source environment.
 */
async function diagnoseDeletionCycleReleasesAgainstDestination(destinationClient, destination, releases) {
    const traversalSchema = (0, inspection_schema_1.contentTraversalSchema)(destination);
    const tasks = [...releases]
        .sort((left, right) => left.recordId.localeCompare(right.recordId))
        .map((release) => {
        const record = destination.records[release.recordId];
        if (!record) {
            throw new types_1.ContentDiffError('CONCURRENT_SNAPSHOT_CHANGE', `Deletion-cycle release owner ${release.recordId} disappeared after destination capture.`, { recordId: release.recordId });
        }
        return {
            recordId: release.recordId,
            itemTypeId: record.itemTypeId,
            versionHash: release.intermediateCurrentHash,
            fields: release.fields,
        };
    });
    const diagnostics = new Array(tasks.length);
    let cursor = 0;
    async function worker() {
        while (cursor < tasks.length) {
            const index = cursor;
            cursor += 1;
            const task = tasks[index];
            try {
                await destinationClient.items.validateExisting(task.recordId, (0, validation_payload_1.buildRecordValidationPayload)(task.fields, task.itemTypeId, traversalSchema));
                diagnostics[index] = {
                    recordId: task.recordId,
                    slice: 'intermediate',
                    versionHash: task.versionHash,
                    valid: true,
                    issues: [],
                };
            }
            catch (error) {
                const issues = validationIssuesFromError(error);
                if (!issues)
                    throw error;
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
    await Promise.all(Array.from({ length: Math.min(5, tasks.length) }, () => worker()));
    return diagnostics;
}
function validationIssuesFromError(error) {
    if (!error || typeof error !== 'object')
        return null;
    const candidate = error;
    const response = candidate.response && typeof candidate.response === 'object'
        ? candidate.response
        : null;
    const body = (response === null || response === void 0 ? void 0 : response.body) && typeof response.body === 'object'
        ? response.body
        : null;
    const errors = Array.isArray(candidate.errors)
        ? candidate.errors
        : Array.isArray(body === null || body === void 0 ? void 0 : body.errors)
            ? body.errors
            : null;
    if (!errors) {
        const status = response === null || response === void 0 ? void 0 : response.status;
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
        const raw = entry;
        const attributes = raw.attributes && typeof raw.attributes === 'object'
            ? raw.attributes
            : raw;
        const details = attributes.details && typeof attributes.details === 'object'
            ? (0, canonicalize_1.canonicalizeJson)(attributes.details)
            : {};
        const nestedCode = details.code;
        const topCode = attributes.code;
        const code = typeof nestedCode === 'string'
            ? nestedCode
            : typeof topCode === 'string' && topCode !== 'INVALID_FIELD'
                ? topCode
                : 'VALIDATION_CONTRACT_CHANGED';
        const nestedFieldId = details.field_id;
        const topFieldId = attributes.field_id;
        const fieldId = typeof nestedFieldId === 'string'
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
async function assertPublicationBoundarySafety(destinationClient, plan) {
    var _a, _b, _c;
    const recordPlansById = new Map(plan.records.map((recordPlan) => [recordPlan.id, recordPlan]));
    const publishOrderIndex = new Map(plan.execution.publishOrder.map((recordId, index) => [recordId, index]));
    const externalPublicationOwners = new Map();
    function requireExternalPublication(dependencyId, ownerRecordId) {
        var _a;
        if (dependencyId === ownerRecordId)
            return;
        const owners = (_a = externalPublicationOwners.get(dependencyId)) !== null && _a !== void 0 ? _a : new Set();
        owners.add(ownerRecordId);
        externalPublicationOwners.set(dependencyId, owners);
    }
    for (const recordPlan of plan.records) {
        if (!((_a = recordPlan.desired) === null || _a === void 0 ? void 0 : _a.published))
            continue;
        for (const dependencyId of recordPlan.publishedDependencies) {
            if (!recordPlansById.has(dependencyId)) {
                requireExternalPublication(dependencyId, recordPlan.id);
            }
        }
    }
    for (const release of plan.execution.deleteReleases.filter(({ publish }) => publish)) {
        const owner = recordPlansById.get(release.recordId);
        if (!(owner === null || owner === void 0 ? void 0 : owner.baseline)) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Published deletion release ${release.recordId} has no destination baseline.`, { recordId: release.recordId });
        }
        const releaseSnapshot = {
            ...owner.baseline,
            published: {
                fields: release.fields,
                hash: release.intermediateCurrentHash,
            },
        };
        for (const dependencyId of (0, dependencies_1.collectPublishedDependencyIds)(releaseSnapshot, plan.schema)) {
            if (dependencyId === release.recordId)
                continue;
            const dependencyPlan = recordPlansById.get(dependencyId);
            if (!dependencyPlan) {
                requireExternalPublication(dependencyId, release.recordId);
                continue;
            }
            const remainsPublishedBeforeDeleteIsland = Boolean(((_b = dependencyPlan.desired) === null || _b === void 0 ? void 0 : _b.published) ||
                (dependencyPlan.action === 'delete' &&
                    ((_c = dependencyPlan.baseline) === null || _c === void 0 ? void 0 : _c.published)));
            if (!remainsPublishedBeforeDeleteIsland) {
                throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Temporary deletion release ${release.recordId} depends on managed record ${dependencyId}, but that dependency will be unpublished before the deletion phase.`, { recordId: release.recordId, dependencyId });
            }
        }
    }
    const externalPublishedDependencyIds = [
        ...externalPublicationOwners.keys(),
    ].sort();
    const publicationBoundaryTargets = plan.records.filter((recordPlan) => {
        var _a, _b;
        return Boolean((_a = recordPlan.baseline) === null || _a === void 0 ? void 0 : _a.published) &&
            (recordPlan.action === 'delete' ||
                (Boolean(recordPlan.desired) &&
                    ((_b = recordPlan.desired) === null || _b === void 0 ? void 0 : _b.published) === null));
    });
    const checks = [
        ...externalPublishedDependencyIds.map((dependencyId) => async () => {
            var _a;
            try {
                await destinationClient.items.find(dependencyId, {
                    version: 'published',
                    nested: false,
                });
            }
            catch (error) {
                if (!isNotFoundError(error))
                    throw error;
                throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Desired or temporary published content references out-of-scope record ${dependencyId}, but that record has no published destination version. Publishing it could mutate content outside the selected scope.`, {
                    dependencyId,
                    requiredBy: [
                        ...((_a = externalPublicationOwners.get(dependencyId)) !== null && _a !== void 0 ? _a : []),
                    ].sort(),
                });
            }
        }),
        ...publicationBoundaryTargets.map((recordPlan) => async () => {
            var _a, _b;
            const referrers = await destinationClient.items.references(recordPlan.id, { version: 'published', nested: false });
            for (const referrer of referrers) {
                const referrerId = String((_a = referrer.id) !== null && _a !== void 0 ? _a : '');
                if (!referrerId || referrerId === recordPlan.id)
                    continue;
                const referrerPlan = recordPlansById.get(referrerId);
                const targetIndex = publishOrderIndex.get(recordPlan.id);
                const referrerIndex = publishOrderIndex.get(referrerId);
                const targetIsDeletion = recordPlan.action === 'delete';
                const referrerRunsFirst = targetIsDeletion ||
                    (referrerIndex !== undefined &&
                        targetIndex !== undefined &&
                        referrerIndex < targetIndex);
                const sameDeleteIsland = Boolean(targetIsDeletion && (referrerPlan === null || referrerPlan === void 0 ? void 0 : referrerPlan.action) === 'delete');
                const removesPublishedReference = Boolean(((_b = referrerPlan === null || referrerPlan === void 0 ? void 0 : referrerPlan.desired) === null || _b === void 0 ? void 0 : _b.published) &&
                    !referrerPlan.publishedDependencies.includes(recordPlan.id) &&
                    referrerPlan.action !== 'noop' &&
                    referrerRunsFirst);
                const unpublishesFirst = Boolean((referrerPlan === null || referrerPlan === void 0 ? void 0 : referrerPlan.desired) &&
                    referrerPlan.desired.published === null &&
                    referrerPlan.action !== 'noop' &&
                    referrerPlan.action !== 'delete' &&
                    referrerRunsFirst);
                if (sameDeleteIsland ||
                    removesPublishedReference ||
                    unpublishesFirst) {
                    continue;
                }
                throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', recordPlan.action === 'delete'
                    ? `Record ${recordPlan.id} cannot be deleted safely because published referrer ${referrerId} is outside the selected reconciliation or deletion island, or retains the reference.`
                    : `Record ${recordPlan.id} cannot be unpublished safely because published referrer ${referrerId} is outside the selected reconciliation order or retains the reference.`, { recordId: recordPlan.id, referrerId });
            }
        }),
    ];
    let cursor = 0;
    async function worker() {
        while (cursor < checks.length) {
            const check = checks[cursor];
            cursor += 1;
            await check();
        }
    }
    await Promise.all(Array.from({ length: Math.min(5, checks.length) }, () => worker()));
}
async function assertPublishedDeleteReleasesValid(destinationClient, releases, validatorRelaxedRecordIds = new Set(), destination) {
    var _a;
    const itemTypes = new Map((_a = destination === null || destination === void 0 ? void 0 : destination.schema.itemTypes.map((itemType) => [itemType.id, itemType])) !== null && _a !== void 0 ? _a : []);
    const strictReleases = releases.filter(({ publish, recordId }) => {
        if (validatorRelaxedRecordIds.has(recordId))
            return false;
        if (publish)
            return true;
        if (!destination)
            return false;
        const record = destination.records[recordId];
        const itemType = record ? itemTypes.get(record.itemTypeId) : undefined;
        return Boolean(!itemType || !itemType.draftModeActive || !itemType.draftSavingActive);
    });
    let cursor = 0;
    async function worker() {
        var _a, _b;
        while (cursor < strictReleases.length) {
            const release = strictReleases[cursor];
            cursor += 1;
            try {
                // `fields` is a complete request-compatible high-level item body. The
                // private validation endpoint is read-only and runs the same record
                // validators that a strict update or publication of the temporary
                // unlink state will run.
                await destinationClient.items.validateExisting(release.recordId, destination
                    ? (0, validation_payload_1.buildRecordValidationPayload)(release.fields, (_b = (_a = destination.records[release.recordId]) === null || _a === void 0 ? void 0 : _a.itemTypeId) !== null && _b !== void 0 ? _b : '', (0, inspection_schema_1.contentTraversalSchema)(destination))
                    : release.fields);
            }
            catch (error) {
                throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Record ${release.recordId} cannot pass strict validation after removing cyclic deletion references. No migration artifacts were written.`, {
                    recordId: release.recordId,
                    cause: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(5, strictReleases.length) }, () => worker()));
}
async function assertTransientDeleteReleaseIdsUnoccupied(destinationClient, releases) {
    const reservations = releases
        .flatMap(({ recordId, transientNestedBlockIds }) => transientNestedBlockIds.map((blockId) => ({ blockId, recordId })))
        .sort((left, right) => left.blockId.localeCompare(right.blockId) ||
        left.recordId.localeCompare(right.recordId));
    let cursor = 0;
    async function worker() {
        while (cursor < reservations.length) {
            const reservation = reservations[cursor];
            cursor += 1;
            try {
                await destinationClient.items.find(reservation.blockId, {
                    version: 'current',
                    nested: false,
                });
            }
            catch (error) {
                if (isNotFoundError(error))
                    continue;
                throw error;
            }
            throw new types_1.ContentDiffError('BLOCK_OWNERSHIP_CONFLICT', `Transient nested block ID ${reservation.blockId} planned for deletion release ${reservation.recordId} is already occupied in the destination. No migration artifacts were written.`, {
                blockId: reservation.blockId,
                recordId: reservation.recordId,
            });
        }
    }
    await Promise.all(Array.from({ length: Math.min(5, reservations.length) }, () => worker()));
}
async function findDestinationIdCollisions(source, destination, destinationClient) {
    const sourceOnlyEntities = [
        ...Object.keys(source.records)
            .filter((id) => !(id in destination.records))
            .map((id) => ({ id, kind: 'record', topRecordId: id })),
        ...Object.keys(source.blockOwnership)
            .filter((id) => !(id in destination.blockOwnership))
            .map((id) => ({
            id,
            kind: 'block',
            topRecordId: source.blockOwnership[id][0].topRecordId,
        })),
    ].sort((left, right) => left.id.localeCompare(right.id));
    const collisions = [];
    let cursor = 0;
    async function worker() {
        while (cursor < sourceOnlyEntities.length) {
            const entity = sourceOnlyEntities[cursor];
            cursor += 1;
            try {
                await destinationClient.items.find(entity.id, {
                    version: 'current',
                    nested: false,
                });
            }
            catch (error) {
                if (isNotFoundError(error)) {
                    continue;
                }
                throw error;
            }
            collisions.push(entity);
        }
    }
    await Promise.all(Array.from({ length: Math.min(5, sourceOnlyEntities.length) }, () => worker()));
    return collisions.sort((left, right) => left.topRecordId.localeCompare(right.topRecordId) ||
        left.id.localeCompare(right.id));
}
function isNotFoundError(error) {
    if (!error || typeof error !== 'object') {
        return false;
    }
    if ('response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'status' in error.response &&
        error.response.status === 404) {
        return true;
    }
    if (!('errors' in error) || !Array.isArray(error.errors)) {
        return false;
    }
    return error.errors.some((entry) => {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        const attributes = 'attributes' in entry &&
            entry.attributes &&
            typeof entry.attributes === 'object'
            ? entry.attributes
            : entry;
        const code = 'code' in attributes ? attributes.code : undefined;
        return (code === 'NOT_FOUND' ||
            code === 'RECORD_NOT_FOUND' ||
            code === 'ITEM_NOT_FOUND');
    });
}
function summarizeForCommand(plan) {
    const counts = {
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
        counts: Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))),
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
        skippedRecords: plan.invalidContent.skippedRecords.map(({ id, itemTypeId, disposition, reasons }) => ({
            id,
            itemTypeId,
            disposition,
            reasons: reasons.map(({ code, slice, dependencyId, dependencyChain }) => ({
                code,
                slice,
                ...(dependencyId ? { dependencyId } : {}),
                dependencyChain,
            })),
        })),
        validatorRelaxations: plan.invalidContent.validatorRelaxations.map(({ fieldId, itemTypeId, relaxedValidatorKeys, affectedRecordIds }) => ({
            fieldId,
            itemTypeId,
            relaxedValidatorKeys,
            affectedRecordIds,
        })),
        legacyIdMappings: plan.legacyIdMappings.entries.map(({ entityType, sourceId, targetId, status }) => ({
            entityType,
            sourceId,
            targetId,
            status,
        })),
        skippedLegacyIdMappings: plan.legacyIdMappings.skippedEntries.map(({ entityType, sourceId, reason }) => ({
            entityType,
            sourceId,
            reason,
        })),
    };
}
tslib_1.__exportStar(require("./canonicalize"), exports);
tslib_1.__exportStar(require("./dependencies"), exports);
tslib_1.__exportStar(require("./legacy-ids"), exports);
tslib_1.__exportStar(require("./permissions"), exports);
tslib_1.__exportStar(require("./plan"), exports);
tslib_1.__exportStar(require("./schema"), exports);
tslib_1.__exportStar(require("./snapshot"), exports);
tslib_1.__exportStar(require("./types"), exports);
tslib_1.__exportStar(require("./write-artifacts"), exports);
