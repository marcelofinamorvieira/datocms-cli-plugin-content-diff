"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffEnvironments = diffEnvironments;
const prettier_1 = require("prettier");
const fetch_schema_1 = require("./fetch-schema");
const create_new_fields_and_fieldsets_1 = require("./resources/create-new-fields-and-fieldsets");
const create_new_item_types_1 = require("./resources/create-new-item-types");
const delete_missing_fields_and_fieldsets_in_existing_item_types_1 = require("./resources/delete-missing-fields-and-fieldsets-in-existing-item-types");
const delete_missing_item_types_1 = require("./resources/delete-missing-item-types");
const finalize_item_types_1 = require("./resources/finalize-item-types");
const manage_item_type_filters_1 = require("./resources/manage-item-type-filters");
const manage_menu_items_1 = require("./resources/manage-menu-items");
const manage_plugins_1 = require("./resources/manage-plugins");
const manage_schema_menu_items_1 = require("./resources/manage-schema-menu-items");
const manage_upload_filters_1 = require("./resources/manage-upload-filters");
const manage_workflows_1 = require("./resources/manage-workflows");
const update_fields_and_fieldsets_1 = require("./resources/update-fields-and-fieldsets");
const update_roles_1 = require("./resources/update-roles");
const update_site_1 = require("./resources/update-site");
const write_1 = require("./write");
async function diffEnvironments({ newClient, newEnvironmentId, oldClient, oldEnvironmentId, migrationFilePath, format, }) {
    const newSchema = await (0, fetch_schema_1.fetchSchema)(newClient);
    const oldSchema = await (0, fetch_schema_1.fetchSchema)(oldClient);
    const { data: roles } = await newClient.roles.rawList();
    const commands = [
        ...(0, update_site_1.updateSite)(newSchema, oldSchema),
        ...(0, manage_workflows_1.manageWorkflows)(newSchema, oldSchema),
        ...(0, manage_plugins_1.managePlugins)(newSchema, oldSchema),
        ...(0, manage_upload_filters_1.manageUploadFilters)(newSchema, oldSchema),
        ...(0, create_new_item_types_1.createNewItemTypes)(newSchema, oldSchema),
        ...(0, create_new_fields_and_fieldsets_1.createNewFieldsAndFieldsets)(newSchema, oldSchema),
        ...(0, delete_missing_fields_and_fieldsets_in_existing_item_types_1.deleteMissingFieldsAndFieldsetsInExistingItemTypes)(newSchema, oldSchema),
        ...(0, update_fields_and_fieldsets_1.updateFieldsAndFieldsets)(newSchema, oldSchema),
        ...(0, delete_missing_item_types_1.deleteMissingItemTypes)(newSchema, oldSchema),
        ...(0, finalize_item_types_1.finalizeItemTypes)(newSchema, oldSchema),
        ...(0, manage_item_type_filters_1.manageItemTypeFilters)(newSchema, oldSchema),
        ...(0, manage_menu_items_1.manageMenuItems)(newSchema, oldSchema),
        ...(0, manage_schema_menu_items_1.manageSchemaMenuItems)(newSchema, oldSchema),
        ...(0, update_roles_1.updateRoles)(roles, newEnvironmentId, oldEnvironmentId, {
            newInternalItemTypeIds: newSchema.internalItemTypeIds,
            oldInternalItemTypeIds: oldSchema.internalItemTypeIds,
        }),
    ];
    try {
        const options = await (0, prettier_1.resolveConfig)(migrationFilePath);
        return (0, write_1.write)(commands, { ...options, format, filepath: migrationFilePath });
    }
    catch {
        // .prettierrc of user might not work with our version of prettier, in this case
        // fall back to default options
        return (0, write_1.write)(commands, { format, filepath: migrationFilePath });
    }
}
