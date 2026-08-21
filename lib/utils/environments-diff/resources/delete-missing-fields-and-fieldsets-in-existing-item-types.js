"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDestroyFieldClientCommand = buildDestroyFieldClientCommand;
exports.buildDestroyFieldsetClientCommand = buildDestroyFieldsetClientCommand;
exports.deleteMissingFieldsAndFieldsetsInExistingItemType = deleteMissingFieldsAndFieldsetsInExistingItemType;
exports.deleteMissingFieldsAndFieldsetsInExistingItemTypes = deleteMissingFieldsAndFieldsetsInExistingItemTypes;
const lodash_1 = require("lodash");
const utils_1 = require("../utils");
const comments_1 = require("./comments");
function buildDestroyFieldClientCommand(field, itemType) {
    return [
        (0, comments_1.buildComment)(`Delete ${(0, utils_1.buildFieldTitle)(field)} in ${(0, utils_1.buildItemTypeTitle)(itemType)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.fields.destroy',
            arguments: [field.id],
        },
    ];
}
function buildDestroyFieldsetClientCommand(fieldset, itemType) {
    return [
        (0, comments_1.buildComment)(`Delete ${(0, utils_1.buildFieldsetTitle)(fieldset)} in ${(0, utils_1.buildItemTypeTitle)(itemType)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.fieldsets.destroy',
            arguments: [fieldset.id],
        },
    ];
}
function deleteMissingFieldsAndFieldsetsInExistingItemType(newItemTypeSchema, oldItemTypeSchema) {
    const oldFieldIds = Object.keys(oldItemTypeSchema.fieldsById);
    const newFieldIds = Object.keys(newItemTypeSchema.fieldsById);
    const deletedFieldIds = (0, lodash_1.difference)(oldFieldIds, newFieldIds);
    const oldFieldsetIds = Object.keys(oldItemTypeSchema.fieldsetsById);
    const newFieldsetIds = Object.keys(newItemTypeSchema.fieldsetsById);
    const deletedFieldsetsIds = (0, lodash_1.difference)(oldFieldsetIds, newFieldsetIds);
    return [
        ...deletedFieldsetsIds.flatMap((fieldsetId) => buildDestroyFieldsetClientCommand(oldItemTypeSchema.fieldsetsById[fieldsetId], newItemTypeSchema.entity)),
        ...deletedFieldIds.flatMap((fieldId) => buildDestroyFieldClientCommand(oldItemTypeSchema.fieldsById[fieldId], newItemTypeSchema.entity)),
    ];
}
function deleteMissingFieldsAndFieldsetsInExistingItemTypes(newSchema, oldSchema) {
    const newItemTypeIds = Object.keys(newSchema.itemTypesById);
    const oldItemTypeIds = Object.keys(oldSchema.itemTypesById);
    const keptItemTypeIds = (0, lodash_1.intersection)(newItemTypeIds, oldItemTypeIds);
    const destroyCommands = keptItemTypeIds.flatMap((itemTypeId) => deleteMissingFieldsAndFieldsetsInExistingItemType(newSchema.itemTypesById[itemTypeId], oldSchema.itemTypesById[itemTypeId]));
    if (destroyCommands.length === 0) {
        return [];
    }
    return [
        (0, comments_1.buildComment)('Destroy fields in existing models/block models'),
        ...destroyCommands,
    ];
}
