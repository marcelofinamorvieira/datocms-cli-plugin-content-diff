"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attributesToIgnoreOnBlockModels = exports.attributesToIgnoreOnModels = void 0;
exports.createNewItemTypes = createNewItemTypes;
const lodash_1 = require("lodash");
const utils_1 = require("../utils");
const comments_1 = require("./comments");
const defaultValuesForItemTypeAttribute = {
    hint: null,
    sortable: false,
    tree: false,
    singleton: false,
    modular_block: false,
    all_locales_required: false,
    ordering_meta: null,
    collection_appearance: 'compact',
};
exports.attributesToIgnoreOnModels = [
    'collection_appeareance',
    'ordering_direction',
    'ordering_meta',
    'has_singleton_item',
];
exports.attributesToIgnoreOnBlockModels = [
    'all_locales_required',
    'collection_appearance',
    'collection_appeareance',
    'draft_mode_active',
    'has_singleton_item',
    'ordering_direction',
    'ordering_meta',
    'singleton',
    'sortable',
    'tree',
];
function buildCreateItemTypeClientCommand(itemTypeSchema, schemaMenuItem) {
    const itemType = itemTypeSchema.entity;
    const attributesToUpdate = (0, lodash_1.pick)(itemType.attributes, (0, lodash_1.without)(Object.keys(itemType.attributes).filter((attribute) => !(0, lodash_1.isEqual)(defaultValuesForItemTypeAttribute[attribute], itemType.attributes[attribute])), ...(itemType.attributes.modular_block
        ? exports.attributesToIgnoreOnBlockModels
        : exports.attributesToIgnoreOnModels)));
    return [
        (0, comments_1.buildComment)(`Create ${(0, utils_1.buildItemTypeTitle)(itemType)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.itemTypes.create',
            arguments: [
                {
                    data: {
                        type: 'item_type',
                        id: (0, utils_1.isBase64Id)(itemType.id) ? itemType.id : undefined,
                        attributes: attributesToUpdate,
                        ...(itemType.relationships.workflow.data
                            ? { relationships: (0, lodash_1.pick)(itemType.relationships, 'workflow') }
                            : {}),
                    },
                },
                {
                    skip_menu_item_creation: true,
                    schema_menu_item_id: schemaMenuItem.id,
                },
            ],
            oldEnvironmentId: itemType.id,
        },
    ];
}
function createNewItemTypes(newSchema, oldSchema) {
    const newItemTypeIds = Object.keys(newSchema.itemTypesById);
    const oldItemTypeIds = Object.keys(oldSchema.itemTypesById);
    const createdItemTypeIds = (0, lodash_1.difference)(newItemTypeIds, oldItemTypeIds);
    if (createdItemTypeIds.length === 0) {
        return [];
    }
    return [
        (0, comments_1.buildComment)('Create new models/block models'),
        ...createdItemTypeIds.flatMap((itemTypeId) => {
            const schemaMenuItem = Object.values(newSchema.schemaMenuItemsById).find((item) => { var _a; return ((_a = item.relationships.item_type.data) === null || _a === void 0 ? void 0 : _a.id) === itemTypeId; });
            return buildCreateItemTypeClientCommand(newSchema.itemTypesById[itemTypeId], schemaMenuItem);
        }),
    ];
}
