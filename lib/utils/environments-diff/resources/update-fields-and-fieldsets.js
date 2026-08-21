"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRegularUpdateFieldClientCommand = buildRegularUpdateFieldClientCommand;
exports.buildUpdateFieldClientCommand = buildUpdateFieldClientCommand;
exports.buildUpdateFieldsetClientCommand = buildUpdateFieldsetClientCommand;
exports.updateFieldsAndFieldsetsInItemType = updateFieldsAndFieldsetsInItemType;
exports.updateFieldsAndFieldsets = updateFieldsAndFieldsets;
const lodash_1 = require("lodash");
const utils_1 = require("../utils");
const comments_1 = require("./comments");
function buildRegularUpdateFieldClientCommand(newField, oldField) {
    const attributesToUpdate = oldField
        ? (0, lodash_1.pick)(newField.attributes, (0, lodash_1.without)(Object.keys(newField.attributes).filter((attribute) => !(0, lodash_1.isEqual)(oldField.attributes[attribute], newField.attributes[attribute])), 'appeareance', 'field_type'))
        : (0, lodash_1.pick)(newField.attributes, 'position');
    const relationshipsToUpdate = oldField
        ? (0, lodash_1.pick)(newField.relationships, Object.keys(newField.relationships).filter((attribute) => !(0, lodash_1.isEqual)(oldField.relationships[attribute], newField.relationships[attribute])))
        : null;
    if (Object.keys(attributesToUpdate).length === 0 &&
        (!relationshipsToUpdate || Object.keys(relationshipsToUpdate).length === 0)) {
        return undefined;
    }
    return {
        type: 'apiCallClientCommand',
        call: 'client.fields.update',
        arguments: [
            newField.id,
            {
                data: {
                    id: newField.id,
                    type: 'field',
                    attributes: attributesToUpdate,
                    ...(relationshipsToUpdate &&
                        Object.keys(relationshipsToUpdate).length > 0
                        ? { relationships: relationshipsToUpdate }
                        : {}),
                },
            },
        ],
        fieldType: newField.attributes.field_type,
    };
}
function buildUpdateFieldClientCommand(newField, oldField, itemType) {
    const commands = [];
    if (oldField &&
        newField.attributes.field_type !== oldField.attributes.field_type) {
        commands.push({
            type: 'apiCallClientCommand',
            call: 'client.fields.update',
            arguments: [
                newField.id,
                {
                    data: {
                        id: newField.id,
                        type: 'field',
                        attributes: {
                            field_type: newField.attributes.field_type,
                        },
                    },
                },
            ],
            fieldType: newField.attributes.field_type,
        });
    }
    const regularUpdateFieldClientCommand = buildRegularUpdateFieldClientCommand(newField, oldField);
    if (regularUpdateFieldClientCommand) {
        commands.push(regularUpdateFieldClientCommand);
    }
    if (commands.length === 0) {
        return [];
    }
    return [
        (0, comments_1.buildComment)(`Update ${(0, utils_1.buildFieldTitle)(newField)} in ${(0, utils_1.buildItemTypeTitle)(itemType)}`),
        ...commands,
    ];
}
function buildUpdateFieldsetClientCommand(newFieldset, oldFieldset, itemType) {
    const attributesToUpdate = oldFieldset
        ? (0, lodash_1.pick)(newFieldset.attributes, Object.keys(newFieldset.attributes).filter((attribute) => !(0, lodash_1.isEqual)(oldFieldset.attributes[attribute], newFieldset.attributes[attribute])))
        : (0, lodash_1.pick)(newFieldset.attributes, 'position');
    if (Object.keys(attributesToUpdate).length === 0) {
        return [];
    }
    return [
        (0, comments_1.buildComment)(`Update ${(0, utils_1.buildFieldsetTitle)(newFieldset)} in ${(0, utils_1.buildItemTypeTitle)(itemType)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.fieldsets.update',
            arguments: [
                newFieldset.id,
                {
                    data: {
                        id: newFieldset.id,
                        type: 'fieldset',
                        attributes: attributesToUpdate,
                    },
                },
            ],
        },
    ];
}
function getFieldsetId(entity) {
    var _a;
    return isField(entity) ? (_a = entity.relationships.fieldset.data) === null || _a === void 0 ? void 0 : _a.id : undefined;
}
function findSiblings({ of: entity, collection, fieldsetId, positionGte, }) {
    const siblings = fieldsetId
        ? collection.filter((entity) => {
            var _a;
            return isField(entity) &&
                ((_a = entity.relationships.fieldset.data) === null || _a === void 0 ? void 0 : _a.id) === fieldsetId;
        })
        : collection.filter((entity) => (isField(entity) && !entity.relationships.fieldset.data) ||
            isFieldset(entity));
    return siblings
        .filter((e) => e.id !== entity.id || e.type !== entity.type)
        .filter((e) => e.attributes.position >= positionGte);
}
function findChildren({ of: entity, collection, }) {
    return collection.filter((e) => { var _a; return e.type === 'field' && ((_a = e.relationships.fieldset.data) === null || _a === void 0 ? void 0 : _a.id) === entity.id; });
}
function findMaxPosition({ collection, fieldsetId, }) {
    const siblings = fieldsetId
        ? collection.filter((entity) => {
            var _a;
            return isField(entity) &&
                ((_a = entity.relationships.fieldset.data) === null || _a === void 0 ? void 0 : _a.id) === fieldsetId;
        })
        : collection.filter((entity) => (isField(entity) && !entity.relationships.fieldset.data) ||
            isFieldset(entity));
    return siblings.reduce((max, e) => Math.max(max, e.attributes.position), 0);
}
function isFieldset(entity) {
    return entity.type === 'fieldset';
}
function isField(entity) {
    return entity.type === 'field';
}
function generateInitialState({ oldKeptEntities, createdEntities, deletedEntities, }) {
    const state = oldKeptEntities.map(lodash_1.cloneDeep);
    [
        ...createdEntities.filter(isFieldset),
        ...createdEntities.filter(isField),
    ].forEach((entity) => {
        var _a;
        const newEntity = (0, lodash_1.cloneDeep)(entity);
        newEntity.attributes.position =
            findMaxPosition({
                collection: state,
                fieldsetId: isField(entity)
                    ? (_a = entity.relationships.fieldset.data) === null || _a === void 0 ? void 0 : _a.id
                    : undefined,
            }) + 1;
        state.push(newEntity);
    });
    deletedEntities.forEach((deletedEntity) => {
        findSiblings({
            of: deletedEntity,
            collection: state,
            fieldsetId: getFieldsetId(deletedEntity),
            positionGte: deletedEntity.attributes.position,
        }).forEach((entity) => {
            entity.attributes.position -= 1;
        });
        if (isFieldset(deletedEntity)) {
            findChildren({ of: deletedEntity, collection: state }).forEach((entityInState) => {
                entityInState.relationships.fieldset.data = null;
                entityInState.attributes.position =
                    findMaxPosition({
                        collection: state,
                        fieldsetId: undefined,
                    }) + 1;
            });
        }
    });
    return state;
}
// biome-ignore lint/correctness/noUnusedVariables: <explanation>
function debugState(message, state) {
    console.log(message);
    const roots = (0, lodash_1.sortBy)(state.filter((entity) => (isField(entity) && !entity.relationships.fieldset.data) ||
        isFieldset(entity)), (e) => e.attributes.position);
    roots.forEach((root) => {
        console.log(`${root.attributes.position}. ${root.type === 'field' ? root.attributes.api_key : root.attributes.title}`);
        if (root.type === 'fieldset') {
            const children = (0, lodash_1.sortBy)(state.filter((entity) => {
                var _a;
                return isField(entity) &&
                    ((_a = entity.relationships.fieldset.data) === null || _a === void 0 ? void 0 : _a.id) === root.id;
            }), (e) => e.attributes.position);
            children.forEach((root) => {
                console.log(`  ${root.attributes.position}. ${root.type === 'field'
                    ? root.attributes.api_key
                    : root.attributes.title}`);
            });
        }
    });
}
class InvalidMovement extends Error {
}
function updateState({ updateCommand, state, }) {
    var _a, _b, _c;
    const entityType = updateCommand.call === 'client.fields.update' ? 'field' : 'fieldset';
    const entityId = updateCommand.arguments[0];
    const entityInState = state.find((e) => e.id === entityId && e.type === entityType);
    const entityFieldsetIdBeforeUpdate = getFieldsetId(entityInState);
    const entityPositionBeforeUpdate = entityInState.attributes.position;
    const entityFieldsetIdAfterUpdate = updateCommand.call === 'client.fields.update'
        ? ((_a = updateCommand.arguments[1].data.relationships) === null || _a === void 0 ? void 0 : _a.fieldset)
            ? (_c = (_b = updateCommand.arguments[1].data.relationships) === null || _b === void 0 ? void 0 : _b.fieldset.data) === null || _c === void 0 ? void 0 : _c.id
            : entityFieldsetIdBeforeUpdate
        : undefined;
    const entityPositionAfterUpdate = 'position' in updateCommand.arguments[1].data.attributes
        ? updateCommand.arguments[1].data.attributes.position
        : entityPositionBeforeUpdate;
    const maxPosition = findMaxPosition({
        collection: findSiblings({
            of: entityInState,
            collection: state,
            fieldsetId: entityFieldsetIdAfterUpdate,
            positionGte: 0,
        }),
        fieldsetId: entityFieldsetIdAfterUpdate,
    });
    if (entityPositionAfterUpdate > maxPosition + 1) {
        throw new InvalidMovement('Something went wrong!');
    }
    entityInState.attributes.position = entityPositionAfterUpdate;
    if (entityInState.type === 'field') {
        entityInState.relationships.fieldset.data = entityFieldsetIdAfterUpdate
            ? { id: entityFieldsetIdAfterUpdate, type: 'fieldset' }
            : null;
    }
    findSiblings({
        of: entityInState,
        collection: state,
        fieldsetId: entityFieldsetIdBeforeUpdate,
        positionGte: entityPositionBeforeUpdate,
    }).forEach((entity) => {
        entity.attributes.position -= 1;
    });
    findSiblings({
        of: entityInState,
        collection: state,
        fieldsetId: entityFieldsetIdAfterUpdate,
        positionGte: entityPositionAfterUpdate,
    }).forEach((entity) => {
        entity.attributes.position += 1;
    });
}
function updateFieldsAndFieldsetsInItemType(newItemTypeSchema, oldItemTypeSchema) {
    const oldFieldIds = Object.keys(oldItemTypeSchema.fieldsById);
    const newFieldIds = Object.keys(newItemTypeSchema.fieldsById);
    const oldFieldsetIds = Object.keys(oldItemTypeSchema.fieldsetsById);
    const newFieldsetIds = Object.keys(newItemTypeSchema.fieldsetsById);
    const oldKeptEntities = (0, lodash_1.sortBy)([
        ...(0, lodash_1.intersection)(oldFieldIds, newFieldIds).map((fieldId) => oldItemTypeSchema.fieldsById[fieldId]),
        ...(0, lodash_1.intersection)(oldFieldsetIds, newFieldsetIds).map((fieldsetId) => oldItemTypeSchema.fieldsetsById[fieldsetId]),
    ], (entity) => entity.attributes.position);
    const deletedEntities = (0, lodash_1.sortBy)([
        ...(0, lodash_1.difference)(oldFieldIds, newFieldIds).map((fieldId) => oldItemTypeSchema.fieldsById[fieldId]),
        ...(0, lodash_1.difference)(oldFieldsetIds, newFieldsetIds).map((fieldsetId) => oldItemTypeSchema.fieldsetsById[fieldsetId]),
    ], (entity) => entity.attributes.position);
    const createdEntities = (0, lodash_1.sortBy)([
        ...(0, lodash_1.difference)(newFieldIds, oldFieldIds).map((fieldId) => newItemTypeSchema.fieldsById[fieldId]),
        ...(0, lodash_1.difference)(newFieldsetIds, oldFieldsetIds).map((fieldsetId) => newItemTypeSchema.fieldsetsById[fieldsetId]),
    ], (entity) => entity.attributes.position);
    function run(mode) {
        const state = generateInitialState({
            oldKeptEntities,
            deletedEntities,
            createdEntities,
        });
        const sortedEntitiesToProcess = (0, lodash_1.sortBy)([
            ...newFieldIds.map((fieldId) => newItemTypeSchema.fieldsById[fieldId]),
            ...newFieldsetIds.map((fieldsetId) => newItemTypeSchema.fieldsetsById[fieldsetId]),
        ], (entity) => {
            var _a, _b;
            if (mode === 'dumb') {
                return entity.attributes.position;
            }
            // we try to start moving items that are more distant from their original
            // position. this can generate a lower number of ops, but we're not
            // mathematically sure that operations are legal :D
            const entityInState = state.find((e) => e.id === entity.id && e.type === entity.type);
            let weight = Math.abs(entity.attributes.position - entityInState.attributes.position);
            if (entityInState.type === 'field' &&
                isField(entity) &&
                ((_a = entityInState.relationships.fieldset.data) === null || _a === void 0 ? void 0 : _a.id) !==
                    ((_b = entity.relationships.fieldset.data) === null || _b === void 0 ? void 0 : _b.id)) {
                weight += 100;
            }
            return -weight;
        });
        // if (newItemTypeSchema.entity.attributes.api_key === 'plugin') {
        //   debugState('INITIAL', state);
        // }
        let commands = [];
        while (sortedEntitiesToProcess.length > 0) {
            const entityToProcess = sortedEntitiesToProcess.shift();
            const entityInState = state.find((e) => e.id === entityToProcess.id && e.type === entityToProcess.type);
            const entityCommands = entityToProcess.type === 'field'
                ? buildUpdateFieldClientCommand(entityToProcess, entityInState, newItemTypeSchema.entity)
                : buildUpdateFieldsetClientCommand(entityToProcess, entityInState, newItemTypeSchema.entity);
            commands = [...commands, ...entityCommands];
            // if (
            //   newItemTypeSchema.entity.attributes.api_key === 'plugin' &&
            //   entityCommands.length > 0
            // ) {
            //   console.log(
            //     `${entityToProcess.type} ${
            //       entityToProcess.type === 'field'
            //         ? entityToProcess.attributes.api_key
            //         : entityToProcess.attributes.title
            //     }`,
            //   );
            // }
            entityCommands
                .filter((c) => c.type === 'apiCallClientCommand' &&
                ['client.fieldsets.update', 'client.fields.update'].includes(c.call))
                .forEach((updateCommand) => updateState({
                updateCommand,
                state,
            }));
            // if (
            //   newItemTypeSchema.entity.attributes.api_key === 'plugin' &&
            //   entityCommands.length > 0
            // ) {
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
function updateFieldsAndFieldsets(newSchema, oldSchema) {
    const newItemTypeIds = Object.keys(newSchema.itemTypesById);
    const oldItemTypeIds = Object.keys(oldSchema.itemTypesById);
    const keptItemTypeIds = (0, lodash_1.intersection)(newItemTypeIds, oldItemTypeIds);
    const commands = keptItemTypeIds.flatMap((itemTypeId) => updateFieldsAndFieldsetsInItemType(newSchema.itemTypesById[itemTypeId], oldSchema.itemTypesById[itemTypeId]));
    if (commands.length === 0) {
        return [];
    }
    return [(0, comments_1.buildComment)('Update existing fields/fieldsets'), ...commands];
}
