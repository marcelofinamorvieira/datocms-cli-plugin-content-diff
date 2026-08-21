"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const cli_utils_1 = require("@datocms/cli-utils");
const lodash_1 = require("lodash");
const datocms_version_1 = require("../../compat/datocms-version");
const content_diff_1 = require("../../content-diff");
class ContentDiffCommand extends cli_utils_1.CmaClientCommand {
    async run() {
        (0, datocms_version_1.assertSupportedDatocmsCli)(this);
        const { args: { NAME: name }, flags, } = await this.parse(ContentDiffCommand);
        this.requireDatoProfileConfig();
        const environments = await this.client.environments.list();
        const { sourceEnvironmentId, destinationEnvironmentId } = this.resolveEnvironmentIds(flags.autogenerate, environments);
        const migrations = this.datoProfileConfig.migrations;
        const migrationsDirectory = (migrations === null || migrations === void 0 ? void 0 : migrations.directory)
            ? (0, node_path_1.resolve)((0, node_path_1.dirname)(this.datoConfigPath), migrations.directory)
            : (0, node_path_1.resolve)('./migrations');
        const format = await this.resolveMigrationFormat({
            forceJavaScript: flags.js,
            forceTypeScript: flags.ts,
            migrationsTsconfig: migrations === null || migrations === void 0 ? void 0 : migrations.tsconfig,
        });
        const itemTypes = this.parseItemTypes(flags['item-types']);
        const migrationFilePath = (0, node_path_1.join)(migrationsDirectory, `${Math.floor(Date.now() / 1000)}_${(0, lodash_1.camelCase)(name)}.${format}`);
        this.startSpinner(`Comparing content from "${sourceEnvironmentId}" to "${destinationEnvironmentId}"`);
        try {
            const generated = await ContentDiffCommand.generateMigration({
                client: this.client,
                buildClientForEnvironment: (environment) => this.buildClient({ environment }),
                sourceEnvironmentId,
                destinationEnvironmentId,
                migrationFilePath,
                format,
                options: {
                    itemTypes,
                    uploads: flags.uploads,
                    includeDeletions: flags['include-deletions'],
                    bundleAssets: flags['bundle-assets'],
                    migrateInvalidContent: flags['migrate-invalid-content'],
                    migrationsModelApiKey: (migrations === null || migrations === void 0 ? void 0 : migrations.modelApiKey) || 'schema_migration',
                    contentDiffModelApiKey: 'datocms_content_diff',
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
    resolveEnvironmentIds(rawAutogenerate, environments) {
        const parts = rawAutogenerate.split(':');
        if (parts.length > 2 || !parts[0] || (parts.length === 2 && !parts[1])) {
            this.error('--autogenerate must use the format SOURCE or SOURCE:DESTINATION');
        }
        const sourceEnvironmentId = parts[0];
        const primaryEnvironment = environments.find((environment) => environment.meta.primary);
        const destinationEnvironmentId = parts[1] || (primaryEnvironment === null || primaryEnvironment === void 0 ? void 0 : primaryEnvironment.id);
        if (!destinationEnvironmentId) {
            this.error('Cannot determine the primary environment');
        }
        if (!environments.some((environment) => environment.id === sourceEnvironmentId)) {
            this.error(`Environment "${sourceEnvironmentId}" does not exist`);
        }
        if (!environments.some((environment) => environment.id === destinationEnvironmentId)) {
            this.error(`Environment "${destinationEnvironmentId}" does not exist`);
        }
        if (sourceEnvironmentId === destinationEnvironmentId) {
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
        var _a;
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
                    this.log(`  model=${record.itemTypeId} id=${record.id} slice=${(_a = reason.slice) !== null && _a !== void 0 ? _a : 'aggregate'} reason=${reason.code}`);
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
ContentDiffCommand.generateMigration = content_diff_1.generateContentDiffMigration;
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
    var _a;
    const newLegacyIdMappingCount = summary.legacyIdMappings.filter(({ status }) => status === 'new').length;
    return {
        detectedLegacyIdCount: summary.legacyIdMappings.length + summary.skippedLegacyIdMappings.length,
        legacyIdMappingCount: summary.legacyIdMappings.length,
        newLegacyIdMappingCount,
        skippedLegacyIdCount: summary.skippedLegacyIdMappings.length,
        mappingRecordCount: summary.legacyIdMappings.length
            ? (_a = summary.counts['legacyIdMappings.records']) !== null && _a !== void 0 ? _a : 0
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
                var _a, _b, _c, _d;
                return ((_a = left.slice) !== null && _a !== void 0 ? _a : '').localeCompare((_b = right.slice) !== null && _b !== void 0 ? _b : '') ||
                    left.code.localeCompare(right.code) ||
                    ((_c = left.dependencyId) !== null && _c !== void 0 ? _c : '').localeCompare((_d = right.dependencyId) !== null && _d !== void 0 ? _d : '') ||
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
