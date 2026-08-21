import type { CmaClient } from '@datocms/cli-utils';
import type { ItemTypeSchemaSnapshot } from './types';
/** Proves schema-edit authority before emitting a plan that will edit fields. */
export declare function assertCanEditSchema(client: CmaClient.Client): Promise<void>;
/**
 * Collection endpoints are permission-filtered. A content diff is therefore
 * authoritative only after positively proving that its credential can read
 * every record and upload in both environments.
 */
export declare function assertUnrestrictedReadAccess(client: CmaClient.Client, environmentIds: readonly string[], itemTypes: readonly ItemTypeSchemaSnapshot[]): Promise<void>;
