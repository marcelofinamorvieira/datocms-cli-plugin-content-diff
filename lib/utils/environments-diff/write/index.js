"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.write = write;
const tslib_1 = require("tslib");
const lodash_1 = require("lodash");
const prettier_1 = require("prettier");
const ts = tslib_1.__importStar(require("typescript"));
const utils_1 = require("../utils");
const ApiCommands = tslib_1.__importStar(require("./api-calls"));
const comments_1 = require("./comments");
const get_entity_ids_to_be_recreated_1 = require("./get-entity-ids-to-be-recreated");
function writeApiCallClientCommand(command, entityIdsToBeRecreated) {
    switch (command.call) {
        case 'client.fields.create':
            return ApiCommands.buildCreateFieldClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.fields.update':
            return ApiCommands.buildUpdateFieldClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.fields.destroy':
            return ApiCommands.buildDestroyFieldClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.fieldsets.create':
            return ApiCommands.buildCreateFieldsetClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.fieldsets.update':
            return ApiCommands.buildUpdateFieldsetClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.fieldsets.destroy':
            return ApiCommands.buildDestroyFieldsetClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.itemTypes.create':
            return ApiCommands.buildCreateItemTypeClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.itemTypes.update':
            return ApiCommands.buildUpdateItemTypeClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.itemTypes.destroy':
            return ApiCommands.buildDestroyItemTypeClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.uploadFilters.create':
            return ApiCommands.buildCreateUploadFilterClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.uploadFilters.update':
            return ApiCommands.buildUpdateUploadFilterClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.uploadFilters.destroy':
            return ApiCommands.buildDestroyUploadFilterClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.itemTypeFilters.create':
            return ApiCommands.buildCreateItemTypeFilterClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.itemTypeFilters.update':
            return ApiCommands.buildUpdateItemTypeFilterClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.itemTypeFilters.destroy':
            return ApiCommands.buildDestroyItemTypeFilterClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.workflows.create':
            return ApiCommands.buildCreateWorkflowClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.workflows.update':
            return ApiCommands.buildUpdateWorkflowClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.workflows.destroy':
            return ApiCommands.buildDestroyWorkflowClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.plugins.create':
            return ApiCommands.buildCreatePluginClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.plugins.update':
            return ApiCommands.buildUpdatePluginClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.plugins.destroy':
            return ApiCommands.buildDestroyPluginClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.roles.updateCurrentEnvironmentPermissions':
            return ApiCommands.buildUpdateRoleClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.menuItems.create':
            return ApiCommands.buildCreateMenuItemClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.menuItems.update':
            return ApiCommands.buildUpdateMenuItemClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.menuItems.destroy':
            return ApiCommands.buildDestroyMenuItemClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.schemaMenuItems.create':
            return ApiCommands.buildCreateSchemaMenuItemClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.schemaMenuItems.update':
            return ApiCommands.buildUpdateSchemaMenuItemClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.schemaMenuItems.destroy':
            return ApiCommands.buildDestroySchemaMenuItemClientCommandNode(command, entityIdsToBeRecreated);
        case 'client.site.update':
            return ApiCommands.buildUpdateSiteClientCommandNode(command, entityIdsToBeRecreated);
        default:
            throw new Error(`Dont't know how to handle ${JSON.stringify(command)}`);
    }
}
const jsHeader = `'use strict';\n\n/** @param client { import("datocms/lib/cma-client-node").Client } */\n`;
function write(commands, { format, ...prettierOptions }) {
    const entityIdsToBeRecreated = (0, get_entity_ids_to_be_recreated_1.getEntityIdsToBeRecreated)(commands);
    const nodes = commands.flatMap((command) => {
        switch (command.type) {
            case 'apiCallClientCommand': {
                return writeApiCallClientCommand(command, entityIdsToBeRecreated);
            }
            case 'comment': {
                return (0, comments_1.buildCommentNode)(command);
            }
            default: {
                throw new Error('Type not handled!');
            }
        }
    });
    const skeleton = format === 'ts'
        ? `
      import { Client, SimpleSchemaTypes } from 'datocms/lib/cma-client-node';

      export default async function(client: Client): Promise<void> {
        ${Object.entries(entityIdsToBeRecreated)
            .filter((pair) => pair[1].filter((id) => !(0, utils_1.isBase64Id)(id)).length > 0)
            .map(([entityType]) => `const new${(0, lodash_1.upperFirst)(entityType)}s: Record<string, SimpleSchemaTypes.${(0, lodash_1.upperFirst)(entityType)}> = {};`)
            .join('\n')}
      }
      `
        : `
      module.exports = async function (client) {
        ${Object.entries(entityIdsToBeRecreated)
            .filter((pair) => pair[1].filter((id) => !(0, utils_1.isBase64Id)(id)).length > 0)
            .map(([entityType]) => `const new${(0, lodash_1.upperFirst)(entityType)}s = {};`)
            .join('\n')}
      }
  `;
    const sourceFile = (0, utils_1.parseAstFromCode)(skeleton);
    const transformer = (context) => (rootNode) => {
        function visit(node) {
            if (ts.isFunctionDeclaration(node)) {
                const functionDeclaration = node;
                return ts.factory.updateFunctionDeclaration(functionDeclaration, functionDeclaration.modifiers, functionDeclaration.asteriskToken, functionDeclaration.name, functionDeclaration.typeParameters, functionDeclaration.parameters, undefined, ts.factory.createBlock(ts.factory.createNodeArray([
                    ...functionDeclaration.body.statements,
                    ...nodes,
                ]), true));
            }
            if (ts.isFunctionExpression(node)) {
                const functionExpression = node;
                return ts.factory.updateFunctionExpression(functionExpression, functionExpression.modifiers, functionExpression.asteriskToken, functionExpression.name, functionExpression.typeParameters, functionExpression.parameters, undefined, ts.factory.createBlock(ts.factory.createNodeArray([
                    ...functionExpression.body.statements,
                    ...nodes,
                ]), true));
            }
            return ts.visitEachChild(node, visit, context);
        }
        return ts.visitNode(rootNode, visit);
    };
    const result = ts.transform(sourceFile, [transformer]);
    const code = (format === 'js' ? jsHeader : '') +
        (0, utils_1.writeCodeFromAst)(ts.factory.createNodeArray(result.transformed)).replace(/(\s+console\.log\(|export default )/g, '\n$1');
    return (0, prettier_1.format)(code, prettierOptions);
}
