import type { BlockOwnership, ContentSnapshot, CreateCycleShellCandidate, DeleteReleaseStep, JsonObject, RecordDependencyGraph, RecordSnapshot, ReferenceDependency, SchemaSnapshot, UniqueReleaseStep } from './types';
export declare function contentItemNamespaceIds(...snapshots: readonly ContentSnapshot[]): Set<string>;
export declare function buildBlockOwnershipIndex(records: Record<string, RecordSnapshot>, schema: SchemaSnapshot): Record<string, BlockOwnership[]>;
export declare function assertNoBlockOwnershipConflicts(index: Record<string, BlockOwnership[]>): void;
export declare function assertCompatibleBlockOwnership(source: Record<string, BlockOwnership[]>, target: Record<string, BlockOwnership[]>): void;
export declare function collectRecordReferences(record: RecordSnapshot, schema: SchemaSnapshot): ReferenceDependency[];
export declare function collectPublishedRecordReferences(record: RecordSnapshot, schema: SchemaSnapshot): ReferenceDependency[];
export declare function collectUploadReferences(record: RecordSnapshot, schema: SchemaSnapshot): string[];
export declare function buildRecordDependencyGraph(records: Record<string, RecordSnapshot>, schema: SchemaSnapshot, additionalDependencies?: ReferenceDependency[], creationRecordIds?: ReadonlySet<string>, supportedShellRecordIds?: ReadonlySet<string>): RecordDependencyGraph;
/**
 * Computes deterministic source-only create-cycle seed payloads for the
 * generator's read-only diagnostic validation pass. Every intra-component
 * record reference is removed, including references currently made required
 * by a relaxable field validator. Tree-parent cycles are marked structural
 * because no field-validator change can make them persistable.
 */
export declare function collectCreateCycleShellCandidates(records: Record<string, RecordSnapshot>, schema: SchemaSnapshot, creationRecordIds: ReadonlySet<string>): CreateCycleShellCandidate[];
/**
 * Computes the exact create-time field payload for every cyclic source-only
 * component. Required/self cycles use the component-wide shell that the
 * runtime declares explicitly. Optional multi-record cycles instead use the
 * deterministic create order and remove only references to records that do
 * not exist yet, exactly like `expectedCreateSeedFields()` in the runtime.
 *
 * Keeping this projection separate from `collectCreateCycleShellCandidates()`
 * is intentional: callers that reason specifically about declared invalid
 * draft shells still need the component-wide form, while validator
 * diagnostics must exercise the actual request body sent to `items.create()`.
 */
export declare function collectCreateCycleIntermediateCandidates(records: Record<string, RecordSnapshot>, schema: SchemaSnapshot, creationRecordIds: ReadonlySet<string>): CreateCycleShellCandidate[];
/** Returns nodes with dependencies before their consumers. */
export declare function topologicalSort(dependencies: Record<string, string[]>): string[];
export declare function buildDeletionOrder(records: Record<string, RecordSnapshot>, schema: SchemaSnapshot): string[];
/**
 * One destination-only required-reference SCC and the exact unlink versions
 * that can break it. An empty `releases` array is fail-closed: at least one
 * structural/topology edge cannot be represented by a field-only update.
 */
export interface RequiredDeletionCycleReleaseCandidate {
    componentRecordIds: string[];
    releases: DeleteReleaseStep[];
    unsupportedPaths: string[];
}
/**
 * One destination-only optional-reference SCC and the exact unlink versions
 * that break it. These releases still need full validation when their model
 * cannot persist invalid drafts, or when the release must be published.
 */
export interface OptionalDeletionCycleReleaseCandidate {
    componentRecordIds: string[];
    releases: DeleteReleaseStep[];
    unsupportedPaths: string[];
}
export interface AnalyzeDeletionDependenciesOptions {
    /**
     * Required-reference SCCs are destructive only after the invalid-content
     * planner has diagnosed their exact unlink versions. Every member of an SCC
     * must be present in this set; partial authorization is never accepted.
     */
    supportedRequiredCycleRecordIds?: ReadonlySet<string>;
    /** Complete visible Item namespace reserved before transient block allocation. */
    reservedItemIds?: ReadonlySet<string>;
}
export declare function collectRequiredDeletionCycleReleaseCandidates(records: Record<string, RecordSnapshot>, schema: SchemaSnapshot, options?: Pick<AnalyzeDeletionDependenciesOptions, 'reservedItemIds'>): RequiredDeletionCycleReleaseCandidate[];
export declare function collectOptionalDeletionCycleReleaseCandidates(records: Record<string, RecordSnapshot>, schema: SchemaSnapshot, options?: Pick<AnalyzeDeletionDependenciesOptions, 'reservedItemIds'>): OptionalDeletionCycleReleaseCandidate[];
/**
 * Returns every deletion SCC whose published unlink projection would need
 * fresh nested block IDs. The CMA full-validation update path rehydrates any
 * nested payload carrying an ID as an existing block, so these components
 * must be preserved instead of emitted as executable release steps.
 */
export declare function collectUnsupportedPublishedNestedDeletionComponents(records: Record<string, RecordSnapshot>, schema: SchemaSnapshot, options?: Pick<AnalyzeDeletionDependenciesOptions, 'reservedItemIds'>): string[][];
export declare function analyzeDeletionDependencies(records: Record<string, RecordSnapshot>, schema: SchemaSnapshot, options?: AnalyzeDeletionDependenciesOptions): {
    deleteOrder: string[];
    releases: DeleteReleaseStep[];
};
export declare function assertExternalReferencesExist(references: readonly ReferenceDependency[], selectedRecordIds: ReadonlySet<string>, targetVisibleRecordIds: ReadonlySet<string>): void;
export declare function buildUniqueReleaseDependencies(source: ContentSnapshot, target: ContentSnapshot, includeDeletions: boolean): ReferenceDependency[];
export interface RuntimeCurrentUniqueConflict {
    recordId: string;
    ownerRecordId: string;
    itemTypeId: string;
    fieldId: string;
    fieldApiKey: string;
    path: string;
    phase: 'create-seed' | 'published-stage' | 'current-restore';
}
export interface RuntimeCurrentUniqueTransitionAnalysis {
    publishDependencies: ReferenceDependency[];
    updateDependencies: ReferenceDependency[];
    conflicts: RuntimeCurrentUniqueConflict[];
}
/** Models every unique-value claim visible in runtime CURRENT across phases. */
export declare function analyzeRuntimeCurrentUniqueTransitions(source: ContentSnapshot, target: ContentSnapshot, excludedSourceRecordIds?: ReadonlySet<string>): RuntimeCurrentUniqueTransitionAnalysis;
export declare function analyzeUniqueReleases(source: ContentSnapshot, target: ContentSnapshot, includeDeletions: boolean): {
    dependencies: ReferenceDependency[];
    releases: UniqueReleaseStep[];
};
export declare function buildPublishedUniqueDependencies(source: ContentSnapshot, target: ContentSnapshot, includeDeletions: boolean): ReferenceDependency[];
export interface BuildPublishOrderOptions {
    deletionRecordIds?: ReadonlySet<string>;
    publicationSeedRecordIds?: ReadonlySet<string>;
}
export declare function collectPublishedDependencyIds(record: RecordSnapshot, schema: SchemaSnapshot): string[];
/**
 * Produces one forward order for publication reconciliation and unpublishing.
 * Dependencies are always placed before consumers. For unpublishing, the
 * referenced record depends on every published referrer operation that must
 * remove the reference or unpublish first.
 */
export declare function buildPublishOrder(records: Record<string, RecordSnapshot>, schema: SchemaSnapshot, publishedUniqueDependencies: readonly ReferenceDependency[], targetRecords?: Readonly<Record<string, RecordSnapshot>>, options?: BuildPublishOrderOptions): string[];
export declare function assertSingletonIdsMatch(source: ContentSnapshot, target: ContentSnapshot): void;
/** Exact field body used by runtime phase 5 for a source-only record CREATE. */
export declare function projectCreateSeedFields(record: RecordSnapshot, schema: SchemaSnapshot, createOrder: readonly string[], createRecordIds: ReadonlySet<string>, shellRecordIds: ReadonlySet<string>, shellComponents: readonly (readonly string[])[]): JsonObject;
