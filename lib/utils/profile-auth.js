"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileApiTokenEnvironmentName = profileApiTokenEnvironmentName;
exports.resolveProfileApiToken = resolveProfileApiToken;
function profileApiTokenEnvironmentName(profileId, profileConfig) {
    if (profileConfig.apiTokenEnvName) {
        return profileConfig.apiTokenEnvName;
    }
    return profileId === 'default'
        ? 'DATOCMS_API_TOKEN'
        : `DATOCMS_${profileId.toUpperCase()}_PROFILE_API_TOKEN`;
}
async function resolveProfileApiToken({ explicitApiToken, profileConfig, profileId, resolveLinkedSiteToken, }) {
    const environmentName = profileApiTokenEnvironmentName(profileId, profileConfig);
    if (explicitApiToken) {
        return { apiToken: explicitApiToken, environmentName };
    }
    if (profileConfig.siteId) {
        const linkedSiteToken = await resolveLinkedSiteToken(profileConfig.siteId, profileConfig.organizationId);
        if (linkedSiteToken) {
            return { apiToken: linkedSiteToken, environmentName };
        }
    }
    return {
        apiToken: process.env[environmentName],
        environmentName,
    };
}
