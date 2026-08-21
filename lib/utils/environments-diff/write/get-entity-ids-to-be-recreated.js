"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEntityIdsToBeRecreated = getEntityIdsToBeRecreated;
function getEntityIdsToBeRecreated(commands) {
    return {
        field: commands
            .filter((command) => command.type === 'apiCallClientCommand' &&
            command.call === 'client.fields.create')
            .map((command) => command.oldEnvironmentId),
        fieldset: commands
            .filter((command) => command.type === 'apiCallClientCommand' &&
            command.call === 'client.fieldsets.create')
            .map((command) => command.oldEnvironmentId),
        itemType: commands
            .filter((command) => command.type === 'apiCallClientCommand' &&
            command.call === 'client.itemTypes.create')
            .map((command) => command.oldEnvironmentId),
        plugin: commands
            .filter((command) => command.type === 'apiCallClientCommand' &&
            command.call === 'client.plugins.create')
            .map((command) => command.oldEnvironmentId),
        workflow: commands
            .filter((command) => command.type === 'apiCallClientCommand' &&
            command.call === 'client.workflows.create')
            .map((command) => command.oldEnvironmentId),
        menuItem: commands
            .filter((command) => command.type === 'apiCallClientCommand' &&
            command.call === 'client.menuItems.create')
            .map((command) => command.oldEnvironmentId),
        schemaMenuItem: commands
            .filter((command) => command.type === 'apiCallClientCommand' &&
            command.call === 'client.schemaMenuItems.create')
            .map((command) => command.oldEnvironmentId),
        itemTypeFilter: commands
            .filter((command) => command.type === 'apiCallClientCommand' &&
            command.call === 'client.itemTypeFilters.create')
            .map((command) => command.oldEnvironmentId),
    };
}
