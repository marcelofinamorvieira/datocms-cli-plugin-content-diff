import type { CmaClient } from '@datocms/cli-utils';
import type { Command, Schema } from '../types';
export declare function debugState(message: string, state: CmaClient.RawApiTypes.SchemaMenuItem[], newSchema: Schema, rawRoots?: CmaClient.RawApiTypes.SchemaMenuItem[], level?: number): void;
export declare function manageSchemaMenuItems(newSchema: Schema, oldSchema: Schema): Command[];
