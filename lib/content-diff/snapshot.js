"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultScheduleAdapter = void 0;
exports.captureContentSnapshot = captureContentSnapshot;
exports.readScheduleDetails = readScheduleDetails;
exports.snapshotSemanticState = snapshotSemanticState;
const canonicalize_1 = require("./canonicalize");
const dependencies_1 = require("./dependencies");
const inspection_schema_1 = require("./inspection-schema");
const schema_1 = require("./schema");
const structural_content_1 = require("./structural-content");
const types_1 = require("./types");
const types_2 = require("./types");
const READ_CONCURRENCY = 5;
const RECORD_PAGE_SIZE_WITH_NESTED_BLOCKS = 30;
const COLLECTION_PAGE_SIZE = 500;
exports.defaultScheduleAdapter = {
    read: readScheduleDetails,
};
async function captureContentSnapshot({ client, environmentId, schema: providedSchema, scope, maxAttempts = 3, scheduleAdapter = exports.defaultScheduleAdapter, fullAccessVerified, }) {
    var _a, _b, _c, _d, _e;
    const contentDiffModelApiKey = (_a = scope.contentDiffModelApiKey) !== null && _a !== void 0 ? _a : types_2.DEFAULT_CONTENT_DIFF_MODEL_API_KEY;
    if (fullAccessVerified !== true) {
        throw new types_1.ContentDiffError('UNPROVEN_FULL_ACCESS', 'Exact content diff requires credentials with provably unrestricted record and upload reads.');
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new types_1.ContentDiffError('INVALID_SCOPE', 'maxAttempts must be a positive integer.');
    }
    let fullSchema = providedSchema !== null && providedSchema !== void 0 ? providedSchema : (await (0, schema_1.fetchSchemaSnapshot)(client, environmentId));
    const verifiedReadScope = (0, canonicalize_1.stableStringify)(readItemTypesForPermissionProof(fullSchema, scope.migrationsModelApiKey, contentDiffModelApiKey));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const selectedItemTypes = (0, schema_1.resolveItemTypeSelection)(fullSchema, scope.itemTypes, scope.migrationsModelApiKey, scope.contentDiffModelApiKey);
        const scopedSchema = (0, schema_1.schemaForScope)(fullSchema, scope.itemTypes, scope.migrationsModelApiKey, scope.contentDiffModelApiKey);
        const captured = await captureOnce(client, environmentId, fullSchema, scopedSchema, selectedItemTypes, scope.uploads, new Set((_b = scope.baselineUploadIds) !== null && _b !== void 0 ? _b : []), new Set((_c = scope.baselineUploadCollectionIds) !== null && _c !== void 0 ? _c : []), scope.allUploadCollections === true, scheduleAdapter, scope.migrationsModelApiKey, contentDiffModelApiKey);
        const [verificationMarker, refreshedFullSchema] = await Promise.all([
            captureConsistencyMarker(client, fullSchema, selectedItemTypes, scope.uploads, new Set([
                ...Object.keys(captured.snapshot.uploads),
                ...((_d = scope.baselineUploadIds) !== null && _d !== void 0 ? _d : []),
            ]), new Set([
                ...Object.keys(captured.snapshot.uploadCollections),
                ...((_e = scope.baselineUploadCollectionIds) !== null && _e !== void 0 ? _e : []),
            ]), scheduleAdapter, scopedSchema.locales, scope.migrationsModelApiKey, contentDiffModelApiKey),
            (0, schema_1.fetchSchemaSnapshot)(client, environmentId),
        ]);
        const refreshedScopedSchema = (0, schema_1.schemaForScope)(refreshedFullSchema, scope.itemTypes, scope.migrationsModelApiKey, scope.contentDiffModelApiKey);
        const capturedReadScope = (0, canonicalize_1.stableStringify)(readItemTypesForPermissionProof(fullSchema, scope.migrationsModelApiKey, contentDiffModelApiKey));
        const refreshedReadScope = (0, canonicalize_1.stableStringify)(readItemTypesForPermissionProof(refreshedFullSchema, scope.migrationsModelApiKey, contentDiffModelApiKey));
        if (captured.marker === verificationMarker &&
            scopedSchema.digest === refreshedScopedSchema.digest &&
            (0, inspection_schema_1.inspectionSubsetMatches)(captured.snapshot.inspection, refreshedFullSchema) &&
            capturedReadScope === refreshedReadScope &&
            refreshedReadScope === verifiedReadScope) {
            return captured.snapshot;
        }
        fullSchema = refreshedFullSchema;
    }
    throw new types_1.ContentDiffError('CONCURRENT_SNAPSHOT_CHANGE', `The ${environmentId} environment changed while it was being read. Stop concurrent edits and retry.`, { environmentId, attempts: maxAttempts });
}
async function readScheduleDetails(client, recordId, _localeOrder) {
    var _a, _b, _c, _d, _e, _f;
    const response = await client.items.rawCurrentVsPublishedState(recordId);
    const raw = response;
    if (!isObject(raw.data) || !Array.isArray(raw.included)) {
        throw scheduleContractError(recordId);
    }
    const publicationRelationship = relationshipData(raw.data, 'scheduled_publication');
    const unpublishingRelationship = relationshipData(raw.data, 'scheduled_unpublishing');
    const publication = publicationRelationship
        ? findIncluded(raw.included, publicationRelationship, recordId)
        : null;
    const unpublishing = unpublishingRelationship
        ? findIncluded(raw.included, unpublishingRelationship, recordId)
        : null;
    return {
        publication: publication
            ? {
                at: requiredString((_a = publication.attributes) === null || _a === void 0 ? void 0 : _a.publication_scheduled_at, recordId),
                selective: ((_b = publication.attributes) === null || _b === void 0 ? void 0 : _b.selective_publication) === null
                    ? null
                    : parseSelectivePublication((_c = publication.attributes) === null || _c === void 0 ? void 0 : _c.selective_publication, recordId),
            }
            : null,
        unpublishing: unpublishing
            ? {
                at: requiredString((_d = unpublishing.attributes) === null || _d === void 0 ? void 0 : _d.unpublishing_scheduled_at, recordId),
                locales: ((_e = unpublishing.attributes) === null || _e === void 0 ? void 0 : _e.content_in_locales) === null
                    ? null
                    : parseStringArray((_f = unpublishing.attributes) === null || _f === void 0 ? void 0 : _f.content_in_locales, recordId),
            }
            : null,
    };
}
function snapshotSemanticState(snapshot) {
    var _a;
    return {
        siteId: snapshot.siteId,
        schemaDigest: snapshot.schema.digest,
        scope: snapshot.scope,
        readItemTypes: snapshot.readItemTypes,
        records: Object.fromEntries(Object.values(snapshot.records)
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((record) => [
            record.id,
            {
                hash: record.hash,
                position: record.topology.position,
                validity: {
                    current: record.validity.current,
                    published: record.validity.published,
                },
            },
        ])),
        uploads: Object.fromEntries(Object.values(snapshot.uploads)
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((upload) => [upload.id, upload.hash])),
        uploadCollections: Object.fromEntries(Object.values(snapshot.uploadCollections)
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((collection) => [collection.id, collection.hash])),
        missingUploadReferences: (_a = snapshot.missingUploadReferences) !== null && _a !== void 0 ? _a : {},
        inspection: (0, canonicalize_1.canonicalizeJson)(snapshot.inspection),
    };
}
async function captureOnce(client, environmentId, fullSchema, scopedSchema, selectedItemTypes, uploadsMode, baselineUploadIds, baselineCollectionIds, allUploadCollections, scheduleAdapter, migrationsModelApiKey, contentDiffModelApiKey) {
    const currentItems = await listItems(client, selectedItemTypes, 'current', true);
    const publishedItems = await listItems(client, selectedItemTypes, 'published', true);
    const currentById = indexItems(currentItems);
    const publishedById = indexItems(publishedItems);
    const schedules = new Map();
    const scheduledItems = currentItems.filter(hasScheduleMarker);
    const scheduleValues = await mapWithConcurrency(scheduledItems, READ_CONCURRENCY, async (item) => scheduleAdapter.read(client, requiredItemId(item), scopedSchema.locales));
    scheduledItems.forEach((item, index) => {
        schedules.set(requiredItemId(item), scheduleValues[index]);
    });
    const encounteredItemTypeIds = new Set();
    const structuralIssues = [];
    for (const [recordId, currentItem] of Object.entries(currentById).sort(([left], [right]) => left.localeCompare(right))) {
        const itemTypeId = itemTypeIdOf(currentItem);
        const itemType = selectedItemTypes.find(({ id }) => id === itemTypeId);
        if (!itemType) {
            throw new types_1.ContentDiffError('INCOMPATIBLE_SCHEMA', `Record ${recordId} refers to an item type outside the selected scope.`);
        }
        for (const [slice, item] of [
            ['current', currentItem],
            ['published', publishedById[recordId]],
        ]) {
            if (!item)
                continue;
            const inspection = (0, structural_content_1.inspectRecordStructuralContent)(item, itemType, fullSchema, recordId, slice);
            inspection.encounteredItemTypeIds.forEach((id) => encounteredItemTypeIds.add(id));
            structuralIssues.push(...inspection.issues);
        }
    }
    const inspection = (0, inspection_schema_1.buildContentInspectionSnapshot)(fullSchema, scopedSchema, encounteredItemTypeIds, structuralIssues);
    const traversalSchema = (0, inspection_schema_1.schemaWithInspectionItemTypes)(scopedSchema, inspection.itemTypes);
    const records = Object.fromEntries(Object.entries(currentById)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([recordId, currentItem]) => {
        var _a, _b;
        const itemTypeId = itemTypeIdOf(currentItem);
        const itemType = selectedItemTypes.find(({ id }) => id === itemTypeId);
        if (!itemType) {
            throw new types_1.ContentDiffError('INCOMPATIBLE_SCHEMA', `Record ${recordId} refers to an item type outside the selected scope.`);
        }
        const publishedItem = (_a = publishedById[recordId]) !== null && _a !== void 0 ? _a : null;
        if (publishedItem && itemTypeIdOf(publishedItem) !== itemTypeId) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Record ${recordId} resolves to different models in current and published versions.`);
        }
        return [
            recordId,
            (0, canonicalize_1.canonicalizeRecord)(currentItem, publishedItem, itemType, traversalSchema, (_b = schedules.get(recordId)) !== null && _b !== void 0 ? _b : {
                publication: null,
                unpublishing: null,
            }),
        ];
    }));
    for (const publishedId of Object.keys(publishedById)) {
        if (!(publishedId in currentById)) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Published record ${publishedId} has no current version.`);
        }
    }
    const blockOwnership = (0, dependencies_1.buildBlockOwnershipIndex)(records, traversalSchema);
    const uploadReferencesByRecord = Object.fromEntries(Object.values(records).map((record) => [
        record.id,
        (0, dependencies_1.collectUploadReferences)(record, traversalSchema),
    ]));
    const referencedUploadIds = new Set(Object.values(uploadReferencesByRecord).flat());
    const allUploads = await listUploads(client);
    const selectedUploads = allUploads.filter((upload) => uploadsMode === 'all' ||
        referencedUploadIds.has(requiredItemId(upload)) ||
        baselineUploadIds.has(requiredItemId(upload)));
    const foundUploadIds = new Set(selectedUploads.map(requiredItemId));
    const missingUploadReferences = Object.fromEntries(Object.entries(uploadReferencesByRecord)
        .map(([recordId, uploadIds]) => [
        recordId,
        uploadIds
            .filter((uploadId) => !foundUploadIds.has(uploadId))
            .sort(),
    ])
        .filter(([, uploadIds]) => uploadIds.length > 0));
    const uploads = Object.fromEntries(selectedUploads
        .map((upload) => (0, canonicalize_1.canonicalizeUpload)(upload, scopedSchema.locales))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((upload) => [upload.id, upload]));
    const allCollections = (await client.uploadCollections.list()).map(canonicalize_1.canonicalizeUploadCollection);
    const visibleBaselineCollectionIds = new Set([...baselineCollectionIds].filter((id) => allCollections.some((collection) => collection.id === id)));
    const uploadCollections = allUploadCollections
        ? Object.fromEntries(allCollections
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((collection) => [collection.id, collection]))
        : selectCollectionClosure(allCollections, uploads, visibleBaselineCollectionIds);
    const visibleRecordIds = await listVisibleRecordIds(client, fullSchema, migrationsModelApiKey, contentDiffModelApiKey);
    const capturedAt = new Date().toISOString();
    const snapshot = {
        formatVersion: types_1.CONTENT_SNAPSHOT_FORMAT_VERSION,
        siteId: scopedSchema.siteId,
        environmentId,
        capturedAt,
        schema: scopedSchema,
        scope: {
            itemTypeIds: selectedItemTypes.map(({ id }) => id).sort(),
            uploads: uploadsMode,
        },
        readItemTypes: readItemTypesForPermissionProof(fullSchema, migrationsModelApiKey, contentDiffModelApiKey),
        records,
        uploads,
        uploadCollections,
        visibleRecordIds,
        blockOwnership,
        inspection,
        missingUploadReferences,
        digest: '',
    };
    snapshot.digest = (0, canonicalize_1.semanticHash)(snapshotSemanticState(snapshot));
    return {
        snapshot,
        marker: consistencyMarker(currentItems, publishedItems, visibleRecordIds, selectedUploads, Object.values(uploadCollections), schedules, scopedSchema.locales),
    };
}
function readItemTypesForPermissionProof(schema, migrationsModelApiKey, contentDiffModelApiKey) {
    const migrationsModelId = (0, schema_1.migrationsTrackingModelId)(schema, migrationsModelApiKey);
    return schema.itemTypes
        .filter(({ id, modularBlock, apiKey }) => !modularBlock &&
        id !== migrationsModelId &&
        apiKey !== contentDiffModelApiKey)
        .map(({ id, workflowId }) => ({ id, workflowId }))
        .sort((left, right) => left.id.localeCompare(right.id));
}
async function captureConsistencyMarker(client, fullSchema, selectedItemTypes, uploadsMode, selectedUploadIds, selectedCollectionIds, scheduleAdapter, localeOrder, migrationsModelApiKey, contentDiffModelApiKey) {
    const [currentItems, publishedItems, visibleRecordIds, allUploads, collections,] = await Promise.all([
        listItems(client, selectedItemTypes, 'current', false),
        listItems(client, selectedItemTypes, 'published', false),
        listVisibleRecordIds(client, fullSchema, migrationsModelApiKey, contentDiffModelApiKey),
        listUploads(client),
        client.uploadCollections.list(),
    ]);
    const uploads = allUploads.filter((upload) => uploadsMode === 'all' || selectedUploadIds.has(requiredItemId(upload)));
    const selectedCollections = collections
        .map(canonicalize_1.canonicalizeUploadCollection)
        .filter(({ id }) => selectedCollectionIds.has(id));
    const scheduledItems = currentItems.filter(hasScheduleMarker);
    const scheduleValues = await mapWithConcurrency(scheduledItems, READ_CONCURRENCY, async (item) => scheduleAdapter.read(client, requiredItemId(item), localeOrder));
    const schedules = new Map();
    scheduledItems.forEach((item, index) => {
        schedules.set(requiredItemId(item), scheduleValues[index]);
    });
    return consistencyMarker(currentItems, publishedItems, visibleRecordIds, uploads, selectedCollections, schedules, localeOrder);
}
function consistencyMarker(currentItems, publishedItems, visibleRecordIds, uploads, collections, schedules, localeOrder) {
    return (0, canonicalize_1.semanticHash)({
        current: currentItems.map(itemConsistency).sort(compareById),
        published: publishedItems.map(itemConsistency).sort(compareById),
        visibleRecordIds,
        uploads: uploads.map(uploadConsistency).sort(compareById),
        collections: collections
            .map(({ id, hash }) => ({ id, hash }))
            .sort(compareById),
        schedules: [...schedules]
            .map(([id, value]) => ({
            id,
            value: (0, canonicalize_1.canonicalizeSchedules)(value, localeOrder),
        }))
            .sort((left, right) => left.id.localeCompare(right.id)),
    });
}
async function listItems(client, itemTypes, version, nested) {
    const result = [];
    for (const itemType of itemTypes) {
        const iterator = client.items.listPagedIterator({
            filter: { type: itemType.id },
            nested,
            order_by: 'id_ASC',
            version,
        }, {
            perPage: nested
                ? RECORD_PAGE_SIZE_WITH_NESTED_BLOCKS
                : COLLECTION_PAGE_SIZE,
            concurrency: READ_CONCURRENCY,
        });
        for await (const item of iterator) {
            result.push(item);
        }
    }
    return result.sort((left, right) => requiredItemId(left).localeCompare(requiredItemId(right)));
}
async function listUploads(client) {
    const result = [];
    const iterator = client.uploads.listPagedIterator({ order_by: 'id_ASC' }, { perPage: COLLECTION_PAGE_SIZE, concurrency: READ_CONCURRENCY });
    for await (const upload of iterator) {
        result.push(upload);
    }
    return result.sort((left, right) => requiredItemId(left).localeCompare(requiredItemId(right)));
}
async function listVisibleRecordIds(client, schema, migrationsModelApiKey, contentDiffModelApiKey) {
    const migrationsModelId = (0, schema_1.migrationsTrackingModelId)(schema, migrationsModelApiKey);
    const regularItemTypes = schema.itemTypes.filter(({ id, modularBlock, apiKey }) => !modularBlock &&
        id !== migrationsModelId &&
        apiKey !== contentDiffModelApiKey);
    const items = await listItems(client, regularItemTypes, 'current', false);
    return items.map(requiredItemId).sort();
}
function selectCollectionClosure(collections, uploads, additionalCollectionIds = new Set()) {
    const byId = new Map(collections.map((collection) => [collection.id, collection]));
    const selected = new Set([
        ...Object.values(uploads)
            .map(({ manual }) => manual.collectionId)
            .filter((id) => Boolean(id)),
        ...additionalCollectionIds,
    ]);
    for (const id of [...selected]) {
        let current = byId.get(id);
        if (!current) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Upload collection ${id} is referenced but not visible.`);
        }
        while (current.parentId) {
            selected.add(current.parentId);
            const parent = byId.get(current.parentId);
            if (!parent) {
                throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Upload collection ${current.id} has missing parent ${current.parentId}.`);
            }
            current = parent;
        }
    }
    return Object.fromEntries(collections
        .filter(({ id }) => selected.has(id))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((collection) => [collection.id, collection]));
}
function itemConsistency(input) {
    const item = assertObject(input);
    const meta = isObject(item.meta) ? item.meta : {};
    return {
        id: requiredItemId(input),
        itemTypeId: itemTypeIdOf(input),
        currentVersion: stringOrNull(meta.current_version),
        updatedAt: stringOrNull(meta.updated_at),
        publishedAt: stringOrNull(meta.published_at),
        publicationScheduledAt: stringOrNull(meta.publication_scheduled_at),
        unpublishingScheduledAt: stringOrNull(meta.unpublishing_scheduled_at),
        stage: stringOrNull(meta.stage),
        parentId: stringOrNull(item.parent_id),
        position: typeof item.position === 'number' ? item.position : null,
        isValid: booleanOrNull(meta.is_valid),
        isCurrentVersionValid: booleanOrNull(meta.is_current_version_valid),
        isPublishedVersionValid: booleanOrNull(meta.is_published_version_valid),
    };
}
function uploadConsistency(input) {
    const upload = assertObject(input);
    return {
        id: requiredItemId(input),
        md5: stringOrNull(upload.md5),
        updatedAt: stringOrNull(upload.updated_at),
    };
}
function indexItems(items) {
    const result = {};
    for (const item of items) {
        const id = requiredItemId(item);
        if (id in result) {
            throw new types_1.ContentDiffError('DUPLICATE_ENTITY_ID', `The CMA returned duplicate record ID ${id}.`, { recordId: id });
        }
        result[id] = item;
    }
    return result;
}
function hasScheduleMarker(input) {
    const item = assertObject(input);
    const meta = isObject(item.meta) ? item.meta : {};
    return Boolean(meta.publication_scheduled_at || meta.unpublishing_scheduled_at);
}
function itemTypeIdOf(input) {
    const item = assertObject(input);
    if (typeof item.__itemTypeId === 'string')
        return item.__itemTypeId;
    if (isObject(item.item_type) && typeof item.item_type.id === 'string') {
        return item.item_type.id;
    }
    throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Record ${requiredItemId(input)} has no item type relationship.`);
}
function relationshipData(data, key) {
    const relationships = isObject(data.relationships)
        ? data.relationships
        : null;
    const relationship = relationships && isObject(relationships[key]) ? relationships[key] : null;
    const value = relationship && isObject(relationship.data) ? relationship.data : null;
    if (!value)
        return null;
    if (typeof value.id !== 'string' || typeof value.type !== 'string') {
        throw scheduleContractError(String(data.id));
    }
    return { id: value.id, type: value.type };
}
function findIncluded(included, relationship, recordId) {
    const resource = included.find((candidate) => isObject(candidate) &&
        candidate.id === relationship.id &&
        candidate.type === relationship.type);
    if (!isObject(resource) || !isObject(resource.attributes)) {
        throw scheduleContractError(recordId);
    }
    return resource;
}
function parseSelectivePublication(value, recordId) {
    if (!isObject(value) || typeof value.non_localized_content !== 'boolean') {
        throw scheduleContractError(recordId);
    }
    return {
        locales: parseStringArray(value.content_in_locales, recordId),
        nonLocalized: value.non_localized_content,
    };
}
function parseStringArray(value, recordId) {
    if (!Array.isArray(value) ||
        value.some((entry) => typeof entry !== 'string')) {
        throw scheduleContractError(recordId);
    }
    return [...value];
}
function scheduleContractError(recordId) {
    return new types_1.ContentDiffError('SCHEDULE_CONTRACT_CHANGED', `Cannot read complete schedule details for record ${recordId}; the private current-vs-published response contract changed.`, { recordId });
}
function requiredString(value, recordId) {
    if (typeof value !== 'string')
        throw scheduleContractError(recordId);
    return value;
}
function requiredItemId(value) {
    const resource = assertObject(value);
    if (typeof resource.id !== 'string') {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', 'The CMA returned a resource without an ID.');
    }
    return resource.id;
}
function assertObject(value) {
    if (!isObject(value)) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', 'The CMA returned a malformed resource.');
    }
    return value;
}
function stringOrNull(value) {
    return typeof value === 'string' ? value : null;
}
function booleanOrNull(value) {
    return typeof value === 'boolean' ? value : null;
}
function compareById(left, right) {
    return String(left.id).localeCompare(String(right.id));
}
async function mapWithConcurrency(values, concurrency, mapper) {
    const output = new Array(values.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (nextIndex < values.length) {
            const index = nextIndex++;
            output[index] = await mapper(values[index], index);
        }
    });
    await Promise.all(workers);
    return output;
}
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
