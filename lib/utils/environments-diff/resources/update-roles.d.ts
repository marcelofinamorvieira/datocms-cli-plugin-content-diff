import type { CmaClient } from '@datocms/cli-utils';
import type { Command } from '../types';
export declare function updateRole(role: CmaClient.RawApiTypes.Role, newEnvironmentId: string, oldEnvironmentId: string, { newInternalItemTypeIds, oldInternalItemTypeIds, }?: {
    newInternalItemTypeIds?: readonly string[];
    oldInternalItemTypeIds?: readonly string[];
}): Command[];
export declare function updateRoles(roles: CmaClient.RawApiTypes.Role[], newEnvironmentId: string, oldEnvironmentId: string, internalItemTypes?: {
    newInternalItemTypeIds?: readonly string[];
    oldInternalItemTypeIds?: readonly string[];
}): Command[];
