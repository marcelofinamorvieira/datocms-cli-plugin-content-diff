import type { DeleteReleaseStep, JsonObject, JsonValue, RecordPlan, SchemaSnapshot, UniqueReleaseStep } from './types';
export type SanitizedHtmlWriteStage = 'create' | 'current-restore' | 'delete-release' | 'position-finalize' | 'published-stage' | 'tree-reparent' | 'unique-release';
export interface SanitizedHtmlWriteRisk {
    recordId: string;
    itemTypeId: string;
    fieldId: string;
    stage: SanitizedHtmlWriteStage;
    path: string;
    locale: string | null;
}
export interface SanitizedHtmlWriteExecution {
    createOrder: readonly string[];
    uniqueReleases: readonly UniqueReleaseStep[];
    deleteReleases: readonly DeleteReleaseStep[];
    deleteOrder: readonly string[];
    publicationSeedOrder: readonly string[];
    publishOrder: readonly string[];
    updateOrder: readonly string[];
    /** Mirrors the runtime's absoluteRecordPositionsReproducible contract. */
    absoluteRecordPositionsReproducible: boolean;
}
/**
 * The CMA uses Ruby Sanitize + Nokogiri HTML5 serialization before CREATE and
 * attribute-bearing UPDATEs. Reproducing those bytes in the generated Node runtime
 * would not be a stable cross-language contract. This deliberately small
 * subset is the only input for which byte identity can be proved without
 * parsing HTML: ordinary text with no markup/entity opener, HTML-significant
 * delimiter, carriage return, C0/C1 control, raw NBSP, surrogate, or Unicode
 * noncharacter.
 */
export declare function isProvablyCmaSanitizerByteStableText(value: JsonValue | undefined): boolean;
/**
 * Models every CREATE and every UPDATE whose serialized data.attributes is
 * non-empty in execution order. UPDATE field payloads use the same top-field
 * diff as the generated runtime. Reparent and position payloads are also
 * attributes in the CMA client, so their exact topology state machine is
 * projected as well. If no such write occurs, there is no sanitizer risk. If
 * one occurs, the safety proof checks the complete post-write fields: CMA can
 * full-rehydrate omitted fields whenever the current version is invalid or the
 * model is asynchronously validating, and that runtime-only state is not
 * available in a portable plan.
 */
export declare function findSanitizedHtmlWriteRisks(records: readonly RecordPlan[], phaseSchema: SchemaSnapshot, projectedCreateSeedFields: ReadonlyMap<string, JsonObject>, execution: SanitizedHtmlWriteExecution): SanitizedHtmlWriteRisk[];
