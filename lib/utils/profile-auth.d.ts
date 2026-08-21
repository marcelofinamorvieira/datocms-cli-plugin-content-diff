import type { ProfileConfig } from '@datocms/cli-utils';
export type ResolveLinkedSiteToken = (siteId: string, organizationId?: string) => Promise<string | undefined>;
export declare function profileApiTokenEnvironmentName(profileId: string, profileConfig: ProfileConfig): string;
export declare function resolveProfileApiToken({ explicitApiToken, profileConfig, profileId, resolveLinkedSiteToken, }: {
    explicitApiToken?: string;
    profileConfig: ProfileConfig;
    profileId: string;
    resolveLinkedSiteToken: ResolveLinkedSiteToken;
}): Promise<{
    apiToken?: string;
    environmentName: string;
}>;
