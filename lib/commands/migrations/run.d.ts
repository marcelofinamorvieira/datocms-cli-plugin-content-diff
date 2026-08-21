import { CmaClientCommand, oclif } from '@datocms/cli-utils';
/**
 * Protocol understood by generated content-diff migration entrypoints.
 *
 * Ordinary migrations can ignore this additional context property. Generated
 * content-diff migrations use it to fail closed when invoked by a CLI runner
 * that predates their execution-safety contract.
 */
export declare const CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION: 1;
export type MigrationExecutionContext = Readonly<{
    environmentId: string;
    inPlace: boolean;
    allowPrimary: boolean;
    contentDiffProtocolVersion: typeof CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION;
}>;
export default class Command extends CmaClientCommand {
    static description: string;
    static flags: {
        source: oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
        destination: oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
        'in-place': oclif.Interfaces.BooleanFlag<boolean>;
        'allow-primary': oclif.Interfaces.BooleanFlag<boolean>;
        'dry-run': oclif.Interfaces.BooleanFlag<boolean>;
        'fast-fork': oclif.Interfaces.BooleanFlag<boolean>;
        force: oclif.Interfaces.BooleanFlag<boolean>;
        'migrations-dir': oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
        'migrations-model': oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
        'migrations-tsconfig': oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
    };
    private registeredTsNode?;
    run(): Promise<{
        environmentId: string;
        runMigrationScripts: string[];
    }>;
    private runMigrationScript;
    private migrationScriptsToRun;
    private forkEnvironment;
    private fetchAlreadyRunMigrationScripts;
    private upsertMigrationModel;
    private migrationModelHasRecords;
    private createMigrationModel;
    private createMigrationModelNameField;
    private assertExactMigrationModel;
    private assertUsableExistingMigrationModel;
    private assertExactMigrationItemType;
    private migrationModelConflict;
}
