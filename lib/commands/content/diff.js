"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const cli_utils_1 = require("@datocms/cli-utils");
const lodash_1 = require("lodash");
const datocms_version_1 = require("../../compat/datocms-version");
const content_diff_1 = require("../../content-diff");
const profile_auth_1 = require("../../utils/profile-auth");
class ContentDiffCommand extends cli_utils_1.CmaClientCommand {
    async init() {
        if (!hasDualProfileFlag(this.argv)) {
            await super.init();
            return;
        }
        const initializeDatoConfig = Reflect.get(cli_utils_1.DatoConfigCommand.prototype, 'init');
        await Reflect.apply(initializeDatoConfig, this, []);
    }
    async run() {
        var _b, _c, _d;
        (0, datocms_version_1.assertSupportedDatocmsCli)(this);
        const { args: { NAME: name }, flags, } = await this.parse(_a);
        const globalFlags = flags;
        const dualProfileSelection = this.resolveDualProfileSelection({
            sourceProfile: flags['source-profile'],
            destinationProfile: flags['destination-profile'],
            sourceApiToken: globalFlags['source-api-token'],
            destinationApiToken: globalFlags['destination-api-token'],
            legacyProfile: globalFlags.profile,
            legacyApiToken: globalFlags['api-token'],
        });
        let sourceRootClient;
        let destinationRootClient;
        let sourceEnvironmentClient;
        let destinationEnvironmentClient;
        let sourceMigrationsModelApiKey;
        let destinationMigrationsModelApiKey;
        let destinationMigrations;
        let sourceEnvironments;
        let destinationEnvironments;
        let sourceEnvironmentId;
        let destinationEnvironmentId;
        if (dualProfileSelection) {
            const [sourceEndpoint, destinationEndpoint] = await Promise.all([
                this.buildProfileEndpoint({
                    profileId: dualProfileSelection.sourceProfile,
                    explicitApiToken: dualProfileSelection.sourceApiToken,
                    endpointTokenFlag: '--source-api-token',
                    json: Boolean(globalFlags.json),
                    baseUrl: globalFlags['base-url'],
                    logLevel: globalFlags['log-level'],
                    logMode: globalFlags['log-mode'],
                }),
                this.buildProfileEndpoint({
                    profileId: dualProfileSelection.destinationProfile,
                    explicitApiToken: dualProfileSelection.destinationApiToken,
                    endpointTokenFlag: '--destination-api-token',
                    json: Boolean(globalFlags.json),
                    baseUrl: globalFlags['base-url'],
                    logLevel: globalFlags['log-level'],
                    logMode: globalFlags['log-mode'],
                }),
            ]);
            sourceRootClient = sourceEndpoint.rootClient;
            destinationRootClient = destinationEndpoint.rootClient;
            [sourceEnvironments, destinationEnvironments] = await Promise.all([
                sourceRootClient.environments.list(),
                destinationRootClient.environments.list(),
            ]);
            ({ sourceEnvironmentId, destinationEnvironmentId } =
                this.resolveEnvironmentIds(flags.autogenerate, sourceEnvironments, destinationEnvironments, true));
            sourceEnvironmentClient =
                sourceEndpoint.buildEnvironmentClient(sourceEnvironmentId);
            destinationEnvironmentClient = destinationEndpoint.buildEnvironmentClient(destinationEnvironmentId);
            sourceMigrationsModelApiKey =
                ((_b = sourceEndpoint.profileConfig.migrations) === null || _b === void 0 ? void 0 : _b.modelApiKey) ||
                    'schema_migration';
            destinationMigrationsModelApiKey =
                ((_c = destinationEndpoint.profileConfig.migrations) === null || _c === void 0 ? void 0 : _c.modelApiKey) ||
                    'schema_migration';
            destinationMigrations = destinationEndpoint.profileConfig.migrations;
        }
        else {
            this.requireDatoProfileConfig();
            sourceRootClient = this.client;
            destinationRootClient = this.client;
            sourceEnvironments = await this.client.environments.list();
            destinationEnvironments = sourceEnvironments;
            ({ sourceEnvironmentId, destinationEnvironmentId } =
                this.resolveEnvironmentIds(flags.autogenerate, sourceEnvironments, destinationEnvironments, false));
            [sourceEnvironmentClient, destinationEnvironmentClient] =
                await Promise.all([
                    this.buildClient({ environment: sourceEnvironmentId }),
                    this.buildClient({ environment: destinationEnvironmentId }),
                ]);
            sourceMigrationsModelApiKey =
                ((_d = this.datoProfileConfig.migrations) === null || _d === void 0 ? void 0 : _d.modelApiKey) || 'schema_migration';
            destinationMigrationsModelApiKey = sourceMigrationsModelApiKey;
            destinationMigrations = this.datoProfileConfig.migrations;
        }
        const migrationsDirectory = (destinationMigrations === null || destinationMigrations === void 0 ? void 0 : destinationMigrations.directory)
            ? (0, node_path_1.resolve)((0, node_path_1.dirname)(this.datoConfigPath), destinationMigrations.directory)
            : (0, node_path_1.resolve)('./migrations');
        const format = await this.resolveMigrationFormat({
            forceJavaScript: flags.js,
            forceTypeScript: flags.ts,
            migrationsTsconfig: destinationMigrations === null || destinationMigrations === void 0 ? void 0 : destinationMigrations.tsconfig,
        });
        const itemTypes = this.parseItemTypes(flags['item-types']);
        const migrationFilePath = (0, node_path_1.join)(migrationsDirectory, `${Math.floor(Date.now() / 1000)}_${(0, lodash_1.camelCase)(name)}.${format}`);
        this.startSpinner(`Comparing content from "${sourceEnvironmentId}" to "${destinationEnvironmentId}"`);
        try {
            const generated = await _a.generateMigration({
                source: {
                    rootClient: sourceRootClient,
                    environmentClient: sourceEnvironmentClient,
                    environmentId: sourceEnvironmentId,
                    migrationsModelApiKey: sourceMigrationsModelApiKey,
                    contentDiffModelApiKey: 'datocms_content_diff',
                },
                destination: {
                    rootClient: destinationRootClient,
                    environmentClient: destinationEnvironmentClient,
                    environmentId: destinationEnvironmentId,
                    migrationsModelApiKey: destinationMigrationsModelApiKey,
                    contentDiffModelApiKey: 'datocms_content_diff',
                },
                migrationFilePath,
                format,
                options: {
                    itemTypes,
                    uploads: flags.uploads,
                    includeDeletions: flags['include-deletions'],
                    bundleAssets: flags['bundle-assets'],
                    migrateInvalidContent: flags['migrate-invalid-content'],
                },
            });
            this.stopSpinner();
            const humanSummary = normalizeSummary(generated.summary);
            const result = {
                sourceEnvironmentId: generated.sourceEnvironmentId,
                destinationEnvironmentId: generated.destinationEnvironmentId,
                format: generated.format,
                migrationFilePath: generated.migrationPath,
                planFilePath: generated.planPath,
                runtimeFilePath: generated.runtimePath,
                ...(generated.assetsPath
                    ? { assetsDirectoryPath: generated.assetsPath }
                    : {}),
                summary: {
                    counts: humanSummary.counts,
                    destructiveActionCount: humanSummary.destructiveActions.length,
                    warningCount: humanSummary.warnings.length,
                    invalidContent: toPublicInvalidContentSummary(humanSummary.invalidContent),
                    legacyIds: toPublicLegacyIdSummary(humanSummary),
                },
            };
            this.printHumanResult(result, humanSummary);
            return result;
        }
        catch (error) {
            this.stopSpinnerWithFailure();
            if (error instanceof content_diff_1.ContentDiffError &&
                error.code === 'ENVIRONMENT_SEMANTICS_MISMATCH') {
                this.error([
                    `Incompatible environment activation/settings: cannot generate content migration ${JSON.stringify(name)} from "${sourceEnvironmentId}" to "${destinationEnvironmentId}" because content serialization or validation semantics differ.`,
                    'No content records were read and no migration artifacts were created.',
                    'Align the destination timezone and product-update activations with the source, or create a fresh destination fork from an environment with matching settings, then regenerate the content diff.',
                    'Schema autogeneration alone may not repair activation mismatches.',
                    '--migrate-invalid-content does not bypass environment compatibility.',
                ].join('\n'));
            }
            if (error instanceof content_diff_1.ContentDiffError &&
                error.code === 'SCHEMA_MISMATCH') {
                if (dualProfileSelection) {
                    this.error([
                        `Incompatible schema: cannot generate content migration ${JSON.stringify(name)} from "${sourceEnvironmentId}" to "${destinationEnvironmentId}" because the projects' managed schemas differ.`,
                        'No content records were read and no migration artifacts were created.',
                        'Apply the shared, checked-in schema migration history to the destination project, then regenerate the content diff.',
                        'Schema autogeneration currently compares environments within one project and cannot repair cross-project drift.',
                        '--migrate-invalid-content only handles supported invalid or historical-null content; it does not bypass schema compatibility.',
                    ].join('\n'));
                }
                const schemaReadyEnvironmentId = `${destinationEnvironmentId}-schema-ready`;
                this.error([
                    `Incompatible schema: cannot generate content migration ${JSON.stringify(name)} from "${sourceEnvironmentId}" to "${destinationEnvironmentId}" because their managed schemas differ.`,
                    'No content records were read and no migration artifacts were created.',
                    'Generate the schema migration first:',
                    `  datocms migrations:new ${JSON.stringify(`sync ${sourceEnvironmentId} schema`)} --autogenerate=${JSON.stringify(`${sourceEnvironmentId}:${destinationEnvironmentId}`)}`,
                    'Apply it to a fork of the destination:',
                    `  datocms migrations:run --source=${JSON.stringify(destinationEnvironmentId)} --destination=${JSON.stringify(schemaReadyEnvironmentId)}`,
                    'Then regenerate the content diff against that schema-ready fork:',
                    `  datocms content:diff ${JSON.stringify(name)} --autogenerate=${JSON.stringify(`${sourceEnvironmentId}:${schemaReadyEnvironmentId}`)}`,
                    '--migrate-invalid-content only handles supported invalid or historical-null content; it does not bypass schema compatibility.',
                ].join('\n'));
            }
            throw error;
        }
    }
    parseItemTypes(rawItemTypes) {
        if (rawItemTypes === 'all') {
            return 'all';
        }
        const itemTypes = Array.from(new Set(rawItemTypes
            .split(',')
            .map((itemType) => itemType.trim())
            .filter(Boolean)));
        if (itemTypes.length === 0 || itemTypes.includes('all')) {
            this.error('--item-types must be "all" or a comma-separated list of item type API keys');
        }
        return itemTypes;
    }
    resolveDualProfileSelection({ sourceProfile, destinationProfile, sourceApiToken, destinationApiToken, legacyProfile, legacyApiToken, }) {
        const hasDualProfileOption = Boolean(sourceProfile ||
            destinationProfile ||
            sourceApiToken ||
            destinationApiToken);
        if (!hasDualProfileOption) {
            return undefined;
        }
        if (!sourceProfile || !destinationProfile) {
            this.error('--source-profile and --destination-profile must be provided together');
        }
        if (legacyProfile || legacyApiToken) {
            this.error('--profile and --api-token cannot be combined with --source-profile, --destination-profile, --source-api-token, or --destination-api-token');
        }
        return {
            sourceProfile,
            destinationProfile,
            ...(sourceApiToken ? { sourceApiToken } : {}),
            ...(destinationApiToken ? { destinationApiToken } : {}),
        };
    }
    async buildProfileEndpoint({ profileId, explicitApiToken, endpointTokenFlag, json, baseUrl, logLevel, logMode, }) {
        this.requireDatoConfig();
        const profileConfig = this.datoConfig.profiles[profileId];
        if (!profileConfig) {
            this.error(`Requested profile "${profileId}" is not defined in config file "${this.datoConfigRelativePath}"`, {
                suggestions: [
                    `Configure it with "${this.config.bin} profile:set ${profileId}"`,
                ],
            });
        }
        const resolveLinkedSiteToken = (siteId, organizationId) => _a.resolveLinkedSiteToken(this, siteId, organizationId);
        const { apiToken, environmentName } = await (0, profile_auth_1.resolveProfileApiToken)({
            explicitApiToken,
            profileConfig,
            profileId,
            resolveLinkedSiteToken,
        });
        if (!apiToken) {
            this.error(`Cannot find an API token for profile "${profileId}" to call DatoCMS!`, {
                suggestions: [
                    `Provide ${endpointTokenFlag}`,
                    `Link profile "${profileId}" to a project with "${this.config.bin} link --profile=${profileId}" (requires "${this.config.bin} login" first)`,
                    `Set the ${environmentName} environment variable (we look inside .env.local and .env too)`,
                ],
            });
        }
        const profileLogLevel = logLevel || profileConfig.logLevel;
        const profileLogMode = logMode || profileConfig.logMode;
        const clientOptions = {
            apiToken,
            ...(baseUrl || profileConfig.baseUrl
                ? { baseUrl: baseUrl || profileConfig.baseUrl }
                : {}),
            logLevel: json || !profileLogLevel
                ? cli_utils_1.CmaClient.LogLevel.NONE
                : cli_utils_1.logLevelMap[profileLogLevel],
            logFn: this.buildApiLogFunction(profileLogMode, [apiToken]),
        };
        return {
            profileConfig,
            rootClient: _a.buildProfileClient(clientOptions),
            buildEnvironmentClient: (environmentId) => _a.buildProfileClient({
                ...clientOptions,
                environment: environmentId,
            }),
        };
    }
    buildApiLogFunction(logMode, secrets = []) {
        return (rawMessage) => {
            const message = secrets.reduce((redacted, secret) => secret ? redacted.split(secret).join('[REDACTED]') : redacted, rawMessage);
            if (logMode === 'directory') {
                const match = message.match(/^\[([^\]]+)\]/);
                if (!match) {
                    return;
                }
                const logDirectory = './api-calls';
                if (!(0, node_fs_1.existsSync)(logDirectory)) {
                    (0, node_fs_1.mkdirSync)(logDirectory, { recursive: true });
                }
                (0, node_fs_1.appendFileSync)((0, node_path_1.join)(logDirectory, `${match[1]}.log`), `${message}\n`, {
                    encoding: 'utf8',
                });
            }
            else if (logMode === 'file') {
                (0, node_fs_1.appendFileSync)('./api-calls.log', `${message}\n`, {
                    encoding: 'utf8',
                });
            }
            else {
                this.log(message);
            }
        };
    }
    resolveEnvironmentIds(rawAutogenerate, sourceEnvironments, destinationEnvironments, allowMatchingEnvironmentIds) {
        const parts = rawAutogenerate.split(':');
        if (parts.length > 2 || !parts[0] || (parts.length === 2 && !parts[1])) {
            this.error('--autogenerate must use the format SOURCE or SOURCE:DESTINATION');
        }
        const sourceEnvironmentId = parts[0];
        const primaryEnvironment = destinationEnvironments.find((environment) => environment.meta.primary);
        const destinationEnvironmentId = parts[1] || (primaryEnvironment === null || primaryEnvironment === void 0 ? void 0 : primaryEnvironment.id);
        if (!destinationEnvironmentId) {
            this.error('Cannot determine the primary environment');
        }
        if (!sourceEnvironments.some((environment) => environment.id === sourceEnvironmentId)) {
            this.error(`Environment "${sourceEnvironmentId}" does not exist`);
        }
        if (!destinationEnvironments.some((environment) => environment.id === destinationEnvironmentId)) {
            this.error(`Environment "${destinationEnvironmentId}" does not exist`);
        }
        if (!allowMatchingEnvironmentIds &&
            sourceEnvironmentId === destinationEnvironmentId) {
            this.error('Source and destination environments must be different');
        }
        return { sourceEnvironmentId, destinationEnvironmentId };
    }
    async resolveMigrationFormat({ forceJavaScript, forceTypeScript, migrationsTsconfig, }) {
        if (forceJavaScript) {
            return 'js';
        }
        if (forceTypeScript || migrationsTsconfig) {
            return 'ts';
        }
        try {
            await findNearestFile('tsconfig.json');
            return 'ts';
        }
        catch {
            return 'js';
        }
    }
    printHumanResult(result, summary) {
        var _b;
        if (this.jsonEnabled()) {
            return;
        }
        this.log(`Content diff: ${result.sourceEnvironmentId} -> ${result.destinationEnvironmentId}`);
        this.log(`Migration: ${(0, node_path_1.relative)(process.cwd(), result.migrationFilePath)}`);
        this.log(`Plan: ${(0, node_path_1.relative)(process.cwd(), result.planFilePath)}`);
        this.log(`Runtime: ${(0, node_path_1.relative)(process.cwd(), result.runtimeFilePath)}`);
        if (result.assetsDirectoryPath) {
            this.log(`Assets: ${(0, node_path_1.relative)(process.cwd(), result.assetsDirectoryPath)}`);
        }
        if (summary.invalidContent.requiresTemporaryValidatorRelaxation) {
            this.warn(`TEMPORARY VALIDATOR RELAXATION: this migration will relax ${summary.invalidContent.relaxedValidatorCount} validator${summary.invalidContent.relaxedValidatorCount === 1 ? '' : 's'} across ${summary.invalidContent.relaxedFieldCount} field${summary.invalidContent.relaxedFieldCount === 1 ? '' : 's'} while migrating ${summary.invalidContent.migratedRecords} invalid record${summary.invalidContent.migratedRecords === 1 ? '' : 's'}.`);
            this.warn('RESIDUAL RISK: if execution stops after schema relaxation, validators can remain relaxed until this same migration is rerun successfully. There is no cross-resource rollback. Running on primary additionally requires migrations:run --in-place --allow-primary.');
        }
        if (summary.legacyIdMappings.length > 0) {
            const newCount = summary.legacyIdMappings.filter(({ status }) => status === 'new').length;
            this.warn(`LEGACY ID REMAPPING: ${summary.legacyIdMappings.length} legacy identifier${summary.legacyIdMappings.length === 1 ? '' : 's'} detected. Legacy IDs cannot be preserved. This migration will assign new IDs and persist aliases in the datocms_content_diff model. External consumers using the old IDs must be updated. ${newCount} new mapping${newCount === 1 ? '' : 's'} will be saved in the append-only ledger before content writes.`);
        }
        if (summary.skippedLegacyIdMappings.length > 0) {
            this.warn(`LEGACY IDS SKIPPED: ${summary.skippedLegacyIdMappings.length} legacy identifier${summary.skippedLegacyIdMappings.length === 1 ? '' : 's'} belonged only to skipped content. These entities will not be migrated, and no new alias reservations will be written for them.`);
        }
        if (summary.invalidContent.skippedRecords > 0) {
            this.warn(`PARTIAL CONTENT DIFF: ${summary.invalidContent.skippedRecords} top-level record aggregate${summary.invalidContent.skippedRecords === 1 ? ' was' : 's were'} skipped. Review the diagnostics below before running the migration.`);
        }
        this.log('Changes:');
        const counts = Object.entries(summary.counts).filter(([, count]) => count > 0);
        if (counts.length === 0) {
            this.log('  none');
        }
        else {
            for (const [change, count] of counts) {
                this.log(`  ${change}: ${count}`);
            }
        }
        if (summary.records.length > 0) {
            this.log('Records:');
            for (const record of summary.records) {
                this.log(`  ${record.action} ${record.itemTypeId}/${record.id}`);
            }
        }
        if (summary.uploads.length > 0) {
            this.log('Uploads:');
            for (const upload of summary.uploads) {
                this.log(`  ${upload.action} ${upload.id}`);
            }
        }
        if (summary.skippedRecords.length > 0) {
            this.log('Skipped records:');
            for (const record of summary.skippedRecords) {
                for (const reason of record.reasons) {
                    this.log(`  model=${record.itemTypeId} id=${record.id} slice=${(_b = reason.slice) !== null && _b !== void 0 ? _b : 'aggregate'} reason=${reason.code}`);
                    this.log(`    dependency chain: ${reason.dependencyChain.length > 0
                        ? reason.dependencyChain.join(' -> ')
                        : 'none'}`);
                }
            }
        }
        if (summary.validatorRelaxations.length > 0) {
            this.log('Validator relaxations:');
            for (const relaxation of summary.validatorRelaxations) {
                this.log(`  model=${relaxation.itemTypeId} field=${relaxation.fieldId} validators=${relaxation.relaxedValidatorKeys.join(',') || 'none'} records=${relaxation.affectedRecordIds.join(',') || 'none'}`);
            }
        }
        if (summary.legacyIdMappings.length > 0) {
            this.log('Legacy ID mappings:');
            for (const mapping of summary.legacyIdMappings) {
                this.log(`  ${mapping.entityType} ${mapping.sourceId} -> ${mapping.targetId} (${mapping.status})`);
            }
        }
        if (summary.skippedLegacyIdMappings.length > 0) {
            this.log('Skipped legacy IDs (not migrated):');
            for (const diagnostic of summary.skippedLegacyIdMappings) {
                this.log(`  ${diagnostic.entityType} ${diagnostic.sourceId}: ${diagnostic.reason}`);
            }
        }
        if (summary.destructiveActions.length > 0) {
            this.log('Destructive actions:');
            for (const action of summary.destructiveActions) {
                this.log(`  ${action}`);
            }
        }
        if (summary.warnings.length > 0) {
            this.log('Warnings:');
            for (const warning of summary.warnings) {
                this.log(`  ${warning}`);
            }
        }
    }
}
_a = ContentDiffCommand;
ContentDiffCommand.generateMigration = content_diff_1.generateContentDiffMigration;
ContentDiffCommand.buildProfileClient = (config) => cli_utils_1.CmaClient.buildClient(config);
ContentDiffCommand.resolveLinkedSiteToken = async (command, siteId, organizationId) => {
    const resolver = Reflect.get(command, 'resolveTokenFromSiteId');
    return Reflect.apply(resolver, command, [siteId, organizationId]);
};
ContentDiffCommand.description = 'Generate a content migration by comparing two DatoCMS environments';
ContentDiffCommand.examples = [
    {
        description: 'Generate a migration from staging to the primary environment',
        command: '<%= config.bin %> <%= command.id %> "sync staging content" --autogenerate=staging',
    },
    {
        description: 'Generate a migration from one environment to another',
        command: '<%= config.bin %> <%= command.id %> "sync content" --autogenerate=source:destination',
    },
    {
        description: 'Include every upload and destructive cleanup',
        command: '<%= config.bin %> <%= command.id %> "mirror content" --autogenerate=source:destination --uploads=all --include-deletions',
    },
    {
        description: 'Migrate eligible invalid or historical-null content using temporary schema changes',
        command: '<%= config.bin %> <%= command.id %> "sync invalid content" --autogenerate=source:destination --migrate-invalid-content',
    },
    {
        description: 'Generate a migration across projects that share aligned public IDs',
        command: '<%= config.bin %> <%= command.id %> "sync shared content" --source-profile=source_project --destination-profile=destination_project --autogenerate=main:main',
    },
];
ContentDiffCommand.args = {
    NAME: cli_utils_1.oclif.Args.string({
        description: 'The name to give to the generated migration',
        required: true,
    }),
};
ContentDiffCommand.flags = {
    ...cli_utils_1.CmaClientCommand.flags,
    autogenerate: cli_utils_1.oclif.Flags.string({
        description: 'Generate a migration from SOURCE to DESTINATION. When DESTINATION is omitted, the primary environment is used (for example, --autogenerate=staging or --autogenerate=staging:production)',
        required: true,
    }),
    'source-profile': cli_utils_1.oclif.Flags.string({
        description: 'Read content from this configured profile (must be used with --destination-profile)',
    }),
    'destination-profile': cli_utils_1.oclif.Flags.string({
        description: 'Compare and generate for this configured profile (must be used with --source-profile)',
    }),
    'source-api-token': cli_utils_1.oclif.Flags.string({
        description: 'Specify a custom API key for --source-profile instead of its configured authentication',
    }),
    'destination-api-token': cli_utils_1.oclif.Flags.string({
        description: 'Specify a custom API key for --destination-profile instead of its configured authentication',
    }),
    'item-types': cli_utils_1.oclif.Flags.string({
        description: 'Item type API keys to include, separated by commas, or "all"',
        default: 'all',
    }),
    uploads: cli_utils_1.oclif.Flags.custom({
        description: 'Include uploads referenced by selected content or every upload',
        options: ['referenced', 'all'],
        default: 'referenced',
    })(),
    'include-deletions': cli_utils_1.oclif.Flags.boolean({
        description: 'Include deletion of destination-only records and unused uploads in scope',
        default: false,
    }),
    'bundle-assets': cli_utils_1.oclif.Flags.boolean({
        description: 'Download upload binaries beside the generated migration instead of transferring them from source URLs at runtime',
        default: false,
    }),
    'migrate-invalid-content': cli_utils_1.oclif.Flags.boolean({
        description: 'Migrate eligible invalid or historical-null content with exact temporary validator relaxation or create-time field-default suppression; unsupported records are skipped and reported',
        default: false,
    }),
    ts: cli_utils_1.oclif.Flags.boolean({
        description: 'Force a TypeScript migration',
        exclusive: ['js'],
    }),
    js: cli_utils_1.oclif.Flags.boolean({
        description: 'Force a JavaScript migration',
        exclusive: ['ts'],
    }),
};
exports.default = ContentDiffCommand;
function toPublicInvalidContentSummary(summary) {
    return {
        partial: summary.status === 'partial',
        detectedRecordCount: summary.detectedRecords,
        migratedRecordCount: summary.migratedRecords,
        skippedRecordCount: summary.skippedRecords,
        propagatedSkipCount: summary.propagatedSkipCount,
        relaxedFieldCount: summary.relaxedFieldCount,
        relaxedValidatorCount: summary.relaxedValidatorCount,
        requiresTemporaryValidatorRelaxation: summary.requiresTemporaryValidatorRelaxation,
    };
}
function toPublicLegacyIdSummary(summary) {
    var _b;
    const newLegacyIdMappingCount = summary.legacyIdMappings.filter(({ status }) => status === 'new').length;
    return {
        detectedLegacyIdCount: summary.legacyIdMappings.length + summary.skippedLegacyIdMappings.length,
        legacyIdMappingCount: summary.legacyIdMappings.length,
        newLegacyIdMappingCount,
        skippedLegacyIdCount: summary.skippedLegacyIdMappings.length,
        mappingRecordCount: summary.legacyIdMappings.length
            ? (_b = summary.counts['legacyIdMappings.records']) !== null && _b !== void 0 ? _b : 0
            : 0,
        requiresLegacyIdRemapping: summary.legacyIdMappings.length > 0,
    };
}
function normalizeSummary(summary) {
    return {
        counts: Object.fromEntries(Object.entries(summary.counts).sort(([left], [right]) => left.localeCompare(right))),
        records: [...summary.records].sort((left, right) => left.itemTypeId.localeCompare(right.itemTypeId) ||
            left.id.localeCompare(right.id) ||
            left.action.localeCompare(right.action)),
        uploads: [...summary.uploads].sort((left, right) => left.id.localeCompare(right.id) ||
            left.action.localeCompare(right.action)),
        invalidContent: { ...summary.invalidContent },
        skippedRecords: summary.skippedRecords
            .map((record) => ({
            ...record,
            reasons: [...record.reasons].sort((left, right) => {
                var _b, _c, _d, _e;
                return ((_b = left.slice) !== null && _b !== void 0 ? _b : '').localeCompare((_c = right.slice) !== null && _c !== void 0 ? _c : '') ||
                    left.code.localeCompare(right.code) ||
                    ((_d = left.dependencyId) !== null && _d !== void 0 ? _d : '').localeCompare((_e = right.dependencyId) !== null && _e !== void 0 ? _e : '') ||
                    left.dependencyChain
                        .join('\0')
                        .localeCompare(right.dependencyChain.join('\0'));
            }),
        }))
            .sort((left, right) => left.itemTypeId.localeCompare(right.itemTypeId) ||
            left.id.localeCompare(right.id) ||
            left.disposition.localeCompare(right.disposition)),
        validatorRelaxations: summary.validatorRelaxations
            .map((relaxation) => ({
            ...relaxation,
            relaxedValidatorKeys: [...relaxation.relaxedValidatorKeys].sort(),
            affectedRecordIds: [...relaxation.affectedRecordIds].sort(),
        }))
            .sort((left, right) => left.itemTypeId.localeCompare(right.itemTypeId) ||
            left.fieldId.localeCompare(right.fieldId)),
        legacyIdMappings: [...summary.legacyIdMappings].sort((left, right) => left.entityType.localeCompare(right.entityType) ||
            left.sourceId.localeCompare(right.sourceId)),
        skippedLegacyIdMappings: [...summary.skippedLegacyIdMappings].sort((left, right) => left.entityType.localeCompare(right.entityType) ||
            left.sourceId.localeCompare(right.sourceId) ||
            left.reason.localeCompare(right.reason)),
        destructiveActions: [...summary.destructiveActions].sort(),
        warnings: [...summary.warnings].sort(),
    };
}
async function findNearestFile(fileName, directoryPath = (0, node_path_1.resolve)()) {
    const path = (0, node_path_1.join)(directoryPath, fileName);
    try {
        await (0, promises_1.access)(path);
        return path;
    }
    catch {
        const parentDirectoryPath = (0, node_path_1.dirname)(directoryPath);
        if (parentDirectoryPath === directoryPath) {
            throw new Error(`No "${fileName}" file found`);
        }
        return findNearestFile(fileName, parentDirectoryPath);
    }
}
function hasDualProfileFlag(argv) {
    return argv.some((argument) => [
        '--source-profile',
        '--destination-profile',
        '--source-api-token',
        '--destination-api-token',
    ].some((flag) => argument === flag || argument.startsWith(`${flag}=`)));
}
