import type { CmaClient } from '@datocms/cli-utils';
export declare function diffEnvironments({ newClient, newEnvironmentId, oldClient, oldEnvironmentId, migrationFilePath, format, }: {
    newClient: CmaClient.Client;
    newEnvironmentId: string;
    oldClient: CmaClient.Client;
    oldEnvironmentId: string;
    migrationFilePath: string;
    format: 'js' | 'ts';
}): Promise<string>;
