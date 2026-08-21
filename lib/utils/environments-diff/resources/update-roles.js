"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRole = updateRole;
exports.updateRoles = updateRoles;
const lodash_1 = require("lodash");
const comments_1 = require("./comments");
function omitNullProperties(hash) {
    return Object.entries(hash).reduce((result, [key, value]) => {
        if (!value || key === 'environment') {
            return result;
        }
        result[key] = value;
        return result;
    }, {});
}
function buildUpdateRoleDiff(newData, oldData) {
    const remove = (0, lodash_1.differenceWith)(oldData, newData, lodash_1.isEqual);
    const add = (0, lodash_1.differenceWith)(newData, oldData, lodash_1.isEqual);
    if (add.length === 0 && remove.length === 0) {
        return undefined;
    }
    return {
        ...(add.length > 0 ? { add } : {}),
        ...(remove.length > 0 ? { remove } : {}),
    };
}
function getEnvItemTypePermissions(permissions, newEnvironmentId, oldEnvironmentId, newInternalItemTypeIds, oldInternalItemTypeIds) {
    const newPermissions = permissions
        .filter((rule) => rule.environment === newEnvironmentId &&
        (!rule.item_type || !newInternalItemTypeIds.has(rule.item_type)))
        .map(omitNullProperties);
    const oldPermissions = permissions
        .filter((rule) => rule.environment === oldEnvironmentId &&
        (!rule.item_type || !oldInternalItemTypeIds.has(rule.item_type)))
        .map(omitNullProperties);
    return buildUpdateRoleDiff(newPermissions, oldPermissions);
}
function getEnvUploadPermissions(permissions, newEnvironmentId, oldEnvironmentId) {
    const newPermissions = permissions
        .filter((rule) => rule.environment === newEnvironmentId)
        .map(omitNullProperties);
    const oldPermissions = permissions
        .filter((rule) => rule.environment === oldEnvironmentId)
        .map(omitNullProperties);
    return buildUpdateRoleDiff(newPermissions, oldPermissions);
}
function updateRole(role, newEnvironmentId, oldEnvironmentId, { newInternalItemTypeIds = [], oldInternalItemTypeIds = [], } = {}) {
    const newInternalIds = new Set(newInternalItemTypeIds);
    const oldInternalIds = new Set(oldInternalItemTypeIds);
    const positiveItemType = getEnvItemTypePermissions(role.attributes.positive_item_type_permissions, newEnvironmentId, oldEnvironmentId, newInternalIds, oldInternalIds);
    const negativeItemType = getEnvItemTypePermissions(role.attributes.negative_item_type_permissions, newEnvironmentId, oldEnvironmentId, newInternalIds, oldInternalIds);
    const positiveUpload = getEnvUploadPermissions(role.attributes.positive_upload_permissions, newEnvironmentId, oldEnvironmentId);
    const negativeUpload = getEnvUploadPermissions(role.attributes.negative_upload_permissions, newEnvironmentId, oldEnvironmentId);
    if (!(positiveItemType || negativeItemType || positiveUpload || negativeUpload)) {
        return [];
    }
    const command = {
        type: 'apiCallClientCommand',
        call: 'client.roles.updateCurrentEnvironmentPermissions',
        roleId: role.id,
        changes: {
            ...(positiveItemType
                ? { positive_item_type_permissions: positiveItemType }
                : {}),
            ...(negativeItemType
                ? { negative_item_type_permissions: negativeItemType }
                : {}),
            ...(positiveUpload
                ? { positive_upload_permissions: positiveUpload }
                : {}),
            ...(negativeUpload
                ? { negative_upload_permissions: negativeUpload }
                : {}),
        },
    };
    return [
        (0, comments_1.buildComment)(`Update permissions for environment in role ${role.attributes.name}`),
        command,
    ];
}
function updateRoles(roles, newEnvironmentId, oldEnvironmentId, internalItemTypes = {}) {
    return roles.flatMap((role) => updateRole(role, newEnvironmentId, oldEnvironmentId, internalItemTypes));
}
