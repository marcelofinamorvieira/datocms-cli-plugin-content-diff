import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { CmaClient } from '@datocms/cli-utils';
import { isPortableDatoId } from '../../src/content-diff/canonicalize';
import { deterministicPortableDatoId } from '../../src/content-diff/legacy-ids';
import {
  buildClient,
  captureEnvironmentFingerprint,
  invokeGeneratedMigrationForReplay,
} from '../e2e/real-cma-harness';

export const CROSS_PROJECT_E2E_ENV = {
  optIn: 'DATOCMS_CONTENT_DIFF_E2E_CROSS_PROJECT',
  keep: 'DATOCMS_CONTENT_DIFF_E2E_KEEP',
  sourceToken: 'DATOCMS_CONTENT_DIFF_E2E_SOURCE_API_TOKEN',
  destinationToken: 'DATOCMS_CONTENT_DIFF_E2E_DESTINATION_API_TOKEN',
  sourceProjectId: 'DATOCMS_CONTENT_DIFF_E2E_SOURCE_PROJECT_ID',
  destinationProjectId: 'DATOCMS_CONTENT_DIFF_E2E_DESTINATION_PROJECT_ID',
} as const;

const SOURCE_PROFILE = 'cross_source';
const DESTINATION_PROFILE = 'cross_destination';
const DISPOSABLE_PROJECT_NAME = /\b(?:e2e|test|testing|disposable)\b/i;
const pluginRoot = resolve(__dirname, '../..');
const pluginDevBin = join(pluginRoot, 'bin', 'dev');

type Definition = {
  settings: { locales: string };
  itemTypeId: string;
  fields: {
    title: { type: 'string'; localized: false };
    related: { type: 'link'; localized: false };
  };
};

type FixtureIds = Readonly<{
  model: string;
  titleField: string;
  relatedField: string;
  baselineRecord: string;
  sourceOnlyRecord: string;
  destinationOnlyRecord: string;
}>;

type Fixture = Readonly<{
  ids: FixtureIds;
  modelApiKey: string;
}>;

type CapturedRecord = Readonly<{
  id: string;
  title: string | null;
  related: string | null;
  status: string;
  currentValid: boolean;
  publishedValid: boolean | null;
}>;

type CapturedState = Readonly<{
  current: Readonly<Record<string, CapturedRecord>>;
  published: Readonly<Record<string, CapturedRecord>>;
}>;

type HarnessConfig = Readonly<{
  sourceToken: string;
  destinationToken: string;
  expectedSourceProjectId: string;
  expectedDestinationProjectId: string;
  keep: boolean;
}>;

type CliResult = Readonly<{ stdout: string; stderr: string }>;

export function alignedFixtureIds(seed: string): FixtureIds {
  return {
    model: deterministicPortableDatoId(`${seed}:model`),
    titleField: deterministicPortableDatoId(`${seed}:field:title`),
    relatedField: deterministicPortableDatoId(`${seed}:field:related`),
    baselineRecord: deterministicPortableDatoId(`${seed}:record:baseline`),
    sourceOnlyRecord: deterministicPortableDatoId(`${seed}:record:source`),
    destinationOnlyRecord: deterministicPortableDatoId(
      `${seed}:record:destination`,
    ),
  };
}

export function buildCrossProjectConfig(
  migrationModelApiKey: string,
  migrationsDirectory = 'migrations',
): Record<string, unknown> {
  const profile = (apiTokenEnvName: string) => ({
    apiTokenEnvName,
    logLevel: 'NONE',
    migrations: {
      directory: migrationsDirectory,
      modelApiKey: migrationModelApiKey,
    },
  });

  return {
    profiles: {
      [SOURCE_PROFILE]: profile(CROSS_PROJECT_E2E_ENV.sourceToken),
      [DESTINATION_PROFILE]: profile(CROSS_PROJECT_E2E_ENV.destinationToken),
    },
  };
}

export async function runAlignedCrossProjectE2E(): Promise<void> {
  const config = loadConfiguration();
  const sourceRoot = buildClient(config.sourceToken);
  const destinationRoot = buildClient(config.destinationToken);
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const sourceEnvironmentId = `cpx-${runId}-main`;
  const destinationEnvironmentId = sourceEnvironmentId;
  const appliedEnvironmentId = `cpx-${runId}-applied`;
  const wrongEnvironmentId = `cpx-${runId}-wrong`;
  const migrationModelApiKey = `cpx_migrations_r${createHash('sha256')
    .update(runId)
    .digest('hex')
    .slice(0, 12)}`;
  const workspace = await mkdtemp(join(tmpdir(), 'datocms-cpx-e2e-'));
  const sourceCreated: string[] = [];
  const destinationCreated: string[] = [];
  let primaryFailure: Error | undefined;

  const [
    sourceSite,
    destinationSite,
    sourceEnvironments,
    destinationEnvironments,
  ] = await Promise.all([
    sourceRoot.site.find(),
    destinationRoot.site.find(),
    sourceRoot.environments.list(),
    destinationRoot.environments.list(),
  ]);
  const sourcePrimary = sourceEnvironments.find(({ meta }) => meta.primary);
  const destinationPrimary = destinationEnvironments.find(
    ({ meta }) => meta.primary,
  );

  assert.ok(sourcePrimary, 'source project has no visible primary environment');
  assert.ok(
    destinationPrimary,
    'destination project has no visible primary environment',
  );
  assert.notEqual(
    sourceSite.id,
    destinationSite.id,
    'cross-project E2E requires two different projects',
  );
  assert.notEqual(
    config.sourceToken,
    config.destinationToken,
    'cross-project E2E requires distinct project tokens',
  );
  assertDisposableProject(sourceSite, config.expectedSourceProjectId, 'source');
  assertDisposableProject(
    destinationSite,
    config.expectedDestinationProjectId,
    'destination',
  );
  assertAlignedSiteSemantics(sourceSite, destinationSite);

  const [sourcePrimaryBefore, destinationPrimaryBefore] = await Promise.all([
    captureEnvironmentFingerprint(
      buildClient(config.sourceToken, sourcePrimary.id),
    ),
    captureEnvironmentFingerprint(
      buildClient(config.destinationToken, destinationPrimary.id),
    ),
  ]);

  try {
    await forkOwnedEnvironment(
      sourceRoot,
      sourcePrimary.id,
      sourceEnvironmentId,
      sourceCreated,
    );
    await forkOwnedEnvironment(
      destinationRoot,
      destinationPrimary.id,
      destinationEnvironmentId,
      destinationCreated,
    );

    const sourceClient = buildClient(config.sourceToken, sourceEnvironmentId);
    const destinationClient = buildClient(
      config.destinationToken,
      destinationEnvironmentId,
    );
    const fixture = await seedAlignedFixture(
      sourceClient,
      destinationClient,
      runId,
    );
    await introduceDrift(sourceClient, destinationClient, fixture);

    const sourceExpected = await captureFixtureState(sourceClient, fixture);
    const destinationExpected = await captureFixtureState(
      destinationClient,
      fixture,
    );
    const [sourceBeforeGeneration, destinationBeforeGeneration] =
      await Promise.all([
        captureEnvironmentFingerprint(sourceClient),
        captureEnvironmentFingerprint(destinationClient),
      ]);

    const migrationsDirectory = join(workspace, 'migrations');
    const configPath = join(workspace, 'datocms.config.json');
    await mkdir(migrationsDirectory);
    await writeFile(
      configPath,
      `${JSON.stringify(
        buildCrossProjectConfig(migrationModelApiKey),
        null,
        2,
      )}\n`,
    );

    const generation = await runCli({
      args: [
        'content:diff',
        `cross-project ${runId}`,
        `--source-profile=${SOURCE_PROFILE}`,
        `--destination-profile=${DESTINATION_PROFILE}`,
        `--autogenerate=${sourceEnvironmentId}:${destinationEnvironmentId}`,
        `--item-types=${fixture.modelApiKey}`,
        '--uploads=referenced',
        '--js',
        '--json',
        `--config-file=${configPath}`,
      ],
      cwd: workspace,
      environment: generationEnvironment(config),
      secrets: [config.sourceToken, config.destinationToken],
    });
    const output = parseObject(generation.stdout, 'content:diff output');
    assert.equal(output.sourceEnvironmentId, sourceEnvironmentId);
    assert.equal(output.destinationEnvironmentId, destinationEnvironmentId);

    const migrationFiles = (await readdir(migrationsDirectory)).filter((name) =>
      /^\d+.*\.js$/.test(name),
    );
    assert.equal(migrationFiles.length, 1);
    const migrationFilename = migrationFiles[0];
    const migrationFilePath = join(migrationsDirectory, migrationFilename);
    const planFilePath = join(
      migrationsDirectory,
      '.datocms-content',
      migrationFilename.replace(/\.js$/, '.plan.json'),
    );
    const runtimeFilePath = join(
      migrationsDirectory,
      '.datocms-content',
      'runtime-v16.js',
    );
    await Promise.all([
      access(migrationFilePath),
      access(planFilePath),
      access(runtimeFilePath),
    ]);
    const generatedBytes = (
      await Promise.all([
        readFile(migrationFilePath, 'utf8'),
        readFile(planFilePath, 'utf8'),
        readFile(runtimeFilePath, 'utf8'),
      ])
    ).join('\n');
    for (const forbidden of [
      config.sourceToken,
      config.destinationToken,
      SOURCE_PROFILE,
      DESTINATION_PROFILE,
    ]) {
      assert.equal(
        generatedBytes.includes(forbidden),
        false,
        'generated artifacts leaked credentials or local profile names',
      );
    }
    const envelope = parseObject(
      await readFile(planFilePath, 'utf8'),
      'content plan envelope',
    );
    assert.equal(envelope.formatVersion, 10);
    assert.equal(envelope.runtimeVersion, '16');
    const plan = parseObject(envelope.plan, 'content plan');
    assert.equal(parseObject(plan.source, 'plan source').siteId, sourceSite.id);
    assert.equal(
      parseObject(plan.target, 'plan target').siteId,
      destinationSite.id,
    );
    assert.equal(
      parseObject(plan.options, 'plan options').projectMode,
      'aligned_projects',
    );

    const [sourceAfterGeneration, destinationAfterGeneration] =
      await Promise.all([
        captureEnvironmentFingerprint(sourceClient),
        captureEnvironmentFingerprint(destinationClient),
      ]);
    assert.equal(sourceAfterGeneration, sourceBeforeGeneration);
    assert.equal(destinationAfterGeneration, destinationBeforeGeneration);

    const sourceBeforeWrongProfile =
      await captureEnvironmentFingerprint(sourceClient);
    let wrongProfileAssertionError: Error | undefined;
    let unexpectedWrongProjectFork: CmaClient.ApiTypes.Environment | null =
      null;
    try {
      await assertCliFailure({
        args: [
          'migrations:run',
          `--profile=${SOURCE_PROFILE}`,
          `--source=${sourceEnvironmentId}`,
          `--destination=${wrongEnvironmentId}`,
          `--config-file=${configPath}`,
        ],
        cwd: workspace,
        environment: sourceExecutionEnvironment(config),
        secrets: [config.sourceToken],
        pattern: /targets (?:site|project)|wrong target|destination project/i,
      });
    } catch (error) {
      wrongProfileAssertionError = safeError(error);
    } finally {
      unexpectedWrongProjectFork = await findEnvironment(
        sourceRoot,
        wrongEnvironmentId,
      );
      if (
        unexpectedWrongProjectFork?.meta.forked_from === sourceEnvironmentId
      ) {
        sourceCreated.push(wrongEnvironmentId);
      }
    }
    if (wrongProfileAssertionError) throw wrongProfileAssertionError;
    assert.equal(
      unexpectedWrongProjectFork,
      null,
      'wrong-profile execution created a fork before target binding failed',
    );
    assert.equal(
      await captureEnvironmentFingerprint(sourceClient),
      sourceBeforeWrongProfile,
      'wrong-profile execution mutated the source project',
    );

    try {
      await runCli({
        args: [
          'migrations:run',
          `--profile=${DESTINATION_PROFILE}`,
          `--source=${destinationEnvironmentId}`,
          `--destination=${appliedEnvironmentId}`,
          `--config-file=${configPath}`,
        ],
        cwd: workspace,
        environment: destinationExecutionEnvironment(config),
        secrets: [config.destinationToken],
      });
      destinationCreated.push(appliedEnvironmentId);
    } catch (error) {
      const applied = await findEnvironment(
        destinationRoot,
        appliedEnvironmentId,
      );
      if (applied?.meta.forked_from === destinationEnvironmentId) {
        destinationCreated.push(appliedEnvironmentId);
      }
      throw error;
    }

    const appliedClient = buildClient(
      config.destinationToken,
      appliedEnvironmentId,
    );
    const applied = await captureFixtureState(appliedClient, fixture);
    assertAppliedState({
      applied,
      source: sourceExpected,
      destination: destinationExpected,
      fixture,
    });
    await assertMigrationTracking(
      appliedClient,
      migrationModelApiKey,
      migrationFilename,
    );
    await invokeGeneratedMigrationForReplay(
      migrationFilePath,
      appliedClient,
      appliedEnvironmentId,
    );
    await assertRegenerationIsNoop({
      workspace,
      config,
      fixture,
      sourceEnvironmentId,
      appliedEnvironmentId,
      migrationModelApiKey,
    });
  } catch (error) {
    primaryFailure = safeError(error);
  }

  const cleanupErrors: Error[] = [];
  if (config.keep) {
    console.log(
      `[content-diff cross-project e2e] KEEP source site ${sourceSite.id}: ${
        sourceCreated.join(', ') || 'none'
      }`,
    );
    console.log(
      `[content-diff cross-project e2e] KEEP destination site ${
        destinationSite.id
      }: ${destinationCreated.join(', ') || 'none'}`,
    );
  } else {
    cleanupErrors.push(
      ...(await cleanupOwnedEnvironments(destinationRoot, destinationCreated)),
      ...(await cleanupOwnedEnvironments(sourceRoot, sourceCreated)),
    );
  }
  await rm(workspace, { recursive: true, force: true }).catch((error) => {
    cleanupErrors.push(safeError(error));
  });

  const [sourcePrimaryAfter, destinationPrimaryAfter] = await Promise.all([
    captureEnvironmentFingerprint(
      buildClient(config.sourceToken, sourcePrimary.id),
    ),
    captureEnvironmentFingerprint(
      buildClient(config.destinationToken, destinationPrimary.id),
    ),
  ]);
  assert.equal(sourcePrimaryAfter, sourcePrimaryBefore);
  assert.equal(destinationPrimaryAfter, destinationPrimaryBefore);

  if (primaryFailure) throw primaryFailure;
  if (cleanupErrors.length > 0) {
    throw new Error(cleanupErrors.map(({ message }) => message).join('; '));
  }
}

async function seedAlignedFixture(
  source: CmaClient.Client,
  destination: CmaClient.Client,
  runId: string,
): Promise<Fixture> {
  const ids = alignedFixtureIds(runId);
  for (const id of Object.values(ids)) assert.equal(isPortableDatoId(id), true);
  const modelApiKey = `cpx_r${createHash('sha256')
    .update(runId)
    .digest('hex')
    .slice(0, 12)}`;
  const create = async (client: CmaClient.Client) => {
    const model = await client.itemTypes.create({
      id: ids.model,
      name: `Cross-project fixture ${runId}`,
      api_key: modelApiKey,
      singleton: false,
      all_locales_required: false,
      sortable: false,
      modular_block: false,
      draft_mode_active: true,
      draft_saving_active: true,
      tree: false,
      collection_appearance: 'compact',
      inverse_relationships_enabled: false,
    });
    assert.equal(model.id, ids.model);
    await client.fields.create(model.id, {
      id: ids.titleField,
      label: 'Title',
      api_key: 'title',
      field_type: 'string',
      localized: false,
      validators: { required: {} },
    });
    await client.fields.create(model.id, {
      id: ids.relatedField,
      label: 'Related',
      api_key: 'related',
      field_type: 'link',
      localized: false,
      validators: { item_item_type: { item_types: [model.id] } },
    });
    const baseline = await client.items.create<Definition>({
      id: ids.baselineRecord,
      item_type: { id: model.id, type: 'item_type' },
      title: 'shared baseline',
      related: null,
    });
    assert.equal(baseline.id, ids.baselineRecord);
    await client.items.publish<Definition>(baseline.id);
  };
  await create(source);
  await create(destination);
  return { ids, modelApiKey };
}

async function introduceDrift(
  source: CmaClient.Client,
  destination: CmaClient.Client,
  fixture: Fixture,
): Promise<void> {
  await source.items.update<Definition>(fixture.ids.baselineRecord, {
    title: 'source published',
    related: null,
  });
  await source.items.publish<Definition>(fixture.ids.baselineRecord);
  await source.items.update<Definition>(fixture.ids.baselineRecord, {
    title: 'source current draft',
    related: null,
  });
  const sourceOnly = await source.items.create<Definition>({
    id: fixture.ids.sourceOnlyRecord,
    item_type: { id: fixture.ids.model, type: 'item_type' },
    title: 'source-only published',
    related: fixture.ids.baselineRecord,
  });
  await source.items.publish<Definition>(sourceOnly.id);

  await destination.items.update<Definition>(fixture.ids.baselineRecord, {
    title: 'destination drift',
    related: null,
  });
  await destination.items.publish<Definition>(fixture.ids.baselineRecord);
  const destinationOnly = await destination.items.create<Definition>({
    id: fixture.ids.destinationOnlyRecord,
    item_type: { id: fixture.ids.model, type: 'item_type' },
    title: 'destination-only retained',
    related: fixture.ids.baselineRecord,
  });
  await destination.items.publish<Definition>(destinationOnly.id);
}

async function captureFixtureState(
  client: CmaClient.Client,
  fixture: Fixture,
): Promise<CapturedState> {
  const capture = async (version: 'current' | 'published') => {
    const response = await client.items.rawList<Definition>({
      filter: { type: fixture.ids.model },
      version,
      page: { limit: 500 },
    });
    return Object.fromEntries(
      response.data
        .map((record): [string, CapturedRecord] => [
          record.id,
          {
            id: record.id,
            title: record.attributes.title,
            related: record.attributes.related,
            status: String(record.meta.status),
            currentValid: Boolean(record.meta.is_current_version_valid),
            publishedValid: record.meta.is_published_version_valid,
          },
        ])
        .sort(([left], [right]) => left.localeCompare(right)),
    ) as Record<string, CapturedRecord>;
  };
  return {
    current: await capture('current'),
    published: await capture('published'),
  };
}

function assertAppliedState(input: {
  applied: CapturedState;
  source: CapturedState;
  destination: CapturedState;
  fixture: Fixture;
}): void {
  const expectedIds = [
    input.fixture.ids.baselineRecord,
    input.fixture.ids.destinationOnlyRecord,
    input.fixture.ids.sourceOnlyRecord,
  ].sort();

  for (const version of ['current', 'published'] as const) {
    assert.deepEqual(
      Object.keys(input.applied[version]).sort(),
      expectedIds,
      `applied ${version} slice contains an unexpected fixture record`,
    );
    assert.deepEqual(
      input.applied[version][input.fixture.ids.baselineRecord],
      input.source[version][input.fixture.ids.baselineRecord],
    );
    assert.deepEqual(
      input.applied[version][input.fixture.ids.sourceOnlyRecord],
      input.source[version][input.fixture.ids.sourceOnlyRecord],
    );
    assert.deepEqual(
      input.applied[version][input.fixture.ids.destinationOnlyRecord],
      input.destination[version][input.fixture.ids.destinationOnlyRecord],
    );
  }
}

async function assertMigrationTracking(
  client: CmaClient.Client,
  apiKey: string,
  filename: string,
): Promise<void> {
  const model = (await client.itemTypes.list()).find(
    ({ api_key }) => api_key === apiKey,
  );
  assert.ok(model, 'destination migration tracking model is missing');
  const records = await client.items.rawList({
    filter: { type: model.id },
    page: { limit: 500 },
  });
  assert.deepEqual(
    records.data.map(({ attributes }) => attributes.name),
    [filename],
  );
}

async function assertRegenerationIsNoop(input: {
  workspace: string;
  config: HarnessConfig;
  fixture: Fixture;
  sourceEnvironmentId: string;
  appliedEnvironmentId: string;
  migrationModelApiKey: string;
}): Promise<void> {
  const directory = join(input.workspace, 'regenerated');
  const configPath = join(input.workspace, 'regenerated.config.json');
  await mkdir(directory);
  await writeFile(
    configPath,
    `${JSON.stringify(
      buildCrossProjectConfig(input.migrationModelApiKey, 'regenerated'),
      null,
      2,
    )}\n`,
  );
  const result = await runCli({
    args: [
      'content:diff',
      'cross-project regenerated no-op',
      `--source-profile=${SOURCE_PROFILE}`,
      `--destination-profile=${DESTINATION_PROFILE}`,
      `--autogenerate=${input.sourceEnvironmentId}:${input.appliedEnvironmentId}`,
      `--item-types=${input.fixture.modelApiKey}`,
      '--uploads=referenced',
      '--js',
      '--json',
      `--config-file=${configPath}`,
    ],
    cwd: input.workspace,
    environment: generationEnvironment(input.config),
    secrets: [input.config.sourceToken, input.config.destinationToken],
  });
  const summary = parseObject(
    parseObject(result.stdout, 'regenerated output').summary,
    'regenerated summary',
  );
  for (const [name, count] of Object.entries(
    parseObject(summary.counts, 'regenerated counts'),
  )) {
    assert.equal(count, 0, `regenerated plan reports non-zero ${name}`);
  }
  assert.equal(summary.destructiveActionCount, 0);
}

function loadConfiguration(): HarnessConfig {
  assert.equal(
    process.env[CROSS_PROJECT_E2E_ENV.optIn],
    '1',
    `${CROSS_PROJECT_E2E_ENV.optIn}=1 is required`,
  );
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  return {
    sourceToken: required(CROSS_PROJECT_E2E_ENV.sourceToken),
    destinationToken: required(CROSS_PROJECT_E2E_ENV.destinationToken),
    expectedSourceProjectId: required(CROSS_PROJECT_E2E_ENV.sourceProjectId),
    expectedDestinationProjectId: required(
      CROSS_PROJECT_E2E_ENV.destinationProjectId,
    ),
    keep: process.env[CROSS_PROJECT_E2E_ENV.keep] === '1',
  };
}

function assertDisposableProject(
  site: { id: string; name: string },
  expectedId: string,
  role: string,
): void {
  assert.equal(site.id, expectedId, `${role} project marker does not match`);
  assert.match(
    site.name,
    DISPOSABLE_PROJECT_NAME,
    `${role} project name must contain e2e, test, testing, or disposable`,
  );
}

function assertAlignedSiteSemantics(
  source: CmaClient.ApiTypes.Site,
  destination: CmaClient.ApiTypes.Site,
): void {
  const select = (site: CmaClient.ApiTypes.Site) => ({
    locales: site.locales,
    timezone: site.timezone,
    improvedTimezoneManagement: site.meta.improved_timezone_management,
    improvedBooleanFields: site.meta.improved_boolean_fields,
    improvedValidationAtPublishing: site.meta.improved_validation_at_publishing,
    millisecondsInDatetime: site.meta.milliseconds_in_datetime,
    nonLocalizedFocalPoints: site.meta.non_localized_focal_points,
    improvedHexManagement: site.meta.improved_hex_management,
  });
  assert.deepEqual(
    select(source),
    select(destination),
    'cross-project E2E projects have incompatible content semantics',
  );
}

async function forkOwnedEnvironment(
  root: CmaClient.Client,
  sourceId: string,
  destinationId: string,
  owned: string[],
): Promise<void> {
  assert.equal(await findEnvironment(root, destinationId), null);
  try {
    await root.environments.fork(sourceId, { id: destinationId });
    owned.push(destinationId);
  } catch (error) {
    const candidate = await findEnvironment(root, destinationId);
    if (candidate?.meta.forked_from === sourceId) owned.push(destinationId);
    throw error;
  }
}

async function findEnvironment(
  client: CmaClient.Client,
  id: string,
): Promise<CmaClient.ApiTypes.Environment | null> {
  try {
    return await client.environments.find(id);
  } catch (error) {
    if (error instanceof CmaClient.ApiError && error.findError('NOT_FOUND')) {
      return null;
    }
    throw error;
  }
}

async function cleanupOwnedEnvironments(
  client: CmaClient.Client,
  ids: readonly string[],
): Promise<Error[]> {
  const errors: Error[] = [];
  for (const id of [...ids].reverse()) {
    try {
      await client.environments.destroy(id);
    } catch (error) {
      if (error instanceof CmaClient.ApiError && error.findError('NOT_FOUND')) {
        continue;
      }
      errors.push(safeError(error));
    }
  }
  return errors;
}

function generationEnvironment(config: HarnessConfig): NodeJS.ProcessEnv {
  return childEnvironment({
    [CROSS_PROJECT_E2E_ENV.sourceToken]: config.sourceToken,
    [CROSS_PROJECT_E2E_ENV.destinationToken]: config.destinationToken,
  });
}

function sourceExecutionEnvironment(config: HarnessConfig): NodeJS.ProcessEnv {
  return childEnvironment({
    [CROSS_PROJECT_E2E_ENV.sourceToken]: config.sourceToken,
  });
}

function destinationExecutionEnvironment(
  config: HarnessConfig,
): NodeJS.ProcessEnv {
  return childEnvironment({
    [CROSS_PROJECT_E2E_ENV.destinationToken]: config.destinationToken,
  });
}

function childEnvironment(values: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of [
    'DATOCMS_API_TOKEN',
    'DATOCMS_PROFILE',
    CROSS_PROJECT_E2E_ENV.sourceToken,
    CROSS_PROJECT_E2E_ENV.destinationToken,
  ]) {
    delete environment[key];
  }
  return { ...environment, ...values };
}

async function runCli(input: {
  args: readonly string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  secrets: readonly string[];
}): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [pluginDevBin, ...input.args], {
      cwd: input.cwd,
      env: input.environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectPromise);
    child.once('close', (code, signal) => {
      if (code === 0) return resolvePromise({ stdout, stderr });
      rejectPromise(
        new Error(
          redact(
            [
              `${basename(pluginDevBin)} exited with ${code ?? signal}`,
              stdout.trim(),
              stderr.trim(),
            ]
              .filter(Boolean)
              .join('\n'),
            input.secrets,
          ),
        ),
      );
    });
  });
}

async function assertCliFailure(
  input: Parameters<typeof runCli>[0] & { pattern: RegExp },
): Promise<void> {
  try {
    await runCli(input);
    assert.fail('CLI command unexpectedly succeeded');
  } catch (error) {
    assert.match(safeError(error).message, input.pattern);
  }
}

function parseObject(value: unknown, label: string): Record<string, unknown> {
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object`);
  }
  return parsed as Record<string, unknown>;
}

function safeError(error: unknown): Error {
  if (error instanceof CmaClient.ApiError) {
    return new Error(
      `CMA ${error.response.status}: ${JSON.stringify(
        error.errors.map(({ attributes }) => ({
          code: attributes.code,
          details: attributes.details,
        })),
      )}`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function redact(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (result, secret) => result.split(secret).join('[REDACTED]'),
    value,
  );
}
