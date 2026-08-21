import { CmaClient, CmaClientCommand, oclif } from '@datocms/cli-utils';
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
    static buildProfileClient: (config: CmaClient.ClientConfigOptions) => CmaClient.Client;
    static resolveLinkedSiteToken: (command: ContentDiffCommand, siteId: string, organizationId?: string) => Promise<string | undefined>;
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
        'source-profile': oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
        'destination-profile': oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
        'source-api-token': oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
        'destination-api-token': oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
        'item-types': oclif.Interfaces.OptionFlag<string, oclif.Interfaces.CustomOptions>;
        uploads: oclif.Interfaces.OptionFlag<UploadScope, oclif.Interfaces.CustomOptions>;
        'include-deletions': oclif.Interfaces.BooleanFlag<boolean>;
        'bundle-assets': oclif.Interfaces.BooleanFlag<boolean>;
        'migrate-invalid-content': oclif.Interfaces.BooleanFlag<boolean>;
        ts: oclif.Interfaces.BooleanFlag<boolean>;
        js: oclif.Interfaces.BooleanFlag<boolean>;
    };
    protected init(): Promise<void>;
    run(): Promise<ContentDiffCommandResult>;
    private parseItemTypes;
    private resolveDualProfileSelection;
    private buildProfileEndpoint;
    private buildApiLogFunction;
    private resolveEnvironmentIds;
    private resolveMigrationFormat;
    private printHumanResult;
}
export {};
