import { CmaClientCommand, oclif } from '@datocms/cli-utils';
import { generateContentDiffMigration } from '../../content-diff';
type MigrationFormat = 'js' | 'ts';
type UploadScope = 'all' | 'referenced';
type PublicInvalidContentSummary = {
    partial: boolean;
    detectedRecordCount: number;
    migratedRecordCount: number;
    skippedRecordCount: number;
    propagatedSkipCount: number;
    relaxedFieldCount: number;
    relaxedValidatorCount: number;
    requiresTemporaryValidatorRelaxation: boolean;
};
type PublicLegacyIdSummary = {
    detectedLegacyIdCount: number;
    legacyIdMappingCount: number;
    newLegacyIdMappingCount: number;
    skippedLegacyIdCount: number;
    mappingRecordCount: number;
    requiresLegacyIdRemapping: boolean;
};
export type ContentDiffCommandResult = {
    sourceEnvironmentId: string;
    destinationEnvironmentId: string;
    format: MigrationFormat;
    migrationFilePath: string;
    planFilePath: string;
    runtimeFilePath: string;
    assetsDirectoryPath?: string;
    summary: {
        counts: Record<string, number>;
        destructiveActionCount: number;
        warningCount: number;
        invalidContent: PublicInvalidContentSummary;
        legacyIds: PublicLegacyIdSummary;
    };
};
export default class ContentDiffCommand extends CmaClientCommand {
    static generateMigration: typeof generateContentDiffMigration;
    static description: string;
    static examples: {
        description: string;
        command: string;
    }[];
    static args: {
        NAME: oclif.Interfaces.Arg<string, Record<string, unknown>>;
    };
    static flags: {
        autogenerate: oclif.Interfaces.OptionFlag<string, oclif.Interfaces.CustomOptions>;
        'item-types': oclif.Interfaces.OptionFlag<string, oclif.Interfaces.CustomOptions>;
        uploads: oclif.Interfaces.OptionFlag<UploadScope, oclif.Interfaces.CustomOptions>;
        'include-deletions': oclif.Interfaces.BooleanFlag<boolean>;
        'bundle-assets': oclif.Interfaces.BooleanFlag<boolean>;
        'migrate-invalid-content': oclif.Interfaces.BooleanFlag<boolean>;
        ts: oclif.Interfaces.BooleanFlag<boolean>;
        js: oclif.Interfaces.BooleanFlag<boolean>;
    };
    run(): Promise<ContentDiffCommandResult>;
    private parseItemTypes;
    private resolveEnvironmentIds;
    private resolveMigrationFormat;
    private printHumanResult;
}
export {};
