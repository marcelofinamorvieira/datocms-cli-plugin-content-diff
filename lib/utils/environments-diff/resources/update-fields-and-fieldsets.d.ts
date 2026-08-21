import type { CmaClient } from '@datocms/cli-utils';
import type { Command, ItemTypeInfo, Schema } from '../types';
export declare function buildRegularUpdateFieldClientCommand(newField: CmaClient.RawApiTypes.Field, oldField: CmaClient.RawApiTypes.Field | undefined): Command | undefined;
export declare function buildUpdateFieldClientCommand(newField: CmaClient.RawApiTypes.Field, oldField: CmaClient.RawApiTypes.Field | undefined, itemType: CmaClient.RawApiTypes.ItemType): Command[];
export declare function buildUpdateFieldsetClientCommand(newFieldset: CmaClient.RawApiTypes.Fieldset, oldFieldset: CmaClient.RawApiTypes.Fieldset | undefined, itemType: CmaClient.RawApiTypes.ItemType): Command[];
export declare function updateFieldsAndFieldsetsInItemType(newItemTypeSchema: ItemTypeInfo, oldItemTypeSchema: ItemTypeInfo): Command[];
export declare function updateFieldsAndFieldsets(newSchema: Schema, oldSchema: Schema): Command[];
