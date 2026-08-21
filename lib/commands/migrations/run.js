"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const cli_utils_1 = require("@datocms/cli-utils");
const api_1 = require("tsx/cjs/api");
const datocms_version_1 = require("../../compat/datocms-version");
const fetch_schema_1 = require("../../utils/environments-diff/fetch-schema");
const MIGRATION_FILE_REGEXP = /^\d+.*\.(js|ts)$/;
/**
 * Protocol understood by generated content-diff migration entrypoints.
 *
 * Ordinary migrations can ignore this additional context property. Generated
 * content-diff migrations use it to fail closed when invoked by a CLI runner
 * that predates their execution-safety contract.
 */
exports.CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION = 1;
class Command extends cli_utils_1.CmaClientCommand {
    async run() {
        var _a;
        (0, datocms_version_1.assertSupportedDatocmsCli)(this);
        this.requireDatoProfileConfig();
        const preference = (_a = this.datoProfileConfig) === null || _a === void 0 ? void 0 : _a.migrations;
        const parsed = await this.parse(Command);
        const { 'dry-run': dryRun, 'in-place': inPlace, 'allow-primary': allowPrimary, 'fast-fork': fastFork, force, source: sourceEnvId, destination: rawDestinationEnvId, } = parsed.flags;
        const migrationsDir = (0, node_path_1.resolve)(parsed.flags['migrations-dir'] ||
            ((preference === null || preference === void 0 ? void 0 : preference.directory)
                ? (0, node_path_1.resolve)((0, node_path_1.dirname)(this.datoConfigPath), preference === null || preference === void 0 ? void 0 : preference.directory)
                : undefined) ||
            './migrations');
        const migrationsModelApiKey = parsed.flags['migrations-model'] ||
            (preference === null || preference === void 0 ? void 0 : preference.modelApiKey) ||
            'schema_migration';
        if (migrationsModelApiKey === fetch_schema_1.CONTENT_DIFF_MAPPING_MODEL_API_KEY) {
            this.error(`The model API key "${fetch_schema_1.CONTENT_DIFF_MAPPING_MODEL_API_KEY}" is reserved for the content-diff legacy-ID mapping ledger and cannot be used to track migrations. Choose a different migrations.modelApiKey or --migrations-model value.`);
        }
        const migrationsTsconfig = parsed.flags['migrations-tsconfig'] ||
            ((preference === null || preference === void 0 ? void 0 : preference.tsconfig)
                ? (0, node_path_1.resolve)((0, node_path_1.dirname)(this.datoConfigPath), preference === null || preference === void 0 ? void 0 : preference.tsconfig)
                : undefined);
        try {
            await (0, promises_1.access)(migrationsDir);
        }
        catch {
            this.error(`Directory "${migrationsDir}" does not exist!`);
        }
        if (migrationsTsconfig) {
            try {
                await (0, promises_1.access)(migrationsTsconfig);
            }
            catch {
                this.error(`File "${migrationsTsconfig}" does not exist!`);
            }
        }
        const allEnvironments = await this.client.environments.list();
        const primaryEnv = allEnvironments.find((env) => env.meta.primary);
        const sourceEnv = sourceEnvId
            ? await this.client.environments.find(sourceEnvId)
            : primaryEnv;
        if (!sourceEnv) {
            this.error(`You have no permissions to access the "${sourceEnvId ? `"${sourceEnvId}"` : 'primary'}" environment!`);
        }
        let destinationEnvId = inPlace
            ? sourceEnv.id
            : rawDestinationEnvId || `${sourceEnv.id}-post-migrations`;
        const destinationIsPrimary = !!primaryEnv && primaryEnv.id === destinationEnvId;
        this.log(`Migrations will be ${dryRun ? 'simulated (dry run)' : 'run'} in "${destinationEnvId}" ${destinationIsPrimary ? 'primary' : 'sandbox'} environment`);
        if (inPlace) {
            if (destinationIsPrimary) {
                if (!allowPrimary) {
                    this.error('Running migrations on primary environment is not allowed!', {
                        suggestions: [
                            'The recommended workflow is to fork, run migrations on the sandbox, and then promote it.',
                            'Only override this guard with --allow-primary after reviewing every pending migration. WARNING: there is no rollback if the run fails partway through — the primary environment may be left in a partially-migrated state.',
                        ],
                    });
                }
                this.warn('Running migrations in-place on the primary environment (--allow-primary). ' +
                    'Review every pending migration: a failure partway through can leave primary partially migrated, with no automatic rollback.');
            }
        }
        else {
            destinationEnvId = await this.forkEnvironment(sourceEnv, destinationEnvId, allEnvironments, dryRun, fastFork, force);
        }
        const envClient = await this.buildClient({ environment: destinationEnvId });
        const executionContext = {
            environmentId: destinationEnvId,
            inPlace: Boolean(inPlace),
            allowPrimary: Boolean(allowPrimary),
            contentDiffProtocolVersion: exports.CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION,
        };
        const migrationModel = await this.upsertMigrationModel(envClient, migrationsModelApiKey, dryRun);
        const migrationScriptsToRun = await this.migrationScriptsToRun(migrationModel, envClient, migrationsDir);
        const someMigrationScriptRequiresLegacyClient = migrationScriptsToRun.some((s) => s.legacy);
        let legacyEnvClient = null;
        if (someMigrationScriptRequiresLegacyClient) {
            const config = await this.buildBaseClientInitializationOptions();
            try {
                const libraryName = 'datocms-client';
                const { SiteClient } = await import(libraryName);
                legacyEnvClient = new SiteClient(config.apiToken, {
                    environment: destinationEnvId,
                });
            }
            catch {
                this.error('Detected some migrations that require legacy client', {
                    suggestions: ['Please add the "datocms-client" NPM package'],
                });
            }
        }
        for (const migrationScript of migrationScriptsToRun) {
            // eslint-disable-next-line no-await-in-loop
            await this.runMigrationScript(migrationScript, envClient, legacyEnvClient, dryRun, migrationModel, migrationsDir, migrationsTsconfig, executionContext);
        }
        this.log(migrationScriptsToRun.length === 0
            ? 'No new migration scripts to run, skipping operation'
            : dryRun
                ? `Successfully simulated ${migrationScriptsToRun.length} migration scripts (dry run, no changes were made)`
                : `Successfully run ${migrationScriptsToRun.length} migration scripts`);
        return {
            environmentId: destinationEnvId,
            runMigrationScripts: migrationScriptsToRun.map((s) => s.path),
        };
    }
    async runMigrationScript(script, envClient, legacyEnvClient, dryRun, migrationModel, migrationsDir, _migrationsTsconfig, executionContext) {
        const relativePath = (0, node_path_1.relative)(migrationsDir, script.path);
        this.startSpinner(dryRun
            ? `Simulating migration "${relativePath}" (dry run)`
            : `Running migration "${relativePath}"`);
        try {
            if (!dryRun) {
                const exportedThing = (0, api_1.require)(script.path, __filename);
                const migration = typeof exportedThing === 'function'
                    ? exportedThing
                    : 'default' in exportedThing &&
                        typeof exportedThing.default === 'function'
                        ? exportedThing.default
                        : undefined;
                if (!migration) {
                    this.error('The script does not export a valid migration function');
                }
                try {
                    await migration(script.legacy ? legacyEnvClient : envClient, executionContext);
                }
                catch (e) {
                    this.stopSpinnerWithFailure();
                    if (e instanceof Error) {
                        this.log();
                        this.log('----');
                        this.log(e.stack);
                        this.log('----');
                        this.log();
                    }
                    this.error(`Migration "${relativePath}" failed`);
                }
            }
            if (!dryRun && migrationModel) {
                await envClient.items.create({
                    item_type: migrationModel,
                    name: relativePath,
                });
            }
            this.stopSpinner();
        }
        catch (e) {
            this.stopSpinnerWithFailure();
            throw e;
        }
    }
    async migrationScriptsToRun(migrationModel, envClient, migrationsDir) {
        const alreadyRunMigrations = migrationModel
            ? await this.fetchAlreadyRunMigrationScripts(envClient, migrationModel)
            : [];
        const allMigrationScripts = (await (0, promises_1.readdir)(migrationsDir))
            .filter((file) => file.match(MIGRATION_FILE_REGEXP))
            .map((file) => ({
            filename: file,
            path: (0, node_path_1.join)(migrationsDir, file),
            legacy: false,
        }));
        let allLegacyMigrationScripts = [];
        try {
            const legacyMigrationsDir = (0, node_path_1.join)(migrationsDir, 'legacyClient');
            await (0, promises_1.access)(legacyMigrationsDir);
            allLegacyMigrationScripts = (await (0, promises_1.readdir)(legacyMigrationsDir))
                .filter((file) => file.match(MIGRATION_FILE_REGEXP))
                .map((file) => ({
                filename: file,
                path: (0, node_path_1.join)(legacyMigrationsDir, file),
                legacy: true,
            }));
        }
        catch { }
        return [...allMigrationScripts, ...allLegacyMigrationScripts]
            .sort((a, b) => a.filename.localeCompare(b.filename))
            .filter((script) => !alreadyRunMigrations.includes(script.filename));
    }
    async forkEnvironment(sourceEnv, destinationEnvId, allEnvironments, dryRun, fastFork, force) {
        try {
            this.startSpinner(`Creating a fork of "${sourceEnv.id}" environment called "${destinationEnvId}"${dryRun ? ' (dry run, skipped)' : ''}`);
            const existingEnvironment = allEnvironments.find((env) => env.id === destinationEnvId);
            if (existingEnvironment) {
                this.error(`Environment "${destinationEnvId}" already exists!`, {
                    suggestions: [
                        `To execute the migrations inside the existing environment, run "${this.config.bin} migrations:run --source=${destinationEnvId} --in-place"`,
                        `To delete the environment, run "${this.config.bin} environments:destroy ${destinationEnvId}"`,
                    ],
                });
            }
            if (!dryRun) {
                await this.client.environments.fork(sourceEnv.id, {
                    id: destinationEnvId,
                }, {
                    fast: fastFork,
                    force,
                });
            }
            this.stopSpinner();
            return dryRun ? sourceEnv.id : destinationEnvId;
        }
        catch (e) {
            this.stopSpinnerWithFailure();
            if (e instanceof cli_utils_1.CmaClient.ApiError &&
                e.findError('ACTIVE_EDITING_SESSIONS')) {
                this.error('Cannot proceed with a fast fork of the environment, as some users are currently editing records', {
                    suggestions: ['To proceed anyway, use the --force flag'],
                });
            }
            throw e;
        }
    }
    async fetchAlreadyRunMigrationScripts(client, model) {
        const migrationScripts = [];
        for await (const item of client.items.listPagedIterator({
            filter: { type: model.id },
        })) {
            if (typeof item.name !== 'string' || item.name.length === 0) {
                this.error(`Migration tracking record "${item.id}" in model "${model.api_key}" has an invalid migration file name. migrations:run cannot safely determine which scripts already ran.`);
            }
            migrationScripts.push(item.name);
        }
        return migrationScripts;
    }
    async upsertMigrationModel(client, migrationModelApiKey, dryRun) {
        let migrationItemType;
        try {
            migrationItemType = await client.itemTypes.find(migrationModelApiKey);
        }
        catch (e) {
            if (!(e instanceof cli_utils_1.CmaClient.ApiError) || e.response.status !== 404) {
                throw e;
            }
            this.startSpinner(`Creating "${migrationModelApiKey}" model${dryRun ? ' (dry run, skipped)' : ''}`);
            try {
                if (dryRun) {
                    this.stopSpinner();
                    return null;
                }
                migrationItemType = await this.createMigrationModel(client, migrationModelApiKey);
                const fields = await client.fields.list(migrationItemType.id);
                this.assertExactMigrationModel(migrationItemType, fields, migrationModelApiKey);
                this.stopSpinner();
                return migrationItemType;
            }
            catch (creationError) {
                this.stopSpinnerWithFailure();
                throw creationError;
            }
        }
        const fields = await client.fields.list(migrationItemType.id);
        if (fields.length > 0) {
            this.assertUsableExistingMigrationModel(migrationItemType, fields, migrationModelApiKey);
            return migrationItemType;
        }
        // A fieldless model is only recoverable when it is the exact model that
        // migrations:run creates. Existing custom tracking models remain
        // supported, but we must never guess how to complete an unrelated model.
        this.assertExactMigrationItemType(migrationItemType, migrationModelApiKey);
        if (await this.migrationModelHasRecords(client, migrationItemType)) {
            this.error(`Configured migrations model "${migrationModelApiKey}" (${migrationItemType.id}) is missing its name field but already contains tracking records. migrations:run cannot safely reconstruct the lost migration history.`);
        }
        this.startSpinner(`Completing partially created "${migrationModelApiKey}" model${dryRun ? ' (dry run, skipped)' : ''}`);
        try {
            if (dryRun) {
                this.stopSpinner();
                return null;
            }
            await this.createMigrationModelNameField(client, migrationItemType.id);
            const completedFields = await client.fields.list(migrationItemType.id);
            this.assertExactMigrationModel(migrationItemType, completedFields, migrationModelApiKey);
            this.stopSpinner();
            return migrationItemType;
        }
        catch (completionError) {
            this.stopSpinnerWithFailure();
            throw completionError;
        }
    }
    async migrationModelHasRecords(client, model) {
        for await (const _item of client.items.listPagedIterator({
            filter: { type: model.id },
        })) {
            return true;
        }
        return false;
    }
    async createMigrationModel(client, migrationModelApiKey) {
        const model = await client.itemTypes.create({
            name: 'Schema migration',
            api_key: migrationModelApiKey,
            draft_mode_active: false,
        }, { skip_menu_item_creation: true });
        await this.createMigrationModelNameField(client, model.id);
        return model;
    }
    async createMigrationModelNameField(client, migrationModelId) {
        await client.fields.create(migrationModelId, {
            label: 'Migration file name',
            api_key: 'name',
            field_type: 'string',
            validators: {
                required: {},
            },
        });
    }
    assertExactMigrationModel(model, fields, migrationModelApiKey) {
        this.assertExactMigrationItemType(model, migrationModelApiKey);
        const nameField = fields[0];
        const validators = nameField === null || nameField === void 0 ? void 0 : nameField.validators;
        const requiredValidator = validators === null || validators === void 0 ? void 0 : validators.required;
        const exactRequiredValidator = requiredValidator !== null &&
            typeof requiredValidator === 'object' &&
            !Array.isArray(requiredValidator) &&
            Object.keys(requiredValidator).length === 0;
        const exactNameField = fields.length === 1 &&
            (nameField === null || nameField === void 0 ? void 0 : nameField.api_key) === 'name' &&
            nameField.field_type === 'string' &&
            nameField.localized === false &&
            nameField.default_value === null &&
            validators !== undefined &&
            Object.keys(validators).length === 1 &&
            exactRequiredValidator;
        if (!exactNameField) {
            this.migrationModelConflict(migrationModelApiKey, model.id);
        }
    }
    assertUsableExistingMigrationModel(model, fields, migrationModelApiKey) {
        const nameFields = fields.filter((field) => field.api_key === 'name');
        const nameField = nameFields[0];
        const unusableNameField = nameFields.length !== 1 ||
            (nameField === null || nameField === void 0 ? void 0 : nameField.field_type) !== 'string' ||
            nameField.localized !== false;
        const unsatisfiedRequiredExtraFields = fields.filter((field) => {
            if (field.id === (nameField === null || nameField === void 0 ? void 0 : nameField.id))
                return false;
            const validators = field.validators;
            return (validators === null || validators === void 0 ? void 0 : validators.required) !== undefined && field.default_value == null;
        });
        if (model.modular_block ||
            model.singleton ||
            unusableNameField ||
            unsatisfiedRequiredExtraFields.length > 0) {
            this.migrationModelConflict(migrationModelApiKey, model.id);
        }
    }
    assertExactMigrationItemType(model, migrationModelApiKey) {
        const exactItemType = model.name === 'Schema migration' &&
            model.api_key === migrationModelApiKey &&
            model.modular_block === false &&
            model.singleton === false &&
            model.sortable === false &&
            model.tree === false &&
            model.draft_mode_active === false &&
            model.draft_saving_active === false &&
            model.all_locales_required === false &&
            model.workflow === null;
        if (!exactItemType) {
            this.migrationModelConflict(migrationModelApiKey, model.id);
        }
    }
    migrationModelConflict(migrationModelApiKey, migrationModelId) {
        return this.error(`Configured migrations model "${migrationModelApiKey}" (${migrationModelId}) cannot safely track migration file names. It must be a regular, non-singleton model with one nonlocalized string field named "name" and no additional required field without a default. Fix the model or choose another --migrations-model value.`, { exit: 1 });
    }
}
Command.description = 'Run migration scripts that have not run yet';
Command.flags = {
    source: cli_utils_1.oclif.Flags.string({
        description: 'Specify the environment to fork',
    }),
    destination: cli_utils_1.oclif.Flags.string({
        description: 'Specify the name of the new forked environment',
        exclusive: ['in-place'],
    }),
    'in-place': cli_utils_1.oclif.Flags.boolean({
        description: 'Run the migrations in the --source environment, without forking',
        exclusive: ['destination'],
    }),
    'allow-primary': cli_utils_1.oclif.Flags.boolean({
        description: 'Allow running reviewed migrations in-place on the primary environment. There is no rollback if the run fails partway through',
        dependsOn: ['in-place'],
    }),
    'dry-run': cli_utils_1.oclif.Flags.boolean({
        description: 'Simulate the execution of the migrations, without making any actual change',
    }),
    'fast-fork': cli_utils_1.oclif.Flags.boolean({
        description: 'Run a fast fork. A fast fork reduces processing time, but it also prevents writing to the source environment during the process',
        dependsOn: ['destination'],
    }),
    force: cli_utils_1.oclif.Flags.boolean({
        description: 'Forces the start of a fast fork, even there are users currently editing records in the environment to copy',
        dependsOn: ['fast-fork'],
    }),
    'migrations-dir': cli_utils_1.oclif.Flags.string({
        description: 'Directory where script migrations are stored',
    }),
    'migrations-model': cli_utils_1.oclif.Flags.string({
        description: 'API key of the DatoCMS model used to store migration data',
    }),
    'migrations-tsconfig': cli_utils_1.oclif.Flags.string({
        description: 'Path of the tsconfig.json to use to run TS migrations scripts',
    }),
};
exports.default = Command;
