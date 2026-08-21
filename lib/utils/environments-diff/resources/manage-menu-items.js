"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugState = debugState;
exports.manageMenuItems = manageMenuItems;
const lodash_1 = require("lodash");
const utils_1 = require("../utils");
const comments_1 = require("./comments");
const defaultValuesForMenuItemAttribute = {
    external_url: null,
    open_in_new_tab: false,
};
function buildCreateMenuItemClientCommand(menuItem) {
    const attributesToPick = Object.keys(menuItem.attributes).filter((attribute) => !(0, lodash_1.isEqual)(defaultValuesForMenuItemAttribute[attribute], menuItem.attributes[attribute]));
    const attributesToUpdate = (0, lodash_1.pick)(menuItem.attributes, (0, lodash_1.without)(attributesToPick, 'position'));
    return [
        (0, comments_1.buildComment)(`Create ${(0, utils_1.buildMenuItemTitle)(menuItem)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.menuItems.create',
            arguments: [
                {
                    data: {
                        type: 'menu_item',
                        id: (0, utils_1.isBase64Id)(menuItem.id) ? menuItem.id : undefined,
                        attributes: attributesToUpdate,
                        relationships: Object.fromEntries(Object.entries((0, lodash_1.omit)(menuItem.relationships, 'children')).filter(([_key, value]) => !!value.data)),
                    },
                },
            ],
            oldEnvironmentId: menuItem.id,
        },
    ];
}
function buildDestroyMenuItemClientCommand(menuItem) {
    return [
        (0, comments_1.buildComment)(`Delete ${(0, utils_1.buildMenuItemTitle)(menuItem)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.menuItems.destroy',
            arguments: [menuItem.id],
        },
    ];
}
function buildUpdateMenuItemClientCommand(newMenuItem, oldMenuItem) {
    const attributesToUpdate = oldMenuItem
        ? (0, lodash_1.pick)(newMenuItem.attributes, Object.keys(newMenuItem.attributes).filter((attribute) => !(0, lodash_1.isEqual)(oldMenuItem.attributes[attribute], newMenuItem.attributes[attribute])))
        : (0, lodash_1.pick)(newMenuItem.attributes, 'position');
    const relationshipsToUpdate = oldMenuItem
        ? (0, lodash_1.pick)(newMenuItem.relationships, Object.keys((0, lodash_1.omit)(newMenuItem.relationships, 'children')).filter((attribute) => !(0, lodash_1.isEqual)(oldMenuItem.relationships[attribute], newMenuItem.relationships[attribute])))
        : null;
    if (Object.keys(attributesToUpdate).length === 0 &&
        (!relationshipsToUpdate || Object.keys(relationshipsToUpdate).length === 0)) {
        return [];
    }
    return [
        (0, comments_1.buildComment)(`Update ${(0, utils_1.buildMenuItemTitle)(newMenuItem)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.menuItems.update',
            arguments: [
                newMenuItem.id,
                {
                    data: {
                        type: 'menu_item',
                        id: newMenuItem.id,
                        attributes: attributesToUpdate,
                        ...(relationshipsToUpdate &&
                            Object.keys(relationshipsToUpdate).length > 0
                            ? { relationships: relationshipsToUpdate }
                            : {}),
                    },
                },
            ],
        },
    ];
}
function findSiblings({ of: entity, collection, parentId, positionGte, }) {
    const siblings = collection.filter((entity) => { var _a; return ((_a = entity.relationships.parent.data) === null || _a === void 0 ? void 0 : _a.id) === parentId; });
    return siblings
        .filter((e) => e.id !== entity.id || e.type !== entity.type)
        .filter((e) => e.attributes.position >= positionGte);
}
function findChildren({ of: entity, collection, }) {
    return collection.filter((e) => { var _a; return ((_a = e.relationships.parent.data) === null || _a === void 0 ? void 0 : _a.id) === entity.id; });
}
function findMaxPosition({ collection, parentId, }) {
    const siblings = collection.filter((entity) => { var _a; return ((_a = entity.relationships.parent.data) === null || _a === void 0 ? void 0 : _a.id) === parentId; });
    return siblings.reduce((max, e) => Math.max(max, e.attributes.position), 0);
}
function generateInitialState({ oldKeptEntities, createdEntities, deletedEntities, }) {
    const state = oldKeptEntities.map(lodash_1.cloneDeep);
    createdEntities.forEach((entity) => {
        var _a;
        const newEntity = (0, lodash_1.cloneDeep)(entity);
        newEntity.attributes.position =
            findMaxPosition({
                collection: state,
                parentId: (_a = entity.relationships.parent.data) === null || _a === void 0 ? void 0 : _a.id,
            }) + 1;
        state.push(newEntity);
    });
    deletedEntities.forEach((deletedEntity) => {
        var _a;
        findSiblings({
            of: deletedEntity,
            collection: state,
            parentId: (_a = deletedEntity.relationships.parent.data) === null || _a === void 0 ? void 0 : _a.id,
            positionGte: deletedEntity.attributes.position,
        }).forEach((entity) => {
            entity.attributes.position -= 1;
        });
        findChildren({ of: deletedEntity, collection: state }).forEach((entityInState) => {
            entityInState.relationships.parent.data = null;
            entityInState.attributes.position =
                findMaxPosition({
                    collection: state,
                    parentId: undefined,
                }) + 1;
        });
    });
    return state;
}
class InvalidMovement extends Error {
}
function updateState({ updateCommand, state, }) {
    var _a, _b, _c, _d;
    const entityId = updateCommand.arguments[0];
    const entityInState = state.find((e) => e.id === entityId);
    const entityParentIdBeforeUpdate = (_a = entityInState.relationships.parent.data) === null || _a === void 0 ? void 0 : _a.id;
    const entityPositionBeforeUpdate = entityInState.attributes.position;
    const entityParentIdAfterUpdate = ((_b = updateCommand.arguments[1].data
        .relationships) === null || _b === void 0 ? void 0 : _b.parent)
        ? (_d = (_c = updateCommand.arguments[1].data.relationships) === null || _c === void 0 ? void 0 : _c.parent.data) === null || _d === void 0 ? void 0 : _d.id
        : entityParentIdBeforeUpdate;
    const entityPositionAfterUpdate = updateCommand.arguments[1].data.attributes &&
        'position' in updateCommand.arguments[1].data.attributes
        ? updateCommand.arguments[1].data.attributes.position
        : entityPositionBeforeUpdate;
    // console.log('entityParentIdBeforeUpdate', entityParentIdBeforeUpdate);
    // console.log('entityPositionBeforeUpdate', entityPositionBeforeUpdate);
    // console.log('entityParentIdAfterUpdate', entityParentIdAfterUpdate);
    // console.log('entityPositionAfterUpdate', entityPositionAfterUpdate);
    entityInState.attributes.position = entityPositionAfterUpdate;
    entityInState.relationships.parent.data = entityParentIdAfterUpdate
        ? { id: entityParentIdAfterUpdate, type: 'menu_item' }
        : null;
    findSiblings({
        of: entityInState,
        collection: state,
        parentId: entityParentIdBeforeUpdate,
        positionGte: entityPositionBeforeUpdate,
    }).forEach((entity) => {
        entity.attributes.position -= 1;
    });
    findSiblings({
        of: entityInState,
        collection: state,
        parentId: entityParentIdAfterUpdate,
        positionGte: entityPositionAfterUpdate,
    }).forEach((entity) => {
        entity.attributes.position += 1;
    });
}
function debugState(message, state, rawRoots = state.filter((entity) => !entity.relationships.parent.data), level = 0) {
    if (message) {
        console.log(`\n\n${message}`);
    }
    const roots = (0, lodash_1.sortBy)(rawRoots, (e) => e.attributes.position);
    roots.forEach((root) => {
        console.log(`${'  '.repeat(level)}${root.attributes.position}. ${root.attributes.label} (${root.id})`);
        debugState('', state, state.filter((entity) => { var _a; return ((_a = entity.relationships.parent.data) === null || _a === void 0 ? void 0 : _a.id) === root.id; }), level + 1);
    });
}
function buildUpdateCommands(newSchema, oldSchema) {
    const oldEntityIds = Object.keys(oldSchema.menuItemsById);
    const newEntityIds = Object.keys(newSchema.menuItemsById);
    const oldKeptEntities = (0, lodash_1.intersection)(oldEntityIds, newEntityIds).map((menuItemId) => oldSchema.menuItemsById[menuItemId]);
    const deletedEntities = (0, lodash_1.difference)(oldEntityIds, newEntityIds).map((menuItemId) => oldSchema.menuItemsById[menuItemId]);
    const createdEntities = (0, lodash_1.difference)(newEntityIds, oldEntityIds).map((menuItemId) => newSchema.menuItemsById[menuItemId]);
    function run(mode) {
        const state = generateInitialState({
            oldKeptEntities,
            deletedEntities,
            createdEntities,
        });
        const sortedEntitiesToProcess = (0, lodash_1.sortBy)(newEntityIds.map((menuItemId) => newSchema.menuItemsById[menuItemId]), (entity) => {
            var _a, _b;
            if (mode === 'dumb') {
                return entity.attributes.position;
            }
            // we try to start moving items that are more distant from their original
            // position. this can generate a lower number of ops, but we're not
            // mathematically sure that operations are legal :D
            const entityInState = state.find((e) => e.id === entity.id && e.type === entity.type);
            let weight = Math.abs(entity.attributes.position - entityInState.attributes.position);
            if (((_a = entityInState.relationships.parent.data) === null || _a === void 0 ? void 0 : _a.id) !==
                ((_b = entity.relationships.parent.data) === null || _b === void 0 ? void 0 : _b.id)) {
                weight += 100;
            }
            return -weight;
        });
        // debugState(`INITIAL (${mode})`, state);
        let commands = [];
        while (sortedEntitiesToProcess.length > 0) {
            const entityToProcess = sortedEntitiesToProcess.shift();
            const entityInState = state.find((e) => e.id === entityToProcess.id && e.type === entityToProcess.type);
            const entityCommands = buildUpdateMenuItemClientCommand(entityToProcess, entityInState);
            commands = [...commands, ...entityCommands];
            // console.log(`\nProcesso ${entityToProcess.attributes.label}`);
            entityCommands
                .filter((c) => c.type === 'apiCallClientCommand' &&
                c.call === 'client.menuItems.update')
                .forEach((updateCommand) => updateState({
                updateCommand,
                state,
            }));
            // if (entityCommands.length > 0) {
            //   debugState('RESULT', state);
            // }
        }
        return commands;
    }
    try {
        return run('smart');
    }
    catch (e) {
        if (e instanceof InvalidMovement) {
            return run('dumb');
        }
        throw e;
    }
}
function sortByDepth(entities) {
    const nodes = entities.map((entity) => ({
        entity,
        children: [],
        depth: 0,
    }));
    const map = Object.fromEntries(nodes.map((node) => [node.entity.id, node]));
    const tree = [];
    nodes.forEach((node) => {
        var _a;
        const parentId = (_a = node.entity.relationships.parent.data) === null || _a === void 0 ? void 0 : _a.id;
        if (parentId && entities.find((e) => e.id === parentId)) {
            map[parentId].children.push(node);
        }
        else {
            tree.push(node);
        }
    });
    const sortedNodes = [];
    function visit(node, depth) {
        node.depth = depth;
        sortedNodes.push(node);
        node.children.forEach((child) => visit(child, depth + 1));
    }
    tree.forEach((node) => visit(node, 0));
    return sortedNodes
        .sort((a, b) => a.depth - b.depth)
        .map((node) => node.entity);
}
function manageMenuItems(newSchema, oldSchema) {
    const oldEntityIds = Object.keys(oldSchema.menuItemsById);
    const newEntityIds = Object.keys(newSchema.menuItemsById);
    const deletedEntities = (0, lodash_1.difference)(oldEntityIds, newEntityIds).map((menuItemId) => oldSchema.menuItemsById[menuItemId]);
    const createdEntities = (0, lodash_1.difference)(newEntityIds, oldEntityIds).map((menuItemId) => newSchema.menuItemsById[menuItemId]);
    const createCommands = sortByDepth(createdEntities).flatMap((entity) => buildCreateMenuItemClientCommand(entity));
    const deleteCommands = deletedEntities.flatMap((entity) => buildDestroyMenuItemClientCommand(entity));
    const updateCommands = buildUpdateCommands(newSchema, oldSchema);
    const commands = [
        ...createCommands,
        ...deleteCommands,
        ...updateCommands,
    ];
    if (commands.length === 0) {
        return [];
    }
    return [(0, comments_1.buildComment)('Manage menu items'), ...commands];
}
