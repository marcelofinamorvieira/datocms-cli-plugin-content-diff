import type { CmaClient } from '@datocms/cli-utils';
import type { BuildContentDiffPlanOptions, ContentDiffPlan, ContentSnapshot, DeleteReleaseStep, InvalidContentDiagnostic, ItemTypeSelection, JsonObject, UploadSelection } from './types';
export type ContentDiffMigrationSummary = {
    counts: Record<string, number>;
    records: Array<{
        id: string;
        itemTypeId: string;
        action: string;
    }>;
    uploads: Array<{
        id: string;
        action: string;
    }>;
    destructiveActions: string[];
    warnings: string[];
    invalidContent: ContentDiffPlan['summary']['invalidContent'];
    skippedRecords: Array<{
        id: string;
        itemTypeId: string;
        disposition: string;
        reasons: Array<{
            code: string;
            slice: string | null;
            dependencyId?: string;
            dependencyChain: string[];
        }>;
    }>;
    validatorRelaxations: Array<{
        fieldId: string;
        itemTypeId: string;
        relaxedValidatorKeys: string[];
        affectedRecordIds: string[];
    }>;
    legacyIdMappings: Array<{
        entityType: string;
        sourceId: string;
        targetId: string;
        status: 'existing' | 'new';
    }>;
    skippedLegacyIdMappings: Array<{
        entityType: string;
        sourceId: string;
        reason: string;
    }>;
};
export interface GenerateContentDiffMigrationEndpoint {
    /** Project-scoped client used only for project/environment permission proofs. */
    rootClient: CmaClient.Client;
    /** Client already scoped to this endpoint's environment. */
    environmentClient: CmaClient.Client;
    environmentId: string;
    migrationsModelApiKey?: string;
    contentDiffModelApiKey?: string;
}
export interface GenerateContentDiffMigrationInput {
    source: GenerateContentDiffMigrationEndpoint;
    destination: GenerateContentDiffMigrationEndpoint;
    migrationFilePath: string;
    format: 'js' | 'ts';
    options: {
        itemTypes: ItemTypeSelection;
        uploads: UploadSelection;
        includeDeletions: boolean;
        bundleAssets: boolean;
        migrateInvalidContent: boolean;
    };
}
export interface GenerateContentDiffMigrationResult {
    sourceEnvironmentId: string;
    destinationEnvironmentId: string;
    format: 'js' | 'ts';
    migrationPath: string;
    planPath: string;
    runtimePath: string;
    assetsPath?: string;
    summary: ContentDiffMigrationSummary;
}
export declare function generateContentDiffMigration({ source, destination, migrationFilePath, format, options, }: GenerateContentDiffMigrationInput): Promise<GenerateContentDiffMigrationResult>;
export declare function assertNoLegacyDestinationIdCollisions(collisions: NonNullable<BuildContentDiffPlanOptions['entityIdCollisions']>): void;
/**
 * Runs private, non-mutating validation calls only for source slices whose CMA
 * validity flag is false. Unknown error shapes are retained as an explicit
 * contract diagnostic so the planner can skip the aggregate fail-closed.
 */
export declare function diagnoseInvalidSourceContent(sourceClient: CmaClient.Client, source: ContentSnapshot, intermediateCandidates?: ReadonlyArray<{
    recordId: string;
    versionHash: string;
    fields: JsonObject;
}>): Promise<InvalidContentDiagnostic[]>;
/**
 * Diagnoses destination-side validator conflicts (notably unique-value
 * handoffs) for exact desired payloads of records that already exist there.
 * Source-only creates continue to use source-side shell diagnostics because
 * unavailable destination dependencies would make validateNew ambiguous.
 */
export declare function diagnoseDesiredContentAgainstDestination(destinationClient: CmaClient.Client, source: ContentSnapshot, destination: ContentSnapshot): Promise<InvalidContentDiagnostic[]>;
/**
 * Diagnoses the canonical intermediate versions used to release a
 * destination-only reference SCC before deletion. These payloads are
 * validated against the destination because the records do not exist in the
 * source environment.
 */
export declare function diagnoseDeletionCycleReleasesAgainstDestination(destinationClient: CmaClient.Client, destination: ContentSnapshot, releases: readonly DeleteReleaseStep[]): Promise<InvalidContentDiagnostic[]>;
/**
 * Proves the two publication operations that could otherwise escape the
 * selected content scope: recursively publishing an external dependency and
 * cascading/scrubbing a published referrer while unpublishing a record.
 */
export declare function assertPublicationBoundarySafety(destinationClient: CmaClient.Client, plan: ContentDiffPlan): Promise<void>;
export declare function assertPublishedDeleteReleasesValid(destinationClient: CmaClient.Client, releases: readonly DeleteReleaseStep[], validatorRelaxedRecordIds?: ReadonlySet<string>, destination?: ContentSnapshot): Promise<void>;
export declare function assertTransientDeleteReleaseIdsUnoccupied(destinationClient: CmaClient.Client, releases: readonly DeleteReleaseStep[]): Promise<void>;
export declare function findDestinationIdCollisions(source: ContentSnapshot, destination: ContentSnapshot, destinationClient: CmaClient.Client): Promise<NonNullable<BuildContentDiffPlanOptions['entityIdCollisions']>>;
export declare function summarizeForCommand(plan: ContentDiffPlan): ContentDiffMigrationSummary;
export * from './canonicalize';
export * from './dependencies';
export * from './legacy-ids';
export * from './permissions';
export * from './plan';
export * from './schema';
export * from './snapshot';
export * from './types';
export * from './write-artifacts';
