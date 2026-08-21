"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.manageUploadFilters = manageUploadFilters;
const lodash_1 = require("lodash");
const utils_1 = require("../utils");
const comments_1 = require("./comments");
function buildCreateUploadFilterClientCommand(uploadFilter) {
    return [
        (0, comments_1.buildComment)(`Create ${(0, utils_1.buildUploadFilterTitle)(uploadFilter)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.uploadFilters.create',
            arguments: [
                {
                    data: {
                        type: 'upload_filter',
                        id: (0, utils_1.isBase64Id)(uploadFilter.id) ? uploadFilter.id : undefined,
                        attributes: uploadFilter.attributes,
                    },
                },
            ],
            oldEnvironmentId: uploadFilter.id,
        },
    ];
}
function buildDestroyUploadFilterClientCommand(uploadFilter) {
    return [
        (0, comments_1.buildComment)(`Delete ${(0, utils_1.buildUploadFilterTitle)(uploadFilter)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.uploadFilters.destroy',
            arguments: [uploadFilter.id],
        },
    ];
}
function buildUpdateUploadFilterClientCommand(newUploadFilter, oldUploadFilter) {
    const updatedAttributes = Object.keys(newUploadFilter.attributes).filter((attribute) => !(0, lodash_1.isEqual)(oldUploadFilter.attributes[attribute], newUploadFilter.attributes[attribute]));
    if (updatedAttributes.length === 0) {
        return [];
    }
    return [
        (0, comments_1.buildComment)(`Update ${(0, utils_1.buildUploadFilterTitle)(newUploadFilter)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.uploadFilters.update',
            arguments: [
                oldUploadFilter.id,
                {
                    data: {
                        type: 'upload_filter',
                        id: oldUploadFilter.id,
                        attributes: newUploadFilter.attributes,
                    },
                },
            ],
        },
    ];
}
function manageUploadFilters(newSchema, oldSchema) {
    const oldEntityIds = Object.keys(oldSchema.uploadFiltersById);
    const newEntityIds = Object.keys(newSchema.uploadFiltersById);
    const keptEntityIds = (0, lodash_1.intersection)(oldEntityIds, newEntityIds);
    const deletedEntities = (0, lodash_1.difference)(oldEntityIds, newEntityIds).map((uploadFilterId) => oldSchema.uploadFiltersById[uploadFilterId]);
    const createdEntities = (0, lodash_1.difference)(newEntityIds, oldEntityIds).map((uploadFilterId) => newSchema.uploadFiltersById[uploadFilterId]);
    const commands = [
        ...deletedEntities.flatMap(buildDestroyUploadFilterClientCommand),
        ...createdEntities.flatMap(buildCreateUploadFilterClientCommand),
        ...keptEntityIds.flatMap((uploadFilterId) => buildUpdateUploadFilterClientCommand(newSchema.uploadFiltersById[uploadFilterId], oldSchema.uploadFiltersById[uploadFilterId])),
    ];
    if (commands.length === 0) {
        return [];
    }
    return [(0, comments_1.buildComment)('Manage upload filters'), ...commands];
}
