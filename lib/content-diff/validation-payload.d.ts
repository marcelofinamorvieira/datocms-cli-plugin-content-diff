import type { JsonObject, SchemaSnapshot } from './types';
/**
 * Converts canonical snapshot fields into a body that the high-level CMA item
 * validation methods can serialize safely. Nested block IDs are deliberately
 * omitted: a published block can have the same parent but no longer belong to
 * the current field/locale slot used by `validateExisting()`. Treating every
 * embedded block as a validation-only new payload preserves its model and
 * complete recursive content without triggering that ownership check.
 */
export declare function buildRecordValidationPayload(fields: JsonObject, itemTypeId: string, schema: SchemaSnapshot): JsonObject;
