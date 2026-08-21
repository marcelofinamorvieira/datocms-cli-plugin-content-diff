"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nestedBlockIdentity = nestedBlockIdentity;
exports.nestedBlockFields = nestedBlockFields;
exports.inspectRecordStructuralContent = inspectRecordStructuralContent;
const types_1 = require("./types");
/**
 * Reads every CMA representation of a nested block identity and rejects
 * ambiguity. Returning null means that the value makes no nested-item claim.
 */
function nestedBlockIdentity(value, path) {
    if (!isObject(value))
        return null;
    const hasItemType = Object.prototype.hasOwnProperty.call(value, 'item_type');
    const hasRelationshipItemType = isObject(value.relationships) &&
        Object.prototype.hasOwnProperty.call(value.relationships, 'item_type');
    const hasInternalItemType = Object.prototype.hasOwnProperty.call(value, '__itemTypeId');
    const claimsNestedItem = value.type === 'item' ||
        (Object.prototype.hasOwnProperty.call(value, 'id') &&
            (hasItemType || hasRelationshipItemType || hasInternalItemType));
    if (!claimsNestedItem)
        return null;
    if (value.type !== 'item') {
        throw unsupportedIdentity(path, 'declares a block model identity without type="item"');
    }
    if (typeof value.id !== 'string' || value.id.length === 0) {
        throw unsupportedIdentity(path, 'has no non-empty block ID');
    }
    const candidates = [];
    if (hasItemType) {
        if (!isObject(value.item_type) ||
            typeof value.item_type.id !== 'string' ||
            value.item_type.id.length === 0) {
            throw unsupportedIdentity(path, 'has a malformed item_type identity');
        }
        candidates.push({ representation: 'item_type.id', id: value.item_type.id });
    }
    if (hasRelationshipItemType) {
        const relationship = value.relationships.item_type;
        if (!isObject(relationship) ||
            !isObject(relationship.data) ||
            typeof relationship.data.id !== 'string' ||
            relationship.data.id.length === 0) {
            throw unsupportedIdentity(path, 'has a malformed relationships.item_type.data identity');
        }
        candidates.push({
            representation: 'relationships.item_type.data.id',
            id: relationship.data.id,
        });
    }
    if (hasInternalItemType) {
        if (typeof value.__itemTypeId !== 'string' ||
            value.__itemTypeId.length === 0) {
            throw unsupportedIdentity(path, 'has a malformed __itemTypeId identity');
        }
        candidates.push({
            representation: '__itemTypeId',
            id: value.__itemTypeId,
        });
    }
    if (candidates.length === 0) {
        throw unsupportedIdentity(path, 'has no authoritative block model identity');
    }
    const itemTypeIds = [...new Set(candidates.map(({ id }) => id))];
    if (itemTypeIds.length !== 1) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Nested item ${value.id} has conflicting block model identities at ${path}.`, {
            blockId: value.id,
            path,
            representations: Object.fromEntries(candidates.map(({ representation, id }) => [representation, id])),
        });
    }
    return { id: value.id, itemTypeId: itemTypeIds[0] };
}
function nestedBlockFields(value, path) {
    if (!isObject(value)) {
        throw unsupportedIdentity(path, 'is not an object');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'attributes')) {
        if (!isObject(value.attributes)) {
            throw unsupportedIdentity(path, 'has malformed block attributes');
        }
        return value.attributes;
    }
    const reserved = new Set([
        '__itemTypeId',
        'creator',
        'id',
        'item_type',
        'meta',
        'relationships',
        'type',
    ]);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !reserved.has(key)));
}
function inspectRecordStructuralContent(input, ownerItemType, fullSchema, recordId, slice) {
    if (!isObject(input)) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Record ${recordId} returned a malformed ${slice} resource.`, { recordId, slice });
    }
    const itemTypes = new Map(fullSchema.itemTypes.map((itemType) => [itemType.id, itemType]));
    const encounteredItemTypeIds = new Set();
    const issues = [];
    const fields = isObject(input.attributes) ? input.attributes : input;
    inspectFields(fields, ownerItemType, '', null, itemTypes, recordId, slice, encounteredItemTypeIds, issues);
    return {
        encounteredItemTypeIds: [...encounteredItemTypeIds].sort(),
        issues: deduplicateIssues(issues.map((issue) => ({ ...issue, itemTypeId: ownerItemType.id }))),
    };
}
function inspectFields(fields, itemType, prefix, inheritedLocale, itemTypes, recordId, slice, encounteredItemTypeIds, issues) {
    for (const field of itemType.fields) {
        if (!Object.prototype.hasOwnProperty.call(fields, field.apiKey))
            continue;
        const fieldPath = prefix ? `${prefix}.${field.apiKey}` : field.apiKey;
        const rawValue = fields[field.apiKey];
        const values = field.localized && isObject(rawValue)
            ? Object.entries(rawValue)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([locale, value]) => ({ locale, value }))
            : [{ locale: inheritedLocale, value: rawValue }];
        for (const { locale, value } of values) {
            inspectFieldValue(value, field, fieldPath, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues);
        }
    }
}
function inspectFieldValue(value, field, fieldPath, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues) {
    if (field.fieldType === 'rich_text') {
        if (!Array.isArray(value))
            return;
        value.forEach((entry, index) => inspectEmbeddedBlock(entry, field, 'rich_text_blocks', `${fieldPath}[${index}]`, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues));
        return;
    }
    if (field.fieldType === 'single_block') {
        if (value === null || value === undefined)
            return;
        inspectEmbeddedBlock(value, field, 'single_block_blocks', fieldPath, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues);
        return;
    }
    if (field.fieldType === 'structured_text') {
        inspectStructuredText(value, field, fieldPath, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues);
    }
}
function inspectStructuredText(value, field, path, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues) {
    if (Array.isArray(value)) {
        value.forEach((child, index) => inspectStructuredText(child, field, `${path}[${index}]`, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues));
        return;
    }
    if (!isObject(value))
        return;
    if (value.type === 'block' || value.type === 'inlineBlock') {
        const validatorKey = value.type === 'block'
            ? 'structured_text_blocks'
            : 'structured_text_inline_blocks';
        if (!Object.prototype.hasOwnProperty.call(value, 'item')) {
            throw unsupportedIdentity(path, 'has a block node without an item');
        }
        inspectEmbeddedBlock(value.item, field, validatorKey, `${path}.item`, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues);
    }
    else {
        const unexpectedIdentity = nestedBlockIdentity(value, path);
        if (unexpectedIdentity) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Nested item ${unexpectedIdentity.id} appears outside a Structured Text block node at ${path}.`, { blockId: unexpectedIdentity.id, path });
        }
    }
    for (const [key, child] of Object.entries(value)) {
        if (key === 'item' &&
            (value.type === 'block' || value.type === 'inlineBlock')) {
            continue;
        }
        inspectStructuredText(child, field, `${path}.${key}`, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues);
    }
}
function inspectEmbeddedBlock(value, field, validatorKey, path, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues) {
    const identity = nestedBlockIdentity(value, path);
    if (!identity) {
        throw unsupportedIdentity(path, 'has no authoritative nested block identity');
    }
    const blockType = itemTypes.get(identity.itemTypeId);
    if (!blockType) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Nested item ${identity.id} refers to unknown block model ${identity.itemTypeId}.`, {
            blockId: identity.id,
            blockItemTypeId: identity.itemTypeId,
            path,
        });
    }
    if (!blockType.modularBlock) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Nested item ${identity.id} refers to regular model ${identity.itemTypeId}.`, {
            blockId: identity.id,
            blockItemTypeId: identity.itemTypeId,
            path,
        });
    }
    encounteredItemTypeIds.add(blockType.id);
    const allowed = structuralValidatorItemTypeIds(field, validatorKey);
    if (!allowed.has(blockType.id)) {
        issues.push({
            recordId,
            itemTypeId: '',
            slice,
            fieldId: field.id,
            fieldPath: path,
            locale,
            validatorKey,
            blockId: identity.id,
            blockItemTypeId: blockType.id,
        });
    }
    inspectFields(nestedBlockFields(value, path), blockType, `${path}.block:${identity.id}`, locale, itemTypes, recordId, slice, encounteredItemTypeIds, issues);
}
function structuralValidatorItemTypeIds(field, validatorKey) {
    const configuration = field.validators[validatorKey];
    if (configuration === undefined)
        return new Set();
    if (!isObject(configuration) || !Array.isArray(configuration.item_types)) {
        throw new types_1.ContentDiffError('INCOMPATIBLE_SCHEMA', `Field ${field.id} has a malformed ${validatorKey} validator.`, { fieldId: field.id, validatorKey });
    }
    if (configuration.item_types.some((itemTypeId) => typeof itemTypeId !== 'string' || itemTypeId.length === 0)) {
        throw new types_1.ContentDiffError('INCOMPATIBLE_SCHEMA', `Field ${field.id} has non-string item type IDs in ${validatorKey}.`, { fieldId: field.id, validatorKey });
    }
    return new Set(configuration.item_types);
}
function deduplicateIssues(issues) {
    return [
        ...new Map(issues.map((issue) => {
            var _a;
            return [
                [
                    issue.recordId,
                    issue.slice,
                    issue.fieldId,
                    issue.fieldPath,
                    (_a = issue.locale) !== null && _a !== void 0 ? _a : '',
                    issue.validatorKey,
                    issue.blockId,
                    issue.blockItemTypeId,
                ].join('\0'),
                issue,
            ];
        })).values(),
    ].sort((left, right) => {
        var _a, _b;
        return left.recordId.localeCompare(right.recordId) ||
            left.slice.localeCompare(right.slice) ||
            left.fieldPath.localeCompare(right.fieldPath) ||
            ((_a = left.locale) !== null && _a !== void 0 ? _a : '').localeCompare((_b = right.locale) !== null && _b !== void 0 ? _b : '') ||
            left.blockId.localeCompare(right.blockId);
    });
}
function unsupportedIdentity(path, message) {
    return new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Nested content at ${path} ${message}.`, { path });
}
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
