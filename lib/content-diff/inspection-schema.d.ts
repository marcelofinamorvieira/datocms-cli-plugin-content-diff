import type { ContentInspectionSnapshot, ContentSnapshot, ItemTypeSchemaSnapshot, SchemaSnapshot, StructuralContentIssue } from './types';
export declare function inspectionItemTypesDigest(itemTypes: readonly ItemTypeSchemaSnapshot[]): string;
export declare function buildContentInspectionSnapshot(fullSchema: SchemaSnapshot, managedSchema: SchemaSnapshot, encounteredItemTypeIds: ReadonlySet<string>, structuralIssues: readonly StructuralContentIssue[]): ContentInspectionSnapshot;
export declare function contentTraversalSchema(snapshot: Pick<ContentSnapshot, 'schema' | 'inspection'>): SchemaSnapshot;
export declare function schemaWithInspectionItemTypes(managedSchema: SchemaSnapshot, inspectionItemTypes: readonly ItemTypeSchemaSnapshot[]): SchemaSnapshot;
export declare function inspectionSubsetMatches(inspection: ContentInspectionSnapshot, refreshedFullSchema: SchemaSnapshot): boolean;
