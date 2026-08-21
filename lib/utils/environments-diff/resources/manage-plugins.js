"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.managePlugins = managePlugins;
const lodash_1 = require("lodash");
const utils_1 = require("../utils");
const comments_1 = require("./comments");
function buildCreatePluginClientCommand(plugin) {
    const commands = [];
    const createCommand = {
        type: 'apiCallClientCommand',
        call: 'client.plugins.create',
        arguments: [
            {
                data: {
                    type: 'plugin',
                    id: (0, utils_1.isBase64Id)(plugin.id) ? plugin.id : undefined,
                    attributes: plugin.attributes.package_name
                        ? (0, lodash_1.pick)(plugin.attributes, 'package_name')
                        : plugin.meta.version === '1'
                            ? (0, lodash_1.omit)(plugin.attributes, 'parameters')
                            : (0, lodash_1.omit)(plugin.attributes, 'parameter_definitions', 'field_types', 'plugin_type', 'parameters'),
                },
            },
        ],
        oldEnvironmentId: plugin.id,
    };
    commands.push(createCommand);
    if (!(0, lodash_1.isEqual)(plugin.attributes.parameters, {})) {
        const updateCommand = {
            type: 'apiCallClientCommand',
            call: 'client.plugins.update',
            arguments: [
                plugin.id,
                {
                    data: {
                        id: plugin.id,
                        type: 'plugin',
                        attributes: (0, lodash_1.pick)(plugin.attributes, 'parameters'),
                    },
                },
            ],
        };
        commands.push(updateCommand);
    }
    return [
        (0, comments_1.buildComment)(`${plugin.attributes.package_name ? 'Install' : 'Create private'} ${(0, utils_1.buildPluginTitle)(plugin)}`),
        ...commands,
    ];
}
function buildDestroyPluginClientCommand(plugin) {
    return [
        (0, comments_1.buildComment)(`Delete ${(0, utils_1.buildPluginTitle)(plugin)}`),
        {
            type: 'apiCallClientCommand',
            call: 'client.plugins.destroy',
            arguments: [plugin.id],
        },
    ];
}
function buildUpdatePluginClientCommand(newPlugin, oldPlugin) {
    const isLegacy = oldPlugin.meta.version === '1';
    const isPublic = Boolean(oldPlugin.attributes.package_name);
    const commands = [];
    const onlyChangedAttributes = (...allowedAttributes) => (0, lodash_1.pick)(newPlugin.attributes, (0, lodash_1.intersection)(Object.keys(newPlugin.attributes).filter((attribute) => !(0, lodash_1.isEqual)(oldPlugin.attributes[attribute], newPlugin.attributes[attribute])), allowedAttributes));
    if (isLegacy) {
        if (isPublic) {
            if (!newPlugin.attributes.package_version) {
                const updateCommand = {
                    type: 'apiCallClientCommand',
                    call: 'client.plugins.update',
                    arguments: [
                        oldPlugin.id,
                        {
                            data: {
                                id: oldPlugin.id,
                                type: 'plugin',
                                attributes: (0, lodash_1.pick)(newPlugin.attributes, 'name', 'description', 'url', 'permissions'),
                            },
                        },
                    ],
                };
                commands.push((0, comments_1.buildComment)(`Convert legacy ${(0, utils_1.buildPluginTitle)(newPlugin)} into private plugin`));
                commands.push(updateCommand);
            }
            else if (newPlugin.attributes.package_version !==
                oldPlugin.attributes.package_version) {
                const updateCommand = {
                    type: 'apiCallClientCommand',
                    call: 'client.plugins.update',
                    arguments: [
                        oldPlugin.id,
                        {
                            data: {
                                id: oldPlugin.id,
                                type: 'plugin',
                                attributes: (0, lodash_1.pick)(newPlugin.attributes, 'package_version'),
                            },
                        },
                    ],
                };
                commands.push((0, comments_1.buildComment)(`Upgrade version of legacy ${(0, utils_1.buildPluginTitle)(newPlugin)}`));
                commands.push(updateCommand);
            }
            if (!(0, lodash_1.isEqual)(newPlugin.attributes.parameters, oldPlugin.attributes.parameters)) {
                const updateCommand = {
                    type: 'apiCallClientCommand',
                    call: 'client.plugins.update',
                    arguments: [
                        oldPlugin.id,
                        {
                            data: {
                                id: oldPlugin.id,
                                type: 'plugin',
                                attributes: (0, lodash_1.pick)(newPlugin.attributes, 'parameters'),
                            },
                        },
                    ],
                };
                commands.push((0, comments_1.buildComment)(`Update settings of legacy ${(0, utils_1.buildPluginTitle)(oldPlugin)}`));
                commands.push(updateCommand);
            }
        }
        else {
            const changedAttributes = onlyChangedAttributes('name', 'description', 'url', 'parameters', 'permissions');
            if (Object.keys(changedAttributes).length > 0) {
                const updateCommand = {
                    type: 'apiCallClientCommand',
                    call: 'client.plugins.update',
                    arguments: [
                        oldPlugin.id,
                        {
                            data: {
                                id: oldPlugin.id,
                                type: 'plugin',
                                attributes: changedAttributes,
                            },
                        },
                    ],
                };
                commands.push((0, comments_1.buildComment)(`Update legacy private ${(0, utils_1.buildPluginTitle)(newPlugin)}`));
                commands.push(updateCommand);
            }
        }
    }
    else {
        if (isPublic) {
            if (!newPlugin.attributes.package_version) {
                const updateCommand = {
                    type: 'apiCallClientCommand',
                    call: 'client.plugins.update',
                    arguments: [
                        oldPlugin.id,
                        {
                            data: {
                                id: oldPlugin.id,
                                type: 'plugin',
                                attributes: onlyChangedAttributes('name', 'description', 'url', 'permissions', 'parameters'),
                            },
                        },
                    ],
                };
                commands.push((0, comments_1.buildComment)(`Convert ${(0, utils_1.buildPluginTitle)(newPlugin)} into private plugin`));
                commands.push(updateCommand);
            }
            else {
                const changedAttributes = onlyChangedAttributes('package_version', 'parameters');
                if (Object.keys(changedAttributes).length > 0) {
                    const updateCommand = {
                        type: 'apiCallClientCommand',
                        call: 'client.plugins.update',
                        arguments: [
                            oldPlugin.id,
                            {
                                data: {
                                    id: oldPlugin.id,
                                    type: 'plugin',
                                    attributes: changedAttributes,
                                },
                            },
                        ],
                    };
                    commands.push((0, comments_1.buildComment)(`${'package_version' in changedAttributes
                        ? 'Upgrade version'
                        : 'Update settings'} of ${(0, utils_1.buildPluginTitle)(oldPlugin)}`));
                    commands.push(updateCommand);
                }
            }
        }
        else {
            const changedAttributes = onlyChangedAttributes('name', 'description', 'url', 'parameters', 'permissions');
            if (Object.keys(changedAttributes).length > 0) {
                const updateCommand = {
                    type: 'apiCallClientCommand',
                    call: 'client.plugins.update',
                    arguments: [
                        oldPlugin.id,
                        {
                            data: {
                                id: oldPlugin.id,
                                type: 'plugin',
                                attributes: changedAttributes,
                            },
                        },
                    ],
                };
                commands.push((0, comments_1.buildComment)(`Update settings of private ${(0, utils_1.buildPluginTitle)(oldPlugin)}`));
                commands.push(updateCommand);
            }
        }
    }
    return commands;
}
function managePlugins(newSchema, oldSchema) {
    const oldEntityIds = Object.keys(oldSchema.pluginsById);
    const newEntityIds = Object.keys(newSchema.pluginsById);
    const keptEntityIds = (0, lodash_1.intersection)(oldEntityIds, newEntityIds);
    const deletedEntities = (0, lodash_1.difference)(oldEntityIds, newEntityIds).map((pluginId) => oldSchema.pluginsById[pluginId]);
    const createdEntities = (0, lodash_1.difference)(newEntityIds, oldEntityIds).map((pluginId) => newSchema.pluginsById[pluginId]);
    const commands = [
        ...deletedEntities.flatMap(buildDestroyPluginClientCommand),
        ...createdEntities.flatMap(buildCreatePluginClientCommand),
        ...keptEntityIds.flatMap((pluginId) => buildUpdatePluginClientCommand(newSchema.pluginsById[pluginId], oldSchema.pluginsById[pluginId])),
    ];
    if (commands.length === 0) {
        return [];
    }
    return [(0, comments_1.buildComment)('Manage upload filters'), ...commands];
}
