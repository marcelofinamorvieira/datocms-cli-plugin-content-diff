"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCreateFieldClientCommand = buildCreateFieldClientCommand;
exports.buildCreateFieldsetClientCommand = buildCreateFieldsetClientCommand;
exports.buildCreateFieldClientCommands = buildCreateFieldClientCommands;
exports.buildCreateFieldsetClientCommands = buildCreateFieldsetClientCommands;
exports.createNewFieldsAndFieldsets = createNewFieldsAndFieldsets;
const lodash_1 = require("lodash");
const utils_1 = require("../utils");
const comments_1 = require("./comments");
function buildDefaultValues(site) {
    return {
        hint: null,
        localized: false,
        deep_filtering_enabled: false,
        default_value: site.attributes.locales.length === 1
            ? null
            : Object.fromEntries(site.attributes.locales.map((locale) => [locale, null])),
        validators: {},
    };
}
function buildCreateFieldClientCommand(site, itemType, field) {
    const defaultValues = buildDefaultValues(site);
    const attributesToPick = (0, lodash_1.without)(Object.keys(field.attributes).filter((attribute) => !(0, lodash_1.isEqual)(defaultValues[attribute], field.attributes[attribute])), 'appeareance');
    const attributesToUpdate = (0, lodash_1.pick)(field.attributes, (0, lodash_1.without)(attributesToPick, 'position'));
    return [
        (0, comments_1.buildComment)(`Create ${(0, utils_1.buildFieldTitle)(field)} in ${(0, utils_1.buildItemTypeTitle)(itemType)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.fields.create',
            arguments: [
                field.relationships.item_type.data.id,
                {
                    data: {
                        type: 'field',
                        id: (0, utils_1.isBase64Id)(field.id) ? field.id : undefined,
                        attributes: attributesToUpdate,
                        ...(field.relationships.fieldset.data
                            ? { relationships: (0, lodash_1.pick)(field.relationships, 'fieldset') }
                            : {}),
                    },
                },
            ],
            oldEnvironmentId: field.id,
        },
    ];
}
const defaultValuesForFieldsetAttribute = {
    hint: null,
    collapsible: false,
    start_collapsed: false,
};
function buildCreateFieldsetClientCommand(itemType, fieldset) {
    const attributesToUpdate = (0, lodash_1.pick)(fieldset.attributes, (0, lodash_1.without)(Object.keys(fieldset.attributes).filter((attribute) => !(0, lodash_1.isEqual)(defaultValuesForFieldsetAttribute[attribute], fieldset.attributes[attribute])), 'position'));
    return [
        (0, comments_1.buildComment)(`Create ${(0, utils_1.buildFieldsetTitle)(fieldset)} in ${(0, utils_1.buildItemTypeTitle)(itemType)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.fieldsets.create',
            arguments: [
                fieldset.relationships.item_type.data.id,
                {
                    data: {
                        type: 'fieldset',
                        id: (0, utils_1.isBase64Id)(fieldset.id) ? fieldset.id : undefined,
                        attributes: attributesToUpdate,
                    },
                },
            ],
            oldEnvironmentId: fieldset.id,
        },
    ];
}
function buildCreateFieldClientCommands(site, itemType, fields) {
    const nonSlugFields = (0, lodash_1.sortBy)(fields.filter((field) => field.attributes.field_type !== 'slug'), (e) => e.attributes.position);
    const slugFields = (0, lodash_1.sortBy)(fields.filter((field) => field.attributes.field_type === 'slug'), (e) => e.attributes.position);
    return [
        ...nonSlugFields.flatMap(buildCreateFieldClientCommand.bind(null, site, itemType)),
        ...slugFields.flatMap(buildCreateFieldClientCommand.bind(null, site, itemType)),
    ];
}
function buildCreateFieldsetClientCommands(itemType, fieldsets) {
    return (0, lodash_1.sortBy)(fieldsets, (e) => e.attributes.position).flatMap(buildCreateFieldsetClientCommand.bind(null, itemType));
}
function createNewFieldsAndFieldsetsInItemType(newSite, newItemTypeSchema, oldItemTypeSchema) {
    const oldFieldIds = oldItemTypeSchema
        ? Object.keys(oldItemTypeSchema.fieldsById)
        : null;
    const newFieldIds = Object.keys(newItemTypeSchema.fieldsById);
    const fieldsToCreate = (oldFieldIds ? (0, lodash_1.difference)(newFieldIds, oldFieldIds) : newFieldIds).map((fieldId) => newItemTypeSchema.fieldsById[fieldId]);
    const oldFieldsetIds = oldItemTypeSchema
        ? Object.keys(oldItemTypeSchema.fieldsetsById)
        : null;
    const newFieldsetIds = Object.keys(newItemTypeSchema.fieldsetsById);
    const fieldsetsToCreate = (oldFieldsetIds ? (0, lodash_1.difference)(newFieldsetIds, oldFieldsetIds) : newFieldsetIds).map((fieldsetId) => newItemTypeSchema.fieldsetsById[fieldsetId]);
    return [
        ...buildCreateFieldsetClientCommands(newItemTypeSchema.entity, fieldsetsToCreate),
        ...buildCreateFieldClientCommands(newSite, newItemTypeSchema.entity, fieldsToCreate),
    ];
}
function createNewFieldsAndFieldsets(newSchema, oldSchema) {
    const newItemTypeIds = Object.keys(newSchema.itemTypesById);
    const oldItemTypeIds = Object.keys(oldSchema.itemTypesById);
    const createdItemTypeIds = (0, lodash_1.difference)(newItemTypeIds, oldItemTypeIds);
    const keptItemTypeIds = (0, lodash_1.intersection)(newItemTypeIds, oldItemTypeIds);
    const commands = [...createdItemTypeIds, ...keptItemTypeIds].flatMap((itemTypeId) => createNewFieldsAndFieldsetsInItemType(newSchema.siteEntity, newSchema.itemTypesById[itemTypeId], oldSchema.itemTypesById[itemTypeId]));
    if (commands.length === 0) {
        return [];
    }
    return [(0, comments_1.buildComment)('Creating new fields/fieldsets'), ...commands];
}
