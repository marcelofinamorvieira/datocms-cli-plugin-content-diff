"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFELY_RELAXABLE_VALIDATOR_KEYS = void 0;
exports.buildContentDiffPlan = buildContentDiffPlan;
exports.summarizeContentDiffPlan = summarizeContentDiffPlan;
const canonicalize_1 = require("./canonicalize");
const create_defaults_1 = require("./create-defaults");
const create_sanitization_1 = require("./create-sanitization");
const dependencies_1 = require("./dependencies");
const fresh_nested_updates_1 = require("./fresh-nested-updates");
const inspection_schema_1 = require("./inspection-schema");
const legacy_ids_1 = require("./legacy-ids");
const schema_1 = require("./schema");
const upload_collection_contract_1 = require("./upload-collection-contract");
const upload_contract_1 = require("./upload-contract");
exports.SAFELY_RELAXABLE_VALIDATOR_KEYS = [
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
];
const SAFELY_RELAXABLE_VALIDATOR_KEY_SET = new Set(exports.SAFELY_RELAXABLE_VALIDATOR_KEYS);
const types_1 = require("./types");
function buildContentDiffPlan(sourceInput, targetInput, options) {
    var _a, _b;
    assertSnapshotCompatibility(sourceInput, targetInput, options);
    assertUploadFilenameBasenames(sourceInput, 'source');
    assertUploadFilenameBasenames(targetInput, 'target');
    const migrateInvalidContent = options.migrateInvalidContent === true;
    const migrationsModelApiKey = (_a = options.migrationsModelApiKey) !== null && _a !== void 0 ? _a : 'schema_migration';
    const originalSource = sourceInput;
    const originalTarget = targetInput;
    const tentativeLegacyIdMappings = (_b = options.legacyIdMappings) !== null && _b !== void 0 ? _b : (0, legacy_ids_1.emptyLegacyIdMappingPlan)(sourceInput);
    const normalizedSource = (0, legacy_ids_1.applyLegacyIdMappingsToSnapshot)(sourceInput, tentativeLegacyIdMappings);
    const reservedItemIds = (0, dependencies_1.contentItemNamespaceIds)(normalizedSource, targetInput);
    const invalidContent = prepareInvalidContent(normalizedSource, targetInput, options, reservedItemIds);
    const source = invalidContent.source;
    const target = invalidContent.target;
    const sourceTraversalSchema = (0, inspection_schema_1.contentTraversalSchema)(source);
    const targetTraversalSchema = (0, inspection_schema_1.contentTraversalSchema)(target);
    const legacyIdMappings = (0, legacy_ids_1.finalizeLegacyIdMappingPlan)(tentativeLegacyIdMappings, source, target, options.externalLegacyRecordTargets, options.legacyIdMappingOccupiedItemIds, normalizedSource, invalidContent.skippedRecords);
    (0, dependencies_1.assertCompatibleBlockOwnership)(source.blockOwnership, target.blockOwnership);
    (0, dependencies_1.assertSingletonIdsMatch)(source, target);
    assertNoRecordBlockIdCollisions(source);
    assertNoOutOfScopeRecordIdCollisions(source, target);
    assertPortableNewIds(source, target);
    const sourceIds = new Set(Object.keys(source.records));
    const allReferences = Object.values(source.records).flatMap((record) => (0, dependencies_1.collectRecordReferences)(record, sourceTraversalSchema));
    (0, dependencies_1.assertExternalReferencesExist)(allReferences, sourceIds, new Set(target.visibleRecordIds));
    const planningSource = {
        ...source,
        schema: (0, inspection_schema_1.schemaWithInspectionItemTypes)(invalidContent.relaxedSchema, source.inspection.itemTypes),
    };
    const planningTarget = {
        ...target,
        schema: (0, inspection_schema_1.schemaWithInspectionItemTypes)(invalidContent.relaxedSchema, target.inspection.itemTypes),
    };
    const uniqueReleaseAnalysis = (0, dependencies_1.analyzeUniqueReleases)(planningSource, planningTarget, options.includeDeletions);
    const publishedUniqueDependencies = (0, dependencies_1.buildPublishedUniqueDependencies)(planningSource, planningTarget, options.includeDeletions);
    const creationRecordIds = new Set(Object.keys(source.records).filter((id) => !(id in target.records)));
    const dependencyGraph = (0, dependencies_1.buildRecordDependencyGraph)(source.records, planningSource.schema, uniqueReleaseAnalysis.dependencies, creationRecordIds, invalidContent.supportedShellRecordIds);
    assertNoDraftCreateSeedSafety(source, target, creationRecordIds, dependencyGraph.createOrder);
    const warnings = [...invalidContent.warnings];
    if (legacyIdMappings.entries.length > 0) {
        warnings.push({
            code: 'LEGACY_ID_REMAP',
            message: `${legacyIdMappings.entries.length} legacy identifier${legacyIdMappings.entries.length === 1 ? '' : 's'} detected. Legacy IDs cannot be preserved. This migration will assign new IDs and persist aliases in the ${legacyIdMappings.schema.model.apiKey} model. External consumers using the old IDs must be updated.`,
            entityIds: legacyIdMappings.entries.map(({ sourceId }) => sourceId),
        });
    }
    if (legacyIdMappings.skippedEntries.length > 0) {
        warnings.push({
            code: 'LEGACY_ID_SKIPPED',
            message: `${legacyIdMappings.skippedEntries.length} legacy identifier${legacyIdMappings.skippedEntries.length === 1 ? '' : 's'} belonged only to skipped content. No new aliases will be reserved for those entities.`,
            entityIds: legacyIdMappings.skippedEntries.map(({ sourceId }) => sourceId),
        });
    }
    const records = buildRecordPlans(source, target, options.includeDeletions, mergeDependencies(mergeDependencies(dependencyGraph.dependencies, publishedUniqueDependencies), allReferences), warnings);
    const executionCreateOrder = dependencyGraph.createOrder.filter((id) => creationRecordIds.has(id));
    const shellRecordIds = new Set(dependencyGraph.shellRecordIds);
    const projectedCreateSeedFields = new Map(executionCreateOrder.map((recordId) => {
        const sourceRecord = source.records[recordId];
        if (!sourceRecord) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Execution create order refers to missing source record ${recordId}.`, { recordId });
        }
        return [
            recordId,
            (0, dependencies_1.projectCreateSeedFields)(sourceRecord, source.schema, executionCreateOrder, creationRecordIds, shellRecordIds, dependencyGraph.shellComponents),
        ];
    }));
    const defaultValueSuppressions = (0, create_defaults_1.deriveCreateDefaultValueSuppressions)(records, source.schema, projectedCreateSeedFields);
    if (defaultValueSuppressions.length > 0 && !migrateInvalidContent) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Creating ${new Set(defaultValueSuppressions.flatMap(({ affectedRecordIds }) => affectedRecordIds)).size} source-only record(s) would cause active field defaults to replace historical null values. Regenerate with --migrate-invalid-content to authorize exact temporary default suppression and restoration.`, {
            fieldIds: defaultValueSuppressions.map(({ fieldId }) => fieldId),
            recordIds: [
                ...new Set(defaultValueSuppressions.flatMap(({ affectedRecordIds }) => affectedRecordIds)),
            ].sort(),
        });
    }
    if (defaultValueSuppressions.length > 0) {
        warnings.push({
            code: 'DEFAULT_VALUE_SUPPRESSION',
            message: `${defaultValueSuppressions.length} field default configuration(s) will be suppressed exactly while source-only records are created, then restored and verified. Concurrent creates during this narrow project-wide window will not receive those defaults; use a quiet or maintenance window.`,
            entityIds: defaultValueSuppressions.map(({ fieldId }) => fieldId),
        });
    }
    for (const release of uniqueReleaseAnalysis.releases) {
        const recordPlan = records.find(({ id }) => id === release.recordId);
        if (!recordPlan || recordPlan.action !== 'update') {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Unique-value release owner ${release.recordId} is not an update in the generated plan.`, { recordId: release.recordId });
        }
        recordPlan.allowedIntermediateHashes.push(release.intermediateCurrentHash);
    }
    const uploads = buildUploadPlans(source, target, options.includeDeletions, warnings);
    const invalidUploadPlan = uploads
        .map((upload) => ({
        upload,
        error: (0, upload_contract_1.uploadPlanContractError)(upload, originalSource.schema),
    }))
        .find(({ error }) => error !== null);
    if (invalidUploadPlan) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Upload ${invalidUploadPlan.upload.id} cannot be reproduced exactly: ${invalidUploadPlan.error}.`, { entityIds: [invalidUploadPlan.upload.id] });
    }
    const uploadCollections = buildUploadCollectionPlans(source, target);
    const invalidUploadCollectionPlan = uploadCollections
        .map((collection) => ({
        collection,
        error: (0, upload_collection_contract_1.uploadCollectionPlanContractError)(collection),
    }))
        .find(({ error }) => error !== null);
    if (invalidUploadCollectionPlan) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Upload collection ${invalidUploadCollectionPlan.collection.id} cannot be reproduced exactly: ${invalidUploadCollectionPlan.error}.`, { entityIds: [invalidUploadCollectionPlan.collection.id] });
    }
    const collectionDependencies = Object.fromEntries(uploadCollections.map(({ id, desired }) => [
        id,
        desired.parentId && source.uploadCollections[desired.parentId]
            ? [desired.parentId]
            : [],
    ]));
    const deletionRecords = Object.fromEntries(records
        .filter(({ action, baseline }) => action === 'delete' && baseline)
        .map(({ id, baseline }) => [id, baseline]));
    const deletionAnalysis = Object.keys(deletionRecords).length > 0
        ? (0, dependencies_1.analyzeDeletionDependencies)(deletionRecords, targetTraversalSchema, {
            supportedRequiredCycleRecordIds: invalidContent.supportedRequiredDeletionCycleRecordIds,
            reservedItemIds,
        })
        : { deleteOrder: [], releases: [] };
    for (const release of deletionAnalysis.releases) {
        const recordPlan = records.find(({ id }) => id === release.recordId);
        if (!recordPlan || recordPlan.action !== 'delete') {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Deletion release owner ${release.recordId} is not a deletion in the generated plan.`, { recordId: release.recordId });
        }
        recordPlan.allowedIntermediateHashes.push(release.intermediateCurrentHash);
    }
    const updateIds = new Set(records.filter(({ action }) => action === 'update').map(({ id }) => id));
    const publicationSeedOrder = dependencyGraph.publicationSeedOrder.filter((id) => { var _a; return Boolean((_a = source.records[id]) === null || _a === void 0 ? void 0 : _a.published); });
    const invalidPublicationSeedId = publicationSeedOrder.find((id) => dependencyGraph.shellRecordIds.includes(id) &&
        !invalidContent.supportedShellRecordIds.has(id));
    if (invalidPublicationSeedId) {
        throw new types_1.ContentDiffError('REQUIRED_REFERENCE_CYCLE', `Record ${invalidPublicationSeedId} requires an invalid draft shell and cannot be safely seed-published to resolve a publication cycle.`, { recordId: invalidPublicationSeedId });
    }
    const publicationSeedIds = new Set(publicationSeedOrder);
    const blockedSeedUniqueDependency = publishedUniqueDependencies.find(({ fromRecordId }) => publicationSeedIds.has(fromRecordId));
    if (blockedSeedUniqueDependency) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Record ${blockedSeedUniqueDependency.fromRecordId} cannot be seed-published before existing record ${blockedSeedUniqueDependency.toRecordId} releases its published unique value.`, {
            recordId: blockedSeedUniqueDependency.fromRecordId,
            dependencyId: blockedSeedUniqueDependency.toRecordId,
        });
    }
    for (const recordId of publicationSeedOrder) {
        const unsafeExistingDependencyId = (0, dependencies_1.collectPublishedDependencyIds)(source.records[recordId], sourceTraversalSchema).find((dependencyId) => Boolean(target.records[dependencyId]) &&
            !target.records[dependencyId].published &&
            !publicationSeedIds.has(dependencyId));
        if (unsafeExistingDependencyId) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Record ${recordId} cannot be seed-published because existing dependency ${unsafeExistingDependencyId} has no published destination version.`, { recordId, dependencyId: unsafeExistingDependencyId });
        }
    }
    const plan = {
        formatVersion: types_1.CONTENT_PLAN_FORMAT_VERSION,
        generatorVersion: types_1.CONTENT_DIFF_GENERATOR_VERSION,
        source: snapshotProvenance(originalSource),
        target: snapshotProvenance(originalTarget),
        options: {
            includeDeletions: options.includeDeletions,
            uploads: options.uploads,
            migrateInvalidContent,
            migrationsModelApiKey,
        },
        schema: originalSource.schema,
        targetInspection: {
            itemTypes: originalTarget.inspection.itemTypes,
            digest: originalTarget.inspection.digest,
        },
        records,
        uploads,
        uploadCollections,
        legacyIdMappings,
        invalidContent: {
            formatVersion: types_1.INVALID_CONTENT_FORMAT_VERSION,
            migrateInvalidContent,
            schemaStates: {
                originalDigest: originalSource.schema.digest,
                fullyRelaxedDigest: invalidContent.relaxedSchema.digest,
                partialRelaxationContract: 'per_field_original_or_relaxed',
            },
            detectedRecordIds: invalidContent.detectedRecordIds,
            migratedRecordIds: invalidContent.migratedRecordIds,
            propagatedSkipCount: invalidContent.propagatedSkipCount,
            validatorRelaxations: invalidContent.validatorRelaxations,
            skippedRecords: invalidContent.skippedRecords,
        },
        execution: {
            collectionOrder: uploadCollections.length > 0
                ? (0, dependencies_1.topologicalSort)(collectionDependencies).filter((id) => uploadCollections.some((plan) => plan.id === id && plan.action !== 'noop'))
                : [],
            uploadOrder: uploads
                .filter(({ action }) => action !== 'noop')
                .map(({ id }) => id),
            uniqueReleases: uniqueReleaseAnalysis.releases,
            deleteReleases: deletionAnalysis.releases,
            shellRecordIds: dependencyGraph.shellRecordIds,
            shellComponents: dependencyGraph.shellComponents,
            revalidateBeforePublishIds: invalidContent.revalidateBeforePublishIds,
            createOrder: executionCreateOrder,
            publicationSeedOrder,
            publishOrder: (0, dependencies_1.buildPublishOrder)(source.records, sourceTraversalSchema, publishedUniqueDependencies, target.records, {
                deletionRecordIds: new Set(Object.keys(deletionRecords)),
                publicationSeedRecordIds: publicationSeedIds,
            }),
            updateOrder: dependencyGraph.updateOrder.filter((id) => updateIds.has(id)),
            deleteOrder: deletionAnalysis.deleteOrder,
        },
        targetPreconditions: options.includeDeletions
            ? {
                itemTypeIds: [...originalTarget.scope.itemTypeIds].sort(),
                selectedRecordIds: Object.keys(originalTarget.records).sort(),
                desiredRecordIds: [
                    ...new Set([
                        ...Object.keys(source.records),
                        ...invalidContent.protectedTargetRecordIds,
                    ]),
                ].sort(),
                selectedUploadIds: Object.keys(originalTarget.uploads).sort(),
                desiredUploadIds: Object.keys(source.uploads).sort(),
            }
            : null,
        requiredPermissions: requiredPermissions(source.schema, source.scope.itemTypeIds, target.readItemTypes, records, uploads, uploadCollections, dependencyGraph.shellRecordIds, dependencyGraph.temporarySeedRecordIds, deletionAnalysis.releases, invalidContent.validatorRelaxations.length > 0 ||
            defaultValueSuppressions.length > 0, legacyIdMappings),
        warnings: warnings.sort((left, right) => left.code.localeCompare(right.code) ||
            left.entityIds.join(',').localeCompare(right.entityIds.join(','))),
        summary: emptySummary(),
    };
    const collectionOrderError = (0, upload_collection_contract_1.uploadCollectionOrderContractError)(plan.uploadCollections, plan.execution.collectionOrder, Object.values(target.uploadCollections));
    if (collectionOrderError) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Upload collection label transition is not executable in the planned order: ${collectionOrderError}.`, { entityIds: plan.execution.collectionOrder });
    }
    const sanitizationRisks = (0, create_sanitization_1.findSanitizedHtmlWriteRisks)(records, (0, inspection_schema_1.schemaWithInspectionItemTypes)(invalidContent.relaxedSchema, target.inspection.itemTypes), projectedCreateSeedFields, {
        ...plan.execution,
        absoluteRecordPositionsReproducible: plan.options.includeDeletions ||
            !plan.warnings.some(({ code }) => code === 'ABSOLUTE_POSITION_NOT_REPRODUCIBLE'),
    });
    if (sanitizationRisks.length > 0) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Cannot generate an exact migration because CMA may rewrite ${sanitizationRisks.length} projected text value(s) during attribute-bearing CREATE/UPDATE stages under active sanitized_html sanitize_before_validation rules. This runtime deliberately does not approximate or disable the sanitizer. Reconcile the affected aggregates by another reviewed path or use byte-stable plain text, then regenerate. No migration artifacts were created.`, {
            recordIds: [
                ...new Set(sanitizationRisks.map(({ recordId }) => recordId)),
            ].sort(),
            fieldIds: [
                ...new Set(sanitizationRisks.map(({ fieldId }) => fieldId)),
            ].sort(),
            stages: [...new Set(sanitizationRisks.map(({ stage }) => stage))],
            paths: sanitizationRisks.map(({ path }) => path),
        });
    }
    plan.summary = summarizeContentDiffPlan(plan);
    return plan;
}
function prepareInvalidContent(source, target, options, reservedItemIds) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const sourceTraversalSchema = (0, inspection_schema_1.contentTraversalSchema)(source);
    const diagnostics = new Map(((_a = options.invalidContentDiagnostics) !== null && _a !== void 0 ? _a : []).map((diagnostic) => [
        diagnosticKey(diagnostic.recordId, diagnostic.slice, diagnostic.versionHash),
        diagnostic,
    ]));
    const diagnosticsByKey = new Map();
    for (const diagnostic of (_b = options.invalidContentDiagnostics) !== null && _b !== void 0 ? _b : []) {
        const key = diagnosticKey(diagnostic.recordId, diagnostic.slice, diagnostic.versionHash);
        const matching = (_c = diagnosticsByKey.get(key)) !== null && _c !== void 0 ? _c : [];
        matching.push(diagnostic);
        diagnosticsByKey.set(key, matching);
    }
    const itemTypes = new Map(source.schema.itemTypes.map((itemType) => [itemType.id, itemType]));
    const skips = new Map();
    const relaxations = new Map();
    const detectedRecordIds = new Set();
    const migratedRecordIds = new Set();
    const supportedShellRecordIds = new Set();
    const supportedRequiredDeletionCycleRecordIds = new Set();
    const revalidateBeforePublishIds = new Set();
    const warnings = [];
    const externalCollisionRecordIds = new Set();
    const externalCollisionBlockIds = new Map();
    const explicitlyProtectedTargetRecordIds = new Set();
    const sourceRecordIds = new Set(Object.keys(source.records));
    const targetVisibleRecordIds = new Set(target.visibleRecordIds);
    const structuralNoopRecordIds = new Set();
    const indivisibleDeletionCycleComponents = [];
    const unsupportedPublishedBlockReleaseRecordIds = new Set();
    const freshNestedBlockUpdates = (0, fresh_nested_updates_1.findUnsupportedFreshNestedBlockUpdates)(Object.values(source.records).map((desired) => {
        var _a;
        const baseline = (_a = target.records[desired.id]) !== null && _a !== void 0 ? _a : null;
        return {
            id: desired.id,
            action: baseline
                ? recordOperation(desired, baseline).noop
                    ? 'noop'
                    : 'update'
                : 'create',
            baseline,
            desired,
        };
    }));
    for (const issue of freshNestedBlockUpdates) {
        detectedRecordIds.add(issue.recordId);
        addSkip(skips, issue.recordId, {
            code: 'UNSUPPORTED_FRESH_NESTED_BLOCK_UPDATE',
            slice: issue.slice,
            message: issue.stage === 'published-stage'
                ? `Record ${issue.recordId} would introduce nested block ${issue.blockId} while staging its desired published version into CURRENT. The CMA full-validation update path can only rehydrate nested block IDs already present in the immediately preceding CURRENT version.`
                : `Record ${issue.recordId} would introduce nested block ${issue.blockId} while restoring its desired current version. The CMA full-validation update path can only rehydrate nested block IDs already present in the immediately preceding CURRENT version.`,
            dependencyId: issue.blockId,
            dependencyChain: [issue.recordId, issue.blockId],
        });
    }
    for (const issue of source.inspection.structuralIssues) {
        const record = source.records[issue.recordId];
        if (!record || record.itemTypeId !== issue.itemTypeId) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Structural-content diagnostic for record ${issue.recordId} does not match the captured aggregate.`, { recordId: issue.recordId, itemTypeId: issue.itemTypeId });
        }
        detectedRecordIds.add(record.id);
        const baseline = (_d = target.records[record.id]) !== null && _d !== void 0 ? _d : null;
        if (baseline && recordOperation(record, baseline).noop) {
            if (!structuralNoopRecordIds.has(record.id)) {
                warnings.push({
                    code: 'INVALID_CONTENT_NOOP',
                    message: `Record ${record.id} contains structurally invalid nested content but already semantically matches the destination, so the migration will not write it.`,
                    entityIds: [record.id],
                });
                structuralNoopRecordIds.add(record.id);
            }
            continue;
        }
        addSkip(skips, record.id, {
            code: 'STRUCTURAL_VALIDATION',
            slice: issue.slice,
            message: `Record ${record.id} embeds block ${issue.blockId} (model ${issue.blockItemTypeId}) at ${issue.fieldPath}, which field ${issue.fieldId} no longer permits through ${issue.validatorKey}.`,
            fieldId: issue.fieldId,
            validatorKey: issue.validatorKey,
            dependencyId: issue.blockId,
            dependencyChain: [record.id, issue.blockId],
        });
    }
    for (const collision of (_e = options.entityIdCollisions) !== null && _e !== void 0 ? _e : []) {
        detectedRecordIds.add(collision.topRecordId);
        if (collision.kind === 'record') {
            externalCollisionRecordIds.add(collision.topRecordId);
        }
        else {
            const blockIds = (_f = externalCollisionBlockIds.get(collision.topRecordId)) !== null && _f !== void 0 ? _f : new Set();
            blockIds.add(collision.id);
            externalCollisionBlockIds.set(collision.topRecordId, blockIds);
        }
        addSkip(skips, collision.topRecordId, {
            code: 'ENTITY_ID_COLLISION',
            slice: 'intermediate',
            message: collision.kind === 'record'
                ? `Source record ${collision.id} collides with an entity outside the managed destination scope.`
                : `Nested block ${collision.id} already exists outside its source aggregate in the destination.`,
            dependencyId: collision.id,
            dependencyChain: [collision.topRecordId],
        });
    }
    for (const record of Object.values(source.records)) {
        if (!target.records[record.id] && targetVisibleRecordIds.has(record.id)) {
            detectedRecordIds.add(record.id);
            externalCollisionRecordIds.add(record.id);
            addSkip(skips, record.id, {
                code: 'ENTITY_ID_COLLISION',
                slice: 'intermediate',
                message: `Source record ${record.id} collides with an out-of-scope destination record.`,
                dependencyId: record.id,
                dependencyChain: [record.id],
            });
        }
        const missingRecordId = (_g = (0, dependencies_1.collectRecordReferences)(record, sourceTraversalSchema).find(({ toRecordId }) => !sourceRecordIds.has(toRecordId) &&
            !targetVisibleRecordIds.has(toRecordId))) === null || _g === void 0 ? void 0 : _g.toRecordId;
        const missingUploadId = (_j = (_h = source.missingUploadReferences) === null || _h === void 0 ? void 0 : _h[record.id]) === null || _j === void 0 ? void 0 : _j[0];
        if (missingRecordId || missingUploadId) {
            detectedRecordIds.add(record.id);
            const dependencyId = missingRecordId !== null && missingRecordId !== void 0 ? missingRecordId : missingUploadId;
            addSkip(skips, record.id, {
                code: 'MISSING_REFERENCE',
                slice: 'current',
                message: `Record ${record.id} references missing ${missingRecordId ? 'record' : 'upload'} ${dependencyId}.`,
                dependencyId,
                dependencyChain: [record.id, dependencyId],
            });
        }
    }
    for (const conflict of findTargetOnlyUniqueConflicts(source, target)) {
        detectedRecordIds.add(conflict.recordId);
        explicitlyProtectedTargetRecordIds.add(conflict.blockingRecordId);
        addSkip(skips, conflict.recordId, {
            code: 'UNRELAXABLE_VALIDATOR',
            slice: conflict.slice,
            message: `Record ${conflict.recordId} needs a unique value held by target-only record ${conflict.blockingRecordId}; create/delete uniqueness handoffs are unsupported in V1.`,
            fieldId: conflict.fieldId,
            validatorKey: 'unique',
            dependencyId: conflict.blockingRecordId,
            dependencyChain: [conflict.recordId, conflict.blockingRecordId],
        });
    }
    if (options.includeDeletions) {
        const targetOnlyRecords = Object.fromEntries(Object.entries(target.records).filter(([id]) => !source.records[id]));
        const deletionCycles = (0, dependencies_1.collectRequiredDeletionCycleReleaseCandidates)(targetOnlyRecords, (0, inspection_schema_1.contentTraversalSchema)(target), { reservedItemIds });
        const optionalDeletionCycles = (0, dependencies_1.collectOptionalDeletionCycleReleaseCandidates)(targetOnlyRecords, (0, inspection_schema_1.contentTraversalSchema)(target), { reservedItemIds });
        const unsupportedPublishedBlockReleaseComponents = (0, dependencies_1.collectUnsupportedPublishedNestedDeletionComponents)(targetOnlyRecords, (0, inspection_schema_1.contentTraversalSchema)(target), { reservedItemIds });
        for (const componentRecordIds of unsupportedPublishedBlockReleaseComponents) {
            indivisibleDeletionCycleComponents.push(componentRecordIds);
            for (const recordId of componentRecordIds) {
                unsupportedPublishedBlockReleaseRecordIds.add(recordId);
                detectedRecordIds.add(recordId);
                addSkip(skips, recordId, {
                    code: 'UNSUPPORTED_PUBLISHED_BLOCK_RELEASE',
                    slice: 'intermediate',
                    message: `Destination-only record ${recordId} belongs to a published deletion cycle whose unlink state would need fresh nested block IDs. The CMA full-validation update path cannot safely create those transient blocks, so the entire deletion component is preserved.`,
                    dependencyChain: componentRecordIds,
                });
            }
        }
        for (const cycle of deletionCycles) {
            indivisibleDeletionCycleComponents.push(cycle.componentRecordIds);
            cycle.componentRecordIds.forEach((recordId) => detectedRecordIds.add(recordId));
            const cycleReason = (recordId) => ({
                code: 'REQUIRED_REFERENCE_CYCLE',
                slice: 'intermediate',
                message: `Destination-only record ${recordId} belongs to a required-reference deletion cycle that cannot be removed without an intermediate unlink state.`,
                dependencyChain: cycle.componentRecordIds,
            });
            if (cycle.componentRecordIds.every((recordId) => unsupportedPublishedBlockReleaseRecordIds.has(recordId))) {
                if (!options.migrateInvalidContent) {
                    cycle.componentRecordIds.forEach((recordId) => addSkip(skips, recordId, cycleReason(recordId)));
                }
                continue;
            }
            if (!options.migrateInvalidContent) {
                cycle.componentRecordIds.forEach((recordId) => addSkip(skips, recordId, cycleReason(recordId)));
                continue;
            }
            if (cycle.releases.length === 0 || cycle.unsupportedPaths.length > 0) {
                cycle.componentRecordIds.forEach((recordId) => addSkip(skips, recordId, {
                    ...cycleReason(recordId),
                    code: 'STRUCTURAL_VALIDATION',
                    message: `Destination-only record ${recordId} belongs to a required-reference deletion cycle whose structural edges cannot be represented by safe field-only unlink updates.`,
                }));
                continue;
            }
            let componentSupported = true;
            for (const release of cycle.releases) {
                const record = targetOnlyRecords[release.recordId];
                const itemType = itemTypes.get(record.itemTypeId);
                const requiresStrictValidity = Boolean(release.publish ||
                    !(itemType === null || itemType === void 0 ? void 0 : itemType.draftModeActive) ||
                    !itemType.draftSavingActive);
                const diagnostic = diagnostics.get(diagnosticKey(release.recordId, 'intermediate', release.intermediateCurrentHash));
                if ((diagnostic === null || diagnostic === void 0 ? void 0 : diagnostic.valid) || !requiresStrictValidity)
                    continue;
                const narrowFailure = requiredDeletionRelaxationFailure(diagnostic, release.recordId, cycleReason(release.recordId), source.schema);
                if (narrowFailure) {
                    componentSupported = false;
                    cycle.componentRecordIds.forEach((recordId) => addSkip(skips, recordId, {
                        ...narrowFailure,
                        dependencyChain: cycle.componentRecordIds,
                    }));
                    break;
                }
                const applied = addDiagnosticRelaxations(diagnostic, release.recordId, cycleReason(release.recordId), source.schema, relaxations);
                if (!applied.ok) {
                    componentSupported = false;
                    cycle.componentRecordIds.forEach((recordId) => addSkip(skips, recordId, {
                        ...applied.reason,
                        dependencyChain: cycle.componentRecordIds,
                    }));
                    break;
                }
                if (release.publish) {
                    revalidateBeforePublishIds.add(release.recordId);
                }
            }
            if (componentSupported) {
                cycle.componentRecordIds.forEach((recordId) => {
                    supportedRequiredDeletionCycleRecordIds.add(recordId);
                    migratedRecordIds.add(recordId);
                });
            }
            else {
                cycle.componentRecordIds.forEach((recordId) => revalidateBeforePublishIds.delete(recordId));
                for (const pending of relaxations.values()) {
                    cycle.componentRecordIds.forEach((recordId) => pending.affectedRecordIds.delete(recordId));
                }
            }
        }
        for (const cycle of optionalDeletionCycles) {
            indivisibleDeletionCycleComponents.push(cycle.componentRecordIds);
            if (cycle.componentRecordIds.every((recordId) => unsupportedPublishedBlockReleaseRecordIds.has(recordId))) {
                continue;
            }
            const cycleReason = (recordId) => ({
                code: 'INVALID_INTERMEDIATE',
                slice: 'intermediate',
                message: `Destination-only record ${recordId} belongs to an optional-reference deletion cycle whose unlink state requires strict validation.`,
                dependencyChain: cycle.componentRecordIds,
            });
            if (cycle.releases.length === 0 || cycle.unsupportedPaths.length > 0) {
                cycle.componentRecordIds.forEach((recordId) => {
                    detectedRecordIds.add(recordId);
                    addSkip(skips, recordId, {
                        ...cycleReason(recordId),
                        code: 'STRUCTURAL_VALIDATION',
                        message: `Destination-only record ${recordId} belongs to an optional-reference deletion cycle whose edges cannot be represented by safe field-only unlink updates.`,
                    });
                });
                continue;
            }
            const strictReleases = cycle.releases.filter((release) => {
                const record = targetOnlyRecords[release.recordId];
                const itemType = record ? itemTypes.get(record.itemTypeId) : undefined;
                return Boolean(release.publish ||
                    !(itemType === null || itemType === void 0 ? void 0 : itemType.draftModeActive) ||
                    !itemType.draftSavingActive);
            });
            if (strictReleases.length === 0)
                continue;
            let componentSupported = true;
            let componentMigrated = false;
            for (const release of strictReleases) {
                const diagnostic = diagnostics.get(diagnosticKey(release.recordId, 'intermediate', release.intermediateCurrentHash));
                if (diagnostic === null || diagnostic === void 0 ? void 0 : diagnostic.valid)
                    continue;
                cycle.componentRecordIds.forEach((recordId) => detectedRecordIds.add(recordId));
                if (!options.migrateInvalidContent) {
                    componentSupported = false;
                    const reason = !diagnostic || diagnostic.issues.length === 0
                        ? {
                            ...cycleReason(release.recordId),
                            code: 'VALIDATION_CONTRACT_CHANGED',
                            message: `Record ${release.recordId} needs a strict optional deletion-cycle unlink write, but the read-only diagnostic endpoint did not return a usable result.`,
                        }
                        : cycleReason(release.recordId);
                    cycle.componentRecordIds.forEach((recordId) => addSkip(skips, recordId, {
                        ...reason,
                        dependencyChain: cycle.componentRecordIds,
                    }));
                    break;
                }
                const applied = addDiagnosticRelaxations(diagnostic, release.recordId, cycleReason(release.recordId), source.schema, relaxations);
                if (!applied.ok) {
                    componentSupported = false;
                    cycle.componentRecordIds.forEach((recordId) => addSkip(skips, recordId, {
                        ...applied.reason,
                        dependencyChain: cycle.componentRecordIds,
                    }));
                    break;
                }
                componentMigrated = true;
                if (release.publish) {
                    revalidateBeforePublishIds.add(release.recordId);
                }
            }
            if (componentSupported && componentMigrated) {
                cycle.componentRecordIds.forEach((recordId) => migratedRecordIds.add(recordId));
            }
            else if (!componentSupported) {
                cycle.componentRecordIds.forEach((recordId) => revalidateBeforePublishIds.delete(recordId));
                for (const pending of relaxations.values()) {
                    cycle.componentRecordIds.forEach((recordId) => pending.affectedRecordIds.delete(recordId));
                }
            }
        }
    }
    for (const [blockId, sourceOwnership] of Object.entries(source.blockOwnership)) {
        const targetOwnership = target.blockOwnership[blockId];
        if (!targetOwnership)
            continue;
        const sourceLocations = new Set(sourceOwnership.map(blockOwnershipLocation));
        const targetLocations = new Set(targetOwnership.map(blockOwnershipLocation));
        if (sourceLocations.size === targetLocations.size &&
            [...sourceLocations].every((location) => targetLocations.has(location))) {
            continue;
        }
        for (const { topRecordId } of sourceOwnership) {
            detectedRecordIds.add(topRecordId);
            const blockIds = (_k = externalCollisionBlockIds.get(topRecordId)) !== null && _k !== void 0 ? _k : new Set();
            blockIds.add(blockId);
            externalCollisionBlockIds.set(topRecordId, blockIds);
            addSkip(skips, topRecordId, {
                code: 'ENTITY_ID_COLLISION',
                slice: 'intermediate',
                message: `Nested block ${blockId} would relocate across aggregates, fields, or locales.`,
                dependencyId: blockId,
                dependencyChain: [topRecordId],
            });
        }
    }
    for (const record of Object.values(source.records)) {
        if (!target.records[record.id] && !(0, canonicalize_1.isPortableDatoId)(record.id)) {
            detectedRecordIds.add(record.id);
            addSkip(skips, record.id, {
                code: 'ENTITY_ID_COLLISION',
                slice: 'intermediate',
                message: `Source-only record ${record.id} uses a legacy ID that cannot be requested on create.`,
                dependencyId: record.id,
                dependencyChain: [record.id],
            });
        }
    }
    for (const [blockId, ownership] of Object.entries(source.blockOwnership)) {
        if (target.blockOwnership[blockId] || (0, canonicalize_1.isPortableDatoId)(blockId))
            continue;
        for (const { topRecordId } of ownership) {
            detectedRecordIds.add(topRecordId);
            addSkip(skips, topRecordId, {
                code: 'ENTITY_ID_COLLISION',
                slice: 'intermediate',
                message: `Nested block ${blockId} uses a legacy ID that cannot be requested on create.`,
                dependencyId: blockId,
                dependencyChain: [topRecordId],
            });
        }
    }
    for (const desired of Object.values(source.records).sort((left, right) => left.id.localeCompare(right.id))) {
        const baseline = (_l = target.records[desired.id]) !== null && _l !== void 0 ? _l : null;
        const itemType = itemTypes.get(desired.itemTypeId);
        if (!itemType)
            continue;
        const requirements = invalidWriteRequirements(desired, baseline, itemType);
        const hasInvalidDesired = !desired.validity.current || desired.validity.published === false;
        if (requirements.noop && hasInvalidDesired) {
            detectedRecordIds.add(desired.id);
            if (!structuralNoopRecordIds.has(desired.id)) {
                warnings.push({
                    code: 'INVALID_CONTENT_NOOP',
                    message: `Record ${desired.id} is invalid but already semantically matches the destination, so the migration will not write it.`,
                    entityIds: [desired.id],
                });
            }
            continue;
        }
        const invalidCurrentScheduleIsProvenSafe = Boolean(requirements.scheduledPublication &&
            !desired.validity.current &&
            canRestoreSelectivePublicationForInvalidCurrent({
                desired,
                itemType,
                diagnostics: (_m = diagnosticsByKey.get(diagnosticKey(desired.id, 'current', desired.current.hash))) !== null && _m !== void 0 ? _m : [],
                traversalSchema: sourceTraversalSchema,
            }));
        if ((requirements.current || requirements.scheduledPublication) &&
            !desired.validity.current &&
            requirements.scheduledPublication &&
            !invalidCurrentScheduleIsProvenSafe) {
            detectedRecordIds.add(desired.id);
            addSkip(skips, desired.id, {
                code: 'UNSAFE_SCHEDULED_PUBLICATION',
                slice: 'schedule',
                message: `Record ${desired.id} has an invalid desired current version whose future publication scope cannot be proven valid under the restored validators.`,
                dependencyChain: [desired.id],
            });
            continue;
        }
        const invalidSlices = [];
        if ((requirements.current || requirements.scheduledPublication) &&
            !desired.validity.current) {
            invalidSlices.push({
                slice: 'current',
                versionHash: desired.current.hash,
                reasonCode: 'INVALID_CURRENT',
                requiresStrictValidity: requirements.currentRequiresStrictValidity,
            });
        }
        if (requirements.published &&
            desired.published &&
            desired.validity.published === false) {
            invalidSlices.push({
                slice: 'published',
                versionHash: desired.published.hash,
                reasonCode: 'INVALID_PUBLISHED',
                requiresStrictValidity: true,
            });
        }
        for (const invalidSlice of invalidSlices) {
            detectedRecordIds.add(desired.id);
            const reason = {
                code: invalidSlice.reasonCode,
                slice: invalidSlice.slice,
                message: `Record ${desired.id} has an invalid desired ${invalidSlice.slice} version that must be written by this migration.`,
                dependencyChain: [desired.id],
            };
            if (!invalidSlice.requiresStrictValidity) {
                migratedRecordIds.add(desired.id);
                continue;
            }
            if (!options.migrateInvalidContent) {
                addSkip(skips, desired.id, reason);
                continue;
            }
            const diagnostic = diagnostics.get(diagnosticKey(desired.id, invalidSlice.slice, invalidSlice.versionHash));
            const applied = addDiagnosticRelaxations(diagnostic, desired.id, reason, source.schema, relaxations);
            if (!applied.ok) {
                addSkip(skips, desired.id, applied.reason);
            }
            else {
                migratedRecordIds.add(desired.id);
                if (requirements.published) {
                    revalidateBeforePublishIds.add(desired.id);
                }
            }
        }
    }
    for (const cycle of findUniqueValueCycles(source, target)) {
        if (cycle.recordIds.some((recordId) => skips.has(recordId)))
            continue;
        cycle.recordIds.forEach((recordId) => detectedRecordIds.add(recordId));
        const cycleReason = (recordId) => ({
            code: 'UNIQUE_VALUE_CYCLE',
            slice: cycle.slice,
            message: `Record ${recordId} belongs to a cyclic ${cycle.slice} unique-value handoff that requires temporary relaxation of field ${cycle.fieldId}.`,
            fieldId: cycle.fieldId,
            validatorKey: 'unique',
            dependencyChain: cycle.recordIds,
        });
        if (!options.migrateInvalidContent) {
            cycle.recordIds.forEach((recordId) => addSkip(skips, recordId, cycleReason(recordId)));
            continue;
        }
        let supported = true;
        for (const recordId of cycle.recordIds) {
            const record = source.records[recordId];
            const version = cycle.slice === 'published' ? record.published : record.current;
            const diagnostic = version
                ? diagnostics.get(diagnosticKey(recordId, cycle.slice, version.hash))
                : undefined;
            const applied = addDiagnosticRelaxations(diagnostic, recordId, cycleReason(recordId), source.schema, relaxations);
            if (!applied.ok) {
                supported = false;
                cycle.recordIds.forEach((componentRecordId) => addSkip(skips, componentRecordId, {
                    ...applied.reason,
                    dependencyChain: cycle.recordIds,
                }));
                break;
            }
            migratedRecordIds.add(recordId);
            if (cycle.slice === 'published') {
                revalidateBeforePublishIds.add(recordId);
            }
        }
        if (!supported) {
            for (const pending of relaxations.values()) {
                cycle.recordIds.forEach((recordId) => pending.affectedRecordIds.delete(recordId));
            }
        }
    }
    const creationRecordIds = new Set(Object.keys(source.records).filter((id) => !(id in target.records)));
    const cycleCandidates = (0, dependencies_1.collectCreateCycleIntermediateCandidates)(source.records, sourceTraversalSchema, creationRecordIds);
    const candidatesByComponent = new Map();
    for (const candidate of cycleCandidates) {
        const key = candidate.componentRecordIds.join('\0');
        const values = (_o = candidatesByComponent.get(key)) !== null && _o !== void 0 ? _o : [];
        values.push(candidate);
        candidatesByComponent.set(key, values);
    }
    for (const candidates of [...candidatesByComponent.values()].sort((left, right) => left[0].componentRecordIds
        .join(',')
        .localeCompare(right[0].componentRecordIds.join(',')))) {
        const componentAlreadySkipped = candidates.some(({ recordId }) => skips.has(recordId));
        const componentIds = new Set(candidates[0].componentRecordIds);
        const topologyCycle = candidates.some(({ topologyCycle }) => topologyCycle);
        const requiredReferences = candidates.flatMap(({ recordId }) => {
            const record = source.records[recordId];
            const seedPrefix = record.published ? 'published.' : 'current.';
            return (0, dependencies_1.collectRecordReferences)(record, sourceTraversalSchema).filter((reference) => reference.required &&
                componentIds.has(reference.toRecordId) &&
                reference.path.startsWith(seedPrefix));
        });
        const requiredDependencies = Object.fromEntries([...componentIds].sort().map((recordId) => [recordId, []]));
        for (const reference of requiredReferences) {
            requiredDependencies[reference.fromRecordId].push(reference.toRecordId);
        }
        const requiresDeclaredShell = componentIds.size === 1 || graphCycles(requiredDependencies).length > 0;
        if (topologyCycle) {
            for (const { recordId } of candidates) {
                detectedRecordIds.add(recordId);
                addSkip(skips, recordId, {
                    code: 'STRUCTURAL_VALIDATION',
                    slice: 'intermediate',
                    message: `Record ${recordId} belongs to a source-only cyclic tree topology that field-validator relaxation cannot represent safely.`,
                    dependencyChain: candidates[0].componentRecordIds,
                });
            }
            continue;
        }
        const strictCandidates = candidates.filter(({ recordId, itemTypeId }) => {
            const record = source.records[recordId];
            const itemType = itemTypes.get(itemTypeId);
            return Boolean(record &&
                itemType &&
                (record.published ||
                    !itemType.draftModeActive ||
                    !itemType.draftSavingActive));
        });
        if (strictCandidates.length === 0)
            continue;
        const invalidCandidates = strictCandidates.filter((candidate) => {
            const diagnostic = diagnostics.get(diagnosticKey(candidate.recordId, 'intermediate', candidate.versionHash));
            return (diagnostic === null || diagnostic === void 0 ? void 0 : diagnostic.valid) !== true;
        });
        if (invalidCandidates.length === 0) {
            if (requiresDeclaredShell) {
                strictCandidates.forEach(({ recordId }) => supportedShellRecordIds.add(recordId));
            }
            continue;
        }
        candidates.forEach(({ recordId }) => detectedRecordIds.add(recordId));
        const cycleReason = (candidate) => ({
            code: 'INVALID_INTERMEDIATE',
            slice: 'intermediate',
            message: requiresDeclaredShell
                ? `Record ${candidate.recordId} needs a component-wide create shell while its cyclic dependencies are created.`
                : `Record ${candidate.recordId} needs an order-dependent create seed while its later optional cyclic dependencies are unavailable.`,
            dependencyChain: candidate.componentRecordIds,
        });
        if (!options.migrateInvalidContent) {
            const first = invalidCandidates[0];
            const diagnostic = diagnostics.get(diagnosticKey(first.recordId, 'intermediate', first.versionHash));
            const reason = requiresDeclaredShell
                ? {
                    ...cycleReason(first),
                    code: 'REQUIRED_REFERENCE_CYCLE',
                    message: `Record ${first.recordId} belongs to a source-only required/self-reference cycle that needs a temporary valid shell.`,
                }
                : diagnostic && diagnostic.issues.length > 0
                    ? cycleReason(first)
                    : {
                        ...cycleReason(first),
                        code: 'VALIDATION_CONTRACT_CHANGED',
                        message: `Record ${first.recordId} needs a strict cyclic create seed, but the read-only diagnostic endpoint did not return a usable result.`,
                    };
            for (const { recordId } of candidates) {
                addSkip(skips, recordId, {
                    ...reason,
                    dependencyChain: candidates[0].componentRecordIds,
                });
            }
            continue;
        }
        // Keep the SCC indivisible when an earlier invalid-source or collision
        // rule already owns one member. Dependency propagation will preserve the
        // remainder without attempting a partial create sequence.
        if (componentAlreadySkipped)
            continue;
        let componentSupported = true;
        for (const candidate of invalidCandidates) {
            const diagnostic = diagnostics.get(diagnosticKey(candidate.recordId, 'intermediate', candidate.versionHash));
            const applied = addDiagnosticRelaxations(diagnostic, candidate.recordId, cycleReason(candidate), source.schema, relaxations);
            if (!applied.ok) {
                componentSupported = false;
                for (const componentRecordId of candidate.componentRecordIds) {
                    addSkip(skips, componentRecordId, {
                        ...applied.reason,
                        dependencyChain: candidate.componentRecordIds,
                    });
                }
                break;
            }
            if (source.records[candidate.recordId].published) {
                revalidateBeforePublishIds.add(candidate.recordId);
            }
        }
        if (componentSupported) {
            if (requiresDeclaredShell) {
                strictCandidates.forEach(({ recordId }) => supportedShellRecordIds.add(recordId));
            }
            candidates.forEach(({ recordId }) => migratedRecordIds.add(recordId));
            continue;
        }
        candidates.forEach(({ recordId }) => {
            supportedShellRecordIds.delete(recordId);
            migratedRecordIds.delete(recordId);
            revalidateBeforePublishIds.delete(recordId);
        });
        for (const pending of relaxations.values()) {
            candidates.forEach(({ recordId }) => pending.affectedRecordIds.delete(recordId));
        }
    }
    let protectedTargetRecordIds = [];
    let protectedUploadIds = new Set();
    let skipClosureChanged = true;
    while (skipClosureChanged) {
        const skipCountBefore = skips.size;
        classifyRuntimeCurrentUniqueTransitions(source, target, options.migrateInvalidContent === true, diagnostics, skips, relaxations, detectedRecordIds, migratedRecordIds, revalidateBeforePublishIds);
        if (hasScheduledPreservedSkip(target, skips)) {
            for (const pending of relaxations.values()) {
                for (const recordId of pending.affectedRecordIds) {
                    if (skips.has(recordId))
                        continue;
                    addSkip(skips, recordId, {
                        code: 'UNSAFE_SCHEDULED_PUBLICATION',
                        slice: 'schedule',
                        message: `Record ${recordId} cannot use temporary validator relaxation while another preserved skipped aggregate has a live schedule that cannot be safely neutralized.`,
                        dependencyChain: [recordId],
                    });
                }
            }
        }
        ({ protectedTargetRecordIds, protectedUploadIds } = reconcileSkipProtection(source, target, skips, detectedRecordIds, explicitlyProtectedTargetRecordIds));
        const protectedTargetRecordIdSet = new Set(protectedTargetRecordIds);
        for (const componentRecordIds of indivisibleDeletionCycleComponents) {
            if (!componentRecordIds.some((recordId) => skips.has(recordId) || protectedTargetRecordIdSet.has(recordId)) ||
                componentRecordIds.every((recordId) => skips.has(recordId))) {
                continue;
            }
            for (const recordId of componentRecordIds) {
                if (skips.has(recordId))
                    continue;
                addSkip(skips, recordId, {
                    code: 'DEPENDENCY_ON_SKIPPED_RECORD',
                    slice: 'intermediate',
                    message: `Destination-only record ${recordId} was preserved because its deletion component must remain an indivisible aggregate.`,
                    dependencyId: (_p = componentRecordIds.find((candidate) => candidate !== recordId &&
                        (skips.has(candidate) ||
                            protectedTargetRecordIdSet.has(candidate)))) !== null && _p !== void 0 ? _p : componentRecordIds[0],
                    dependencyChain: componentRecordIds,
                }, true);
            }
        }
        propagateUnsupportedUniqueValidity(source, target, diagnostics, skips, detectedRecordIds);
        skipClosureChanged = skips.size !== skipCountBefore;
    }
    // Reconciliation can add propagated dependency and ordering skips after the
    // direct invalid-content classification above. Finalize the record classes
    // in one place so every skipped aggregate is reported as detected and no
    // skipped record survives in a migrated/intermediate execution class.
    for (const recordId of skips.keys()) {
        detectedRecordIds.add(recordId);
        migratedRecordIds.delete(recordId);
        supportedShellRecordIds.delete(recordId);
        supportedRequiredDeletionCycleRecordIds.delete(recordId);
        revalidateBeforePublishIds.delete(recordId);
    }
    for (const pending of relaxations.values()) {
        for (const recordId of [...pending.affectedRecordIds]) {
            if (skips.has(recordId))
                pending.affectedRecordIds.delete(recordId);
        }
    }
    const validatorRelaxations = finalizeRelaxations(source.schema, [...relaxations.values()].filter(({ affectedRecordIds }) => affectedRecordIds.size > 0));
    const relaxedSchema = schemaWithRelaxations(source.schema, validatorRelaxations);
    const skippedRecords = [...skips]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([recordId, pending]) => {
        var _a, _b;
        const sourceRecord = source.records[recordId];
        const targetRecord = (_a = target.records[recordId]) !== null && _a !== void 0 ? _a : null;
        const reportedSourceRecord = sourceRecord !== null && sourceRecord !== void 0 ? sourceRecord : targetRecord;
        if (!reportedSourceRecord) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Skipped record ${recordId} is absent from both content snapshots.`, { recordId });
        }
        return skippedAggregate(reportedSourceRecord, targetRecord, pending.reasons, sourceRecord ? source : target, target, externalCollisionRecordIds.has(recordId), [...((_b = externalCollisionBlockIds.get(recordId)) !== null && _b !== void 0 ? _b : [])].sort());
    });
    for (const skipped of skippedRecords) {
        warnings.push({
            code: 'INVALID_CONTENT_SKIPPED',
            message: `Record ${skipped.id} was skipped as a whole (${skipped.reasons
                .map(({ code }) => code)
                .join(', ')}).`,
            entityIds: [skipped.id],
        });
    }
    for (const recordId of protectedTargetRecordIds) {
        if (skips.has(recordId))
            continue;
        warnings.push({
            code: 'RETAINED_TARGET_RECORD',
            message: `Destination-only record ${recordId} is retained because skipped content still depends on it.`,
            entityIds: [recordId],
        });
    }
    const filtered = filterSnapshotsForInvalidContent(source, target, new Set(skips.keys()), new Set(protectedTargetRecordIds), protectedUploadIds, options.uploads);
    return {
        ...filtered,
        relaxedSchema,
        validatorRelaxations,
        skippedRecords,
        supportedShellRecordIds,
        supportedRequiredDeletionCycleRecordIds,
        revalidateBeforePublishIds: [...revalidateBeforePublishIds]
            .filter((id) => !skips.has(id))
            .sort(),
        protectedTargetRecordIds: [
            ...new Set([
                ...protectedTargetRecordIds,
                ...skippedRecords
                    .filter(({ disposition }) => disposition === 'preserve_target')
                    .map(({ id }) => id),
            ]),
        ].sort(),
        warnings,
        detectedRecordIds: [...detectedRecordIds].sort(),
        migratedRecordIds: [...migratedRecordIds]
            .filter((id) => !skips.has(id))
            .sort(),
        propagatedSkipCount: [...skips.values()].filter(({ propagated }) => propagated).length,
    };
}
/**
 * The CMA accepts an invalid draft for a selective future publication only on
 * models with invalid-draft saving enabled, and then validates exactly the
 * requested localized/non-localized slice. Generator diagnostics validate the
 * complete desired payload and enumerate every validator failure. We can
 * therefore retain the schedule only when every exact diagnostic proves that
 * all failures live outside its selected slice. Anything ambiguous remains a
 * fail-closed skip.
 */
function canRestoreSelectivePublicationForInvalidCurrent({ desired, itemType, diagnostics, traversalSchema, }) {
    var _a;
    const selective = (_a = desired.schedules.publication) === null || _a === void 0 ? void 0 : _a.selective;
    if (!selective ||
        !itemType.draftModeActive ||
        !itemType.draftSavingActive ||
        diagnostics.length === 0 ||
        (selective.locales.length === 0 && !selective.nonLocalized)) {
        return false;
    }
    const localeSet = new Set(traversalSchema.locales);
    if (selective.locales.some((locale) => !localeSet.has(locale)))
        return false;
    const fieldsById = new Map(traversalSchema.itemTypes.flatMap((candidateItemType) => candidateItemType.fields.map((field) => [field.id, field])));
    const selectedLocales = new Set(selective.locales);
    return diagnostics.every((diagnostic) => {
        if (diagnostic.valid)
            return diagnostic.issues.length === 0;
        if (diagnostic.issues.length === 0)
            return false;
        return diagnostic.issues.every((issue) => {
            const scope = validationIssueScope(issue, fieldsById, traversalSchema.locales);
            if (!scope)
                return false;
            return scope.kind === 'localized'
                ? !selectedLocales.has(scope.locale)
                : !selective.nonLocalized;
        });
    });
}
function validationIssueScope(issue, fieldsById, locales) {
    if (!issue.fieldId)
        return null;
    const field = fieldsById.get(issue.fieldId);
    if (!field)
        return null;
    if (!field.localized)
        return { kind: 'non_localized' };
    const fieldPath = issue.details.field;
    if (typeof fieldPath !== 'string')
        return null;
    const segments = fieldPath.split('.');
    const fieldSegment = segments.at(-2);
    const locale = segments.at(-1);
    return fieldSegment === field.apiKey && locale && locales.includes(locale)
        ? { kind: 'localized', locale }
        : null;
}
function invalidWriteRequirements(desired, baseline, itemType) {
    var _a;
    const operation = recordOperation(desired, baseline);
    if (operation.noop) {
        return {
            noop: true,
            current: false,
            published: false,
            currentRequiresStrictValidity: false,
            scheduledPublication: false,
        };
    }
    const create = baseline === null;
    const changes = baseline ? compareRecordChanges(desired, baseline) : null;
    const published = Boolean(itemType.draftModeActive &&
        desired.published &&
        (create || (changes === null || changes === void 0 ? void 0 : changes.published)));
    const restoresDifferentCurrent = Boolean(desired.published && desired.current.hash !== desired.published.hash);
    const publicationScheduleChanged = Boolean(desired.schedules.publication &&
        (create ||
            (0, canonicalize_1.stableStringify)(desired.schedules.publication) !==
                (0, canonicalize_1.stableStringify)((_a = baseline === null || baseline === void 0 ? void 0 : baseline.schedules.publication) !== null && _a !== void 0 ? _a : null)));
    const current = create
        ? !desired.published || restoresDifferentCurrent
        : Boolean((changes === null || changes === void 0 ? void 0 : changes.current) || (changes === null || changes === void 0 ? void 0 : changes.topology) || (changes === null || changes === void 0 ? void 0 : changes.lifecycle));
    return {
        noop: false,
        current,
        published,
        currentRequiresStrictValidity: Boolean(!itemType.draftModeActive || !itemType.draftSavingActive),
        // A future publication must be valid under the restored schema. This is
        // true even when the schedule itself is unchanged: writing an invalid
        // current version while retaining that schedule would only defer the
        // failure until the scheduler attempts to publish it.
        scheduledPublication: Boolean(desired.schedules.publication &&
            (publicationScheduleChanged || current || published)),
    };
}
function recordOperation(desired, baseline) {
    if (!baseline)
        return { noop: false, topology: true };
    return {
        noop: desired.hash === baseline.hash &&
            desired.topology.position === baseline.topology.position,
        topology: (0, canonicalize_1.stableStringify)(desired.topology) !== (0, canonicalize_1.stableStringify)(baseline.topology),
    };
}
function findUniqueValueCycles(source, target) {
    var _a, _b;
    var _c;
    const result = [];
    for (const itemType of source.schema.itemTypes.filter(({ modularBlock }) => !modularBlock)) {
        const desiredRecords = Object.values(source.records).filter(({ itemTypeId }) => itemTypeId === itemType.id);
        const baselineRecords = Object.values(target.records).filter(({ itemTypeId }) => itemTypeId === itemType.id);
        for (const field of itemType.fields.filter(({ validators }) => 'unique' in validators)) {
            for (const slice of ['current', 'published']) {
                const owners = new Map();
                for (const record of baselineRecords) {
                    const version = slice === 'current' ? record.current : record.published;
                    if (!version)
                        continue;
                    for (const [locale, value] of uniqueFieldValues(version.fields[field.apiKey], field)) {
                        owners.set(`${locale}:${(0, canonicalize_1.semanticHash)(value)}`, record.id);
                    }
                }
                const dependencies = {};
                for (const record of desiredRecords) {
                    const version = slice === 'current' ? record.current : record.published;
                    if (!version)
                        continue;
                    for (const [locale, value] of uniqueFieldValues(version.fields[field.apiKey], field)) {
                        const key = `${locale}:${(0, canonicalize_1.semanticHash)(value)}`;
                        const ownerId = owners.get(key);
                        if (!ownerId || ownerId === record.id || !source.records[ownerId]) {
                            continue;
                        }
                        const ownerDesired = slice === 'current'
                            ? source.records[ownerId].current
                            : source.records[ownerId].published;
                        const ownerReleases = !ownerDesired ||
                            !uniqueFieldValues(ownerDesired.fields[field.apiKey], field).some(([ownerLocale, ownerValue]) => `${ownerLocale}:${(0, canonicalize_1.semanticHash)(ownerValue)}` === key);
                        if (!ownerReleases)
                            continue;
                        (_a = dependencies[_c = record.id]) !== null && _a !== void 0 ? _a : (dependencies[_c] = []);
                        dependencies[record.id].push(ownerId);
                        (_b = dependencies[ownerId]) !== null && _b !== void 0 ? _b : (dependencies[ownerId] = []);
                    }
                }
                for (const component of graphCycles(dependencies)) {
                    result.push({
                        recordIds: component,
                        fieldId: field.id,
                        slice,
                    });
                }
            }
        }
    }
    return result.sort((left, right) => left.recordIds.join(',').localeCompare(right.recordIds.join(',')) ||
        left.fieldId.localeCompare(right.fieldId) ||
        left.slice.localeCompare(right.slice));
}
function uniqueFieldValues(value, field) {
    if (value === undefined || value === null || uniqueValueIsBlank(value)) {
        return [];
    }
    if (field.localized && typeof value === 'object' && !Array.isArray(value)) {
        return Object.entries(value)
            .filter(([, localized]) => !uniqueValueIsBlank(localized))
            .map(([locale, localized]) => [locale, localized]);
    }
    return [['value', value]];
}
function uniqueValueIsBlank(value) {
    return value === null || (typeof value === 'string' && value.trim() === '');
}
function graphCycles(dependencies) {
    var _a;
    const nodes = Object.keys(dependencies).sort();
    const reachable = (from, to) => {
        var _a;
        const pending = [from];
        const visited = new Set();
        while (pending.length > 0) {
            const current = pending.pop();
            if (current === to && visited.size > 0)
                return true;
            if (visited.has(current))
                continue;
            visited.add(current);
            pending.push(...((_a = dependencies[current]) !== null && _a !== void 0 ? _a : []));
        }
        return false;
    };
    const assigned = new Set();
    const result = [];
    for (const node of nodes) {
        if (assigned.has(node))
            continue;
        const component = nodes.filter((candidate) => reachable(node, candidate) && reachable(candidate, node));
        const selfCycle = ((_a = dependencies[node]) !== null && _a !== void 0 ? _a : []).includes(node);
        if (component.length > 1 || selfCycle) {
            component.forEach((candidate) => assigned.add(candidate));
            result.push(component.sort());
        }
    }
    return result;
}
function findTargetOnlyUniqueConflicts(source, target) {
    const conflicts = [];
    for (const itemType of source.schema.itemTypes.filter(({ modularBlock }) => !modularBlock)) {
        const sourceRecords = Object.values(source.records).filter(({ itemTypeId }) => itemTypeId === itemType.id);
        const targetRecords = Object.values(target.records).filter(({ itemTypeId }) => itemTypeId === itemType.id);
        for (const field of itemType.fields.filter(({ validators }) => 'unique' in validators)) {
            for (const slice of ['current', 'published']) {
                const owners = new Map();
                for (const record of targetRecords) {
                    const version = slice === 'current' ? record.current : record.published;
                    if (!version)
                        continue;
                    for (const [locale, value] of uniqueFieldValues(version.fields[field.apiKey], field)) {
                        owners.set(`${locale}:${(0, canonicalize_1.semanticHash)(value)}`, record.id);
                    }
                }
                for (const record of sourceRecords) {
                    const versions = slice === 'current'
                        ? [
                            record.current,
                            ...(!target.records[record.id] && record.published
                                ? [record.published]
                                : []),
                        ]
                        : record.published
                            ? [record.published]
                            : [];
                    for (const version of versions) {
                        for (const [locale, value] of uniqueFieldValues(version.fields[field.apiKey], field)) {
                            const ownerId = owners.get(`${locale}:${(0, canonicalize_1.semanticHash)(value)}`);
                            if (!ownerId ||
                                ownerId === record.id ||
                                source.records[ownerId]) {
                                continue;
                            }
                            conflicts.push({
                                recordId: record.id,
                                blockingRecordId: ownerId,
                                fieldId: field.id,
                                slice,
                            });
                        }
                    }
                }
            }
        }
    }
    return [
        ...new Map(conflicts.map((conflict) => [
            [
                conflict.recordId,
                conflict.blockingRecordId,
                conflict.fieldId,
                conflict.slice,
            ].join('\0'),
            conflict,
        ])).values(),
    ].sort((left, right) => left.recordId.localeCompare(right.recordId) ||
        left.blockingRecordId.localeCompare(right.blockingRecordId) ||
        left.fieldId.localeCompare(right.fieldId) ||
        left.slice.localeCompare(right.slice));
}
function diagnosticKey(recordId, slice, versionHash) {
    return [recordId, slice, versionHash].join('\0');
}
function requiredDeletionRelaxationFailure(diagnostic, recordId, baseReason, schema) {
    var _a;
    if (!diagnostic || diagnostic.valid || diagnostic.issues.length === 0) {
        return {
            ...baseReason,
            code: 'VALIDATION_CONTRACT_CHANGED',
            message: `Record ${recordId} needs a strict deletion-cycle unlink write, but the read-only diagnostic endpoint did not return matching validator failures.`,
        };
    }
    const fields = new Map(schema.itemTypes.flatMap((itemType) => itemType.fields.map((field) => [field.id, field])));
    for (const issue of diagnostic.issues) {
        const validatorKey = issue.code.startsWith('VALIDATION_')
            ? issue.code.slice('VALIDATION_'.length).toLowerCase()
            : null;
        const field = issue.fieldId ? fields.get(issue.fieldId) : undefined;
        if (!field || !validatorKey || !(validatorKey in field.validators)) {
            return {
                ...baseReason,
                code: issue.code === 'INVALID_FORMAT'
                    ? 'STRUCTURAL_VALIDATION'
                    : issue.code === 'VALIDATION_CONTRACT_CHANGED'
                        ? 'VALIDATION_CONTRACT_CHANGED'
                        : 'UNRELAXABLE_VALIDATOR',
                message: `Record ${recordId} failed deletion-cycle diagnostic validation with ${issue.code} on ${(_a = issue.fieldId) !== null && _a !== void 0 ? _a : 'an unknown field'}; it cannot be mapped to a required or minimum-cardinality validator.`,
                ...(issue.fieldId ? { fieldId: issue.fieldId } : {}),
                ...(validatorKey ? { validatorKey } : {}),
            };
        }
        if (validatorKey === 'required')
            continue;
        if (validatorKey === 'size' || validatorKey === 'length') {
            const validator = field.validators[validatorKey];
            const validatorObject = typeof validator === 'object' &&
                validator !== null &&
                !Array.isArray(validator)
                ? validator
                : null;
            const keys = validatorObject ? Object.keys(validatorObject) : [];
            const hasPositiveMinimum = Boolean(validatorObject &&
                (typeof validatorObject.min === 'number'
                    ? validatorObject.min > 0
                    : typeof validatorObject.eq === 'number' && validatorObject.eq > 0));
            const containsOnlyMinimumConstraints = keys.every((key) => key === 'min' || key === 'eq');
            if (hasPositiveMinimum && containsOnlyMinimumConstraints)
                continue;
        }
        return {
            ...baseReason,
            code: 'UNRELAXABLE_VALIDATOR',
            message: `Record ${recordId} failed deletion-cycle diagnostic validation with ${issue.code}; only exact required or minimum-cardinality validators may be relaxed for a destructive unlink.`,
            fieldId: field.id,
            validatorKey,
        };
    }
    return null;
}
function classifyRuntimeCurrentUniqueTransitions(source, target, migrateInvalidContent, diagnostics, skips, relaxations, detectedRecordIds, migratedRecordIds, revalidateBeforePublishIds) {
    var _a, _b;
    const analysis = (0, dependencies_1.analyzeRuntimeCurrentUniqueTransitions)(source, target, new Set(skips.keys()));
    for (const conflict of analysis.conflicts) {
        const desired = source.records[conflict.recordId];
        const diagnosticVersion = conflict.phase === 'current-restore'
            ? desired === null || desired === void 0 ? void 0 : desired.current
            : conflict.phase === 'create-seed'
                ? (_a = desired === null || desired === void 0 ? void 0 : desired.published) !== null && _a !== void 0 ? _a : desired === null || desired === void 0 ? void 0 : desired.current
                : desired === null || desired === void 0 ? void 0 : desired.published;
        if (!desired || !diagnosticVersion)
            continue;
        detectedRecordIds.add(conflict.recordId);
        const reason = {
            code: 'INVALID_INTERMEDIATE',
            slice: 'intermediate',
            message: conflict.phase === 'create-seed'
                ? `Record ${conflict.recordId} must create its published seed in CURRENT while record ${conflict.ownerRecordId} still owns the same unique value on field ${conflict.fieldId}.`
                : conflict.phase === 'published-stage'
                    ? `Record ${conflict.recordId} must stage its desired published version into CURRENT while record ${conflict.ownerRecordId} still owns the same unique value on field ${conflict.fieldId}.`
                    : `Record ${conflict.recordId} must restore its desired current version while record ${conflict.ownerRecordId} still owns the same unique value on field ${conflict.fieldId}.`,
            fieldId: conflict.fieldId,
            validatorKey: 'unique',
            dependencyId: conflict.ownerRecordId,
            dependencyChain: [conflict.recordId, conflict.ownerRecordId],
        };
        if (!migrateInvalidContent) {
            addSkip(skips, conflict.recordId, reason);
            continue;
        }
        const diagnostic = (_b = diagnostics.get(diagnosticKey(conflict.recordId, 'intermediate', diagnosticVersion.hash))) !== null && _b !== void 0 ? _b : diagnostics.get(diagnosticKey(conflict.recordId, conflict.phase === 'current-restore' ||
            (conflict.phase === 'create-seed' && !desired.published)
            ? 'current'
            : 'published', diagnosticVersion.hash));
        const applied = addExactRuntimeUniqueRelaxation(diagnostic, conflict.recordId, conflict.fieldId, reason, source.schema, relaxations);
        if (!applied.ok) {
            addSkip(skips, conflict.recordId, applied.reason);
            continue;
        }
        migratedRecordIds.add(conflict.recordId);
        if (conflict.phase !== 'current-restore') {
            revalidateBeforePublishIds.add(conflict.recordId);
        }
    }
}
function addExactRuntimeUniqueRelaxation(diagnostic, recordId, fieldId, baseReason, schema, relaxations) {
    var _a;
    if (!diagnostic || diagnostic.valid || diagnostic.issues.length === 0) {
        return {
            ok: false,
            reason: {
                ...baseReason,
                code: 'VALIDATION_CONTRACT_CHANGED',
                message: `Record ${recordId} needs temporary unique-validator relaxation for a runtime CURRENT transition, but the read-only validation diagnostic did not return that failure.`,
            },
        };
    }
    const unexpected = diagnostic.issues.find((issue) => issue.code !== 'VALIDATION_UNIQUE' || issue.fieldId !== fieldId);
    if (unexpected) {
        return {
            ok: false,
            reason: {
                ...baseReason,
                code: unexpected.code === 'INVALID_FORMAT'
                    ? 'STRUCTURAL_VALIDATION'
                    : unexpected.code === 'VALIDATION_CONTRACT_CHANGED'
                        ? 'VALIDATION_CONTRACT_CHANGED'
                        : 'UNRELAXABLE_VALIDATOR',
                message: `Record ${recordId} needs temporary unique-validator relaxation for a runtime CURRENT transition, but its validation diagnostic also reported ${unexpected.code} on ${(_a = unexpected.fieldId) !== null && _a !== void 0 ? _a : 'an unknown field'}.`,
                ...(unexpected.fieldId ? { fieldId: unexpected.fieldId } : {}),
            },
        };
    }
    return addDiagnosticRelaxations(diagnostic, recordId, baseReason, schema, relaxations);
}
function addDiagnosticRelaxations(diagnostic, recordId, baseReason, schema, relaxations) {
    var _a, _b;
    if (!diagnostic || diagnostic.valid || diagnostic.issues.length === 0) {
        return {
            ok: false,
            reason: {
                ...baseReason,
                code: 'VALIDATION_CONTRACT_CHANGED',
                message: `Record ${recordId} is marked invalid, but the read-only diagnostic endpoint did not return a matching validator failure.`,
            },
        };
    }
    const fields = new Map(schema.itemTypes.flatMap((itemType) => itemType.fields.map((field) => [field.id, { itemType, field }])));
    const mapped = [];
    for (const issue of diagnostic.issues) {
        const validatorKey = issue.code.startsWith('VALIDATION_')
            ? issue.code.slice('VALIDATION_'.length).toLowerCase()
            : null;
        const fieldEntry = issue.fieldId ? fields.get(issue.fieldId) : undefined;
        if (!validatorKey ||
            !SAFELY_RELAXABLE_VALIDATOR_KEY_SET.has(validatorKey) ||
            !fieldEntry ||
            !(validatorKey in fieldEntry.field.validators)) {
            return {
                ok: false,
                reason: {
                    ...baseReason,
                    code: issue.code === 'INVALID_FORMAT'
                        ? 'STRUCTURAL_VALIDATION'
                        : issue.code === 'VALIDATION_CONTRACT_CHANGED'
                            ? 'VALIDATION_CONTRACT_CHANGED'
                            : 'UNRELAXABLE_VALIDATOR',
                    message: `Record ${recordId} failed diagnostic validation with ${issue.code} on ${(_a = issue.fieldId) !== null && _a !== void 0 ? _a : 'an unknown field'}; that failure cannot be mapped to one safe optional validator.`,
                    ...(issue.fieldId ? { fieldId: issue.fieldId } : {}),
                    ...(validatorKey ? { validatorKey } : {}),
                },
            };
        }
        mapped.push({
            itemTypeId: fieldEntry.itemType.id,
            fieldId: fieldEntry.field.id,
            validatorKey,
        });
    }
    for (const { itemTypeId, fieldId, validatorKey } of mapped) {
        const pending = (_b = relaxations.get(fieldId)) !== null && _b !== void 0 ? _b : {
            itemTypeId,
            fieldId,
            validatorKeys: new Set(),
            affectedRecordIds: new Set(),
            reasons: [],
        };
        pending.validatorKeys.add(validatorKey);
        pending.affectedRecordIds.add(recordId);
        pending.reasons.push({
            ...baseReason,
            fieldId,
            validatorKey,
        });
        relaxations.set(fieldId, pending);
    }
    return { ok: true };
}
function addSkip(skips, recordId, reason, propagated = false) {
    var _a;
    const pending = (_a = skips.get(recordId)) !== null && _a !== void 0 ? _a : { reasons: [], propagated: false };
    const key = (0, canonicalize_1.stableStringify)(reason);
    if (!pending.reasons.some((candidate) => (0, canonicalize_1.stableStringify)(candidate) === key)) {
        pending.reasons.push(reason);
    }
    pending.propagated || (pending.propagated = propagated);
    skips.set(recordId, pending);
}
function propagateSkippedDependencies(source, target, skips) {
    var _a, _b, _c;
    const traversalSchema = (0, inspection_schema_1.contentTraversalSchema)(source);
    let changed = true;
    while (changed) {
        changed = false;
        for (const record of Object.values(source.records).sort((left, right) => left.id.localeCompare(right.id))) {
            if (skips.has(record.id))
                continue;
            const baseline = (_a = target.records[record.id]) !== null && _a !== void 0 ? _a : null;
            const itemType = source.schema.itemTypes.find(({ id }) => id === record.itemTypeId);
            if (!itemType)
                continue;
            const requirements = invalidWriteRequirements(record, baseline, itemType);
            if (requirements.noop)
                continue;
            const blocking = (0, dependencies_1.collectRecordReferences)(record, traversalSchema).find((reference) => {
                if (!skips.has(reference.toRecordId))
                    return false;
                if (reference.path.startsWith('current.') && !requirements.current) {
                    return false;
                }
                if (reference.path.startsWith('published.') &&
                    !requirements.published) {
                    return false;
                }
                if (reference.path === 'topology.parentId' &&
                    !recordOperation(record, baseline).topology &&
                    baseline) {
                    return false;
                }
                const sourceDependency = source.records[reference.toRecordId];
                const targetDependency = target.records[reference.toRecordId];
                const targetMatchesIdentity = Boolean(sourceDependency &&
                    targetDependency &&
                    sourceDependency.itemTypeId === targetDependency.itemTypeId);
                const targetSatisfies = reference.path.startsWith('published.')
                    ? Boolean(targetMatchesIdentity && (targetDependency === null || targetDependency === void 0 ? void 0 : targetDependency.published))
                    : targetMatchesIdentity;
                return !targetSatisfies;
            });
            if (!blocking)
                continue;
            const dependencyReason = (_b = skips.get(blocking.toRecordId)) === null || _b === void 0 ? void 0 : _b.reasons[0];
            addSkip(skips, record.id, {
                code: 'DEPENDENCY_ON_SKIPPED_RECORD',
                slice: blocking.path.startsWith('published.')
                    ? 'published'
                    : 'current',
                message: `Record ${record.id} cannot reach its desired state because dependency ${blocking.toRecordId} was skipped and the destination does not provide the required version.`,
                dependencyId: blocking.toRecordId,
                dependencyChain: [
                    record.id,
                    ...((_c = dependencyReason === null || dependencyReason === void 0 ? void 0 : dependencyReason.dependencyChain) !== null && _c !== void 0 ? _c : [blocking.toRecordId]),
                ],
            }, true);
            changed = true;
        }
    }
}
function propagateUnsupportedUniqueValidity(source, target, diagnostics, skips, detectedRecordIds) {
    var _a, _b, _c;
    const itemTypes = new Map(source.schema.itemTypes.map((itemType) => [itemType.id, itemType]));
    for (const record of Object.values(source.records).sort((left, right) => left.id.localeCompare(right.id))) {
        if (skips.has(record.id))
            continue;
        const baseline = (_a = target.records[record.id]) !== null && _a !== void 0 ? _a : null;
        const itemType = itemTypes.get(record.itemTypeId);
        if (!itemType ||
            invalidWriteRequirements(record, baseline, itemType).noop) {
            continue;
        }
        for (const slice of ['current', 'published']) {
            const version = recordVersionForSlice(record, slice);
            const expectedValidity = record.validity[slice];
            if (!version || expectedValidity !== false)
                continue;
            const diagnostic = diagnostics.get(diagnosticKey(record.id, slice, version.hash));
            if (!diagnostic || diagnostic.valid || diagnostic.issues.length === 0) {
                continue;
            }
            const uniqueIssues = diagnostic.issues.filter(({ code }) => code === 'VALIDATION_UNIQUE');
            // Any local validator failure is sufficient to keep the derived Boolean
            // validity false after a duplicate peer disappears. Only UNIQUE-only
            // failures depend on the final cross-record value graph.
            if (uniqueIssues.length === 0 ||
                uniqueIssues.length !== diagnostic.issues.length) {
                continue;
            }
            const support = uniqueValiditySupport(source, target, skips, record, slice, uniqueIssues.map(({ fieldId }) => fieldId));
            if (support.supported)
                continue;
            detectedRecordIds.add(record.id);
            if (support.peerIds.length === 0) {
                addSkip(skips, record.id, {
                    code: 'VALIDATION_CONTRACT_CHANGED',
                    slice,
                    message: `Record ${record.id} is marked invalid and reported only uniqueness failures for its ${slice} version, but no matching ${slice} uniqueness peer exists in the source snapshot.`,
                    ...(support.fieldId ? { fieldId: support.fieldId } : {}),
                    validatorKey: 'unique',
                    dependencyChain: [record.id],
                });
            }
            else {
                const dependencyId = support.peerIds[0];
                const dependencyReason = (_b = skips.get(dependencyId)) === null || _b === void 0 ? void 0 : _b.reasons[0];
                addSkip(skips, record.id, {
                    code: 'DEPENDENCY_ON_SKIPPED_RECORD',
                    slice,
                    message: `Record ${record.id} cannot preserve its source ${slice} invalidity because every matching uniqueness peer is skipped and the destination does not preserve an equivalent ${slice} peer.`,
                    ...(support.fieldId ? { fieldId: support.fieldId } : {}),
                    validatorKey: 'unique',
                    dependencyId,
                    dependencyChain: [
                        record.id,
                        ...((_c = dependencyReason === null || dependencyReason === void 0 ? void 0 : dependencyReason.dependencyChain) !== null && _c !== void 0 ? _c : [dependencyId]),
                    ],
                }, true);
            }
            break;
        }
    }
}
function uniqueValiditySupport(source, target, skips, record, slice, diagnosticFieldIds) {
    var _a;
    const itemType = source.schema.itemTypes.find(({ id }) => id === record.itemTypeId);
    const version = recordVersionForSlice(record, slice);
    const peerIds = new Set();
    let firstFieldId = null;
    if (!itemType || !version) {
        return { supported: false, fieldId: null, peerIds: [] };
    }
    for (const fieldId of [...new Set(diagnosticFieldIds)].sort((left, right) => String(left).localeCompare(String(right)))) {
        const field = fieldId
            ? itemType.fields.find(({ id }) => id === fieldId)
            : undefined;
        if (!field || !('unique' in field.validators))
            continue;
        firstFieldId !== null && firstFieldId !== void 0 ? firstFieldId : (firstFieldId = field.id);
        for (const [locale, value] of uniqueFieldValues(version.fields[field.apiKey], field)) {
            const valueHash = (0, canonicalize_1.semanticHash)(value);
            const matchingSourcePeers = Object.values(source.records)
                .filter((candidate) => candidate.id !== record.id &&
                candidate.itemTypeId === record.itemTypeId)
                .filter((candidate) => {
                const candidateVersion = recordVersionForSlice(candidate, slice);
                return Boolean(candidateVersion &&
                    uniqueFieldValues(candidateVersion.fields[field.apiKey], field).some(([candidateLocale, candidateValue]) => candidateLocale === locale &&
                        (0, canonicalize_1.semanticHash)(candidateValue) === valueHash));
            })
                .sort((left, right) => left.id.localeCompare(right.id));
            for (const peer of matchingSourcePeers) {
                if (!skips.has(peer.id)) {
                    const peerBaseline = (_a = target.records[peer.id]) !== null && _a !== void 0 ? _a : null;
                    const peerExpectedValidity = peerBaseline && recordOperation(peer, peerBaseline).noop
                        ? peerBaseline.validity[slice]
                        : peer.validity[slice];
                    if (peerExpectedValidity === false) {
                        return {
                            supported: true,
                            fieldId: field.id,
                            peerIds: [peer.id],
                        };
                    }
                    continue;
                }
                peerIds.add(peer.id);
                const preserved = target.records[peer.id];
                const preservedVersion = preserved
                    ? recordVersionForSlice(preserved, slice)
                    : null;
                if ((preserved === null || preserved === void 0 ? void 0 : preserved.itemTypeId) === record.itemTypeId &&
                    preserved.validity[slice] === false &&
                    preservedVersion &&
                    uniqueFieldValues(preservedVersion.fields[field.apiKey], field).some(([candidateLocale, candidateValue]) => candidateLocale === locale &&
                        (0, canonicalize_1.semanticHash)(candidateValue) === valueHash)) {
                    return {
                        supported: true,
                        fieldId: field.id,
                        peerIds: [peer.id],
                    };
                }
            }
        }
    }
    return {
        supported: false,
        fieldId: firstFieldId,
        peerIds: [...peerIds].sort(),
    };
}
function recordVersionForSlice(record, slice) {
    return slice === 'current' ? record.current : record.published;
}
function protectSkippedOrderingAnchors(source, target, skips, protectedTargetRecordIds) {
    var _a, _b;
    let changed = false;
    const itemTypes = new Map(source.schema.itemTypes.map((itemType) => [itemType.id, itemType]));
    for (const anchorId of [...skips.keys()].sort()) {
        const anchor = target.records[anchorId];
        const itemType = anchor ? itemTypes.get(anchor.itemTypeId) : undefined;
        if (!anchor || (!(itemType === null || itemType === void 0 ? void 0 : itemType.tree) && !(itemType === null || itemType === void 0 ? void 0 : itemType.sortable)))
            continue;
        const anchorParentId = itemType.tree ? anchor.topology.parentId : null;
        for (const record of Object.values(source.records).sort((left, right) => left.id.localeCompare(right.id))) {
            if (skips.has(record.id) || record.itemTypeId !== anchor.itemTypeId) {
                continue;
            }
            const baseline = (_a = target.records[record.id]) !== null && _a !== void 0 ? _a : null;
            const desiredParentId = itemType.tree ? record.topology.parentId : null;
            const baselineParentId = itemType.tree
                ? (_b = baseline === null || baseline === void 0 ? void 0 : baseline.topology.parentId) !== null && _b !== void 0 ? _b : null
                : null;
            const touchesAnchorGroup = desiredParentId === anchorParentId ||
                (baseline !== null && baselineParentId === anchorParentId);
            const shiftsOrdering = !baseline ||
                (touchesAnchorGroup &&
                    (desiredParentId !== baselineParentId ||
                        record.topology.position !== baseline.topology.position));
            if (!touchesAnchorGroup || !shiftsOrdering)
                continue;
            addSkip(skips, record.id, {
                code: 'ORDERING_ANCHOR',
                slice: 'intermediate',
                message: `Record ${record.id} was skipped because changing its sibling position or parent could shift immutable skipped ordering anchor ${anchorId}.`,
                dependencyId: anchorId,
                dependencyChain: [record.id, anchorId],
            }, true);
            changed = true;
        }
        for (const candidate of Object.values(target.records)) {
            if (source.records[candidate.id] ||
                candidate.itemTypeId !== anchor.itemTypeId ||
                (itemType.tree ? candidate.topology.parentId : null) !==
                    anchorParentId ||
                protectedTargetRecordIds.has(candidate.id)) {
                continue;
            }
            protectedTargetRecordIds.add(candidate.id);
            changed = true;
        }
    }
    return changed;
}
function reconcileSkipProtection(source, target, skips, detectedRecordIds, explicitlyProtectedTargetRecordIds) {
    const sourceTraversalSchema = (0, inspection_schema_1.contentTraversalSchema)(source);
    const orderingProtectedTargetRecordIds = new Set();
    let orderingChanged = true;
    while (orderingChanged) {
        propagateSkippedDependencies(source, target, skips);
        orderingChanged = protectSkippedOrderingAnchors(source, target, skips, orderingProtectedTargetRecordIds);
    }
    let protectedTargetRecordIds = [
        ...new Set([
            ...protectedTargetRecords(source, target, skips, explicitlyProtectedTargetRecordIds),
            ...orderingProtectedTargetRecordIds,
        ]),
    ].sort();
    let protectedUploadIds = protectedUploads(target, skips, protectedTargetRecordIds);
    let uploadPropagationChanged = true;
    while (uploadPropagationChanged) {
        uploadPropagationChanged = false;
        for (const record of Object.values(source.records).sort((left, right) => left.id.localeCompare(right.id))) {
            if (skips.has(record.id) ||
                recordOperation(record, target.records[record.id]).noop) {
                continue;
            }
            const conflictingUploadId = (0, dependencies_1.collectUploadReferences)(record, sourceTraversalSchema).find((uploadId) => {
                if (!protectedUploadIds.has(uploadId))
                    return false;
                const desiredUpload = source.uploads[uploadId];
                const baselineUpload = target.uploads[uploadId];
                return Boolean(!desiredUpload ||
                    !baselineUpload ||
                    desiredUpload.hash !== baselineUpload.hash);
            });
            if (!conflictingUploadId)
                continue;
            detectedRecordIds.add(record.id);
            addSkip(skips, record.id, {
                code: 'DEPENDENCY_ON_SKIPPED_RECORD',
                slice: 'current',
                message: `Record ${record.id} depends on upload ${conflictingUploadId}, whose destination state must be preserved for skipped content.`,
                dependencyId: conflictingUploadId,
                dependencyChain: [record.id, conflictingUploadId],
            }, true);
            uploadPropagationChanged = true;
        }
        if (!uploadPropagationChanged)
            continue;
        propagateSkippedDependencies(source, target, skips);
        while (protectSkippedOrderingAnchors(source, target, skips, orderingProtectedTargetRecordIds)) {
            propagateSkippedDependencies(source, target, skips);
        }
        protectedTargetRecordIds = [
            ...new Set([
                ...protectedTargetRecords(source, target, skips, explicitlyProtectedTargetRecordIds),
                ...orderingProtectedTargetRecordIds,
            ]),
        ].sort();
        protectedUploadIds = protectedUploads(target, skips, protectedTargetRecordIds);
    }
    return { protectedTargetRecordIds, protectedUploadIds };
}
function protectedTargetRecords(source, target, skips, seedIds = new Set()) {
    const traversalSchema = (0, inspection_schema_1.contentTraversalSchema)(target);
    const protectedIds = new Set(seedIds);
    const queue = [
        ...new Set([
            ...[...skips.keys()].filter((id) => Boolean(target.records[id])),
            ...seedIds,
        ]),
    ];
    for (const skippedId of skips.keys()) {
        const skipped = source.records[skippedId];
        const itemType = skipped
            ? source.schema.itemTypes.find(({ id }) => id === skipped.itemTypeId)
            : null;
        if (!(itemType === null || itemType === void 0 ? void 0 : itemType.singleton))
            continue;
        for (const candidate of Object.values(target.records)) {
            if (candidate.itemTypeId === skipped.itemTypeId) {
                protectedIds.add(candidate.id);
                queue.push(candidate.id);
            }
        }
    }
    while (queue.length > 0) {
        const ownerId = queue.shift();
        const owner = target.records[ownerId];
        if (!owner)
            continue;
        for (const { toRecordId } of (0, dependencies_1.collectRecordReferences)(owner, traversalSchema)) {
            if (!target.records[toRecordId] ||
                source.records[toRecordId] ||
                protectedIds.has(toRecordId)) {
                continue;
            }
            protectedIds.add(toRecordId);
            queue.push(toRecordId);
        }
    }
    return [...protectedIds].sort();
}
function protectedUploads(target, skips, protectedTargetRecordIds) {
    const traversalSchema = (0, inspection_schema_1.contentTraversalSchema)(target);
    return new Set([...skips.keys(), ...protectedTargetRecordIds]
        .flatMap((recordId) => {
        const record = target.records[recordId];
        return record ? (0, dependencies_1.collectUploadReferences)(record, traversalSchema) : [];
    })
        .sort());
}
function hasScheduledPreservedSkip(target, skips) {
    return [...skips.keys()].some((recordId) => hasSchedule(target.records[recordId]));
}
function hasSchedule(record) {
    return Boolean((record === null || record === void 0 ? void 0 : record.schedules.publication) || (record === null || record === void 0 ? void 0 : record.schedules.unpublishing));
}
function finalizeRelaxations(schema, pendingRelaxations) {
    const fields = new Map(schema.itemTypes.flatMap((itemType) => itemType.fields.map((field) => [field.id, field])));
    return [...pendingRelaxations]
        .sort((left, right) => left.fieldId.localeCompare(right.fieldId))
        .map((pending) => {
        const field = fields.get(pending.fieldId);
        if (!field) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Validator relaxation refers to unknown field ${pending.fieldId}.`, { fieldId: pending.fieldId });
        }
        const relaxedValidatorKeys = [...pending.validatorKeys].sort();
        const relaxedValidators = Object.fromEntries(Object.entries(field.validators).filter(([key]) => !pending.validatorKeys.has(key)));
        const originalHash = (0, canonicalize_1.semanticHash)(field.validators);
        const relaxedHash = (0, canonicalize_1.semanticHash)(relaxedValidators);
        return {
            fieldId: pending.fieldId,
            itemTypeId: pending.itemTypeId,
            originalValidators: field.validators,
            relaxedValidators,
            originalHash,
            relaxedHash,
            allowedValidatorHashes: [originalHash, relaxedHash],
            relaxedValidatorKeys,
            affectedRecordIds: [...pending.affectedRecordIds].sort(),
            reasons: deduplicateReasons(pending.reasons),
        };
    });
}
function schemaWithRelaxations(schema, relaxations) {
    const byFieldId = new Map(relaxations.map((relaxation) => [relaxation.fieldId, relaxation]));
    const relaxed = {
        ...schema,
        itemTypes: schema.itemTypes.map((itemType) => ({
            ...itemType,
            fields: itemType.fields.map((field) => {
                const relaxation = byFieldId.get(field.id);
                return relaxation
                    ? { ...field, validators: relaxation.relaxedValidators }
                    : field;
            }),
        })),
        digest: '',
    };
    relaxed.digest = (0, schema_1.computeSchemaDigest)(relaxed);
    return relaxed;
}
function skippedAggregate(sourceRecord, targetRecord, reasons, source, target, externalCollision, preservedExternalBlockIds) {
    var _a, _b, _c;
    return {
        id: sourceRecord.id,
        itemTypeId: sourceRecord.itemTypeId,
        disposition: externalCollision
            ? 'preserve_external'
            : targetRecord
                ? 'preserve_target'
                : 'must_remain_absent',
        sourceHash: sourceRecord.hash,
        expectedTargetHash: (_a = targetRecord === null || targetRecord === void 0 ? void 0 : targetRecord.hash) !== null && _a !== void 0 ? _a : null,
        expectedTargetPosition: (_b = targetRecord === null || targetRecord === void 0 ? void 0 : targetRecord.topology.position) !== null && _b !== void 0 ? _b : null,
        sourceValidity: sourceRecord.validity,
        targetValidity: (_c = targetRecord === null || targetRecord === void 0 ? void 0 : targetRecord.validity) !== null && _c !== void 0 ? _c : null,
        sourceNestedBlockIds: nestedBlockIdsForRecord(source, sourceRecord.id),
        preservedExternalBlockIds,
        targetNestedBlockIds: targetRecord
            ? nestedBlockIdsForRecord(target, targetRecord.id)
            : [],
        reasons: deduplicateReasons(reasons),
    };
}
function nestedBlockIdsForRecord(snapshot, recordId) {
    return Object.entries(snapshot.blockOwnership)
        .filter(([, entries]) => entries.some(({ topRecordId }) => topRecordId === recordId))
        .map(([blockId]) => blockId)
        .sort();
}
function blockOwnershipLocation(ownership) {
    var _a;
    return [
        ownership.topRecordId,
        ownership.itemTypeId,
        ownership.fieldPath,
        (_a = ownership.locale) !== null && _a !== void 0 ? _a : '',
    ].join('\0');
}
function deduplicateReasons(reasons) {
    return [
        ...new Map(reasons.map((reason) => [(0, canonicalize_1.stableStringify)(reason), reason])).values(),
    ].sort((left, right) => {
        var _a, _b;
        return left.code.localeCompare(right.code) ||
            ((_a = left.slice) !== null && _a !== void 0 ? _a : '').localeCompare((_b = right.slice) !== null && _b !== void 0 ? _b : '') ||
            left.dependencyChain
                .join(',')
                .localeCompare(right.dependencyChain.join(','));
    });
}
function filterSnapshotsForInvalidContent(source, target, skippedRecordIds, protectedTargetRecordIds, protectedUploadIds, uploadsMode) {
    const sourceTraversalSchema = (0, inspection_schema_1.contentTraversalSchema)(source);
    const sourceRecords = Object.fromEntries(Object.entries(source.records).filter(([id]) => !skippedRecordIds.has(id)));
    const targetRecords = Object.fromEntries(Object.entries(target.records).filter(([id]) => !skippedRecordIds.has(id) && !protectedTargetRecordIds.has(id)));
    const desiredReferencedUploadIds = new Set(Object.values(sourceRecords).flatMap((record) => (0, dependencies_1.collectUploadReferences)(record, sourceTraversalSchema)));
    const skippedReferencedUploadIds = new Set([...skippedRecordIds].flatMap((recordId) => {
        const record = source.records[recordId];
        return record
            ? (0, dependencies_1.collectUploadReferences)(record, sourceTraversalSchema)
            : [];
    }));
    const sourceUploads = Object.fromEntries(Object.entries(source.uploads).filter(([id]) => uploadsMode === 'all' ||
        desiredReferencedUploadIds.has(id) ||
        !skippedReferencedUploadIds.has(id)));
    for (const uploadId of protectedUploadIds) {
        const baseline = target.uploads[uploadId];
        if (baseline)
            sourceUploads[uploadId] = baseline;
    }
    const sourceCollections = collectionClosureForUploads(sourceUploads, source.uploadCollections, target.uploadCollections);
    return {
        source: {
            ...source,
            records: sourceRecords,
            uploads: sourceUploads,
            uploadCollections: sourceCollections,
            blockOwnership: filterBlockOwnership(source.blockOwnership, new Set(Object.keys(sourceRecords))),
        },
        target: {
            ...target,
            records: targetRecords,
            blockOwnership: filterBlockOwnership(target.blockOwnership, new Set(Object.keys(targetRecords))),
        },
    };
}
function filterBlockOwnership(ownership, recordIds) {
    return Object.fromEntries(Object.entries(ownership)
        .map(([blockId, entries]) => [
        blockId,
        entries.filter(({ topRecordId }) => recordIds.has(topRecordId)),
    ])
        .filter(([, entries]) => entries.length > 0));
}
function collectionClosureForUploads(uploads, primary, fallback) {
    const collections = { ...fallback, ...primary };
    const selected = new Set(Object.values(uploads)
        .map(({ manual }) => manual.collectionId)
        .filter((id) => Boolean(id)));
    for (const id of [...selected]) {
        let collection = collections[id];
        while (collection === null || collection === void 0 ? void 0 : collection.parentId) {
            selected.add(collection.parentId);
            collection = collections[collection.parentId];
        }
    }
    return Object.fromEntries([...selected]
        .sort()
        .flatMap((id) => (collections[id] ? [[id, collections[id]]] : [])));
}
function assertNoDraftCreateSeedSafety(source, target, creationRecordIds, createOrder) {
    const createOrderIndex = new Map(createOrder.map((recordId, index) => [recordId, index]));
    const itemTypesById = new Map(source.schema.itemTypes.map((itemType) => [itemType.id, itemType]));
    for (const recordId of [...creationRecordIds].sort()) {
        const record = source.records[recordId];
        const itemType = itemTypesById.get(record.itemTypeId);
        if (!itemType || itemType.draftModeActive)
            continue;
        const recordIndex = createOrderIndex.get(recordId);
        for (const dependencyId of (0, dependencies_1.collectPublishedDependencyIds)(record, source.schema)) {
            const dependencyCreateIndex = createOrderIndex.get(dependencyId);
            if (dependencyCreateIndex !== undefined) {
                // Optional references to later creates are absent from the exact seed
                // body. Every retained earlier create must already auto-publish.
                if (recordIndex !== undefined && dependencyCreateIndex > recordIndex) {
                    continue;
                }
                const dependency = source.records[dependencyId];
                const dependencyItemType = dependency
                    ? itemTypesById.get(dependency.itemTypeId)
                    : undefined;
                if (dependencyItemType === null || dependencyItemType === void 0 ? void 0 : dependencyItemType.draftModeActive) {
                    throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `No-draft record ${recordId} auto-publishes during creation, but its seed depends on source-only draft-mode record ${dependencyId}, which is not published yet.`, { recordId, dependencyId });
                }
                continue;
            }
            const existingDependency = target.records[dependencyId];
            if (existingDependency && !existingDependency.published) {
                throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `No-draft record ${recordId} auto-publishes during creation, but existing dependency ${dependencyId} has no published destination version.`, { recordId, dependencyId });
            }
        }
    }
}
function summarizeContentDiffPlan(plan) {
    var _a, _b;
    const summary = emptySummary();
    plan.records.forEach(({ action }) => {
        if (action !== 'noop')
            summary.records[action] += 1;
    });
    plan.uploads.forEach(({ action }) => {
        if (action !== 'noop')
            summary.uploads[action] += 1;
    });
    plan.uploadCollections.forEach(({ action }) => {
        if (action !== 'noop')
            summary.uploadCollections[action] += 1;
    });
    summary.invalidContent = {
        status: plan.invalidContent.skippedRecords.length > 0 ? 'partial' : 'complete',
        detectedRecords: plan.invalidContent.detectedRecordIds.length,
        migratedRecords: plan.invalidContent.migratedRecordIds.length,
        skippedRecords: plan.invalidContent.skippedRecords.length,
        propagatedSkipCount: plan.invalidContent.propagatedSkipCount,
        validatorRelaxations: plan.invalidContent.validatorRelaxations.length,
        relaxedFieldCount: plan.invalidContent.validatorRelaxations.length,
        relaxedValidatorCount: plan.invalidContent.validatorRelaxations.reduce((sum, { relaxedValidatorKeys }) => sum + relaxedValidatorKeys.length, 0),
        requiresTemporaryValidatorRelaxation: plan.invalidContent.validatorRelaxations.length > 0,
    };
    summary.legacyIdMappings = {
        detected: plan.legacyIdMappings.entries.length +
            plan.legacyIdMappings.skippedEntries.length,
        existing: plan.legacyIdMappings.entries.filter(({ status }) => status === 'existing').length,
        created: plan.legacyIdMappings.entries.filter(({ status }) => status === 'new').length,
        skipped: plan.legacyIdMappings.skippedEntries.length,
        records: (_b = (_a = plan.legacyIdMappings.newMappingBatch) === null || _a === void 0 ? void 0 : _a.chunks.length) !== null && _b !== void 0 ? _b : 0,
    };
    summary.warnings = plan.warnings.length;
    return summary;
}
function buildRecordPlans(source, target, includeDeletions, dependencies, warnings) {
    var _a, _b, _c, _d, _e;
    const plans = [];
    const traversalSchema = (0, inspection_schema_1.contentTraversalSchema)(source);
    const allIds = new Set([
        ...Object.keys(source.records),
        ...Object.keys(target.records),
    ]);
    for (const id of [...allIds].sort()) {
        const desired = (_a = source.records[id]) !== null && _a !== void 0 ? _a : null;
        const baseline = (_b = target.records[id]) !== null && _b !== void 0 ? _b : null;
        if (desired && baseline && desired.itemTypeId !== baseline.itemTypeId) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Record ${id} represents different models in source and destination.`, {
                recordId: id,
                sourceItemTypeId: desired.itemTypeId,
                targetItemTypeId: baseline.itemTypeId,
            });
        }
        if (desired && !baseline) {
            plans.push({
                id,
                itemTypeId: desired.itemTypeId,
                action: 'create',
                expectedTargetHash: null,
                baseline: null,
                desired,
                changes: createRecordChanges(desired, source),
                dependencies: (_c = dependencies[id]) !== null && _c !== void 0 ? _c : [],
                publishedDependencies: (0, dependencies_1.collectPublishedDependencyIds)(desired, traversalSchema),
                allowedIntermediateHashes: [],
            });
        }
        else if (desired &&
            baseline &&
            (desired.hash !== baseline.hash ||
                desired.topology.position !== baseline.topology.position)) {
            plans.push({
                id,
                itemTypeId: desired.itemTypeId,
                action: 'update',
                expectedTargetHash: baseline.hash,
                baseline,
                desired,
                changes: compareRecordChanges(desired, baseline),
                dependencies: (_d = dependencies[id]) !== null && _d !== void 0 ? _d : [],
                publishedDependencies: (0, dependencies_1.collectPublishedDependencyIds)(desired, traversalSchema),
                allowedIntermediateHashes: [],
            });
        }
        else if (!desired && baseline) {
            if (includeDeletions) {
                plans.push({
                    id,
                    itemTypeId: baseline.itemTypeId,
                    action: 'delete',
                    expectedTargetHash: baseline.hash,
                    baseline,
                    desired: null,
                    changes: deleteRecordChanges(baseline),
                    dependencies: [],
                    publishedDependencies: [],
                    allowedIntermediateHashes: [],
                });
            }
            else {
                warnings.push({
                    code: 'RETAINED_TARGET_RECORD',
                    message: `Destination-only record ${id} is retained because --include-deletions was not used.`,
                    entityIds: [id],
                });
            }
        }
        else if (desired && baseline) {
            // Validity is derived and can lag schema/content changes. A semantic
            // noop performs no write, so its attainable final validity is exactly
            // the baseline validity observed in the destination.
            const attainableDesired = {
                ...desired,
                validity: baseline.validity,
            };
            plans.push({
                id,
                itemTypeId: desired.itemTypeId,
                action: 'noop',
                expectedTargetHash: baseline.hash,
                baseline,
                desired: attainableDesired,
                changes: allRecordChanges(false),
                dependencies: (_e = dependencies[id]) !== null && _e !== void 0 ? _e : [],
                publishedDependencies: (0, dependencies_1.collectPublishedDependencyIds)(desired, traversalSchema),
                allowedIntermediateHashes: [],
            });
        }
    }
    if (!includeDeletions) {
        const retainedIds = Object.keys(target.records).filter((id) => !(id in source.records));
        const affectsOrderedModels = retainedIds.some((id) => {
            const record = target.records[id];
            const itemType = source.schema.itemTypes.find(({ id: itemTypeId }) => itemTypeId === record.itemTypeId);
            return (itemType === null || itemType === void 0 ? void 0 : itemType.sortable) || (itemType === null || itemType === void 0 ? void 0 : itemType.tree);
        });
        if (affectsOrderedModels) {
            warnings.push({
                code: 'ABSOLUTE_POSITION_NOT_REPRODUCIBLE',
                message: 'Destination-only siblings are retained, so only source-managed relative ordering can be reproduced.',
                entityIds: retainedIds.sort(),
            });
        }
    }
    return plans;
}
function buildUploadPlans(source, target, includeDeletions, warnings) {
    var _a, _b;
    const plans = [];
    const allIds = new Set([
        ...Object.keys(source.uploads),
        ...Object.keys(target.uploads),
    ]);
    for (const id of [...allIds].sort()) {
        const desired = (_a = source.uploads[id]) !== null && _a !== void 0 ? _a : null;
        const baseline = (_b = target.uploads[id]) !== null && _b !== void 0 ? _b : null;
        if (desired && !baseline) {
            plans.push({
                id,
                action: 'create',
                expectedTargetHash: null,
                baseline: null,
                desired,
                changes: { binary: true, metadata: true, collection: true },
            });
        }
        else if (desired && baseline && desired.hash !== baseline.hash) {
            plans.push({
                id,
                action: 'update',
                expectedTargetHash: baseline.hash,
                baseline,
                desired,
                changes: (0, upload_contract_1.compareUploadChanges)(desired, baseline),
            });
        }
        else if (!desired && baseline) {
            if (includeDeletions) {
                plans.push({
                    id,
                    action: 'delete',
                    expectedTargetHash: baseline.hash,
                    baseline,
                    desired: null,
                    changes: { binary: false, metadata: false, collection: false },
                });
            }
            else {
                warnings.push({
                    code: 'RETAINED_TARGET_UPLOAD',
                    message: `Destination-only upload ${id} is retained because --include-deletions was not used.`,
                    entityIds: [id],
                });
            }
        }
        else if (desired && baseline) {
            plans.push({
                id,
                action: 'noop',
                expectedTargetHash: baseline.hash,
                baseline,
                desired,
                changes: { binary: false, metadata: false, collection: false },
            });
        }
    }
    return plans;
}
function buildUploadCollectionPlans(source, target) {
    return Object.values(source.uploadCollections)
        .sort((left, right) => left.id.localeCompare(right.id))
        .flatMap((desired) => {
        const baseline = target.uploadCollections[desired.id];
        if (!baseline) {
            return [
                {
                    id: desired.id,
                    action: 'create',
                    expectedTargetHash: null,
                    baseline: null,
                    desired,
                },
            ];
        }
        if (baseline.hash !== desired.hash) {
            return [
                {
                    id: desired.id,
                    action: 'update',
                    expectedTargetHash: baseline.hash,
                    baseline,
                    desired,
                },
            ];
        }
        return [
            {
                id: desired.id,
                action: 'noop',
                expectedTargetHash: baseline.hash,
                baseline,
                desired,
            },
        ];
    });
}
function assertSnapshotCompatibility(source, target, options) {
    assertInspectionSnapshot(source);
    assertInspectionSnapshot(target);
    (0, schema_1.assertSchemasCompatible)(source.schema, target.schema);
    if (source.environmentId === target.environmentId) {
        throw new types_1.ContentDiffError('INVALID_SCOPE', 'Source and destination environments must be different.');
    }
    if (source.scope.itemTypeIds.join(',') !== target.scope.itemTypeIds.join(',')) {
        throw new types_1.ContentDiffError('INVALID_SCOPE', 'Source and destination snapshots use different item-type scopes.');
    }
    if (source.scope.uploads !== options.uploads ||
        target.scope.uploads !== options.uploads) {
        throw new types_1.ContentDiffError('INVALID_SCOPE', 'Plan upload mode does not match the captured snapshot scope.');
    }
}
function assertInspectionSnapshot(snapshot) {
    var _a;
    const managedIds = new Set(snapshot.schema.itemTypes.map(({ id }) => id));
    const inspectionIds = snapshot.inspection.itemTypes.map(({ id }) => id);
    if (new Set(inspectionIds).size !== inspectionIds.length ||
        inspectionIds.some((id, index) => index > 0 && inspectionIds[index - 1].localeCompare(id) >= 0) ||
        inspectionIds.some((id) => managedIds.has(id)) ||
        snapshot.inspection.itemTypes.some(({ modularBlock }) => !modularBlock) ||
        (0, inspection_schema_1.inspectionItemTypesDigest)(snapshot.inspection.itemTypes) !==
            snapshot.inspection.digest) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Snapshot ${snapshot.environmentId} has an invalid content-inspection schema.`, { environmentId: snapshot.environmentId });
    }
    const traversalSchema = (0, inspection_schema_1.contentTraversalSchema)(snapshot);
    const itemTypes = new Map(traversalSchema.itemTypes.map((itemType) => [itemType.id, itemType]));
    const fields = new Map(traversalSchema.itemTypes.flatMap((itemType) => itemType.fields.map((field) => [field.id, field])));
    const issueKeys = new Set();
    for (const issue of snapshot.inspection.structuralIssues) {
        const record = snapshot.records[issue.recordId];
        const ownerItemType = record && itemTypes.get(record.itemTypeId);
        const blockType = itemTypes.get(issue.blockItemTypeId);
        const field = fields.get(issue.fieldId);
        const validator = field === null || field === void 0 ? void 0 : field.validators[issue.validatorKey];
        const allowedItemTypeIds = validator &&
            typeof validator === 'object' &&
            !Array.isArray(validator) &&
            Array.isArray(validator.item_types) &&
            validator.item_types.every((id) => typeof id === 'string')
            ? validator.item_types
            : null;
        const ownership = (_a = snapshot.blockOwnership[issue.blockId]) !== null && _a !== void 0 ? _a : [];
        const issueKey = (0, canonicalize_1.stableStringify)(issue);
        if (!record ||
            !ownerItemType ||
            ownerItemType.modularBlock ||
            issue.itemTypeId !== record.itemTypeId ||
            !(blockType === null || blockType === void 0 ? void 0 : blockType.modularBlock) ||
            !field ||
            !structuralValidatorMatchesField(issue.validatorKey, field.fieldType) ||
            !allowedItemTypeIds ||
            allowedItemTypeIds.includes(issue.blockItemTypeId) ||
            issue.fieldPath.length === 0 ||
            (issue.locale !== null &&
                !snapshot.schema.locales.includes(issue.locale)) ||
            issueKeys.has(issueKey) ||
            !ownership.some((entry) => entry.topRecordId === record.id &&
                entry.itemTypeId === issue.blockItemTypeId &&
                entry.version === issue.slice &&
                entry.locale === issue.locale &&
                (issue.fieldPath === entry.fieldPath ||
                    issue.fieldPath.startsWith(`${entry.fieldPath}.`) ||
                    issue.fieldPath.startsWith(`${entry.fieldPath}[`)))) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Snapshot ${snapshot.environmentId} has an invalid structural-content diagnostic for record ${issue.recordId}.`, { environmentId: snapshot.environmentId, recordId: issue.recordId });
        }
        issueKeys.add(issueKey);
    }
}
function structuralValidatorMatchesField(validatorKey, fieldType) {
    if (validatorKey === 'rich_text_blocks')
        return fieldType === 'rich_text';
    if (validatorKey === 'single_block_blocks')
        return fieldType === 'single_block';
    return ((validatorKey === 'structured_text_blocks' ||
        validatorKey === 'structured_text_inline_blocks') &&
        fieldType === 'structured_text');
}
function assertPortableNewIds(source, target) {
    const candidates = [
        ...Object.keys(source.records).filter((id) => !(id in target.records)),
        ...Object.keys(source.blockOwnership).filter((id) => !(id in target.blockOwnership)),
        ...Object.keys(source.uploads).filter((id) => !(id in target.uploads)),
        ...Object.keys(source.uploadCollections).filter((id) => !(id in target.uploadCollections)),
    ];
    const invalid = [
        ...new Set(candidates.filter((id) => !(0, canonicalize_1.isPortableDatoId)(id))),
    ].sort();
    if (invalid.length > 0) {
        throw new types_1.ContentDiffError('LEGACY_ID_NOT_PORTABLE', `Source-only entities use legacy IDs that cannot be requested on create: ${invalid.join(', ')}.`, { entityIds: invalid });
    }
}
function assertNoRecordBlockIdCollisions(snapshot) {
    const collisions = Object.keys(snapshot.blockOwnership).filter((id) => id in snapshot.records);
    if (collisions.length > 0) {
        throw new types_1.ContentDiffError('DUPLICATE_ENTITY_ID', `Record and block IDs collide: ${collisions.sort().join(', ')}.`, { entityIds: collisions.sort() });
    }
}
function assertNoOutOfScopeRecordIdCollisions(source, target) {
    const targetVisibleIds = new Set(target.visibleRecordIds);
    const collisions = Object.keys(source.records)
        .filter((id) => !(id in target.records) && targetVisibleIds.has(id))
        .sort();
    if (collisions.length > 0) {
        throw new types_1.ContentDiffError('DUPLICATE_ENTITY_ID', `Source record IDs already belong to out-of-scope destination records: ${collisions.join(', ')}.`, { entityIds: collisions });
    }
}
function compareRecordChanges(desired, baseline) {
    var _a, _b;
    return {
        current: desired.current.hash !== baseline.current.hash,
        published: ((_a = desired.published) === null || _a === void 0 ? void 0 : _a.hash) !== ((_b = baseline.published) === null || _b === void 0 ? void 0 : _b.hash),
        topology: (0, canonicalize_1.stableStringify)(desired.topology) !== (0, canonicalize_1.stableStringify)(baseline.topology),
        lifecycle: (0, canonicalize_1.stableStringify)(desired.lifecycle) !==
            (0, canonicalize_1.stableStringify)(baseline.lifecycle),
        stage: desired.stage !== baseline.stage,
        schedules: (0, canonicalize_1.stableStringify)(desired.schedules) !==
            (0, canonicalize_1.stableStringify)(baseline.schedules),
    };
}
function assertUploadFilenameBasenames(snapshot, label) {
    const invalid = Object.values(snapshot.uploads).find((upload) => upload.basename !== (0, upload_contract_1.uploadBasenameFromFilename)(upload.filename));
    if (invalid) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `${label} upload ${invalid.id} has basename ${JSON.stringify(invalid.basename)}, which does not match filename stem ${JSON.stringify((0, upload_contract_1.uploadBasenameFromFilename)(invalid.filename))}. Regenerate the snapshot from canonical CMA upload state.`, { entityIds: [invalid.id] });
    }
}
function requiredPermissions(schema, selectedItemTypeIds, readItemTypes, records, uploads, collections, shellRecordIds, temporarySeedRecordIds, deleteReleases, editSchema, legacyIdMappings) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const itemTypeActions = new Map(selectedItemTypeIds.map((id) => [id, new Set(['read'])]));
    const uploadActions = new Set(['read']);
    let manageSchedules = false;
    const hasPlannedCmaMutations = records.some(({ action }) => action !== 'noop') ||
        uploads.some(({ action }) => action !== 'noop') ||
        collections.some(({ action }) => action !== 'noop') ||
        editSchema ||
        legacyIdMappings.newMappingBatch !== null;
    const shellRecordIdSet = new Set(shellRecordIds);
    const temporarySeedRecordIdSet = new Set(temporarySeedRecordIds);
    const deleteReleaseByRecordId = new Map(deleteReleases.map((release) => [release.recordId, release]));
    for (const record of records) {
        const actions = (_a = itemTypeActions.get(record.itemTypeId)) !== null && _a !== void 0 ? _a : new Set(['read']);
        itemTypeActions.set(record.itemTypeId, actions);
        const itemType = schema.itemTypes.find(({ id }) => id === record.itemTypeId);
        if (record.action === 'create')
            actions.add('create');
        if ((record.action === 'update' &&
            (record.changes.current ||
                record.changes.topology ||
                record.changes.lifecycle ||
                Boolean(((_b = record.desired) === null || _b === void 0 ? void 0 : _b.published) &&
                    (((_c = record.baseline) === null || _c === void 0 ? void 0 : _c.current.hash) !==
                        record.desired.published.hash ||
                        record.desired.current.hash !== record.desired.published.hash)))) ||
            (record.action === 'create' &&
                (shellRecordIdSet.has(record.id) ||
                    temporarySeedRecordIdSet.has(record.id) ||
                    record.changes.topology ||
                    Boolean(((_d = record.desired) === null || _d === void 0 ? void 0 : _d.published) &&
                        record.desired.current.hash !== record.desired.published.hash)))) {
            actions.add('update');
        }
        if (((itemType === null || itemType === void 0 ? void 0 : itemType.tree) || (itemType === null || itemType === void 0 ? void 0 : itemType.sortable)) &&
            (record.action === 'create' ||
                record.action === 'delete' ||
                record.changes.topology)) {
            // Ordered writes shift siblings. Final reconciliation can therefore
            // update otherwise-unchanged managed records in the affected group.
            actions.add('update');
        }
        if (record.action === 'delete')
            actions.add('delete');
        const deleteRelease = deleteReleaseByRecordId.get(record.id);
        if (deleteRelease) {
            if (((_e = record.baseline) === null || _e === void 0 ? void 0 : _e.current.hash) !== deleteRelease.intermediateCurrentHash) {
                actions.add('update');
            }
            if (deleteRelease.publish)
                actions.add('publish');
        }
        if (record.changes.published &&
            (itemType === null || itemType === void 0 ? void 0 : itemType.draftModeActive) &&
            (record.action !== 'create' || ((_f = record.desired) === null || _f === void 0 ? void 0 : _f.published))) {
            actions.add('publish');
        }
        if (record.changes.stage &&
            (record.action !== 'create' || ((_g = record.desired) === null || _g === void 0 ? void 0 : _g.stage))) {
            actions.add('move_to_stage');
        }
        const hasDesiredSchedule = Boolean(((_h = record.desired) === null || _h === void 0 ? void 0 : _h.schedules.publication) ||
            ((_j = record.desired) === null || _j === void 0 ? void 0 : _j.schedules.unpublishing));
        const removesBaselineSchedule = Boolean(((_k = record.baseline) === null || _k === void 0 ? void 0 : _k.schedules.publication) ||
            ((_l = record.baseline) === null || _l === void 0 ? void 0 : _l.schedules.unpublishing));
        if (hasPlannedCmaMutations &&
            (hasDesiredSchedule || removesBaselineSchedule)) {
            actions.add('publish');
            manageSchedules = true;
        }
    }
    for (const action of (0, upload_contract_1.deriveRequiredUploadActions)(uploads)) {
        uploadActions.add(action);
    }
    const recordOrder = [
        'read',
        'create',
        'update',
        'publish',
        'delete',
        'move_to_stage',
    ];
    const uploadOrder = [
        'read',
        'create',
        'update',
        'replace_asset',
        'move',
        'delete',
    ];
    return {
        readItemTypes: [...readItemTypes].sort((left, right) => left.id.localeCompare(right.id)),
        itemTypes: [...itemTypeActions]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([id, actions]) => ({
            id,
            actions: recordOrder.filter((action) => actions.has(action)),
        })),
        uploadActions: uploadOrder.filter((action) => uploadActions.has(action)),
        manageUploadCollections: (0, upload_collection_contract_1.deriveRequiredManageUploadCollections)(collections),
        manageSchedules,
        editSchema: editSchema ||
            Boolean(legacyIdMappings.newMappingBatch &&
                [
                    legacyIdMappings.schema.model,
                    legacyIdMappings.schema.nameField,
                    legacyIdMappings.schema.mappingField,
                ].some(({ status }) => status === 'new')),
    };
}
function snapshotProvenance(snapshot) {
    return {
        siteId: snapshot.siteId,
        environmentId: snapshot.environmentId,
        schemaDigest: snapshot.schema.digest,
        snapshotDigest: snapshot.digest,
        capturedAt: snapshot.capturedAt,
    };
}
function mergeDependencies(base, additional) {
    var _a;
    const result = Object.fromEntries(Object.entries(base).map(([id, values]) => [id, [...values]]));
    for (const { fromRecordId, toRecordId } of additional) {
        (_a = result[fromRecordId]) !== null && _a !== void 0 ? _a : (result[fromRecordId] = []);
        result[fromRecordId].push(toRecordId);
    }
    for (const values of Object.values(result)) {
        values.splice(0, values.length, ...[...new Set(values)].sort());
    }
    return result;
}
function allRecordChanges(value) {
    return {
        current: value,
        published: value,
        topology: value,
        lifecycle: value,
        stage: value,
        schedules: value,
    };
}
function deleteRecordChanges(baseline) {
    return {
        ...allRecordChanges(false),
        schedules: Boolean(baseline.schedules.publication || baseline.schedules.unpublishing),
    };
}
function createRecordChanges(desired, source) {
    var _a;
    const itemType = source.schema.itemTypes.find(({ id }) => id === desired.itemTypeId);
    if (!itemType) {
        throw new types_1.ContentDiffError('INCOMPATIBLE_SCHEMA', `Record ${desired.id} refers to unknown model ${desired.itemTypeId}.`);
    }
    const workflow = itemType.workflowId
        ? source.schema.workflows.find(({ id }) => id === itemType.workflowId)
        : null;
    const initialStageId = (_a = workflow === null || workflow === void 0 ? void 0 : workflow.stages.find(({ initial }) => initial)) === null || _a === void 0 ? void 0 : _a.id;
    return {
        current: true,
        published: itemType.draftModeActive && desired.published !== null,
        topology: Boolean((itemType.tree && desired.topology.parentId !== null) ||
            ((itemType.tree || itemType.sortable) &&
                desired.topology.position !== null)),
        lifecycle: true,
        stage: desired.stage !== null &&
            (initialStageId === undefined || desired.stage !== initialStageId),
        schedules: Boolean(desired.schedules.publication || desired.schedules.unpublishing),
    };
}
function emptySummary() {
    return {
        records: { create: 0, update: 0, delete: 0 },
        uploads: { create: 0, update: 0, delete: 0 },
        uploadCollections: { create: 0, update: 0 },
        invalidContent: {
            status: 'complete',
            detectedRecords: 0,
            migratedRecords: 0,
            skippedRecords: 0,
            propagatedSkipCount: 0,
            validatorRelaxations: 0,
            relaxedFieldCount: 0,
            relaxedValidatorCount: 0,
            requiresTemporaryValidatorRelaxation: false,
        },
        legacyIdMappings: {
            detected: 0,
            existing: 0,
            created: 0,
            skipped: 0,
            records: 0,
        },
        warnings: 0,
    };
}
