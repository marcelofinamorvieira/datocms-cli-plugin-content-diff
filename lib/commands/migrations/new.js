"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const cli_utils_1 = require("@datocms/cli-utils");
const cma_schema_types_generator_1 = require("@datocms/cma-schema-types-generator");
const lodash_1 = require("lodash");
const mkdirp_1 = tslib_1.__importDefault(require("mkdirp"));
const datocms_version_1 = require("../../compat/datocms-version");
const environments_diff_1 = require("../../utils/environments-diff");
const find_nearest_file_1 = require("../../utils/find-nearest-file");
const jsTemplate = `
'use strict';

/** @param client { import("datocms/lib/cma-client-node").Client } */
module.exports = async (client) => {
  // DatoCMS migration script

  // For more examples, head to our Content Management API docs:
  // https://www.datocms.com/docs/content-management-api

  // Create an Article model:
  // https://www.datocms.com/docs/content-management-api/resources/item-type/create

  const articleModel = await client.itemTypes.create({
    name: 'Article',
    api_key: 'article',
  });

  // Create a Title field (required):
  // https://www.datocms.com/docs/content-management-api/resources/field/create

  const titleField = await client.fields.create(articleModel, {
    label: 'Title',
    api_key: 'title',
    field_type: 'string',
    validators: {
      required: {},
    },
  });

  // Create an Article record:
  // https://www.datocms.com/docs/content-management-api/resources/item/create

  const article = await client.items.create({
    item_type: articleModel,
    title: 'My first article!',
  });
}
`.trim();
const tsTemplate = `
import { Client } from 'datocms/lib/cma-client-node';

export default async function(client: Client): Promise<void> {
  // DatoCMS migration script

  // For more examples, head to our Content Management API docs:
  // https://www.datocms.com/docs/content-management-api

  // Create an Article model:
  // https://www.datocms.com/docs/content-management-api/resources/item-type/create

  const articleModel = await client.itemTypes.create({
    name: 'Article',
    api_key: 'article',
  });

  // Create a Title field (required):
  // https://www.datocms.com/docs/content-management-api/resources/field/create

  const titleField = await client.fields.create(articleModel, {
    label: 'Title',
    api_key: 'title',
    field_type: 'string',
    validators: {
      required: {},
    },
  });

  // Create an Article record:
  // https://www.datocms.com/docs/content-management-api/resources/item/create

  const article = await client.items.create({
    item_type: articleModel,
    title: 'My first article!',
  });
}
`.trim();
class Command extends cli_utils_1.CmaClientCommand {
    async run() {
        var _a, _b, _c;
        (0, datocms_version_1.assertSupportedDatocmsCli)(this);
        const { flags, args: { NAME: scriptName }, } = await this.parse(Command);
        this.requireDatoProfileConfig();
        const config = this.datoProfileConfig;
        const template = flags.template
            ? (0, node_path_1.resolve)(flags.template)
            : ((_a = config.migrations) === null || _a === void 0 ? void 0 : _a.template)
                ? (0, node_path_1.resolve)((0, node_path_1.dirname)(this.datoConfigPath), config.migrations.template)
                : undefined;
        const migrationsDir = ((_b = config.migrations) === null || _b === void 0 ? void 0 : _b.directory)
            ? (0, node_path_1.resolve)((0, node_path_1.dirname)(this.datoConfigPath), config.migrations.directory)
            : (0, node_path_1.resolve)('./migrations');
        const migrationsTsconfig = ((_c = config.migrations) === null || _c === void 0 ? void 0 : _c.tsconfig)
            ? (0, node_path_1.resolve)((0, node_path_1.dirname)(this.datoConfigPath), config.migrations.tsconfig)
            : undefined;
        let isTsProject = false;
        if (migrationsTsconfig) {
            isTsProject = true;
        }
        else {
            try {
                await (0, find_nearest_file_1.findNearestFile)('tsconfig.json');
                isTsProject = true;
            }
            catch { }
        }
        const format = template
            ? (0, node_path_1.extname)(template).split('.').pop()
            : flags.js
                ? 'js'
                : flags.ts || isTsProject
                    ? 'ts'
                    : 'js';
        const migrationFilePath = (0, node_path_1.join)(migrationsDir, `${Math.floor(Date.now() / 1000)}_${(0, lodash_1.camelCase)(scriptName)}.${format}`);
        this.startSpinner(`Writing "${(0, node_path_1.relative)(process.cwd(), migrationFilePath)}"`);
        try {
            await (0, mkdirp_1.default)(migrationsDir);
            await (0, promises_1.writeFile)(migrationFilePath, await this.migrationScriptContent(template, format, migrationFilePath, flags.autogenerate, flags.schema), 'utf-8');
            this.stopSpinner();
        }
        catch (e) {
            this.stopSpinnerWithFailure();
            throw e;
        }
        return migrationFilePath;
    }
    async migrationScriptContent(template, format, migrationFilePath, rawAutoGenerate, schemaFilter) {
        if (!rawAutoGenerate) {
            let content = template
                ? (0, node_fs_1.readFileSync)(template, 'utf-8')
                : format === 'js'
                    ? jsTemplate
                    : tsTemplate;
            // Add schema types if requested (only for TypeScript)
            if (schemaFilter && format === 'ts') {
                const schemaTypes = await this.generateSchemaTypes(schemaFilter);
                content = this.addSchemaTypesToMigration(content, schemaTypes);
            }
            return content;
        }
        const allEnvironments = await this.client.environments.list();
        const primaryEnv = allEnvironments.find((env) => env.meta.primary);
        const [newEnvironmentId, rawOldEnvironmentId] = rawAutoGenerate.split(':');
        const oldEnvironmentId = rawOldEnvironmentId || primaryEnv.id;
        const newEnv = allEnvironments.find((env) => env.id === newEnvironmentId);
        if (!newEnv) {
            this.error(`Environment "${newEnv}" does not exist`);
        }
        const oldEnv = allEnvironments.find((env) => env.id === oldEnvironmentId);
        if (!oldEnv) {
            this.error(`Environment "${oldEnv}" does not exist`);
        }
        const newClient = await this.buildClient({ environment: newEnvironmentId });
        const oldClient = await this.buildClient({ environment: oldEnvironmentId });
        const script = await (0, environments_diff_1.diffEnvironments)({
            newClient,
            newEnvironmentId,
            oldClient,
            oldEnvironmentId,
            migrationFilePath,
            format,
        });
        return script;
    }
    async generateSchemaTypes(schemaFilter) {
        const client = await this.buildClient();
        const itemTypesFilter = schemaFilter.toLowerCase() === 'all' ? undefined : schemaFilter;
        return await (0, cma_schema_types_generator_1.generateSchemaTypesForMigration)(client, {
            itemTypesFilter,
        });
    }
    addSchemaTypesToMigration(content, schemaTypes) {
        // Update the import to include ItemTypeDefinition.
        // Match either package name: `datocms` (current) or `@datocms/cli` (legacy).
        const importMatch = content.match(/^import { Client } from '(datocms|@datocms\/cli)\/lib\/cma-client-node';/m);
        let updatedContent = content;
        if (importMatch) {
            const pkg = importMatch[1];
            const updatedImport = `import { Client, ItemTypeDefinition } from '${pkg}/lib/cma-client-node';`;
            updatedContent = updatedContent.replace(importMatch[0], updatedImport);
        }
        // Add schema types before the function declaration
        const functionMatch = updatedContent.match(/^export default async function/m);
        if (functionMatch) {
            const insertIndex = functionMatch.index;
            return `${updatedContent.slice(0, insertIndex)}// Schema type definitions\n${schemaTypes}\n\n${updatedContent.slice(insertIndex)}`;
        }
        // Fallback: prepend to the beginning
        return `// Schema type definitions\n${schemaTypes}\n\n${updatedContent}`;
    }
}
Command.description = 'Create a new migration script';
Command.flags = {
    ...cli_utils_1.CmaClientCommand.flags,
    ts: cli_utils_1.oclif.Flags.boolean({
        description: 'Forces the creation of a TypeScript migration file',
        exclusive: ['js'],
    }),
    js: cli_utils_1.oclif.Flags.boolean({
        description: 'Forces the creation of a JavaScript migration file',
        exclusive: ['ts'],
    }),
    template: cli_utils_1.oclif.Flags.string({
        description: 'Start the migration script from a custom template',
        exclusive: ['autogenerate'],
    }),
    autogenerate: cli_utils_1.oclif.Flags.string({
        description: "Auto-generates script by diffing the schema of two environments\n\nExamples:\n* --autogenerate=foo finds changes made to sandbox environment 'foo' and applies them to primary environment\n* --autogenerate=foo:bar finds changes made to environment 'foo' and applies them to environment 'bar'",
        exclusive: ['template'],
    }),
    schema: cli_utils_1.oclif.Flags.string({
        description: 'Include schema definitions for models and blocks (TypeScript only). Use "all" for all item types, or specify comma-separated API keys for specific ones',
        required: false,
    }),
};
Command.args = {
    NAME: cli_utils_1.oclif.Args.string({
        description: 'The name to give to the script',
        required: true,
    }),
};
exports.default = Command;
