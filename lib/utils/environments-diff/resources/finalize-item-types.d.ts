import type { Command, ItemTypeInfo, Schema } from '../types';
export declare function finalizeItemType(newItemTypeSchema: ItemTypeInfo, oldItemTypeSchema?: ItemTypeInfo): Command[];
export declare function finalizeItemTypes(newSchema: Schema, oldSchema: Schema): Command[];
