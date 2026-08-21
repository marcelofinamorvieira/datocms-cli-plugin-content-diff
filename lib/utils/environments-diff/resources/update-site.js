"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSite = updateSite;
const lodash_1 = require("lodash");
const comments_1 = require("./comments");
function updateSite(newSchema, oldSchema) {
    const newSite = newSchema.siteEntity;
    const oldSite = oldSchema.siteEntity;
    const attributesToUpdate = (0, lodash_1.omit)((0, lodash_1.pick)(newSite.attributes, Object.keys(newSite.attributes).filter((attribute) => !(0, lodash_1.isEqual)(oldSite.attributes[attribute], newSite.attributes[attribute]))), 'last_data_change_at', 'global_seo', 'theme');
    if (Object.keys(attributesToUpdate).length === 0) {
        return [];
    }
    return [
        (0, comments_1.buildComment)(`Update environment's settings`),
        {
            type: 'apiCallClientCommand',
            call: 'client.site.update',
            arguments: [
                {
                    data: {
                        type: 'site',
                        id: newSite.id,
                        attributes: attributesToUpdate,
                    },
                },
            ],
        },
    ];
}
