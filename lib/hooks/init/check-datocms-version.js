"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const datocms_version_1 = require("../../compat/datocms-version");
const GUARDED_COMMANDS = new Set([
    'content:diff',
    'migrations:new',
    'migrations:run',
]);
const hook = async function ({ config, id }) {
    if (!id || !GUARDED_COMMANDS.has(id))
        return;
    (0, datocms_version_1.assertSupportedDatocmsCliConfig)(config, (message) => {
        this.error(message, { exit: 1 });
    });
};
exports.default = hook;
