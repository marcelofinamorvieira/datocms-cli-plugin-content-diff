import type { CmaClient } from '@datocms/cli-utils';
import type { ItemTypeSchemaSnapshot, ItemTypeSelection, JsonObject, SchemaSnapshot } from './types';
import { ContentDiffError } from './types';
export declare function fetchSchemaSnapshot(client: CmaClient.Client, environmentId: string): Promise<SchemaSnapshot>;
export declare function schemaForScope(schema: SchemaSnapshot, selection: ItemTypeSelection, migrationsModelApiKey?: string, contentDiffModelApiKey?: string): SchemaSnapshot;
export declare function resolveItemTypeSelection(schema: SchemaSnapshot, selection: ItemTypeSelection, migrationsModelApiKey?: string, contentDiffModelApiKey?: string): ItemTypeSchemaSnapshot[];
/**
 * Returns the configured core CLI tracking model only when it is safe to
 * exclude from authoritative content/referrer reads. The runner itself treats
 * this API key as internal, so a conflicting user model must fail closed.
 */
export declare function migrationsTrackingModelId(schema: SchemaSnapshot, migrationsModelApiKey?: string): string | undefined;
/**
 * Digest algorithm shared with the generated runtime. Provenance fields are
 * intentionally excluded so a fork of the baseline remains compatible.
 */
export declare function computeSchemaDigest(schema: SchemaSnapshot): string;
export declare function schemaSemanticState(schema: SchemaSnapshot): JsonObject;
export declare function assertSchemasCompatible(source: SchemaSnapshot, target: SchemaSnapshot): void;
export declare function assertSameProject(source: SchemaSnapshot, target: SchemaSnapshot): void;
export declare function schemaMismatch(source: Pick<SchemaSnapshot, 'environmentId'>, target: Pick<SchemaSnapshot, 'environmentId'>): ContentDiffError;
