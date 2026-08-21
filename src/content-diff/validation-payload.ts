import type {
  FieldSchemaSnapshot,
  ItemTypeSchemaSnapshot,
  JsonObject,
  JsonValue,
  SchemaSnapshot,
} from './types';
import { ContentDiffError } from './types';

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
export function buildRecordValidationPayload(
  fields: JsonObject,
  itemTypeId: string,
  schema: SchemaSnapshot,
): JsonObject {
  return convertRecordFields(fields, findItemType(schema, itemTypeId), schema);
}

function convertRecordFields(
  fields: JsonObject,
  itemType: ItemTypeSchemaSnapshot,
  schema: SchemaSnapshot,
): JsonObject {
  const fieldsByApiKey = new Map(
    itemType.fields.map((field) => [field.apiKey, field]),
  );

  return Object.fromEntries(
    Object.entries(fields).map(([apiKey, value]) => {
      const field = fieldsByApiKey.get(apiKey);
      return [apiKey, field ? convertFieldValue(value, field, schema) : value];
    }),
  );
}

function convertFieldValue(
  value: JsonValue,
  field: FieldSchemaSnapshot,
  schema: SchemaSnapshot,
): JsonValue {
  if (!EMBEDDED_FIELD_TYPES.has(field.fieldType)) return value;

  if (!field.localized) return convertEmbeddedValue(value, schema);
  if (!isObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([locale, localizedValue]) => [
      locale,
      convertEmbeddedValue(localizedValue, schema),
    ]),
  );
}

function convertEmbeddedValue(
  value: JsonValue,
  schema: SchemaSnapshot,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((child) => convertEmbeddedValue(child, schema));
  }

  if (!isObject(value)) return value;
  if (isNestedBlock(value)) return convertNestedBlock(value, schema);

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      convertEmbeddedValue(child, schema),
    ]),
  );
}

function convertNestedBlock(
  block: JsonObject,
  schema: SchemaSnapshot,
): JsonObject {
  const itemTypeId = nestedBlockItemTypeId(block);
  const itemType = findItemType(schema, itemTypeId);

  if (!itemType.modularBlock) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `Nested validation payload refers to non-block model ${itemTypeId}.`,
      { itemTypeId },
    );
  }

  const attributes = isObject(block.attributes)
    ? block.attributes
    : Object.fromEntries(
        Object.entries(block).filter(
          ([key]) =>
            ![
              '__itemTypeId',
              'attributes',
              'creator',
              'id',
              'item_type',
              'meta',
              'relationships',
              'type',
            ].includes(key),
        ),
      );

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

function isNestedBlock(value: JsonObject): boolean {
  return value.type === 'item' && nestedBlockItemTypeId(value).length > 0;
}

function nestedBlockItemTypeId(value: JsonObject): string {
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

function findItemType(
  schema: SchemaSnapshot,
  itemTypeId: string,
): ItemTypeSchemaSnapshot {
  const itemType = schema.itemTypes.find(({ id }) => id === itemTypeId);
  if (itemType) return itemType;

  throw new ContentDiffError(
    'UNSUPPORTED_CONTENT_STATE',
    `Nested validation payload refers to unknown model ${itemTypeId}.`,
    { itemTypeId },
  );
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
