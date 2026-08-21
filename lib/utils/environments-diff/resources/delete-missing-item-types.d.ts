import type { Command, ItemTypeInfo, Schema } from '../types';
export declare function buildDestroyItemTypeClientCommand(itemTypeSchema: ItemTypeInfo): Command[];
export declare function deleteMissingItemTypes(newSchema: Schema, oldSchema: Schema): Command[];
