import type { CmaClient } from '@datocms/cli-utils';
import type { Command, Schema } from '../types';
export declare const attributesToIgnoreOnModels: Array<keyof CmaClient.RawApiTypes.ItemTypeAttributes>;
export declare const attributesToIgnoreOnBlockModels: Array<keyof CmaClient.RawApiTypes.ItemTypeAttributes>;
export declare function createNewItemTypes(newSchema: Schema, oldSchema: Schema): Command[];
