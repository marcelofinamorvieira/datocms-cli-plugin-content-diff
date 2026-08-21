import type { CmaClient } from '@datocms/cli-utils';
import type { Command, Schema } from '../types';
export declare function debugState(message: string, state: CmaClient.RawApiTypes.MenuItem[], rawRoots?: CmaClient.RawApiTypes.MenuItem[], level?: number): void;
export declare function manageMenuItems(newSchema: Schema, oldSchema: Schema): Command[];
