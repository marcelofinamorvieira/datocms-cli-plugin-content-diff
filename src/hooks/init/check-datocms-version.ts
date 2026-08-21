import type { Hook } from '@oclif/core';
import { assertSupportedDatocmsCliConfig } from '../../compat/datocms-version';

const GUARDED_COMMANDS = new Set([
  'content:diff',
  'migrations:new',
  'migrations:run',
]);

const hook: Hook<'init'> = async function ({ config, id }) {
  if (!id || !GUARDED_COMMANDS.has(id)) return;

  assertSupportedDatocmsCliConfig(config, (message) => {
    this.error(message, { exit: 1 });
  });
};

export default hook;
