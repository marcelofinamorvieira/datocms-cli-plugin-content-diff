import type { ItemTypeSchemaSnapshot, SchemaSnapshot, StructuralContentIssue } from './types';
type UnknownObject = Record<string, unknown>;
export interface NestedBlockIdentity {
    id: string;
    itemTypeId: string;
}
export interface StructuralInspectionResult {
    encounteredItemTypeIds: string[];
    issues: StructuralContentIssue[];
}
/**
 * Reads every CMA representation of a nested block identity and rejects
 * ambiguity. Returning null means that the value makes no nested-item claim.
 */
export declare function nestedBlockIdentity(value: unknown, path: string): NestedBlockIdentity | null;
export declare function nestedBlockFields(value: unknown, path: string): UnknownObject;
export declare function inspectRecordStructuralContent(input: unknown, ownerItemType: ItemTypeSchemaSnapshot, fullSchema: SchemaSnapshot, recordId: string, slice: 'current' | 'published'): StructuralInspectionResult;
export {};
