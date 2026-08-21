import type { ItemTypeSchemaSnapshot, JsonObject, JsonValue, RecordPlan, SchemaSnapshot } from './types';
/**
 * Reproduces the CMA's create-time default filling on an already-canonical
 * record payload. Defaults are applied to top-level records and recursively to
 * every new nested block. Existing-record updates deliberately do not use this
 * transform: the CMA preserves explicit nulls on that path.
 */
export declare function applyCreateDefaultsToFields(fields: JsonObject, itemType: ItemTypeSchemaSnapshot, schema: SchemaSnapshot): JsonObject;
export interface CreateDefaultValueSuppression {
    fieldId: string;
    itemTypeId: string;
    originalDefaultValue: JsonValue;
    suppressedDefaultValue: JsonValue;
    originalHash: string;
    suppressedHash: string;
    allowedHashes: [string, string];
    affectedRecordIds: string[];
}
/**
 * Derives the smallest reversible schema-default change that makes every
 * planned CREATE seed byte-stable. Localized defaults are cleared only in the
 * locales where the CMA would otherwise replace an explicit/missing null.
 */
export declare function deriveCreateDefaultValueSuppressions(records: readonly RecordPlan[], schema: SchemaSnapshot, projectedCreateSeedFields: ReadonlyMap<string, JsonObject>): CreateDefaultValueSuppression[];
export declare function createRecordNeedsDefaultCorrection(record: RecordPlan, schema: SchemaSnapshot): boolean;
export declare function defaultCorrectedCreateRecordIds(records: readonly RecordPlan[], schema: SchemaSnapshot): Set<string>;
