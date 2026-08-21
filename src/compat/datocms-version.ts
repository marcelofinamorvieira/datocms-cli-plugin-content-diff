import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from '@oclif/core';

export const SUPPORTED_DATOCMS_CLI_VERSION = '4.0.29' as const;

type HostConfig = Readonly<{
  bin: string;
  name: string;
  pjson?: Readonly<{ version?: string }>;
  root: string;
  version: string;
}>;

function detectedDatocmsVersion(config: HostConfig): string | undefined {
  const roots = new Set([config.root, resolve(config.root, '..')]);

  if (process.argv[1]) {
    try {
      const executableDirectory = dirname(realpathSync(process.argv[1]));
      roots.add(executableDirectory);
      roots.add(resolve(executableDirectory, '..'));
      roots.add(resolve(executableDirectory, '../..'));
    } catch {
      // The loaded oclif metadata remains available below.
    }
  }

  for (const root of roots) {
    try {
      const packageJson = JSON.parse(
        readFileSync(resolve(root, 'package.json'), 'utf8'),
      ) as { name?: unknown; version?: unknown };

      if (
        (packageJson.name === 'datocms' ||
          packageJson.name === '@datocms/cli') &&
        typeof packageJson.version === 'string'
      ) {
        return packageJson.version;
      }
    } catch {
      // Fall back to oclif's loaded metadata below.
    }
  }

  return undefined;
}

export function assertSupportedDatocmsCliConfig(
  config: HostConfig,
  reportError: (message: string) => void,
): void {
  const { bin, name } = config;
  const detectedVersion = detectedDatocmsVersion(config);
  const isDatocmsHost =
    detectedVersion !== undefined ||
    bin === 'datocms' ||
    name === 'datocms' ||
    name === '@datocms/cli';

  if (!isDatocmsHost) return;

  const installedVersion =
    detectedVersion ?? config.pjson?.version ?? config.version;
  if (installedVersion === SUPPORTED_DATOCMS_CLI_VERSION) return;

  reportError(
    `This content-diff beta supports datocms CLI ${SUPPORTED_DATOCMS_CLI_VERSION} only, but ${installedVersion} is running. Install the supported CLI version or update/remove this plugin before continuing.`,
  );
}

/**
 * User-installed oclif plugins share the host CLI configuration. Keep the
 * copied migrations compatibility layer pinned to the exact CLI revision it
 * was extracted from, and fail before profile resolution or CMA access when a
 * different public CLI version loads it.
 *
 * The package's own development binary is intentionally exempt: in that mode
 * this plugin is the root oclif application rather than a datocms user plugin.
 */
export function assertSupportedDatocmsCli(command: Command): void {
  assertSupportedDatocmsCliConfig(command.config, (message) =>
    command.error(message, { exit: 1 }),
  );
}
