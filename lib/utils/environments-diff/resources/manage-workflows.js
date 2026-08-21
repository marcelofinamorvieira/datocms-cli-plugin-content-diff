"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.manageWorkflows = manageWorkflows;
const lodash_1 = require("lodash");
const utils_1 = require("../utils");
const comments_1 = require("./comments");
function buildCreateWorkflowClientCommand(workflow) {
    return [
        (0, comments_1.buildComment)(`Create ${(0, utils_1.buildWorkflowTitle)(workflow)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.workflows.create',
            arguments: [
                {
                    data: {
                        type: 'workflow',
                        id: (0, utils_1.isBase64Id)(workflow.id) ? workflow.id : undefined,
                        attributes: workflow.attributes,
                    },
                },
            ],
            oldEnvironmentId: workflow.id,
        },
    ];
}
function buildDestroyWorkflowClientCommand(workflow) {
    return [
        (0, comments_1.buildComment)(`Delete ${(0, utils_1.buildWorkflowTitle)(workflow)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.workflows.destroy',
            arguments: [workflow.id],
        },
    ];
}
function buildUpdateWorkflowClientCommand(newWorkflow, oldWorkflow) {
    const attributesToUpdate = (0, lodash_1.pick)(newWorkflow.attributes, Object.keys(newWorkflow.attributes).filter((attribute) => !(0, lodash_1.isEqual)(oldWorkflow.attributes[attribute], newWorkflow.attributes[attribute])));
    if (Object.keys(attributesToUpdate).length === 0) {
        return [];
    }
    return [
        (0, comments_1.buildComment)(`Update ${(0, utils_1.buildWorkflowTitle)(newWorkflow)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.workflows.update',
            arguments: [
                oldWorkflow.id,
                {
                    data: {
                        type: 'workflow',
                        id: newWorkflow.id,
                        attributes: attributesToUpdate,
                    },
                },
            ],
        },
    ];
}
function manageWorkflows(newSchema, oldSchema) {
    const oldEntityIds = Object.keys(oldSchema.workflowsById);
    const newEntityIds = Object.keys(newSchema.workflowsById);
    const keptEntityIds = (0, lodash_1.intersection)(oldEntityIds, newEntityIds);
    const deletedEntities = (0, lodash_1.difference)(oldEntityIds, newEntityIds).map((workflowId) => oldSchema.workflowsById[workflowId]);
    const createdEntities = (0, lodash_1.difference)(newEntityIds, oldEntityIds).map((workflowId) => newSchema.workflowsById[workflowId]);
    const commands = [
        ...deletedEntities.flatMap(buildDestroyWorkflowClientCommand),
        ...createdEntities.flatMap(buildCreateWorkflowClientCommand),
        ...keptEntityIds.flatMap((workflowId) => buildUpdateWorkflowClientCommand(newSchema.workflowsById[workflowId], oldSchema.workflowsById[workflowId])),
    ];
    if (commands.length === 0) {
        return [];
    }
    return [(0, comments_1.buildComment)('Manage workflows'), ...commands];
}
