"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prettyStableStringify = prettyStableStringify;
exports.deterministicPortableDatoId = deterministicPortableDatoId;
exports.readLegacyIdMappingRegistry = readLegacyIdMappingRegistry;
exports.assertNoManagedRelationshipToMappingModel = assertNoManagedRelationshipToMappingModel;
exports.prepareLegacyIdMappings = prepareLegacyIdMappings;
exports.emptyLegacyIdMappingPlan = emptyLegacyIdMappingPlan;
exports.applyLegacyIdMappingsToSnapshot = applyLegacyIdMappingsToSnapshot;
exports.remapInvalidContentDiagnostics = remapInvalidContentDiagnostics;
exports.finalizeLegacyIdMappingPlan = finalizeLegacyIdMappingPlan;
const node_crypto_1 = require("node:crypto");
const canonicalize_1 = require("./canonicalize");
const dependencies_1 = require("./dependencies");
const inspection_schema_1 = require("./inspection-schema");
const types_1 = require("./types");
const ITEM_NAMESPACE = 'item';
function prettyStableStringify(value) {
    return JSON.stringify((0, canonicalize_1.canonicalizeJson)(value), null, 2);
}
/**
 * Produces a deterministic, canonical, unpadded URL-safe Base64 v4 UUID.
 * The collision counter is part of the seed so callers can reserve the first
 * available ID without relying on random process state.
 */
function deterministicPortableDatoId(seed) {
    const bytes = (0, node_crypto_1.createHash)('sha256').update(seed).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytes.toString('base64url');
}
async function readLegacyIdMappingRegistry(client, schema, modelApiKey = types_1.DEFAULT_CONTENT_DIFF_MODEL_API_KEY, readRecords = true) {
    const schemaPlan = await mappingSchemaPlan(client, schema, modelApiKey);
    if (schemaPlan.model.status === 'new' || !readRecords) {
        return { schema: schemaPlan, entries: [], records: [] };
    }
    const records = [];
    const iterator = client.items.listPagedIterator({
        filter: { type: schemaPlan.model.id },
        order_by: 'id_ASC',
        version: 'current',
    }, { perPage: 500, concurrency: 5 });
    for await (const rawRecord of iterator) {
        if (!isObject(rawRecord)) {
            throw mappingRegistryError('The internal mapping model returned an invalid record.');
        }
        const id = requiredString(rawRecord.id, 'mapping record id');
        assertMappingRecordLifecycle(rawRecord, id);
        const name = requiredString(rawRecord[types_1.CONTENT_DIFF_MAPPING_NAME_FIELD_API_KEY], `mapping record ${id} name`);
        const mapping = requiredString(rawRecord[types_1.CONTENT_DIFF_MAPPING_FIELD_API_KEY], `mapping record ${id} mapping`);
        records.push({ id, name, mapping });
    }
    return {
        schema: schemaPlan,
        entries: validateMappingRecords(records, schema.siteId),
        records: records
            .map(({ id, mapping }) => ({
            id,
            hash: (0, node_crypto_1.createHash)('sha256').update(mapping).digest('hex'),
        }))
            .sort((left, right) => left.id.localeCompare(right.id)),
    };
}
function assertMappingRecordLifecycle(record, recordId) {
    const meta = record.meta;
    if (!isObject(meta) ||
        meta.status !== 'draft' ||
        meta.is_valid !== true ||
        meta.is_current_version_valid !== true ||
        meta.is_published_version_valid !== null ||
        meta.stage !== null ||
        meta.publication_scheduled_at !== null ||
        meta.unpublishing_scheduled_at !== null ||
        meta.published_at !== null ||
        meta.first_published_at !== null) {
        throw mappingRegistryError(`Internal mapping record ${recordId} must remain a valid, unscheduled, workflow-free draft with no published version.`);
    }
}
function assertNoManagedRelationshipToMappingModel(schema, modelApiKey = types_1.DEFAULT_CONTENT_DIFF_MODEL_API_KEY) {
    const internal = schema.itemTypes.find(({ apiKey }) => apiKey === modelApiKey);
    if (!internal)
        return;
    const structuralValidatorKeys = new Set([
        'item_item_type',
        'items_item_type',
        'rich_text_blocks',
        'single_block_blocks',
        'structured_text_blocks',
        'structured_text_inline_blocks',
        'structured_text_links',
    ]);
    for (const itemType of schema.itemTypes) {
        if (itemType.id === internal.id)
            continue;
        for (const field of itemType.fields) {
            for (const [validatorKey, validatorValue] of Object.entries(field.validators)) {
                if (structuralValidatorKeys.has(validatorKey) &&
                    jsonContainsExactString(validatorValue, internal.id)) {
                    throw new types_1.ContentDiffError('INVALID_SCOPE', `Managed field ${field.id} refers to reserved internal model ${modelApiKey}. Rename that model or remove the relationship before generating a content diff.`, { itemTypeId: itemType.id, fieldId: field.id, modelApiKey });
                }
            }
        }
    }
}
function prepareLegacyIdMappings(source, target, registry) {
    const sourceTraversalSchema = (0, inspection_schema_1.contentTraversalSchema)(source);
    validateRegistryEntries(registry.entries);
    const registryBySource = new Map(registry.entries.map((entry) => [mappingSourceKey(entry), entry]));
    const entries = [];
    const occupied = occupiedIds(source, target, registry.entries);
    for (const { id } of registry.records) {
        occupied.get(ITEM_NAMESPACE).add(id);
    }
    const managedCandidates = sourceOnlyLegacyEntities(source, target);
    for (const candidate of managedCandidates) {
        const existing = registryBySource.get(mappingSourceKey(candidate));
        if (existing && existing.entityType !== candidate.entityType) {
            throw mappingRegistryError(`Legacy Item ID ${candidate.sourceId} is claimed as both ${existing.entityType} and ${candidate.entityType}.`);
        }
        const targetId = existing
            ? existing.targetId
            : reserveEntityTargetId(target.siteId, candidate, occupied.get(mappingNamespace(candidate.entityType)));
        entries.push({
            ...candidate,
            targetId,
            status: existing ? 'existing' : 'new',
            managed: true,
            expectedItemTypeId: null,
            requiredAvailability: { current: true, published: false },
        });
    }
    const selectedRecordIds = new Set(Object.keys(source.records));
    const externalReferenceIds = new Set(Object.values(source.records)
        .flatMap((record) => (0, dependencies_1.collectRecordReferences)(record, sourceTraversalSchema))
        .map(({ toRecordId }) => toRecordId)
        .filter((id) => !selectedRecordIds.has(id) &&
        isLegacyDatoId(id) &&
        !target.visibleRecordIds.includes(id)));
    for (const sourceId of [...externalReferenceIds].sort()) {
        const existing = registryBySource.get(mappingSourceKey({ entityType: 'record', sourceId }));
        if (!existing)
            continue;
        if (existing.entityType !== 'record') {
            throw mappingRegistryError(`Legacy Item ID ${sourceId} is claimed as ${existing.entityType}, not record.`);
        }
        entries.push({
            ...existing,
            status: 'existing',
            managed: false,
            expectedItemTypeId: null,
            requiredAvailability: { current: false, published: false },
        });
    }
    const sortedEntries = sortPlanMappingEntries(entries);
    validatePlanMappingEntries(sortedEntries);
    return {
        formatVersion: types_1.LEGACY_ID_MAPPING_FORMAT_VERSION,
        schema: registry.schema,
        existingMappingRecords: [...registry.records].sort((left, right) => left.id.localeCompare(right.id)),
        entries: sortedEntries,
        skippedEntries: [],
        newMappingBatch: buildNewMappingBatch(target.siteId, registry.schema, sortedEntries.filter(({ status }) => status === 'new'), occupied.get(ITEM_NAMESPACE)),
    };
}
function emptyLegacyIdMappingPlan(snapshot, modelApiKey = types_1.DEFAULT_CONTENT_DIFF_MODEL_API_KEY) {
    const occupied = new Set([
        ...snapshot.schema.itemTypes.map(({ id }) => id),
        ...snapshot.schema.itemTypes.flatMap(({ fields }) => fields.map(({ id }) => id)),
        ...snapshot.inspection.itemTypes.map(({ id }) => id),
        ...snapshot.inspection.itemTypes.flatMap(({ fields }) => fields.map(({ id }) => id)),
    ]);
    return {
        formatVersion: types_1.LEGACY_ID_MAPPING_FORMAT_VERSION,
        schema: newMappingSchemaPlan(snapshot.siteId, modelApiKey, occupied),
        existingMappingRecords: [],
        entries: [],
        skippedEntries: [],
        newMappingBatch: null,
    };
}
function applyLegacyIdMappingsToSnapshot(snapshot, mappingPlan) {
    var _a;
    const maps = mappingMaps(mappingPlan.entries);
    const traversalSchema = (0, inspection_schema_1.contentTraversalSchema)(snapshot);
    const records = {};
    for (const record of Object.values(snapshot.records).sort((left, right) => left.id.localeCompare(right.id))) {
        const mapped = remapRecord(record, traversalSchema, maps);
        insertUnique(records, mapped.id, mapped, 'record');
    }
    const uploads = {};
    for (const upload of Object.values(snapshot.uploads).sort((left, right) => left.id.localeCompare(right.id))) {
        const id = mapId(maps.upload, upload.id);
        const manual = {
            ...upload.manual,
            collectionId: upload.manual.collectionId
                ? mapId(maps.upload_collection, upload.manual.collectionId)
                : null,
        };
        const semanticState = {
            id,
            md5: upload.md5,
            basename: upload.basename,
            filename: upload.filename,
            manual,
        };
        insertUnique(uploads, id, { ...upload, ...semanticState, hash: (0, canonicalize_1.semanticHash)(semanticState) }, 'upload');
    }
    const uploadCollections = {};
    for (const collection of Object.values(snapshot.uploadCollections).sort((left, right) => left.id.localeCompare(right.id))) {
        const semanticState = {
            id: mapId(maps.upload_collection, collection.id),
            label: collection.label,
            parentId: collection.parentId
                ? mapId(maps.upload_collection, collection.parentId)
                : null,
            position: collection.position,
        };
        insertUnique(uploadCollections, semanticState.id, { ...semanticState, hash: (0, canonicalize_1.semanticHash)(semanticState) }, 'upload collection');
    }
    const missingUploadReferences = Object.fromEntries(Object.entries((_a = snapshot.missingUploadReferences) !== null && _a !== void 0 ? _a : {})
        .map(([recordId, uploadIds]) => [
        mapId(maps.record, recordId),
        [...new Set(uploadIds.map((id) => mapId(maps.upload, id)))].sort(),
    ])
        .sort(([left], [right]) => left.localeCompare(right)));
    return {
        ...snapshot,
        records,
        uploads,
        uploadCollections,
        visibleRecordIds: [
            ...new Set(snapshot.visibleRecordIds.map((id) => mapId(maps.record, id))),
        ].sort(),
        blockOwnership: (0, dependencies_1.buildBlockOwnershipIndex)(records, traversalSchema),
        inspection: {
            ...snapshot.inspection,
            structuralIssues: snapshot.inspection.structuralIssues
                .map((issue) => ({
                ...issue,
                recordId: mapId(maps.record, issue.recordId),
                blockId: mapId(maps.block, issue.blockId),
            }))
                .sort((left, right) => {
                var _a, _b;
                return left.recordId.localeCompare(right.recordId) ||
                    left.slice.localeCompare(right.slice) ||
                    left.fieldPath.localeCompare(right.fieldPath) ||
                    ((_a = left.locale) !== null && _a !== void 0 ? _a : '').localeCompare((_b = right.locale) !== null && _b !== void 0 ? _b : '') ||
                    left.validatorKey.localeCompare(right.validatorKey) ||
                    left.blockId.localeCompare(right.blockId) ||
                    left.blockItemTypeId.localeCompare(right.blockItemTypeId);
            }),
        },
        missingUploadReferences,
        // This digest is capture provenance for the raw source environment. The
        // normalized target-ID view is wholly described by the plan ledger.
        digest: snapshot.digest,
    };
}
function remapInvalidContentDiagnostics(diagnostics, rawSource, mappedSource, target, mappingPlan) {
    var _a;
    const recordMap = mappingMaps(mappingPlan.entries).record;
    const maps = mappingMaps(mappingPlan.entries);
    const rawTraversalSchema = (0, inspection_schema_1.contentTraversalSchema)(rawSource);
    const rawIntermediateCandidates = (0, dependencies_1.collectCreateCycleIntermediateCandidates)(rawSource.records, rawTraversalSchema, new Set(Object.keys(rawSource.records).filter((id) => !(mapId(recordMap, id) in target.records))));
    const result = [];
    for (const diagnostic of diagnostics) {
        const mappedRecordId = mapId(recordMap, diagnostic.recordId);
        const rawRecord = rawSource.records[diagnostic.recordId];
        const mappedRecord = mappedSource.records[mappedRecordId];
        if (!rawRecord || !mappedRecord)
            continue;
        if (diagnostic.slice === 'current') {
            if (diagnostic.versionHash !== rawRecord.current.hash)
                continue;
            result.push({
                ...diagnostic,
                recordId: mappedRecordId,
                versionHash: mappedRecord.current.hash,
            });
            continue;
        }
        if (diagnostic.slice === 'published') {
            if (diagnostic.versionHash !== ((_a = rawRecord.published) === null || _a === void 0 ? void 0 : _a.hash) ||
                !mappedRecord.published) {
                continue;
            }
            result.push({
                ...diagnostic,
                recordId: mappedRecordId,
                versionHash: mappedRecord.published.hash,
            });
            continue;
        }
        // Intermediate shell diagnostics are validator-code evidence for an
        // exact source shell. The planner deterministically rebuilds shells after
        // ID normalization. Pairing is intentionally by owning mapped record;
        // source field validators are unchanged by identifier rewriting.
        if (!(mappedRecordId in target.records)) {
            const rawCandidate = rawIntermediateCandidates.find(({ recordId, versionHash }) => recordId === diagnostic.recordId &&
                versionHash === diagnostic.versionHash);
            if (!rawCandidate)
                continue;
            const itemType = findItemType(rawTraversalSchema, rawCandidate.itemTypeId);
            const mappedFields = remapFields(rawCandidate.fields, itemType, rawTraversalSchema, maps);
            result.push({
                ...diagnostic,
                recordId: mappedRecordId,
                versionHash: (0, canonicalize_1.semanticHash)(mappedFields),
            });
        }
    }
    return result.sort(compareDiagnostics);
}
function finalizeLegacyIdMappingPlan(tentative, source, target, externalTargets = {}, additionalOccupiedItemIds = [], detectedSource = source, skippedRecords = []) {
    const sourceTraversalSchema = (0, inspection_schema_1.contentTraversalSchema)(source);
    const retained = [];
    for (const entry of tentative.entries) {
        if (!entry.managed)
            continue;
        const availability = managedAvailability(entry, source);
        if (availability) {
            retained.push({ ...entry, requiredAvailability: availability });
        }
    }
    const currentExternal = new Set();
    const publishedExternal = new Set();
    const managedRecordIds = new Set(Object.keys(source.records));
    for (const record of Object.values(source.records)) {
        const currentOnly = (0, dependencies_1.collectRecordReferences)({ ...record, published: null }, sourceTraversalSchema);
        for (const { toRecordId } of currentOnly) {
            if (!managedRecordIds.has(toRecordId))
                currentExternal.add(toRecordId);
        }
        for (const { toRecordId } of (0, dependencies_1.collectPublishedRecordReferences)(record, sourceTraversalSchema)) {
            if (!managedRecordIds.has(toRecordId))
                publishedExternal.add(toRecordId);
        }
    }
    for (const entry of tentative.entries) {
        if (entry.status !== 'existing')
            continue;
        if (managedAvailability(entry, source))
            continue;
        if (entry.entityType === 'block') {
            throw mappingRegistryError(`Existing block alias ${entry.sourceId} cannot be used as an out-of-scope dependency.`);
        }
        if (entry.entityType !== 'record')
            continue;
        const current = currentExternal.has(entry.targetId);
        const published = publishedExternal.has(entry.targetId);
        if (!current && !published)
            continue;
        if (!target.visibleRecordIds.includes(entry.targetId))
            continue;
        const externalTarget = externalTargets[entry.targetId];
        if (!(externalTarget === null || externalTarget === void 0 ? void 0 : externalTarget.current) || (published && !externalTarget.published)) {
            throw new types_1.ContentDiffError('MISSING_EXTERNAL_REFERENCE', `Mapped out-of-scope record ${entry.targetId} is not available in the destination slices required by retained content.`, {
                sourceId: entry.sourceId,
                targetId: entry.targetId,
                requiresPublished: published,
            });
        }
        retained.push({
            ...entry,
            managed: false,
            expectedItemTypeId: externalTarget.itemTypeId,
            requiredAvailability: { current: current || published, published },
        });
    }
    const entries = sortPlanMappingEntries(retained);
    validatePlanMappingEntries(entries, true);
    const retainedKeys = new Set(entries.map(({ entityType, sourceId }) => `${entityType}\0${sourceId}`));
    const skippedEntries = [
        ...tentative.skippedEntries,
        ...tentative.entries
            .filter(({ entityType, sourceId }) => !retainedKeys.has(`${entityType}\0${sourceId}`))
            .map(({ entityType, sourceId, targetId }) => ({
            entityType,
            sourceId,
            reason: skippedLegacyIdReason(entityType, targetId, detectedSource, skippedRecords),
        })),
    ]
        .sort(compareSkippedMappingEntries)
        .filter((entry, index, values) => index === 0 ||
        entry.entityType !== values[index - 1].entityType ||
        entry.sourceId !== values[index - 1].sourceId);
    const occupiedItems = new Set([
        ...Object.keys(source.records),
        ...Object.keys(source.blockOwnership),
        ...Object.keys(target.records),
        ...Object.keys(target.blockOwnership),
        ...source.visibleRecordIds,
        ...target.visibleRecordIds,
        ...additionalOccupiedItemIds,
        ...tentative.existingMappingRecords.map(({ id }) => id),
    ]);
    return {
        ...tentative,
        entries,
        skippedEntries,
        newMappingBatch: buildNewMappingBatch(target.siteId, tentative.schema, entries.filter(({ status }) => status === 'new'), occupiedItems),
    };
}
function skippedLegacyIdReason(entityType, targetId, detectedSource, skippedRecords) {
    var _a;
    const detectedTraversalSchema = (0, inspection_schema_1.contentTraversalSchema)(detectedSource);
    const owningRecordIds = new Set();
    if (entityType === 'record' && detectedSource.records[targetId]) {
        owningRecordIds.add(targetId);
    }
    if (entityType === 'block') {
        for (const ownership of (_a = detectedSource.blockOwnership[targetId]) !== null && _a !== void 0 ? _a : []) {
            owningRecordIds.add(ownership.topRecordId);
        }
    }
    if (entityType === 'record') {
        for (const record of Object.values(detectedSource.records)) {
            if ((0, dependencies_1.collectRecordReferences)(record, detectedTraversalSchema).some(({ toRecordId }) => toRecordId === targetId)) {
                owningRecordIds.add(record.id);
            }
        }
    }
    if (entityType === 'upload') {
        for (const record of Object.values(detectedSource.records)) {
            if ((0, dependencies_1.collectUploadReferences)(record, detectedTraversalSchema).includes(targetId)) {
                owningRecordIds.add(record.id);
            }
        }
    }
    if (entityType === 'upload_collection') {
        const uploadIds = new Set(Object.values(detectedSource.uploads)
            .filter(({ manual }) => manual.collectionId === targetId)
            .map(({ id }) => id));
        for (const record of Object.values(detectedSource.records)) {
            if ((0, dependencies_1.collectUploadReferences)(record, detectedTraversalSchema).some((id) => uploadIds.has(id))) {
                owningRecordIds.add(record.id);
            }
        }
    }
    const related = skippedRecords.filter(({ id }) => owningRecordIds.has(id));
    const reasons = [
        ...new Set(related.flatMap(({ reasons: recordReasons }) => recordReasons.map(({ code, slice }) => `${code}${slice ? ` (${slice})` : ''}`))),
    ].sort();
    if (reasons.length > 0) {
        return `${entityType === 'record' && owningRecordIds.has(targetId)
            ? 'top-level aggregate'
            : 'owning or referring aggregate'} skipped: ${reasons.join(', ')}`;
    }
    return 'removed from the final managed scope after skip propagation';
}
function compareSkippedMappingEntries(left, right) {
    return (left.entityType.localeCompare(right.entityType) ||
        left.sourceId.localeCompare(right.sourceId) ||
        left.reason.localeCompare(right.reason));
}
async function mappingSchemaPlan(client, schema, modelApiKey) {
    var _a, _b;
    const model = schema.itemTypes.find(({ apiKey }) => apiKey === modelApiKey);
    const reserved = new Set([
        ...schema.itemTypes.map(({ id }) => id),
        ...schema.itemTypes.flatMap(({ fields }) => fields.map(({ id }) => id)),
    ]);
    if (!model) {
        const nameCollision = schema.itemTypes.find(({ name }) => name === 'Content diff');
        if (nameCollision) {
            throw mappingRegistryError(`Model name Content diff is already used by ${nameCollision.apiKey}; the reserved ${modelApiKey} ledger cannot be created safely.`);
        }
        return newMappingSchemaPlan(schema.siteId, modelApiKey, reserved);
    }
    assertMappingModelShape(model, modelApiKey);
    const [rawModel, rawFields] = await Promise.all([
        client.itemTypes.find(model.id),
        client.fields.list(model.id),
    ]);
    if (rawModel.all_locales_required !== false ||
        rawModel.inverse_relationships_enabled !== false ||
        rawModel.collection_appearance !== 'compact' ||
        rawModel.ordering_direction !== null ||
        rawModel.ordering_meta !== null ||
        rawModel.has_singleton_item !== false ||
        rawModel.hint !== null ||
        rawModel.workflow !== null ||
        rawModel.singleton_item !== null ||
        rawModel.ordering_field !== null ||
        rawModel.presentation_image_field !== null ||
        rawModel.image_preview_field !== null ||
        rawModel.excerpt_field !== null) {
        throw mappingRegistryError(`Existing model ${modelApiKey} does not match the reserved content-diff ledger contract.`);
    }
    const byApiKey = new Map(rawFields.map((field) => [field.api_key, field]));
    const nameField = byApiKey.get(types_1.CONTENT_DIFF_MAPPING_NAME_FIELD_API_KEY);
    const mappingField = byApiKey.get(types_1.CONTENT_DIFF_MAPPING_FIELD_API_KEY);
    if (rawFields.length !== 2 ||
        !nameField ||
        !mappingField ||
        nameField.label !== 'Name' ||
        nameField.field_type !== 'string' ||
        nameField.localized ||
        nameField.position !== 1 ||
        !mappingFieldHasExactDefaults(nameField, 'single_line', {
            heading: false,
            placeholder: null,
        }) ||
        (0, canonicalize_1.stableStringify)(nameField.validators) !==
            (0, canonicalize_1.stableStringify)({ required: {}, unique: {} }) ||
        mappingField.label !== 'Mapping' ||
        mappingField.field_type !== 'json' ||
        mappingField.localized ||
        mappingField.position !== 2 ||
        !mappingFieldHasExactDefaults(mappingField, 'json', {}) ||
        (0, canonicalize_1.stableStringify)(mappingField.validators) !==
            (0, canonicalize_1.stableStringify)({ required: {} }) ||
        ((_a = rawModel.title_field) === null || _a === void 0 ? void 0 : _a.id) !== nameField.id ||
        ((_b = rawModel.presentation_title_field) === null || _b === void 0 ? void 0 : _b.id) !== nameField.id) {
        throw mappingRegistryError(`Existing model ${modelApiKey} does not match the reserved content-diff ledger schema.`);
    }
    return {
        model: {
            id: model.id,
            apiKey: modelApiKey,
            name: 'Content diff',
            modularBlock: false,
            singleton: false,
            sortable: false,
            tree: false,
            draftModeActive: true,
            draftSavingActive: false,
            allLocalesRequired: false,
            inverseRelationshipsEnabled: false,
            workflowId: null,
            status: 'existing',
        },
        nameField: {
            id: nameField.id,
            apiKey: types_1.CONTENT_DIFF_MAPPING_NAME_FIELD_API_KEY,
            label: 'Name',
            fieldType: 'string',
            localized: false,
            position: 1,
            validators: { required: {}, unique: {} },
            status: 'existing',
        },
        mappingField: {
            id: mappingField.id,
            apiKey: types_1.CONTENT_DIFF_MAPPING_FIELD_API_KEY,
            label: 'Mapping',
            fieldType: 'json',
            localized: false,
            position: 2,
            validators: { required: {} },
            status: 'existing',
        },
    };
}
function mappingFieldHasExactDefaults(field, editor, parameters) {
    return (field.default_value === null &&
        field.hint === null &&
        field.deep_filtering_enabled === false &&
        field.content_link_enabled === true &&
        field.fieldset === null &&
        (0, canonicalize_1.stableStringify)(field.appearance) ===
            (0, canonicalize_1.stableStringify)({ addons: [], editor, parameters }));
}
function newMappingSchemaPlan(siteId, modelApiKey, occupied) {
    const modelId = reserveDeterministicId(`content-diff-ledger-schema:${siteId}:${modelApiKey}:model`, occupied);
    const nameFieldId = reserveDeterministicId(`content-diff-ledger-schema:${siteId}:${modelApiKey}:name`, occupied);
    const mappingFieldId = reserveDeterministicId(`content-diff-ledger-schema:${siteId}:${modelApiKey}:mapping`, occupied);
    return {
        model: {
            id: modelId,
            apiKey: modelApiKey,
            name: 'Content diff',
            modularBlock: false,
            singleton: false,
            sortable: false,
            tree: false,
            draftModeActive: true,
            draftSavingActive: false,
            allLocalesRequired: false,
            inverseRelationshipsEnabled: false,
            workflowId: null,
            status: 'new',
        },
        nameField: {
            id: nameFieldId,
            apiKey: types_1.CONTENT_DIFF_MAPPING_NAME_FIELD_API_KEY,
            label: 'Name',
            fieldType: 'string',
            localized: false,
            position: 1,
            validators: { required: {}, unique: {} },
            status: 'new',
        },
        mappingField: {
            id: mappingFieldId,
            apiKey: types_1.CONTENT_DIFF_MAPPING_FIELD_API_KEY,
            label: 'Mapping',
            fieldType: 'json',
            localized: false,
            position: 2,
            validators: { required: {} },
            status: 'new',
        },
    };
}
function assertMappingModelShape(model, modelApiKey) {
    if (model.name !== 'Content diff' ||
        model.modularBlock ||
        model.singleton ||
        model.sortable ||
        model.tree ||
        !model.draftModeActive ||
        model.draftSavingActive ||
        model.allLocalesRequired ||
        model.workflowId !== null) {
        throw mappingRegistryError(`Existing model ${modelApiKey} does not match the reserved content-diff ledger contract.`);
    }
}
function validateMappingRecords(records, projectId) {
    var _a, _b, _c;
    const batches = new Map();
    for (const record of records.sort((left, right) => left.id.localeCompare(right.id))) {
        if (!(0, canonicalize_1.isPortableDatoId)(record.id)) {
            throw mappingRegistryError(`Mapping record ${record.id} has a non-portable ID.`);
        }
        if (Buffer.byteLength(record.mapping, 'utf8') >
            types_1.CONTENT_DIFF_MAPPING_RECORD_MAX_BYTES) {
            throw mappingRegistryError(`Mapping record ${record.id} exceeds the 128 KiB ledger ceiling.`);
        }
        let parsed;
        try {
            parsed = JSON.parse(record.mapping);
        }
        catch {
            throw mappingRegistryError(`Mapping record ${record.id} contains invalid JSON.`);
        }
        const document = parseMappingDocument(parsed, record.id, projectId);
        if (prettyStableStringify(document) !== record.mapping) {
            throw mappingRegistryError(`Mapping record ${record.id} is not in canonical pretty JSON form.`);
        }
        const expectedName = mappingChunkName(document.batchId, document.chunkIndex, document.chunkCount);
        if (record.name !== expectedName) {
            throw mappingRegistryError(`Mapping record ${record.id} has an invalid ledger name.`);
        }
        const batch = (_a = batches.get(document.batchId)) !== null && _a !== void 0 ? _a : [];
        batch.push({ recordId: record.id, name: record.name, document });
        batches.set(document.batchId, batch);
    }
    const entries = [];
    for (const [batchId, chunks] of [...batches].sort(([left], [right]) => left.localeCompare(right))) {
        chunks.sort((left, right) => left.document.chunkIndex - right.document.chunkIndex);
        const chunkCount = (_c = (_b = chunks[0]) === null || _b === void 0 ? void 0 : _b.document.chunkCount) !== null && _c !== void 0 ? _c : 0;
        if (chunkCount !== chunks.length ||
            chunks.some(({ document }, index) => document.batchId !== batchId ||
                document.chunkCount !== chunkCount ||
                document.chunkIndex !== index ||
                document.wholeHash !== chunks[0].document.wholeHash)) {
            throw mappingRegistryError(`Mapping batch ${batchId} is missing, duplicated, or inconsistent.`);
        }
        const batchEntries = chunks.flatMap(({ document }) => document.entries);
        if ((0, canonicalize_1.semanticHash)(batchEntries) !== chunks[0].document.wholeHash) {
            throw mappingRegistryError(`Mapping batch ${batchId} failed its whole-batch checksum.`);
        }
        entries.push(...batchEntries);
    }
    validateRegistryEntries(entries);
    return sortDocumentEntries(entries);
}
function parseMappingDocument(value, recordId, projectId) {
    if (!isObject(value)) {
        throw mappingRegistryError(`Mapping record ${recordId} contains an invalid document.`);
    }
    assertExactKeys(value, [
        'batchId',
        'chunkCount',
        'chunkIndex',
        'entries',
        'formatVersion',
        'projectId',
        'wholeHash',
    ], recordId);
    if (value.formatVersion !== types_1.LEGACY_ID_MAPPING_FORMAT_VERSION ||
        value.projectId !== projectId ||
        typeof value.batchId !== 'string' ||
        !(0, canonicalize_1.isPortableDatoId)(value.batchId) ||
        typeof value.wholeHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.wholeHash) ||
        !Number.isInteger(value.chunkIndex) ||
        value.chunkIndex < 0 ||
        !Number.isInteger(value.chunkCount) ||
        value.chunkCount < 1 ||
        !Array.isArray(value.entries) ||
        value.entries.length === 0) {
        throw mappingRegistryError(`Mapping record ${recordId} contains invalid ledger metadata.`);
    }
    const entries = value.entries.map((entry) => parseDocumentEntry(entry, recordId));
    const sorted = sortDocumentEntries(entries);
    if ((0, canonicalize_1.stableStringify)(entries) !== (0, canonicalize_1.stableStringify)(sorted)) {
        throw mappingRegistryError(`Mapping record ${recordId} entries are not sorted.`);
    }
    return {
        formatVersion: types_1.LEGACY_ID_MAPPING_FORMAT_VERSION,
        projectId,
        batchId: value.batchId,
        chunkIndex: value.chunkIndex,
        chunkCount: value.chunkCount,
        wholeHash: value.wholeHash,
        entries,
    };
}
function parseDocumentEntry(value, recordId) {
    if (!isObject(value)) {
        throw mappingRegistryError(`Mapping record ${recordId} contains an invalid entry.`);
    }
    assertExactKeys(value, ['entityType', 'sourceId', 'targetId'], recordId);
    if (!isLegacyEntityType(value.entityType)) {
        throw mappingRegistryError(`Mapping record ${recordId} contains an unknown entity type.`);
    }
    const sourceId = requiredString(value.sourceId, `mapping record ${recordId} sourceId`);
    const targetId = requiredString(value.targetId, `mapping record ${recordId} targetId`);
    if (!isLegacyDatoId(sourceId) || !(0, canonicalize_1.isPortableDatoId)(targetId)) {
        throw mappingRegistryError(`Mapping record ${recordId} contains an invalid legacy-ID mapping.`);
    }
    return { entityType: value.entityType, sourceId, targetId };
}
function buildNewMappingBatch(siteId, schema, planEntries, occupiedItemIds) {
    const entries = sortDocumentEntries(planEntries.map(({ entityType, sourceId, targetId }) => ({
        entityType,
        sourceId,
        targetId,
    })));
    if (entries.length === 0)
        return null;
    const wholeHash = (0, canonicalize_1.semanticHash)(entries);
    const batchId = deterministicPortableDatoId(`content-diff-ledger-batch:${siteId}:${schema.model.apiKey}:${wholeHash}`);
    const provisionalChunkCount = entries.length;
    const entryChunks = [];
    let current = [];
    for (const entry of entries) {
        const candidate = [...current, entry];
        const document = mappingDocument(siteId, batchId, entryChunks.length, provisionalChunkCount, wholeHash, candidate);
        if (Buffer.byteLength(prettyStableStringify(document), 'utf8') <=
            types_1.CONTENT_DIFF_MAPPING_RECORD_MAX_BYTES) {
            current = candidate;
            continue;
        }
        if (current.length === 0) {
            throw mappingRegistryError(`Legacy mapping ${entry.entityType}/${entry.sourceId} cannot fit in one 128 KiB ledger record.`);
        }
        entryChunks.push(current);
        current = [entry];
    }
    if (current.length > 0)
        entryChunks.push(current);
    const chunkCount = entryChunks.length;
    const chunks = entryChunks.map((chunkEntries, chunkIndex) => {
        const document = mappingDocument(siteId, batchId, chunkIndex, chunkCount, wholeHash, chunkEntries);
        const serializedDocument = prettyStableStringify(document);
        const byteLength = Buffer.byteLength(serializedDocument, 'utf8');
        if (byteLength > types_1.CONTENT_DIFF_MAPPING_RECORD_MAX_BYTES) {
            throw mappingRegistryError(`Legacy mapping chunk ${chunkIndex} exceeds 128 KiB.`);
        }
        const id = reserveDeterministicId(`content-diff-ledger-record:${siteId}:${batchId}:${chunkIndex}`, occupiedItemIds);
        return {
            id,
            name: mappingChunkName(batchId, chunkIndex, chunkCount),
            chunkIndex,
            chunkCount,
            hash: (0, node_crypto_1.createHash)('sha256').update(serializedDocument).digest('hex'),
            byteLength,
            serializedDocument,
            document,
        };
    });
    return { batchId, wholeHash, chunks };
}
function mappingDocument(projectId, batchId, chunkIndex, chunkCount, wholeHash, entries) {
    return {
        formatVersion: types_1.LEGACY_ID_MAPPING_FORMAT_VERSION,
        projectId,
        batchId,
        chunkIndex,
        chunkCount,
        wholeHash,
        entries,
    };
}
function mappingChunkName(batchId, chunkIndex, chunkCount) {
    return `legacy-id-map:${batchId}:${chunkIndex + 1}/${chunkCount}`;
}
function sourceOnlyLegacyEntities(source, target) {
    const sourceOnly = [
        ...Object.keys(source.records)
            .filter((id) => !(id in target.records))
            .map((sourceId) => ({ entityType: 'record', sourceId })),
        ...Object.keys(source.blockOwnership)
            .filter((id) => !(id in target.blockOwnership))
            .map((sourceId) => ({ entityType: 'block', sourceId })),
        ...Object.keys(source.uploads)
            .filter((id) => !(id in target.uploads))
            .map((sourceId) => ({ entityType: 'upload', sourceId })),
        ...Object.keys(source.uploadCollections)
            .filter((id) => !(id in target.uploadCollections))
            .map((sourceId) => ({
            entityType: 'upload_collection',
            sourceId,
        })),
    ].filter(({ sourceId }) => !(0, canonicalize_1.isPortableDatoId)(sourceId));
    const malformed = sourceOnly.filter(({ sourceId }) => !isLegacyDatoId(sourceId));
    if (malformed.length > 0) {
        const first = malformed.sort(compareMappingEntries)[0];
        throw mappingRegistryError(`Source-only ${first.entityType} ID ${first.sourceId} is neither a canonical portable DatoCMS ID nor a decimal legacy ID.`);
    }
    return sortDocumentEntries([
        ...sourceOnly
            .filter(({ entityType }) => entityType === 'record')
            .map(({ sourceId }) => ({
            entityType: 'record',
            sourceId,
            targetId: '',
        })),
        ...sourceOnly
            .filter(({ entityType }) => entityType === 'block')
            .map(({ sourceId }) => ({
            entityType: 'block',
            sourceId,
            targetId: '',
        })),
        ...sourceOnly
            .filter(({ entityType }) => entityType === 'upload')
            .map(({ sourceId }) => ({
            entityType: 'upload',
            sourceId,
            targetId: '',
        })),
        ...sourceOnly
            .filter(({ entityType }) => entityType === 'upload_collection')
            .map(({ sourceId }) => ({
            entityType: 'upload_collection',
            sourceId,
            targetId: '',
        })),
    ]);
}
function occupiedIds(source, target, registryEntries) {
    return new Map([
        [
            ITEM_NAMESPACE,
            new Set([
                ...Object.keys(source.records),
                ...Object.keys(source.blockOwnership),
                ...Object.keys(target.records),
                ...Object.keys(target.blockOwnership),
                ...source.visibleRecordIds,
                ...target.visibleRecordIds,
                ...registryEntries
                    .filter(({ entityType }) => mappingNamespace(entityType) === ITEM_NAMESPACE)
                    .map(({ targetId }) => targetId),
            ]),
        ],
        [
            'upload',
            new Set([
                ...Object.keys(source.uploads),
                ...Object.keys(target.uploads),
                ...registryEntries
                    .filter(({ entityType }) => entityType === 'upload')
                    .map(({ targetId }) => targetId),
            ]),
        ],
        [
            'upload_collection',
            new Set([
                ...Object.keys(source.uploadCollections),
                ...Object.keys(target.uploadCollections),
                ...registryEntries
                    .filter(({ entityType }) => entityType === 'upload_collection')
                    .map(({ targetId }) => targetId),
            ]),
        ],
    ]);
}
function reserveEntityTargetId(siteId, entry, occupied) {
    return reserveDeterministicId(`content-diff-legacy-id:${siteId}:${mappingNamespace(entry.entityType)}:${entry.sourceId}`, occupied);
}
function reserveDeterministicId(seed, occupied) {
    for (let counter = 0; counter < 10000; counter += 1) {
        const id = deterministicPortableDatoId(`${seed}:${counter}`);
        if (!occupied.has(id)) {
            occupied.add(id);
            return id;
        }
    }
    throw mappingRegistryError('Could not reserve a collision-free portable ID.');
}
function remapRecord(record, schema, maps) {
    const id = mapId(maps.record, record.id);
    const itemType = findItemType(schema, record.itemTypeId);
    const current = remapVersion(record.current, itemType, schema, maps);
    const published = record.published
        ? remapVersion(record.published, itemType, schema, maps)
        : null;
    const topology = {
        parentId: record.topology.parentId
            ? mapId(maps.record, record.topology.parentId)
            : null,
        position: record.topology.position,
    };
    const semanticState = {
        id,
        itemTypeId: record.itemTypeId,
        current,
        published,
        topology: { parentId: topology.parentId },
        lifecycle: record.lifecycle,
        stage: record.stage,
        schedules: record.schedules,
    };
    return {
        ...record,
        id,
        current,
        published,
        topology,
        hash: (0, canonicalize_1.semanticHash)(semanticState),
    };
}
function remapVersion(version, itemType, schema, maps) {
    const fields = remapFields(version.fields, itemType, schema, maps);
    return { fields, hash: (0, canonicalize_1.semanticHash)(fields) };
}
function remapFields(fields, itemType, schema, maps) {
    const result = { ...fields };
    for (const field of itemType.fields) {
        if (!(field.apiKey in fields))
            continue;
        const value = fields[field.apiKey];
        if (field.localized && isObject(value)) {
            result[field.apiKey] = Object.fromEntries(Object.entries(value).map(([locale, localized]) => [
                locale,
                remapFieldValue(localized, field, schema, maps),
            ]));
        }
        else {
            result[field.apiKey] = remapFieldValue(value, field, schema, maps);
        }
    }
    return result;
}
function remapFieldValue(value, field, schema, maps) {
    if (field.fieldType === 'link') {
        return typeof value === 'string' ? mapId(maps.record, value) : value;
    }
    if (field.fieldType === 'links' && Array.isArray(value)) {
        return value.map((id) => typeof id === 'string' ? mapId(maps.record, id) : id);
    }
    if (field.fieldType === 'file')
        return remapUploadValue(value, maps.upload);
    if (field.fieldType === 'gallery' && Array.isArray(value)) {
        return value.map((entry) => remapUploadValue(entry, maps.upload));
    }
    if (field.fieldType === 'seo' &&
        isObject(value) &&
        typeof value.image === 'string') {
        return { ...value, image: mapId(maps.upload, value.image) };
    }
    if (field.fieldType === 'structured_text') {
        return remapStructuredTextValue(value, schema, maps);
    }
    if (field.fieldType === 'rich_text' || field.fieldType === 'single_block') {
        return remapEmbeddedValue(value, schema, maps);
    }
    return value;
}
function remapStructuredTextValue(value, schema, maps) {
    if (!isObject(value) || !isObject(value.document))
        return value;
    return {
        ...value,
        document: remapStructuredTextNode(value.document, schema, maps),
    };
}
function remapStructuredTextNode(value, schema, maps) {
    if (!isStructuredTextNode(value))
        return value;
    const result = { ...value };
    if ((value.type === 'inlineItem' || value.type === 'itemLink') &&
        typeof value.item === 'string') {
        result.item = mapId(maps.record, value.item);
    }
    else if ((value.type === 'block' || value.type === 'inlineBlock') &&
        isObject(value.item) &&
        isNestedBlock(value.item)) {
        result.item = remapEmbeddedValue(value.item, schema, maps);
    }
    if (Array.isArray(value.children)) {
        result.children = value.children.map((child) => remapStructuredTextNode(child, schema, maps));
    }
    return result;
}
function remapUploadValue(value, map) {
    if (typeof value === 'string')
        return mapId(map, value);
    if (isObject(value) && typeof value.upload_id === 'string') {
        return { ...value, upload_id: mapId(map, value.upload_id) };
    }
    return value;
}
function remapEmbeddedValue(value, schema, maps) {
    if (Array.isArray(value)) {
        return value.map((child) => remapEmbeddedValue(child, schema, maps));
    }
    if (!isObject(value))
        return value;
    if (isNestedBlock(value)) {
        const blockType = findItemType(schema, nestedBlockTypeId(value));
        const fields = remapFields(blockFields(value), blockType, schema, maps);
        return {
            ...value,
            id: mapId(maps.block, value.id),
            ...(isObject(value.attributes) ? { attributes: fields } : fields),
        };
    }
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        if (key === 'item' &&
            typeof child === 'string' &&
            (value.type === 'inlineItem' || value.type === 'itemLink')) {
            result[key] = mapId(maps.record, child);
        }
        else {
            result[key] = remapEmbeddedValue(child, schema, maps);
        }
    }
    return result;
}
function managedAvailability(entry, source) {
    if (entry.entityType === 'record') {
        const record = source.records[entry.targetId];
        return record
            ? { current: true, published: record.published !== null }
            : null;
    }
    if (entry.entityType === 'block') {
        const ownership = source.blockOwnership[entry.targetId];
        return ownership
            ? {
                current: ownership.some(({ version }) => version === 'current'),
                published: ownership.some(({ version }) => version === 'published'),
            }
            : null;
    }
    if (entry.entityType === 'upload') {
        return source.uploads[entry.targetId]
            ? { current: true, published: false }
            : null;
    }
    return source.uploadCollections[entry.targetId]
        ? { current: true, published: false }
        : null;
}
function mappingMaps(entries) {
    const maps = {
        record: new Map(),
        block: new Map(),
        upload: new Map(),
        upload_collection: new Map(),
    };
    for (const entry of entries)
        maps[entry.entityType].set(entry.sourceId, entry.targetId);
    return maps;
}
function validateRegistryEntries(entries) {
    const sourceClaims = new Map();
    const targetClaims = new Map();
    for (const entry of entries) {
        if (!isLegacyDatoId(entry.sourceId) || !(0, canonicalize_1.isPortableDatoId)(entry.targetId)) {
            throw mappingRegistryError(`Invalid legacy mapping ${entry.entityType}/${entry.sourceId}.`);
        }
        const sourceKey = mappingSourceKey(entry);
        const targetKey = `${mappingNamespace(entry.entityType)}\0${entry.targetId}`;
        if (sourceClaims.has(sourceKey) || targetClaims.has(targetKey)) {
            throw mappingRegistryError(`Conflicting legacy mapping claim for ${entry.entityType}/${entry.sourceId}.`);
        }
        sourceClaims.set(sourceKey, entry);
        targetClaims.set(targetKey, entry);
    }
}
function validatePlanMappingEntries(entries, requireExternalType = false) {
    validateRegistryEntries(entries);
    for (const entry of entries) {
        if (!entry.managed && entry.status !== 'existing') {
            throw mappingRegistryError('Out-of-scope aliases must already exist in the durable ledger.');
        }
        if (!entry.managed && entry.entityType !== 'record') {
            throw mappingRegistryError('Only out-of-scope record aliases are supported in this plan format.');
        }
        if (!entry.managed && requireExternalType && !entry.expectedItemTypeId) {
            throw mappingRegistryError(`Out-of-scope record alias ${entry.sourceId} has no authoritative destination item type.`);
        }
    }
}
function sortPlanMappingEntries(entries) {
    return [...entries].sort(compareMappingEntries);
}
function sortDocumentEntries(entries) {
    return [...entries].sort(compareMappingEntries);
}
function compareMappingEntries(left, right) {
    return (left.entityType.localeCompare(right.entityType) ||
        left.sourceId.localeCompare(right.sourceId));
}
function mappingNamespace(entityType) {
    return entityType === 'record' || entityType === 'block'
        ? ITEM_NAMESPACE
        : entityType;
}
function mappingSourceKey(entry) {
    return `${mappingNamespace(entry.entityType)}\0${entry.sourceId}`;
}
function mapId(map, id) {
    var _a;
    return (_a = map.get(id)) !== null && _a !== void 0 ? _a : id;
}
function findItemType(schema, id) {
    const itemType = schema.itemTypes.find((candidate) => candidate.id === id);
    if (!itemType) {
        throw new types_1.ContentDiffError('INCOMPATIBLE_SCHEMA', `Content refers to item type ${id}, which is absent from the managed schema.`);
    }
    return itemType;
}
function isNestedBlock(value) {
    return (value.type === 'item' &&
        typeof value.id === 'string' &&
        nestedBlockTypeId(value) !== '');
}
function isStructuredTextNode(value) {
    return isObject(value) && typeof value.type === 'string' && value.type !== '';
}
function nestedBlockTypeId(value) {
    if (isObject(value.relationships) &&
        isObject(value.relationships.item_type)) {
        const data = value.relationships.item_type.data;
        if (isObject(data) && typeof data.id === 'string')
            return data.id;
    }
    if (isObject(value.item_type) && typeof value.item_type.id === 'string')
        return value.item_type.id;
    return typeof value.__itemTypeId === 'string' ? value.__itemTypeId : '';
}
function blockFields(value) {
    if (isObject(value.attributes))
        return value.attributes;
    const reserved = new Set([
        'id',
        'type',
        'item_type',
        '__itemTypeId',
        'meta',
        'creator',
    ]);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !reserved.has(key)));
}
function insertUnique(record, id, value, label) {
    if (id in record) {
        throw new types_1.ContentDiffError('DUPLICATE_ENTITY_ID', `Legacy ID normalization produced duplicate ${label} ID ${id}.`, { id });
    }
    record[id] = value;
}
function assertExactKeys(value, keys, recordId) {
    if (Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
        throw mappingRegistryError(`Mapping record ${recordId} contains unexpected properties.`);
    }
}
function jsonContainsExactString(value, target) {
    if (value === target)
        return true;
    if (Array.isArray(value))
        return value.some((child) => jsonContainsExactString(child, target));
    return (isObject(value) &&
        Object.values(value).some((child) => jsonContainsExactString(child, target)));
}
function requiredString(value, path) {
    if (typeof value !== 'string')
        throw mappingRegistryError(`Missing ${path}.`);
    return value;
}
function isLegacyEntityType(value) {
    return (value === 'record' ||
        value === 'block' ||
        value === 'upload' ||
        value === 'upload_collection');
}
function isLegacyDatoId(value) {
    return (value.length <= 15 &&
        /^(0|[1-9]\d*)$/.test(value) &&
        BigInt(value) <= BigInt('281474976710655'));
}
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function mappingRegistryError(message) {
    return new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', message);
}
function compareDiagnostics(left, right) {
    return (left.recordId.localeCompare(right.recordId) ||
        left.slice.localeCompare(right.slice) ||
        left.versionHash.localeCompare(right.versionHash));
}
