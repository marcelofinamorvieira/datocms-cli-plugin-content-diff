"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyCreateDefaultsToFields = applyCreateDefaultsToFields;
exports.deriveCreateDefaultValueSuppressions = deriveCreateDefaultValueSuppressions;
exports.createRecordNeedsDefaultCorrection = createRecordNeedsDefaultCorrection;
exports.defaultCorrectedCreateRecordIds = defaultCorrectedCreateRecordIds;
const canonicalize_1 = require("./canonicalize");
const structural_content_1 = require("./structural-content");
const types_1 = require("./types");
/**
 * Reproduces the CMA's create-time default filling on an already-canonical
 * record payload. Defaults are applied to top-level records and recursively to
 * every new nested block. Existing-record updates deliberately do not use this
 * transform: the CMA preserves explicit nulls on that path.
 */
function applyCreateDefaultsToFields(fields, itemType, schema) {
    return applyCreateDefaults(fields, itemType, schema);
}
/**
 * Derives the smallest reversible schema-default change that makes every
 * planned CREATE seed byte-stable. Localized defaults are cleared only in the
 * locales where the CMA would otherwise replace an explicit/missing null.
 */
function deriveCreateDefaultValueSuppressions(records, schema, projectedCreateSeedFields) {
    const collected = new Map();
    for (const record of records) {
        if (record.action !== 'create' || !record.desired)
            continue;
        const itemType = schema.itemTypes.find(({ id }) => id === record.itemTypeId);
        if (!itemType)
            continue;
        const seedFields = projectedCreateSeedFields.get(record.id);
        if (!seedFields) {
            throw new Error(`Missing projected phase-5 create seed for record ${record.id}.`);
        }
        applyCreateDefaults(seedFields, itemType, schema, {
            recordId: record.id,
            suppressions: collected,
        });
    }
    const candidates = [...collected.values()]
        .sort((left, right) => left.fieldId.localeCompare(right.fieldId))
        .map((entry) => {
        const originalHash = (0, canonicalize_1.semanticHash)(entry.originalDefaultValue);
        const suppressedHash = (0, canonicalize_1.semanticHash)(entry.suppressedDefaultValue);
        return {
            fieldId: entry.fieldId,
            itemTypeId: entry.itemTypeId,
            originalDefaultValue: entry.originalDefaultValue,
            suppressedDefaultValue: entry.suppressedDefaultValue,
            originalHash,
            suppressedHash,
            allowedHashes: [originalHash, suppressedHash],
            affectedRecordIds: [...entry.affectedRecordIds].sort(),
        };
    });
    const candidateSchema = schemaWithCreateDefaultSuppressions(schema, candidates);
    const suppressions = candidates.filter((candidate) => {
        const withoutCandidate = schemaWithCreateDefaultSuppressions(schema, candidates.filter(({ fieldId }) => fieldId !== candidate.fieldId));
        return records.some((record) => {
            if (record.action !== 'create' || !record.desired)
                return false;
            const seedFields = projectedCreateSeedFields.get(record.id);
            const suppressedItemType = candidateSchema.itemTypes.find(({ id }) => id === record.itemTypeId);
            const restoredItemType = withoutCandidate.itemTypes.find(({ id }) => id === record.itemTypeId);
            if (!seedFields || !suppressedItemType || !restoredItemType)
                return false;
            return ((0, canonicalize_1.semanticHash)(applyCreateDefaults(seedFields, suppressedItemType, candidateSchema)) !==
                (0, canonicalize_1.semanticHash)(applyCreateDefaults(seedFields, restoredItemType, withoutCandidate)));
        });
    });
    const suppressedSchema = schemaWithCreateDefaultSuppressions(schema, suppressions);
    const defaultsDisabledSchema = schemaWithAllCreateDefaultsDisabled(schema);
    for (const record of records) {
        if (record.action !== 'create' || !record.desired)
            continue;
        const seedFields = projectedCreateSeedFields.get(record.id);
        const itemType = suppressedSchema.itemTypes.find(({ id }) => id === record.itemTypeId);
        if (!seedFields || !itemType)
            continue;
        const defaultsDisabledItemType = defaultsDisabledSchema.itemTypes.find(({ id }) => id === record.itemTypeId);
        if (!defaultsDisabledItemType)
            continue;
        const filled = applyCreateDefaults(seedFields, itemType, suppressedSchema);
        const expected = applyCreateDefaults(seedFields, defaultsDisabledItemType, defaultsDisabledSchema);
        if ((0, canonicalize_1.semanticHash)(filled) !== (0, canonicalize_1.semanticHash)(expected)) {
            throw new types_1.ContentDiffError('UNSUPPORTED_CONTENT_STATE', `Exact temporary field-default suppression cannot reproduce the planned create seed for record ${record.id}.`, {
                recordId: record.id,
                expectedCreateHash: (0, canonicalize_1.semanticHash)(expected),
                modeledCreateHash: (0, canonicalize_1.semanticHash)(filled),
            });
        }
    }
    return suppressions;
}
function schemaWithAllCreateDefaultsDisabled(schema) {
    return {
        ...schema,
        itemTypes: schema.itemTypes.map((itemType) => ({
            ...itemType,
            fields: itemType.fields.map((field) => ({
                ...field,
                defaultValue: null,
            })),
        })),
    };
}
function schemaWithCreateDefaultSuppressions(schema, suppressions) {
    const byFieldId = new Map(suppressions.map((suppression) => [suppression.fieldId, suppression]));
    return {
        ...schema,
        itemTypes: schema.itemTypes.map((itemType) => ({
            ...itemType,
            fields: itemType.fields.map((field) => {
                const suppression = byFieldId.get(field.id);
                return suppression
                    ? { ...field, defaultValue: suppression.suppressedDefaultValue }
                    : field;
            }),
        })),
    };
}
function applyCreateDefaults(fields, itemType, schema, collection) {
    const locales = localesFilledByCreate(fields, itemType, schema);
    const knownApiKeys = new Set(itemType.fields.map(({ apiKey }) => apiKey));
    const result = {};
    for (const field of itemType.fields) {
        const hasValue = Object.prototype.hasOwnProperty.call(fields, field.apiKey);
        let value = hasValue
            ? fields[field.apiKey]
            : field.localized
                ? Object.fromEntries(locales.map((locale) => [locale, null]))
                : null;
        if (field.localized && isJsonObject(value)) {
            const localizedValue = { ...value };
            for (const locale of locales) {
                if (!Object.prototype.hasOwnProperty.call(localizedValue, locale)) {
                    localizedValue[locale] = null;
                }
            }
            const localizedDefault = isJsonObject(field.defaultValue)
                ? field.defaultValue
                : null;
            if (localizedDefault !== null) {
                const suppressedLocales = Object.entries(localizedValue)
                    .filter(([locale, localeValue]) => localeValue === null &&
                    localizedDefault[locale] !== null &&
                    localizedDefault[locale] !== undefined)
                    .map(([locale]) => locale);
                if (suppressedLocales.length > 0 && collection) {
                    collectSuppression(collection, itemType.id, field.id, localizedDefault, Object.fromEntries(Object.entries(localizedDefault).map(([locale, defaultValue]) => [
                        locale,
                        suppressedLocales.includes(locale) ? null : defaultValue,
                    ])));
                }
            }
            value = Object.fromEntries(Object.entries(localizedValue).map(([locale, localeValue]) => [
                locale,
                normalizeCreatedFieldValue(localeValue === null &&
                    localizedDefault !== null &&
                    localizedDefault[locale] !== null &&
                    localizedDefault[locale] !== undefined
                    ? localizedDefault[locale]
                    : localeValue, field.fieldType, schema, collection),
            ]));
        }
        else {
            if (value === null && cmaDefaultIsActive(field.defaultValue)) {
                if (collection) {
                    collectSuppression(collection, itemType.id, field.id, field.defaultValue, null);
                }
                value = field.defaultValue;
            }
            value = normalizeCreatedFieldValue(value, field.fieldType, schema, collection);
        }
        result[field.apiKey] = value;
    }
    for (const [key, value] of Object.entries(fields)) {
        if (!knownApiKeys.has(key)) {
            result[key] = (0, canonicalize_1.canonicalizeJson)(value);
        }
    }
    return (0, canonicalize_1.canonicalizeJson)(result);
}
function createRecordNeedsDefaultCorrection(record, schema) {
    var _a;
    if (record.action !== 'create' || !record.desired)
        return false;
    const itemType = schema.itemTypes.find(({ id }) => id === record.itemTypeId);
    if (!itemType)
        return false;
    const seed = (_a = record.desired.published) !== null && _a !== void 0 ? _a : record.desired.current;
    return ((0, canonicalize_1.semanticHash)(applyCreateDefaultsToFields(seed.fields, itemType, schema)) !==
        seed.hash);
}
function defaultCorrectedCreateRecordIds(records, schema) {
    return new Set(records
        .filter((record) => createRecordNeedsDefaultCorrection(record, schema))
        .map(({ id }) => id));
}
function localesFilledByCreate(fields, itemType, schema) {
    if (itemType.allLocalesRequired)
        return [...schema.locales];
    const firstLocalizedField = itemType.fields.find(({ apiKey, localized }) => localized && Object.prototype.hasOwnProperty.call(fields, apiKey));
    if (!firstLocalizedField)
        return [];
    const value = fields[firstLocalizedField.apiKey];
    return isJsonObject(value) ? Object.keys(value) : [];
}
function normalizeCreatedFieldValue(value, fieldType, schema, collection) {
    if (value === null) {
        if (fieldType === 'string' || fieldType === 'text')
            return '';
        if (fieldType === 'boolean')
            return false;
        return null;
    }
    if (fieldType === 'rich_text' ||
        fieldType === 'single_block' ||
        fieldType === 'structured_text') {
        return applyDefaultsToEmbeddedValue(value, schema, 'create seed', collection);
    }
    return (0, canonicalize_1.canonicalizeJson)(value);
}
function applyDefaultsToEmbeddedValue(value, schema, path, collection) {
    if (Array.isArray(value)) {
        return value.map((child, index) => applyDefaultsToEmbeddedValue(child, schema, `${path}[${index}]`, collection));
    }
    if (!isJsonObject(value))
        return (0, canonicalize_1.canonicalizeJson)(value);
    const identity = (0, structural_content_1.nestedBlockIdentity)(value, path);
    if (identity) {
        const blockType = schema.itemTypes.find(({ id }) => id === identity.itemTypeId);
        if (!(blockType === null || blockType === void 0 ? void 0 : blockType.modularBlock)) {
            return (0, canonicalize_1.canonicalizeJson)(value);
        }
        return (0, canonicalize_1.canonicalizeJson)({
            ...value,
            attributes: applyCreateDefaults((0, canonicalize_1.canonicalizeJson)((0, structural_content_1.nestedBlockFields)(value, `${path}.${identity.id}`)), blockType, schema, collection),
        });
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key,
        applyDefaultsToEmbeddedValue(child, schema, `${path}.${key}`, collection),
    ]));
}
function collectSuppression(collection, itemTypeId, fieldId, originalDefaultValue, suppressedDefaultValue) {
    const existing = collection.suppressions.get(fieldId);
    if (!existing) {
        collection.suppressions.set(fieldId, {
            fieldId,
            itemTypeId,
            originalDefaultValue: (0, canonicalize_1.canonicalizeJson)(originalDefaultValue),
            suppressedDefaultValue: (0, canonicalize_1.canonicalizeJson)(suppressedDefaultValue),
            affectedRecordIds: new Set([collection.recordId]),
        });
        return;
    }
    existing.affectedRecordIds.add(collection.recordId);
    if (isJsonObject(existing.suppressedDefaultValue) &&
        isJsonObject(suppressedDefaultValue)) {
        const existingSuppressedDefault = existing.suppressedDefaultValue;
        existing.suppressedDefaultValue = (0, canonicalize_1.canonicalizeJson)({
            ...existingSuppressedDefault,
            ...Object.fromEntries(Object.entries(suppressedDefaultValue).filter(([locale, value]) => value === null || existingSuppressedDefault[locale] === undefined)),
        });
    }
}
function isJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Ruby's `if field.default_value` treats only nil and false as inactive. */
function cmaDefaultIsActive(value) {
    return value !== undefined && value !== null && value !== false;
}
