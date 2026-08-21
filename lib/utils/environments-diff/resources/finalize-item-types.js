"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeItemType = finalizeItemType;
exports.finalizeItemTypes = finalizeItemTypes;
const lodash_1 = require("lodash");
const utils_1 = require("../utils");
const comments_1 = require("./comments");
const create_new_item_types_1 = require("./create-new-item-types");
const relationshipsToIgnoreOnModelBlocks = [
    'ordering_field',
    'title_field',
    'image_preview_field',
    'excerpt_field',
    'workflow',
    'fields',
    'fieldsets',
    'singleton_item',
];
const relationshipsToIgnoreOnModels = ['fields', 'fieldsets', 'singleton_item'];
const defaultRelationshipsOnCreatedItemTypes = {
    workflow: { data: null },
    ordering_field: { data: null },
    title_field: { data: null },
    image_preview_field: { data: null },
    excerpt_field: { data: null },
    presentation_image_field: { data: null },
    presentation_title_field: { data: null },
};
function finalizeItemType(newItemTypeSchema, oldItemTypeSchema) {
    const oldItemType = oldItemTypeSchema === null || oldItemTypeSchema === void 0 ? void 0 : oldItemTypeSchema.entity;
    const newItemType = newItemTypeSchema.entity;
    const changedRelationships = Object.keys(newItemType.relationships).filter((relationship) => !(0, lodash_1.isEqual)(oldItemType
        ? oldItemType.relationships[relationship]
        : defaultRelationshipsOnCreatedItemTypes[relationship], newItemType.relationships[relationship]));
    const changedAttributes = oldItemTypeSchema
        ? Object.keys(newItemType.attributes).filter((attribute) => !(oldItemType &&
            (0, lodash_1.isEqual)(oldItemType.attributes[attribute], newItemType.attributes[attribute])))
        : ['ordering_direction', 'ordering_meta'];
    // If ordering_field changes, we must also include ordering_direction even if it didn't change
    const attributesWithOrderingDirection = changedRelationships.includes('ordering_field')
        ? [...new Set([...changedAttributes, 'ordering_direction'])]
        : changedAttributes;
    // When ordering_field changes, don't ignore ordering_direction
    const attributesToIgnore = newItemType.attributes.modular_block
        ? create_new_item_types_1.attributesToIgnoreOnBlockModels
        : create_new_item_types_1.attributesToIgnoreOnModels;
    const finalAttributesToIgnore = changedRelationships.includes('ordering_field')
        ? attributesToIgnore.filter((attr) => attr !== 'ordering_direction')
        : attributesToIgnore;
    const attributesToUpdate = (0, lodash_1.pick)(newItemType.attributes, (0, lodash_1.without)(attributesWithOrderingDirection, ...finalAttributesToIgnore));
    const relationshipsToUpdate = (0, lodash_1.pick)(newItemType.relationships, (0, lodash_1.without)(changedRelationships, ...(newItemType.attributes.modular_block
        ? relationshipsToIgnoreOnModelBlocks
        : relationshipsToIgnoreOnModels), ...(!oldItemType ? ['workflow'] : [])));
    const updateItemTypeCommands = Object.keys(attributesToUpdate).length > 0 ||
        Object.keys(relationshipsToUpdate).length > 0
        ? [
            {
                type: 'apiCallClientCommand',
                call: 'client.itemTypes.update',
                arguments: [
                    newItemType.id,
                    {
                        data: {
                            id: newItemType.id,
                            type: 'item_type',
                            ...(Object.keys(attributesToUpdate).length > 0
                                ? { attributes: attributesToUpdate }
                                : {}),
                            ...(Object.keys(relationshipsToUpdate).length > 0
                                ? { relationships: relationshipsToUpdate }
                                : {}),
                        },
                    },
                ],
            },
        ]
        : [];
    if (updateItemTypeCommands.length === 0) {
        return [];
    }
    return [
        (0, comments_1.buildComment)(`Update ${(0, utils_1.buildItemTypeTitle)(newItemType)}`),
        ...updateItemTypeCommands,
    ];
}
function finalizeItemTypes(newSchema, oldSchema) {
    const newItemTypeIds = Object.keys(newSchema.itemTypesById);
    const oldItemTypeIds = Object.keys(oldSchema.itemTypesById);
    const createdItemTypeIds = (0, lodash_1.difference)(newItemTypeIds, oldItemTypeIds);
    const keptItemTypeIds = (0, lodash_1.intersection)(newItemTypeIds, oldItemTypeIds);
    const commands = [...createdItemTypeIds, ...keptItemTypeIds].flatMap((itemTypeId) => finalizeItemType(newSchema.itemTypesById[itemTypeId], oldSchema.itemTypesById[itemTypeId]));
    if (commands.length === 0) {
        return [];
    }
    return [(0, comments_1.buildComment)('Finalize models/block models'), ...commands];
}
