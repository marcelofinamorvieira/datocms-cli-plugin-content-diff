import type { Command } from '@oclif/core';
export declare const SUPPORTED_DATOCMS_CLI_VERSION: "4.0.29";
type HostConfig = Readonly<{
    bin: string;
    name: string;
    pjson?: Readonly<{
        version?: string;
    }>;
    root: string;
    version: string;
}>;
export declare function assertSupportedDatocmsCliConfig(config: HostConfig, reportError: (message: string) => void): void;
/**
 * User-installed oclif plugins share the host CLI configuration. Keep the
 * copied migrations compatibility layer pinned to the exact CLI revision it
 * was extracted from, and fail before profile resolution or CMA access when a
 * different public CLI version loads it.
 *
 * The package's own development binary is intentionally exempt: in that mode
 * this plugin is the root oclif application rather than a datocms user plugin.
 */
export declare function assertSupportedDatocmsCli(command: Command): void;
export {};
