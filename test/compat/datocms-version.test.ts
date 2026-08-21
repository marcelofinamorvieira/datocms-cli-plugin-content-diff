import { resolve } from 'node:path';
import type { Command } from '@oclif/core';
import { expect } from 'chai';
import {
  SUPPORTED_DATOCMS_CLI_VERSION,
  assertSupportedDatocmsCli,
} from '../../src/compat/datocms-version';

function fakeCommand({
  bin,
  name,
  packageVersion,
  root,
  version,
}: Readonly<{
  bin: string;
  name: string;
  packageVersion?: string;
  root?: string;
  version: string;
}>): Command {
  return {
    config: {
      bin,
      name,
      root: root ?? process.cwd(),
      version,
      ...(packageVersion ? { pjson: { version: packageVersion } } : {}),
    },
    error(message: string): never {
      throw new Error(message);
    },
  } as unknown as Command;
}

describe('DatoCMS CLI compatibility', () => {
  it('accepts the exact supported datocms host version', () => {
    expect(() =>
      assertSupportedDatocmsCli(
        fakeCommand({
          bin: 'datocms',
          name: 'datocms',
          version: SUPPORTED_DATOCMS_CLI_VERSION,
        }),
      ),
    ).not.to.throw();
  });

  it('rejects another datocms host version', () => {
    expect(() =>
      assertSupportedDatocmsCli(
        fakeCommand({
          bin: 'datocms',
          name: 'datocms',
          version: '4.0.30',
        }),
      ),
    ).to.throw(
      'This content-diff beta supports datocms CLI 4.0.29 only, but 4.0.30 is running.',
    );
  });

  it('uses the installed host package version when the oclif manifest is stale', () => {
    expect(() =>
      assertSupportedDatocmsCli(
        fakeCommand({
          bin: 'datocms',
          name: 'datocms',
          packageVersion: SUPPORTED_DATOCMS_CLI_VERSION,
          root: resolve(process.cwd(), 'test/fixtures/datocms-4.0.30'),
          version: SUPPORTED_DATOCMS_CLI_VERSION,
        }),
      ),
    ).to.throw(
      'This content-diff beta supports datocms CLI 4.0.29 only, but 4.0.30 is running.',
    );
  });

  it('allows the plugin development binary to load independently', () => {
    expect(() =>
      assertSupportedDatocmsCli(
        fakeCommand({
          bin: 'content-diff',
          name: '@marcelofinamorvieira/datocms-cli-plugin-content-diff',
          version: '0.1.0-beta.1',
        }),
      ),
    ).not.to.throw();
  });
});
