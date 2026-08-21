"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertCanEditSchema = assertCanEditSchema;
exports.assertUnrestrictedReadAccess = assertUnrestrictedReadAccess;
const types_1 = require("./types");
/** Proves schema-edit authority before emitting a plan that will edit fields. */
async function assertCanEditSchema(client) {
    var _a, _b;
    const actor = (await client.users.findMe({ include: 'role' }));
    if (!actor) {
        throw unprovenSchemaEditAccess('The CMA did not return the current actor.');
    }
    if (actor.type === 'account' || actor.type === 'organization')
        return;
    if (actor.type === 'access_token' && actor.hardcoded_type === 'admin') {
        return;
    }
    const roleReference = actor.role;
    if (!roleReference || typeof roleReference.id !== 'string') {
        throw unprovenSchemaEditAccess('The current actor has no directly inspectable effective role.');
    }
    const role = ((_a = roleReference.meta) === null || _a === void 0 ? void 0 : _a.final_permissions)
        ? roleReference
        : (await client.roles.find(roleReference.id));
    const permissions = (_b = role.meta) === null || _b === void 0 ? void 0 : _b.final_permissions;
    if ((permissions === null || permissions === void 0 ? void 0 : permissions.can_edit_schema) !== true) {
        throw unprovenSchemaEditAccess('The current effective role does not grant schema editing.');
    }
}
/**
 * Collection endpoints are permission-filtered. A content diff is therefore
 * authoritative only after positively proving that its credential can read
 * every record and upload in both environments.
 */
async function assertUnrestrictedReadAccess(client, environmentIds, itemTypes) {
    var _a, _b;
    const actor = (await client.users.findMe({ include: 'role' }));
    if (!actor) {
        throw unprovenAccess('The CMA did not return the current actor.');
    }
    if (actor.type === 'account' || actor.type === 'organization') {
        return;
    }
    if (actor.type === 'access_token' && actor.hardcoded_type === 'admin') {
        return;
    }
    if (actor.type === 'access_token' && actor.hardcoded_type === 'readonly') {
        throw unprovenAccess('The built-in read-only API token cannot read upload collections.');
    }
    const roleReference = actor.role;
    if (!roleReference || typeof roleReference.id !== 'string') {
        throw unprovenAccess('The current actor has no directly inspectable effective role.');
    }
    const role = ((_a = roleReference.meta) === null || _a === void 0 ? void 0 : _a.final_permissions)
        ? roleReference
        : (await client.roles.find(roleReference.id));
    const permissions = (_b = role.meta) === null || _b === void 0 ? void 0 : _b.final_permissions;
    if (!permissions) {
        throw unprovenAccess('The current role response does not expose effective permissions.');
    }
    // Upload-collection index/show is additionally guarded for access tokens,
    // even when their upload read rules are otherwise unrestricted.
    if (actor.type === 'access_token' &&
        permissions.can_manage_upload_collections !== true) {
        throw unprovenAccess('The current access token cannot read upload collections.');
    }
    const regularItemTypes = itemTypes.filter(({ modularBlock }) => !modularBlock);
    for (const environmentId of environmentIds) {
        for (const itemType of regularItemTypes) {
            if (!canReadEveryRecord(permissions, environmentId, itemType)) {
                throw unprovenAccess(`The current role cannot prove unrestricted reads for model "${itemType.apiKey}" in environment "${environmentId}".`, environmentId, itemType.id);
            }
        }
        if (!canReadEveryUpload(permissions, environmentId)) {
            throw unprovenAccess(`The current role cannot prove unrestricted upload reads in environment "${environmentId}".`, environmentId);
        }
    }
}
function canReadEveryRecord(permissions, environmentId, itemType) {
    var _a, _b;
    const positives = (_a = permissions.positive_item_type_permissions) !== null && _a !== void 0 ? _a : [];
    const negatives = (_b = permissions.negative_item_type_permissions) !== null && _b !== void 0 ? _b : [];
    const granted = positives.some((permission) => isReadAction(permission.action) &&
        permission.environment === environmentId &&
        permission.on_creator === 'anyone' &&
        hasUnrestrictedLocalization(permission) &&
        !permission.on_stage &&
        matchesItemType(permission, itemType));
    const denied = negatives.some((permission) => isReadAction(permission.action) &&
        permission.environment === environmentId &&
        matchesItemType(permission, itemType));
    return granted && !denied;
}
function canReadEveryUpload(permissions, environmentId) {
    var _a, _b;
    const positives = (_a = permissions.positive_upload_permissions) !== null && _a !== void 0 ? _a : [];
    const negatives = (_b = permissions.negative_upload_permissions) !== null && _b !== void 0 ? _b : [];
    const granted = positives.some((permission) => isReadAction(permission.action) &&
        permission.environment === environmentId &&
        permission.on_creator === 'anyone' &&
        hasUnrestrictedLocalization(permission) &&
        !permission.upload_collection);
    const denied = negatives.some((permission) => isReadAction(permission.action) &&
        permission.environment === environmentId);
    return granted && !denied;
}
function matchesItemType(permission, itemType) {
    if (permission.item_type) {
        return permission.item_type === itemType.id;
    }
    if (permission.workflow) {
        return permission.workflow === itemType.workflowId;
    }
    return true;
}
function isReadAction(action) {
    return action === 'read' || action === 'all';
}
function hasUnrestrictedLocalization(permission) {
    return (permission.localization_scope === undefined ||
        permission.localization_scope === null ||
        permission.localization_scope === 'all');
}
function unprovenAccess(message, environmentId, itemTypeId) {
    return new types_1.ContentDiffError('UNPROVEN_FULL_ACCESS', `${message} Content diff refuses to treat permission-filtered results as complete.`, {
        ...(environmentId ? { environmentId } : {}),
        ...(itemTypeId ? { itemTypeId } : {}),
    });
}
function unprovenSchemaEditAccess(message) {
    return new types_1.ContentDiffError('UNPROVEN_SCHEMA_EDIT_ACCESS', `${message} Content diff refuses to generate temporary validator relaxations without proven schema-edit permission.`);
}
