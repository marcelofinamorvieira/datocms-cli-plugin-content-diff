import type { CmaClient } from '@datocms/cli-utils';
import type { Command, ItemTypeInfo, Schema } from '../types';
export declare function buildDestroyFieldClientCommand(field: CmaClient.RawApiTypes.Field, itemType: CmaClient.RawApiTypes.ItemType): Command[];
export declare function buildDestroyFieldsetClientCommand(fieldset: CmaClient.RawApiTypes.Fieldset, itemType: CmaClient.RawApiTypes.ItemType): Command[];
export declare function deleteMissingFieldsAndFieldsetsInExistingItemType(newItemTypeSchema: ItemTypeInfo, oldItemTypeSchema: ItemTypeInfo): Command[];
export declare function deleteMissingFieldsAndFieldsetsInExistingItemTypes(newSchema: Schema, oldSchema: Schema): Command[];
