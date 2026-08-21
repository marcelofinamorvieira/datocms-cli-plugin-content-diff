import type { CmaClient } from '@datocms/cli-utils';
import type { Command, Schema } from '../types';
export declare function buildCreateFieldClientCommand(site: CmaClient.RawApiTypes.Site, itemType: CmaClient.RawApiTypes.ItemType, field: CmaClient.RawApiTypes.Field): Command[];
export declare function buildCreateFieldsetClientCommand(itemType: CmaClient.RawApiTypes.ItemType, fieldset: CmaClient.RawApiTypes.Fieldset): Command[];
export declare function buildCreateFieldClientCommands(site: CmaClient.RawApiTypes.Site, itemType: CmaClient.RawApiTypes.ItemType, fields: CmaClient.RawApiTypes.Field[]): Command[];
export declare function buildCreateFieldsetClientCommands(itemType: CmaClient.RawApiTypes.ItemType, fieldsets: CmaClient.RawApiTypes.Fieldset[]): Command[];
export declare function createNewFieldsAndFieldsets(newSchema: Schema, oldSchema: Schema): Command[];
