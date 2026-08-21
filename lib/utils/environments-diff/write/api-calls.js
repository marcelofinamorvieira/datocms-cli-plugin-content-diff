"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCreateFieldClientCommandNode = buildCreateFieldClientCommandNode;
exports.buildUpdateFieldClientCommandNode = buildUpdateFieldClientCommandNode;
exports.buildDestroyFieldClientCommandNode = buildDestroyFieldClientCommandNode;
exports.buildCreateFieldsetClientCommandNode = buildCreateFieldsetClientCommandNode;
exports.buildUpdateFieldsetClientCommandNode = buildUpdateFieldsetClientCommandNode;
exports.buildDestroyFieldsetClientCommandNode = buildDestroyFieldsetClientCommandNode;
exports.buildCreateItemTypeClientCommandNode = buildCreateItemTypeClientCommandNode;
exports.buildUpdateItemTypeClientCommandNode = buildUpdateItemTypeClientCommandNode;
exports.buildDestroyItemTypeClientCommandNode = buildDestroyItemTypeClientCommandNode;
exports.buildCreateUploadFilterClientCommandNode = buildCreateUploadFilterClientCommandNode;
exports.buildUpdateUploadFilterClientCommandNode = buildUpdateUploadFilterClientCommandNode;
exports.buildDestroyUploadFilterClientCommandNode = buildDestroyUploadFilterClientCommandNode;
exports.buildCreateItemTypeFilterClientCommandNode = buildCreateItemTypeFilterClientCommandNode;
exports.buildUpdateItemTypeFilterClientCommandNode = buildUpdateItemTypeFilterClientCommandNode;
exports.buildDestroyItemTypeFilterClientCommandNode = buildDestroyItemTypeFilterClientCommandNode;
exports.buildCreateWorkflowClientCommandNode = buildCreateWorkflowClientCommandNode;
exports.buildUpdateWorkflowClientCommandNode = buildUpdateWorkflowClientCommandNode;
exports.buildDestroyWorkflowClientCommandNode = buildDestroyWorkflowClientCommandNode;
exports.buildCreatePluginClientCommandNode = buildCreatePluginClientCommandNode;
exports.buildUpdatePluginClientCommandNode = buildUpdatePluginClientCommandNode;
exports.buildDestroyPluginClientCommandNode = buildDestroyPluginClientCommandNode;
exports.buildUpdateSiteClientCommandNode = buildUpdateSiteClientCommandNode;
exports.buildUpdateRoleClientCommandNode = buildUpdateRoleClientCommandNode;
exports.buildCreateMenuItemClientCommandNode = buildCreateMenuItemClientCommandNode;
exports.buildUpdateMenuItemClientCommandNode = buildUpdateMenuItemClientCommandNode;
exports.buildDestroyMenuItemClientCommandNode = buildDestroyMenuItemClientCommandNode;
exports.buildCreateSchemaMenuItemClientCommandNode = buildCreateSchemaMenuItemClientCommandNode;
exports.buildUpdateSchemaMenuItemClientCommandNode = buildUpdateSchemaMenuItemClientCommandNode;
exports.buildDestroySchemaMenuItemClientCommandNode = buildDestroySchemaMenuItemClientCommandNode;
const tslib_1 = require("tslib");
const Utils = tslib_1.__importStar(require("@datocms/rest-client-utils"));
const lodash_1 = require("lodash");
const ts = tslib_1.__importStar(require("typescript"));
const utils_1 = require("../utils");
function assignToMapping(kind, oldEnvironmentId, expression) {
    return (0, utils_1.isBase64Id)(oldEnvironmentId)
        ? expression
        : ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(ts.factory.createElementAccessExpression(ts.factory.createIdentifier(`new${(0, lodash_1.upperFirst)(kind)}s`), ts.factory.createStringLiteral(oldEnvironmentId)), ts.SyntaxKind.EqualsToken, expression));
}
function makeApiCall(command, argumentsArray) {
    return ts.factory.createAwaitExpression(ts.factory.createCallExpression(ts.factory.createIdentifier(command.call), undefined, argumentsArray));
}
function fetchNewId(kind, oldEnvironmentId, entityIdsToBeRecreated) {
    return entityIdsToBeRecreated[kind].includes(oldEnvironmentId) &&
        !(0, utils_1.isBase64Id)(oldEnvironmentId)
        ? ts.factory.createPropertyAccessExpression(ts.factory.createElementAccessExpression(ts.factory.createIdentifier(`new${(0, lodash_1.upperFirst)(kind)}s`), ts.factory.createStringLiteral(oldEnvironmentId)), 'id')
        : ts.factory.createStringLiteral(oldEnvironmentId);
}
function fetchNewRef(kind, oldRefOrId, entityIdsToBeRecreated) {
    if (!oldRefOrId) {
        return (0, utils_1.createJsonLiteral)(oldRefOrId);
    }
    const id = typeof oldRefOrId === 'string' ? oldRefOrId : oldRefOrId.id;
    if (!entityIdsToBeRecreated[kind].includes(id) || (0, utils_1.isBase64Id)(id)) {
        return (0, utils_1.createJsonLiteral)(oldRefOrId);
    }
    return ts.factory.createElementAccessExpression(ts.factory.createIdentifier(`new${(0, lodash_1.upperFirst)(kind)}s`), ts.factory.createStringLiteral(id));
}
function deserializeBody(body, entityIdsToBeRecreated, options) {
    return (0, utils_1.createJsonLiteral)((options === null || options === void 0 ? void 0 : options.omitEntityId)
        ? (0, lodash_1.omit)(Utils.deserializeResponseBody(body), 'type', 'id')
        : (0, lodash_1.omit)(Utils.deserializeResponseBody(body), 'type'), (options === null || options === void 0 ? void 0 : options.replaceNewIdsInBody)
        ? {
            replace: (rawPath, value) => {
                const path = rawPath
                    .map((c) => (typeof c === 'string' ? c : '*'))
                    .join('.');
                if (!value) {
                    return undefined;
                }
                switch (path) {
                    case 'validators.slug_title_field.title_field_id': {
                        const fieldId = value;
                        return fetchNewId('field', fieldId, entityIdsToBeRecreated);
                    }
                    case 'validators.rich_text_blocks.item_types':
                    case 'validators.single_block_blocks.item_types':
                    case 'validators.structured_text_blocks.item_types':
                    case 'validators.structured_text_inline_blocks.item_types':
                    case 'validators.structured_text_links.item_types':
                    case 'validators.item_item_type.item_types':
                    case 'validators.items_item_type.item_types': {
                        const itemTypeIds = value;
                        return ts.factory.createArrayLiteralExpression(itemTypeIds.map((itemTypeId) => fetchNewId('itemType', itemTypeId, entityIdsToBeRecreated)));
                    }
                    case 'appearance.editor':
                    case 'appearance.addons.*.id': {
                        const pluginId = value;
                        return fetchNewId('plugin', pluginId, entityIdsToBeRecreated);
                    }
                    case 'ordering_field':
                    case 'title_field':
                    case 'image_preview_field':
                    case 'excerpt_field':
                    case 'presentation_image_field':
                    case 'presentation_title_field': {
                        const fieldRef = value;
                        return fetchNewRef('field', fieldRef, entityIdsToBeRecreated);
                    }
                    case 'item_type': {
                        const itemTypeRef = value;
                        return fetchNewRef('itemType', itemTypeRef, entityIdsToBeRecreated);
                    }
                    case 'item_type_filter': {
                        const itemTypeRef = value;
                        return fetchNewRef('itemTypeFilter', itemTypeRef, entityIdsToBeRecreated);
                    }
                    case 'workflow': {
                        const workflowRef = value;
                        return fetchNewRef('workflow', workflowRef, entityIdsToBeRecreated);
                    }
                    case 'fieldset': {
                        const fieldsetRef = value;
                        return fetchNewRef('fieldset', fieldsetRef, entityIdsToBeRecreated);
                    }
                    case 'parent': {
                        const menuItemOrSchemaMenuItemRef = value;
                        return fetchNewRef(menuItemOrSchemaMenuItemRef.type === 'menu_item'
                            ? 'menuItem'
                            : 'schemaMenuItem', menuItemOrSchemaMenuItemRef, entityIdsToBeRecreated);
                    }
                    default: {
                        // leave as it is
                        return undefined;
                    }
                }
            },
        }
        : undefined);
}
function buildCreateFieldClientCommandNode(command, entityIdsToBeRecreated) {
    const [itemTypeId, body] = command.arguments;
    const apiCall = makeApiCall(command, [
        fetchNewRef('itemType', itemTypeId, entityIdsToBeRecreated),
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
        }),
    ]);
    return assignToMapping('field', command.oldEnvironmentId, apiCall);
}
function buildUpdateFieldClientCommandNode(command, entityIdsToBeRecreated) {
    const [fieldId, body] = command.arguments;
    return makeApiCall(command, [
        fetchNewRef('field', fieldId, entityIdsToBeRecreated),
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
            omitEntityId: true,
        }),
    ]);
}
function buildDestroyFieldClientCommandNode(command, _entityIdsToBeRecreated) {
    const [fieldId] = command.arguments;
    return makeApiCall(command, [ts.factory.createStringLiteral(fieldId)]);
}
function buildCreateFieldsetClientCommandNode(command, entityIdsToBeRecreated) {
    const [itemTypeId, body] = command.arguments;
    const apiCall = makeApiCall(command, [
        fetchNewRef('itemType', itemTypeId, entityIdsToBeRecreated),
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
        }),
    ]);
    return assignToMapping('fieldset', command.oldEnvironmentId, apiCall);
}
function buildUpdateFieldsetClientCommandNode(command, entityIdsToBeRecreated) {
    const [fieldsetId, body] = command.arguments;
    return makeApiCall(command, [
        fetchNewRef('fieldset', fieldsetId, entityIdsToBeRecreated),
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
            omitEntityId: true,
        }),
    ]);
}
function buildDestroyFieldsetClientCommandNode(command, _entityIdsToBeRecreated) {
    const [fieldsetId] = command.arguments;
    return makeApiCall(command, [ts.factory.createStringLiteral(fieldsetId)]);
}
function buildCreateItemTypeClientCommandNode(command, entityIdsToBeRecreated) {
    const [body, queryParams] = command.arguments;
    const apiCall = makeApiCall(command, [
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
        }),
        (0, utils_1.createJsonLiteral)(queryParams),
    ]);
    return assignToMapping('itemType', command.oldEnvironmentId, apiCall);
}
function buildUpdateItemTypeClientCommandNode(command, entityIdsToBeRecreated) {
    const [itemTypeId, body] = command.arguments;
    return makeApiCall(command, [
        fetchNewRef('itemType', itemTypeId, entityIdsToBeRecreated),
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
            omitEntityId: true,
        }),
    ]);
}
function buildDestroyItemTypeClientCommandNode(command, _entityIdsToBeRecreated) {
    const [itemTypeId, queryParams] = command.arguments;
    return makeApiCall(command, [
        ts.factory.createStringLiteral(itemTypeId),
        (0, utils_1.createJsonLiteral)(queryParams),
    ]);
}
function buildCreateUploadFilterClientCommandNode(command, entityIdsToBeRecreated) {
    const [body] = command.arguments;
    return makeApiCall(command, [deserializeBody(body, entityIdsToBeRecreated)]);
}
function buildUpdateUploadFilterClientCommandNode(command, entityIdsToBeRecreated) {
    const [uploadFilterId, body] = command.arguments;
    return makeApiCall(command, [
        ts.factory.createStringLiteral(uploadFilterId),
        deserializeBody(body, entityIdsToBeRecreated, { omitEntityId: true }),
    ]);
}
function buildDestroyUploadFilterClientCommandNode(command, _entityIdsToBeRecreated) {
    const [uploadFilterId] = command.arguments;
    return makeApiCall(command, [ts.factory.createStringLiteral(uploadFilterId)]);
}
function buildCreateItemTypeFilterClientCommandNode(command, entityIdsToBeRecreated) {
    const [body] = command.arguments;
    const apiCall = makeApiCall(command, [
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
        }),
    ]);
    return assignToMapping('itemTypeFilter', command.oldEnvironmentId, apiCall);
}
function buildUpdateItemTypeFilterClientCommandNode(command, entityIdsToBeRecreated) {
    const [itemTypeFilterId, body] = command.arguments;
    return makeApiCall(command, [
        ts.factory.createStringLiteral(itemTypeFilterId),
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
            omitEntityId: true,
        }),
    ]);
}
function buildDestroyItemTypeFilterClientCommandNode(command, _entityIdsToBeRecreated) {
    const [itemTypeFilterId] = command.arguments;
    return makeApiCall(command, [
        ts.factory.createStringLiteral(itemTypeFilterId),
    ]);
}
function buildCreateWorkflowClientCommandNode(command, entityIdsToBeRecreated) {
    const [body] = command.arguments;
    const apiCall = makeApiCall(command, [
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
        }),
    ]);
    return assignToMapping('workflow', command.oldEnvironmentId, apiCall);
}
function buildUpdateWorkflowClientCommandNode(command, entityIdsToBeRecreated) {
    const [workflowId, body] = command.arguments;
    return makeApiCall(command, [
        ts.factory.createStringLiteral(workflowId),
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
            omitEntityId: true,
        }),
    ]);
}
function buildDestroyWorkflowClientCommandNode(command, _entityIdsToBeRecreated) {
    const [workflowId] = command.arguments;
    return makeApiCall(command, [ts.factory.createStringLiteral(workflowId)]);
}
function buildCreatePluginClientCommandNode(command, entityIdsToBeRecreated) {
    const [body] = command.arguments;
    const apiCall = makeApiCall(command, [
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
        }),
    ]);
    return assignToMapping('plugin', command.oldEnvironmentId, apiCall);
}
function buildUpdatePluginClientCommandNode(command, entityIdsToBeRecreated) {
    const [pluginId, body] = command.arguments;
    return makeApiCall(command, [
        fetchNewRef('plugin', pluginId, entityIdsToBeRecreated),
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
            omitEntityId: true,
        }),
    ]);
}
function buildDestroyPluginClientCommandNode(command, _entityIdsToBeRecreated) {
    const [pluginId] = command.arguments;
    return makeApiCall(command, [ts.factory.createStringLiteral(pluginId)]);
}
function buildUpdateSiteClientCommandNode(command, entityIdsToBeRecreated) {
    const [body] = command.arguments;
    return makeApiCall(command, [
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
            omitEntityId: true,
        }),
    ]);
}
function buildUpdateRoleClientCommandNode(command, entityIdsToBeRecreated) {
    return [
        makeApiCall(command, [
            ts.factory.createStringLiteral(command.roleId),
            (0, utils_1.createJsonLiteral)(command.changes, {
                replace: (rawPath, value) => {
                    const path = rawPath
                        .map((c) => (typeof c === 'string' ? c : '*'))
                        .join('.');
                    if (!value) {
                        return undefined;
                    }
                    switch (path) {
                        case 'positive_item_type_permissions.add.*.item_type':
                        case 'positive_item_type_permissions.remove.*.item_type':
                        case 'negative_item_type_permissions.add.*.item_type':
                        case 'negative_item_type_permissions.remove.*.item_type': {
                            const itemTypeId = value;
                            return fetchNewId('itemType', itemTypeId, entityIdsToBeRecreated);
                        }
                        case 'positive_item_type_permissions.add.*.workflow':
                        case 'positive_item_type_permissions.remove.*.workflow':
                        case 'negative_item_type_permissions.add.*.workflow':
                        case 'negative_item_type_permissions.remove.*.workflow': {
                            const workflowId = value;
                            return fetchNewId('field', workflowId, entityIdsToBeRecreated);
                        }
                        default: {
                            // leave as it is
                            return undefined;
                        }
                    }
                },
            }),
        ]),
    ];
}
function buildCreateMenuItemClientCommandNode(command, entityIdsToBeRecreated) {
    const [body] = command.arguments;
    const apiCall = makeApiCall(command, [
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
        }),
    ]);
    return assignToMapping('menuItem', command.oldEnvironmentId, apiCall);
}
function buildUpdateMenuItemClientCommandNode(command, entityIdsToBeRecreated) {
    const [menuItemId, body] = command.arguments;
    return makeApiCall(command, [
        fetchNewRef('menuItem', menuItemId, entityIdsToBeRecreated),
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
            omitEntityId: true,
        }),
    ]);
}
function buildDestroyMenuItemClientCommandNode(command, _entityIdsToBeRecreated) {
    const [menuItemId] = command.arguments;
    return makeApiCall(command, [ts.factory.createStringLiteral(menuItemId)]);
}
function buildCreateSchemaMenuItemClientCommandNode(command, entityIdsToBeRecreated) {
    const [body] = command.arguments;
    const apiCall = makeApiCall(command, [
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
        }),
    ]);
    return assignToMapping('schemaMenuItem', command.oldEnvironmentId, apiCall);
}
function buildUpdateSchemaMenuItemClientCommandNode(command, entityIdsToBeRecreated) {
    const [schemaMenuItemId, body] = command.arguments;
    return makeApiCall(command, [
        fetchNewRef('schemaMenuItem', schemaMenuItemId, entityIdsToBeRecreated),
        deserializeBody(body, entityIdsToBeRecreated, {
            replaceNewIdsInBody: true,
            omitEntityId: true,
        }),
    ]);
}
function buildDestroySchemaMenuItemClientCommandNode(command, _entityIdsToBeRecreated) {
    const [schemaMenuItemId] = command.arguments;
    return makeApiCall(command, [
        ts.factory.createStringLiteral(schemaMenuItemId),
    ]);
}
