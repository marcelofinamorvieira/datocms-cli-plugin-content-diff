"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectionItemTypesDigest = inspectionItemTypesDigest;
exports.buildContentInspectionSnapshot = buildContentInspectionSnapshot;
exports.contentTraversalSchema = contentTraversalSchema;
exports.schemaWithInspectionItemTypes = schemaWithInspectionItemTypes;
exports.inspectionSubsetMatches = inspectionSubsetMatches;
const canonicalize_1 = require("./canonicalize");
const types_1 = require("./types");
function inspectionItemTypesDigest(itemTypes) {
    return (0, canonicalize_1.semanticHash)({
        itemTypes: [...itemTypes]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((itemType) => ({
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
                defaultValue: field.defaultValue === undefined ? null : field.defaultValue,
                validators: field.validators,
            })),
        })),
    });
}
function buildContentInspectionSnapshot(fullSchema, managedSchema, encounteredItemTypeIds, structuralIssues) {
    const managedIds = new Set(managedSchema.itemTypes.map(({ id }) => id));
    const fullById = new Map(fullSchema.itemTypes.map((itemType) => [itemType.id, itemType]));
    const itemTypes = [...encounteredItemTypeIds]
        .filter((id) => !managedIds.has(id))
        .sort()
        .map((id) => {
        const itemType = fullById.get(id);
        if (!(itemType === null || itemType === void 0 ? void 0 : itemType.modularBlock)) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Content inspection cannot resolve modular block model ${id}.`, { itemTypeId: id });
        }
        return itemType;
    });
    return {
        itemTypes,
        digest: inspectionItemTypesDigest(itemTypes),
        structuralIssues: [...structuralIssues].sort(compareStructuralIssues),
    };
}
function contentTraversalSchema(snapshot) {
    return schemaWithInspectionItemTypes(snapshot.schema, snapshot.inspection.itemTypes);
}
function schemaWithInspectionItemTypes(managedSchema, inspectionItemTypes) {
    const managedIds = new Set(managedSchema.itemTypes.map(({ id }) => id));
    const duplicates = inspectionItemTypes
        .map(({ id }) => id)
        .filter((id) => managedIds.has(id));
    if (duplicates.length > 0) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Inspection schema overlaps managed item types: ${[...new Set(duplicates)]
            .sort()
            .join(', ')}.`, { itemTypeIds: [...new Set(duplicates)].sort() });
    }
    return {
        ...managedSchema,
        itemTypes: [...managedSchema.itemTypes, ...inspectionItemTypes].sort((left, right) => left.id.localeCompare(right.id)),
        // This merged object is a traversal aid, never a compatibility state.
        digest: managedSchema.digest,
    };
}
function inspectionSubsetMatches(inspection, refreshedFullSchema) {
    const wantedIds = new Set(inspection.itemTypes.map(({ id }) => id));
    const refreshed = refreshedFullSchema.itemTypes
        .filter(({ id }) => wantedIds.has(id))
        .sort((left, right) => left.id.localeCompare(right.id));
    return (refreshed.length === wantedIds.size &&
        inspectionItemTypesDigest(refreshed) === inspection.digest);
}
function compareStructuralIssues(left, right) {
    var _a, _b;
    return (left.recordId.localeCompare(right.recordId) ||
        left.slice.localeCompare(right.slice) ||
        left.fieldPath.localeCompare(right.fieldPath) ||
        ((_a = left.locale) !== null && _a !== void 0 ? _a : '').localeCompare((_b = right.locale) !== null && _b !== void 0 ? _b : '') ||
        left.validatorKey.localeCompare(right.validatorKey) ||
        left.blockId.localeCompare(right.blockId) ||
        left.blockItemTypeId.localeCompare(right.blockItemTypeId));
}
