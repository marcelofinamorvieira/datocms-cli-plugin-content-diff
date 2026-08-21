import type { CmaClient } from '@datocms/cli-utils';
import type { BuildContentDiffPlanOptions, ContentSnapshot, InvalidContentDiagnostic, LegacyIdMappingDocumentEntry, LegacyIdMappingPlan, LegacyIdMappingSchemaPlan, SchemaSnapshot, SkippedRecordAggregate } from './types';
export interface LegacyIdMappingRegistry {
    schema: LegacyIdMappingSchemaPlan;
    entries: LegacyIdMappingDocumentEntry[];
    records: Array<{
        id: string;
        hash: string;
    }>;
}
export declare function prettyStableStringify(value: unknown): string;
/**
 * Produces a deterministic, canonical, unpadded URL-safe Base64 v4 UUID.
 * The collision counter is part of the seed so callers can reserve the first
 * available ID without relying on random process state.
 */
export declare function deterministicPortableDatoId(seed: string): string;
export declare function readLegacyIdMappingRegistry(client: CmaClient.Client, schema: SchemaSnapshot, modelApiKey?: string, readRecords?: boolean): Promise<LegacyIdMappingRegistry>;
export declare function assertNoManagedRelationshipToMappingModel(schema: SchemaSnapshot, modelApiKey?: string): void;
export declare function prepareLegacyIdMappings(source: ContentSnapshot, target: ContentSnapshot, registry: LegacyIdMappingRegistry): LegacyIdMappingPlan;
export declare function emptyLegacyIdMappingPlan(snapshot: ContentSnapshot, modelApiKey?: string): LegacyIdMappingPlan;
export declare function applyLegacyIdMappingsToSnapshot(snapshot: ContentSnapshot, mappingPlan: LegacyIdMappingPlan): ContentSnapshot;
export declare function remapInvalidContentDiagnostics(diagnostics: readonly InvalidContentDiagnostic[], rawSource: ContentSnapshot, mappedSource: ContentSnapshot, target: ContentSnapshot, mappingPlan: LegacyIdMappingPlan): InvalidContentDiagnostic[];
export declare function finalizeLegacyIdMappingPlan(tentative: LegacyIdMappingPlan, source: ContentSnapshot, target: ContentSnapshot, externalTargets?: NonNullable<BuildContentDiffPlanOptions['externalLegacyRecordTargets']>, additionalOccupiedItemIds?: readonly string[], detectedSource?: ContentSnapshot, skippedRecords?: readonly SkippedRecordAggregate[]): LegacyIdMappingPlan;
