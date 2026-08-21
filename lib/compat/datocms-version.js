"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_DATOCMS_CLI_VERSION = void 0;
exports.assertSupportedDatocmsCliConfig = assertSupportedDatocmsCliConfig;
exports.assertSupportedDatocmsCli = assertSupportedDatocmsCli;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
exports.SUPPORTED_DATOCMS_CLI_VERSION = '4.0.29';
function detectedDatocmsVersion(config) {
    const roots = new Set([config.root, (0, node_path_1.resolve)(config.root, '..')]);
    if (process.argv[1]) {
        try {
            const executableDirectory = (0, node_path_1.dirname)((0, node_fs_1.realpathSync)(process.argv[1]));
            roots.add(executableDirectory);
            roots.add((0, node_path_1.resolve)(executableDirectory, '..'));
            roots.add((0, node_path_1.resolve)(executableDirectory, '../..'));
        }
        catch {
            // The loaded oclif metadata remains available below.
        }
    }
    for (const root of roots) {
        try {
            const packageJson = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, 'package.json'), 'utf8'));
            if ((packageJson.name === 'datocms' ||
                packageJson.name === '@datocms/cli') &&
                typeof packageJson.version === 'string') {
                return packageJson.version;
            }
        }
        catch {
            // Fall back to oclif's loaded metadata below.
        }
    }
    return undefined;
}
function assertSupportedDatocmsCliConfig(config, reportError) {
    var _a, _b;
    const { bin, name } = config;
    const detectedVersion = detectedDatocmsVersion(config);
    const isDatocmsHost = detectedVersion !== undefined ||
        bin === 'datocms' ||
        name === 'datocms' ||
        name === '@datocms/cli';
    if (!isDatocmsHost)
        return;
    const installedVersion = (_b = detectedVersion !== null && detectedVersion !== void 0 ? detectedVersion : (_a = config.pjson) === null || _a === void 0 ? void 0 : _a.version) !== null && _b !== void 0 ? _b : config.version;
    if (installedVersion === exports.SUPPORTED_DATOCMS_CLI_VERSION)
        return;
    reportError(`This content-diff beta supports datocms CLI ${exports.SUPPORTED_DATOCMS_CLI_VERSION} only, but ${installedVersion} is running. Install the supported CLI version or update/remove this plugin before continuing.`);
}
/**
 * User-installed oclif plugins share the host CLI configuration. Keep the
 * copied migrations compatibility layer pinned to the exact CLI revision it
 * was extracted from, and fail before profile resolution or CMA access when a
 * different public CLI version loads it.
 *
 * The package's own development binary is intentionally exempt: in that mode
 * this plugin is the root oclif application rather than a datocms user plugin.
 */
function assertSupportedDatocmsCli(command) {
    assertSupportedDatocmsCliConfig(command.config, (message) => command.error(message, { exit: 1 }));
}
