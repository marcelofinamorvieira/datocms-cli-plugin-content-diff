"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.manageItemTypeFilters = manageItemTypeFilters;
const lodash_1 = require("lodash");
const utils_1 = require("../utils");
const comments_1 = require("./comments");
function buildCreateItemTypeFilterClientCommand(itemTypeFilter, itemType) {
    return [
        (0, comments_1.buildComment)(`Create ${(0, utils_1.buildItemTypeFilterTitle)(itemTypeFilter)} of ${(0, utils_1.buildItemTypeTitle)(itemType)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.itemTypeFilters.create',
            arguments: [
                {
                    data: {
                        type: 'item_type_filter',
                        id: (0, utils_1.isBase64Id)(itemTypeFilter.id) ? itemTypeFilter.id : undefined,
                        attributes: itemTypeFilter.attributes,
                        relationships: itemTypeFilter.relationships,
                    },
                },
            ],
            oldEnvironmentId: itemTypeFilter.id,
        },
    ];
}
function buildDestroyItemTypeFilterClientCommand(itemTypeFilter, itemType) {
    return [
        (0, comments_1.buildComment)(`Delete ${(0, utils_1.buildItemTypeFilterTitle)(itemTypeFilter)} of ${(0, utils_1.buildItemTypeTitle)(itemType)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.itemTypeFilters.destroy',
            arguments: [itemTypeFilter.id],
        },
    ];
}
function buildUpdateItemTypeFilterClientCommand(newItemTypeFilter, oldItemTypeFilter, itemType) {
    const attributesToUpdate = (0, lodash_1.pick)(newItemTypeFilter.attributes, Object.keys(newItemTypeFilter.attributes).filter((attribute) => !(0, lodash_1.isEqual)(oldItemTypeFilter.attributes[attribute], newItemTypeFilter.attributes[attribute])));
    if (Object.keys(attributesToUpdate).length === 0) {
        return [];
    }
    return [
        (0, comments_1.buildComment)(`Update ${(0, utils_1.buildItemTypeFilterTitle)(newItemTypeFilter)} of ${(0, utils_1.buildItemTypeTitle)(itemType)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.itemTypeFilters.update',
            arguments: [
                oldItemTypeFilter.id,
                {
                    data: {
                        type: 'item_type_filter',
                        id: oldItemTypeFilter.id,
                        attributes: attributesToUpdate,
                    },
                },
            ],
        },
    ];
}
function manageItemTypeFilters(newSchema, oldSchema) {
    const oldEntityIds = Object.keys(oldSchema.itemTypeFiltersById);
    const newEntityIds = Object.keys(newSchema.itemTypeFiltersById);
    const keptEntityIds = (0, lodash_1.intersection)(oldEntityIds, newEntityIds);
    const deletedEntities = (0, lodash_1.difference)(oldEntityIds, newEntityIds).map((itemTypeFilterId) => oldSchema.itemTypeFiltersById[itemTypeFilterId]);
    const createdEntities = (0, lodash_1.difference)(newEntityIds, oldEntityIds).map((itemTypeFilterId) => newSchema.itemTypeFiltersById[itemTypeFilterId]);
    const commands = [
        ...deletedEntities.flatMap((entity) => buildDestroyItemTypeFilterClientCommand(entity, oldSchema.itemTypesById[entity.relationships.item_type.data.id].entity)),
        ...createdEntities.flatMap((entity) => buildCreateItemTypeFilterClientCommand(entity, newSchema.itemTypesById[entity.relationships.item_type.data.id].entity)),
        ...keptEntityIds.flatMap((itemTypeFilterId) => buildUpdateItemTypeFilterClientCommand(newSchema.itemTypeFiltersById[itemTypeFilterId], oldSchema.itemTypeFiltersById[itemTypeFilterId], newSchema.itemTypesById[newSchema.itemTypeFiltersById[itemTypeFilterId].relationships
            .item_type.data.id].entity)),
    ];
    if (commands.length === 0) {
        return [];
    }
    return [(0, comments_1.buildComment)('Manage model filters'), ...commands];
}
