"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRecordValidationPayload = buildRecordValidationPayload;
const types_1 = require("./types");
const EMBEDDED_FIELD_TYPES = new Set([
    'rich_text',
    'single_block',
    'structured_text',
]);
/**
 * Converts canonical snapshot fields into a body that the high-level CMA item
 * validation methods can serialize safely. Nested block IDs are deliberately
 * omitted: a published block can have the same parent but no longer belong to
 * the current field/locale slot used by `validateExisting()`. Treating every
 * embedded block as a validation-only new payload preserves its model and
 * complete recursive content without triggering that ownership check.
 */
function buildRecordValidationPayload(fields, itemTypeId, schema) {
    return convertRecordFields(fields, findItemType(schema, itemTypeId), schema);
}
function convertRecordFields(fields, itemType, schema) {
    const fieldsByApiKey = new Map(itemType.fields.map((field) => [field.apiKey, field]));
    return Object.fromEntries(Object.entries(fields).map(([apiKey, value]) => {
        const field = fieldsByApiKey.get(apiKey);
        return [apiKey, field ? convertFieldValue(value, field, schema) : value];
    }));
}
function convertFieldValue(value, field, schema) {
    if (!EMBEDDED_FIELD_TYPES.has(field.fieldType))
        return value;
    if (!field.localized)
        return convertEmbeddedValue(value, schema);
    if (!isObject(value))
        return value;
    return Object.fromEntries(Object.entries(value).map(([locale, localizedValue]) => [
        locale,
        convertEmbeddedValue(localizedValue, schema),
    ]));
}
function convertEmbeddedValue(value, schema) {
    if (Array.isArray(value)) {
        return value.map((child) => convertEmbeddedValue(child, schema));
    }
    if (!isObject(value))
        return value;
    if (isNestedBlock(value))
        return convertNestedBlock(value, schema);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key,
        convertEmbeddedValue(child, schema),
    ]));
}
function convertNestedBlock(block, schema) {
    const itemTypeId = nestedBlockItemTypeId(block);
    const itemType = findItemType(schema, itemTypeId);
    if (!itemType.modularBlock) {
        throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Nested validation payload refers to non-block model ${itemTypeId}.`, { itemTypeId });
    }
    const attributes = isObject(block.attributes)
        ? block.attributes
        : Object.fromEntries(Object.entries(block).filter(([key]) => ![
            '__itemTypeId',
            'attributes',
            'creator',
            'id',
            'item_type',
            'meta',
            'relationships',
            'type',
        ].includes(key)));
    return {
        type: 'item',
        attributes: convertRecordFields(attributes, itemType, schema),
        relationships: {
            item_type: {
                data: { id: itemTypeId, type: 'item_type' },
            },
        },
    };
}
function isNestedBlock(value) {
    return value.type === 'item' && nestedBlockItemTypeId(value).length > 0;
}
function nestedBlockItemTypeId(value) {
    if (isObject(value.item_type) && typeof value.item_type.id === 'string') {
        return value.item_type.id;
    }
    if (isObject(value.relationships) &&
        isObject(value.relationships.item_type) &&
        isObject(value.relationships.item_type.data) &&
        typeof value.relationships.item_type.data.id === 'string') {
        return value.relationships.item_type.data.id;
    }
    return typeof value.__itemTypeId === 'string' ? value.__itemTypeId : '';
}
function findItemType(schema, itemTypeId) {
    const itemType = schema.itemTypes.find(({ id }) => id === itemTypeId);
    if (itemType)
        return itemType;
    throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Nested validation payload refers to unknown model ${itemTypeId}.`, { itemTypeId });
}
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
