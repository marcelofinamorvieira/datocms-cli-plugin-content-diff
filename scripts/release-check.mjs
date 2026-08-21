import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const supportedArgs = new Set(['--help', '--skip-e2e']);
const unknownArgs = [...args].filter((arg) => !supportedArgs.has(arg));

if (unknownArgs.length > 0) {
  console.error(`Unknown release-check option: ${unknownArgs.join(', ')}`);
  process.exit(2);
}

if (args.has('--help')) {
  console.log(`Usage: npm run release:check -- [--skip-e2e]

Runs every offline release check and, by default, the complete disposable-project
real-CMA suites. Pass --skip-e2e when both live suites are intentionally deferred.`);
  process.exit(0);
}

const packageRoot = resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (command, commandArgs) => {
  console.log(`\n[release-check] ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd: packageRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(npm, ['run', 'typecheck']);
run(npm, ['run', 'typecheck:test']);
run(npm, ['test']);
run(npm, ['run', 'check']);
run(npm, ['run', 'build']);
run(npm, ['run', 'manifest']);
run(npm, ['audit', '--omit=dev', '--audit-level=high']);
run(npm, ['pack', '--dry-run', '--json', '--ignore-scripts']);
run('git', ['diff', '--check']);

if (args.has('--skip-e2e')) {
  console.log(
    '\n[release-check] Skipped both disposable-project real-CMA suites by explicit request.',
  );
} else {
  run(npm, ['run', 'test:e2e:real-cma']);
  run(npm, ['run', 'test:e2e:cross-project']);
}

console.log('\n[release-check] All requested checks passed.');
