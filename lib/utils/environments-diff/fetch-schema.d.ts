import type { CmaClient } from '@datocms/cli-utils';
import type { Schema } from './types';
/**
 * Internal bookkeeping owned by the content-diff plugin. It is deliberately
 * outside the user-managed schema so a mapping ledger created in one
 * environment never becomes a schema migration create/delete operation.
 */
export declare const CONTENT_DIFF_MAPPING_MODEL_API_KEY = "datocms_content_diff";
export declare function fetchSchema(client: CmaClient.Client): Promise<Schema>;
