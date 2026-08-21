import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { CmaClient } from '@datocms/cli-utils';

const E2E_OPT_IN_ENV = 'DATOCMS_CONTENT_DIFF_E2E';
const E2E_KEEP_ENV = 'DATOCMS_CONTENT_DIFF_E2E_KEEP';
const E2E_DISPOSABLE_PROJECT_ENV =
  'DATOCMS_CONTENT_DIFF_E2E_DISPOSABLE_PROJECT';
const API_TOKEN_ENV = 'DATOCMS_API_TOKEN';
const DISPOSABLE_PROJECT_NAME = /\b(?:e2e|test|testing|disposable)\b/i;

const GENERATED_REPLAY_MUTATION_METHODS = new Set([
  'activate',
  'bulkMoveToStage',
  'create',
  'createFromLocalFile',
  'destroy',
  'fork',
  'promote',
  'publish',
  'unpublish',
  'update',
  'updateFromLocalFile',
]);

type GoldenFixtureDefinition = {
  settings: { locales: string };
  itemTypeId: string;
  fields: {
    title: { type: 'string'; localized: false };
    body: { type: 'text'; localized: false };
    related: { type: 'link'; localized: false };
  };
};

type MigrationRecordDefinition = {
  settings: { locales: string };
  itemTypeId: string;
  fields: {
    name: { type: 'string'; localized: false };
  };
};

export type RealCmaScenarioSeed = Readonly<{
  itemTypeApiKeys: readonly string[];
}>;

export type SeedSourceContext = Readonly<{
  client: CmaClient.Client;
  runId: string;
}>;

export type IntroduceDriftContext<Seed extends RealCmaScenarioSeed> = Readonly<{
  seed: Seed;
  sourceClient: CmaClient.Client;
  destinationClient: CmaClient.Client;
}>;

export type VerifyScenarioContext<
  Seed extends RealCmaScenarioSeed,
  Expected,
> = Readonly<{
  seed: Seed;
  expected: Expected;
  sourceClient: CmaClient.Client;
  destinationClient: CmaClient.Client;
  appliedClient: CmaClient.Client;
  migrationFilename: string;
  migrationFilePath: string;
  planFilePath: string;
  migrationModelApiKey: string;
}>;

export type VerifyGeneratedPlanContext<
  Seed extends RealCmaScenarioSeed,
  Expected,
> = Readonly<{
  seed: Seed;
  expected: Expected;
  sourceClient: CmaClient.Client;
  destinationClient: CmaClient.Client;
  migrationFilename: string;
  migrationFilePath: string;
  planFilePath: string;
}>;

/**
 * A scenario owns only fixture seeding, drift, and its independent oracle.
 * Environment lifecycle and the real CLI invocations stay in the harness.
 */
export type RealCmaScenario<
  Seed extends RealCmaScenarioSeed,
  Expected,
> = Readonly<{
  name: string;
  migrationFormat?: 'js' | 'ts';
  contentDiffArgs?: readonly string[];
  expectedGenerationFailure?: Readonly<{ messagePattern: RegExp }>;
  seedSource(context: SeedSourceContext): Promise<Seed>;
  introduceDrift(context: IntroduceDriftContext<Seed>): Promise<Expected>;
  verifyGeneratedPlan?(
    context: VerifyGeneratedPlanContext<Seed, Expected>,
  ): Promise<void>;
  verify?(context: VerifyScenarioContext<Seed, Expected>): Promise<void>;
}>;

type HarnessConfiguration = Readonly<{
  apiToken: string;
  keepEnvironments: boolean;
}>;

type EnvironmentIds = Readonly<{
  source: string;
  destination: string;
  applied: string;
}>;

type CliResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

class ExpectedGenerationFailureObserved extends Error {}

type GoldenSeed = RealCmaScenarioSeed &
  Readonly<{
    modelId: string;
    modelApiKey: string;
    baselineRecordId: string;
  }>;

type RawGoldenRecord = Readonly<{
  id: string;
  itemTypeId: string;
  title: string | null;
  body: string | null;
  related: string | null;
}>;

type RawGoldenState = Readonly<{
  current: Readonly<Record<string, RawGoldenRecord>>;
  published: Readonly<Record<string, RawGoldenRecord>>;
  currentIds: readonly string[];
  publishedIds: readonly string[];
}>;

type GoldenExpected = Readonly<{
  sourceOnlyRecordId: string;
  destinationOnlyRecordId: string;
  source: RawGoldenState;
  destination: RawGoldenState;
}>;

const pluginPackageRoot = resolve(__dirname, '../..');
const pluginDevBin = join(pluginPackageRoot, 'bin', 'dev');
const coreMigrationRunnerPath = join(
  pluginPackageRoot,
  'src',
  'commands',
  'migrations',
  'run.ts',
);
const requireFromCorePackage = createRequire(
  join(pluginPackageRoot, 'package.json'),
);
const { require: requireWithCoreTsx } = requireFromCorePackage(
  'tsx/cjs/api',
) as Readonly<{
  require(modulePath: string, parentFilename: string): unknown;
}>;

export const goldenPathScenario: RealCmaScenario<GoldenSeed, GoldenExpected> = {
  name: 'published update, source-only create, and retained destination extra',

  async seedSource({ client, runId }) {
    console.log('[content-diff e2e] Creating fixture schema in source sandbox');

    const modelApiKey = `cde2e_${runId.replace(/-/g, '')}`;
    const model = await client.itemTypes.create({
      name: `Content diff E2E ${runId}`,
      api_key: modelApiKey,
      singleton: false,
      all_locales_required: false,
      sortable: false,
      modular_block: false,
      draft_mode_active: true,
      draft_saving_active: false,
      tree: false,
      collection_appearance: 'compact',
      inverse_relationships_enabled: false,
    });

    await client.fields.create(model.id, {
      label: 'Title',
      api_key: 'title',
      field_type: 'string',
      localized: false,
      validators: { required: {} },
    });
    await client.fields.create(model.id, {
      label: 'Body',
      api_key: 'body',
      field_type: 'text',
      localized: false,
      validators: {},
    });
    await client.fields.create(model.id, {
      label: 'Related',
      api_key: 'related',
      field_type: 'link',
      localized: false,
      validators: {
        item_item_type: { item_types: [model.id] },
      },
    });

    const baseline = await client.items.create<GoldenFixtureDefinition>({
      item_type: { id: model.id, type: 'item_type' },
      title: 'alpha baseline',
      body: 'alpha published baseline',
      related: null,
    });
    await client.items.publish<GoldenFixtureDefinition>(baseline.id);

    return {
      itemTypeApiKeys: [modelApiKey],
      modelId: model.id,
      modelApiKey,
      baselineRecordId: baseline.id,
    };
  },

  async introduceDrift({ seed, sourceClient, destinationClient }) {
    console.log('[content-diff e2e] Introducing source and destination drift');

    await sourceClient.items.update<GoldenFixtureDefinition>(
      seed.baselineRecordId,
      {
        title: 'alpha source current',
        body: 'source draft over the published baseline',
        related: null,
      },
    );

    const sourceOnly = await sourceClient.items.create<GoldenFixtureDefinition>(
      {
        item_type: { id: seed.modelId, type: 'item_type' },
        title: 'charlie source only',
        body: 'published source-only record',
        related: seed.baselineRecordId,
      },
    );
    await sourceClient.items.publish<GoldenFixtureDefinition>(sourceOnly.id);

    await destinationClient.items.update<GoldenFixtureDefinition>(
      seed.baselineRecordId,
      {
        title: 'alpha destination drift',
        body: 'destination publication must be reconciled',
        related: null,
      },
    );
    await destinationClient.items.publish<GoldenFixtureDefinition>(
      seed.baselineRecordId,
    );

    const destinationOnly =
      await destinationClient.items.create<GoldenFixtureDefinition>({
        item_type: { id: seed.modelId, type: 'item_type' },
        title: 'delta destination only',
        body: 'must survive because deletions are disabled',
        related: seed.baselineRecordId,
      });

    return {
      sourceOnlyRecordId: sourceOnly.id,
      destinationOnlyRecordId: destinationOnly.id,
      source: await captureGoldenRawState(sourceClient, seed.modelId),
      destination: await captureGoldenRawState(destinationClient, seed.modelId),
    };
  },

  async verify({
    seed,
    expected,
    appliedClient,
    migrationFilename,
    migrationModelApiKey,
  }) {
    console.log('[content-diff e2e] Verifying applied state through raw CMA');

    const applied = await captureGoldenRawState(appliedClient, seed.modelId);
    const managedIds = [
      seed.baselineRecordId,
      expected.sourceOnlyRecordId,
    ].sort();

    for (const id of managedIds) {
      assert.deepEqual(
        applied.current[id],
        expected.source.current[id],
        `current source state was not reproduced for ${id}`,
      );
      assert.deepEqual(
        applied.published[id],
        expected.source.published[id],
        `published source state was not reproduced for ${id}`,
      );
    }

    assert.deepEqual(
      applied.current[expected.destinationOnlyRecordId],
      expected.destination.current[expected.destinationOnlyRecordId],
      'destination-only current record was not preserved',
    );
    assert.equal(
      applied.published[expected.destinationOnlyRecordId],
      undefined,
      'destination-only draft unexpectedly became published',
    );
    assert.deepEqual(
      applied.currentIds,
      [...managedIds, expected.destinationOnlyRecordId].sort(),
      'applied current record IDs differ from the managed source plus retained destination records',
    );
    assert.deepEqual(
      applied.publishedIds,
      expected.source.publishedIds,
      'applied published record IDs differ from the source publication set',
    );

    const migrationModels = await appliedClient.itemTypes.list();
    const migrationModel = migrationModels.find(
      ({ api_key }) => api_key === migrationModelApiKey,
    );
    assert.ok(
      migrationModel,
      'migrations:run did not create its tracking model',
    );

    const migrationRecords =
      await appliedClient.items.rawList<MigrationRecordDefinition>({
        filter: { type: migrationModel.id },
        page: { limit: 500 },
      });
    assert.deepEqual(
      migrationRecords.data.map(({ attributes }) => attributes.name).sort(),
      [migrationFilename],
      'migrations:run did not track exactly the generated migration',
    );
  },
};

export async function runRealCmaE2E(): Promise<void> {
  return runRealCmaScenario(goldenPathScenario);
}

export async function runRealCmaScenario<
  Seed extends RealCmaScenarioSeed,
  Expected,
>(scenario: RealCmaScenario<Seed, Expected>): Promise<void> {
  const configuration = loadHarnessConfiguration();
  const rootClient = buildClient(configuration.apiToken);
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const environmentIds: EnvironmentIds = {
    source: `cde2e-${runId}-source`,
    destination: `cde2e-${runId}-destination`,
    applied: `cde2e-${runId}-applied`,
  };
  const migrationModelApiKey = `cde2e_migrations_${runId.replace(/-/g, '')}`;
  const createdEnvironmentIds: string[] = [];
  const workspace = await mkdtemp(join(tmpdir(), 'datocms-content-diff-e2e-'));
  let primaryFailure: Error | undefined;

  try {
    const site = await rootClient.site.find();
    const environments = await rootClient.environments.list();
    const primary = environments.find(({ meta }) => meta.primary);
    assert.ok(primary, 'the project has no visible primary environment');

    await assertDisposableProjectSafety({
      apiToken: configuration.apiToken,
      primaryEnvironmentId: primary.id,
      projectId: site.id,
      projectName: site.name,
    });

    console.log(
      `[content-diff e2e] Scenario ${JSON.stringify(
        scenario.name,
      )} on project ${JSON.stringify(site.name)} (${site.id})`,
    );

    await forkEnvironment(
      rootClient,
      primary.id,
      environmentIds.source,
      createdEnvironmentIds,
    );
    const sourceClient = buildClient(
      configuration.apiToken,
      environmentIds.source,
    );
    const seed = await scenario.seedSource({ client: sourceClient, runId });

    await forkEnvironment(
      rootClient,
      environmentIds.source,
      environmentIds.destination,
      createdEnvironmentIds,
    );
    const destinationClient = buildClient(
      configuration.apiToken,
      environmentIds.destination,
    );
    const expected = await scenario.introduceDrift({
      seed,
      sourceClient,
      destinationClient,
    });

    const migrationsDirectory = join(workspace, 'migrations');
    const configPath = join(workspace, 'datocms.config.json');
    await mkdir(migrationsDirectory);
    await writeFile(
      configPath,
      JSON.stringify(
        {
          profiles: {
            default: {
              apiTokenEnvName: API_TOKEN_ENV,
              logLevel: 'NONE',
              migrations: {
                directory: 'migrations',
                modelApiKey: migrationModelApiKey,
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const [sourceBeforeGeneration, destinationBeforeGeneration] =
      await Promise.all([
        captureEnvironmentFingerprint(sourceClient),
        captureEnvironmentFingerprint(destinationClient),
      ]);
    console.log('[content-diff e2e] Running the actual content:diff command');
    try {
      await runCli({
        binPath: pluginDevBin,
        args: buildContentDiffArgs({
          scenario,
          name: `real CMA ${runId}`,
          sourceEnvironmentId: environmentIds.source,
          destinationEnvironmentId: environmentIds.destination,
          itemTypeApiKeys: seed.itemTypeApiKeys,
          configPath,
        }),
        cwd: workspace,
        apiToken: configuration.apiToken,
      });
    } catch (error) {
      const expectedFailure = scenario.expectedGenerationFailure;
      if (!expectedFailure) throw error;

      assert.match(safeError(error).message, expectedFailure.messagePattern);
      const [sourceAfterFailure, destinationAfterFailure] = await Promise.all([
        captureEnvironmentFingerprint(sourceClient),
        captureEnvironmentFingerprint(destinationClient),
      ]);
      assert.equal(
        sourceAfterFailure,
        sourceBeforeGeneration,
        'failed content:diff generation mutated the source environment',
      );
      assert.equal(
        destinationAfterFailure,
        destinationBeforeGeneration,
        'failed content:diff generation mutated the destination environment',
      );
      assert.deepEqual(
        await readdir(migrationsDirectory),
        [],
        'failed content:diff generation left migration artifacts behind',
      );
      console.log('[content-diff e2e] Expected generation failure observed');
      throw new ExpectedGenerationFailureObserved();
    }
    if (scenario.expectedGenerationFailure) {
      throw new Error(
        'content:diff succeeded but generation was expected to fail',
      );
    }
    const [sourceAfterGeneration, destinationAfterGeneration] =
      await Promise.all([
        captureEnvironmentFingerprint(sourceClient),
        captureEnvironmentFingerprint(destinationClient),
      ]);
    assert.equal(
      sourceAfterGeneration,
      sourceBeforeGeneration,
      'content:diff generation mutated the source environment',
    );
    assert.equal(
      destinationAfterGeneration,
      destinationBeforeGeneration,
      'content:diff generation mutated the destination environment',
    );

    const migrationFormat = scenario.migrationFormat ?? 'js';
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((filename) =>
        new RegExp(`^\\d+.*\\.${migrationFormat}$`).test(filename),
      )
      .sort();
    assert.equal(
      migrationFiles.length,
      1,
      `content:diff did not generate exactly one ${migrationFormat.toUpperCase()} migration`,
    );
    const migrationFilename = migrationFiles[0];
    const migrationFilePath = join(migrationsDirectory, migrationFilename);
    const planFilePath = join(
      migrationsDirectory,
      '.datocms-content',
      migrationFilename.replace(/\.(?:js|ts)$/, '.plan.json'),
    );
    await Promise.all([access(migrationFilePath), access(planFilePath)]);
    if (scenario.verifyGeneratedPlan) {
      await scenario.verifyGeneratedPlan({
        seed,
        expected,
        sourceClient,
        destinationClient,
        migrationFilename,
        migrationFilePath,
        planFilePath,
      });
    }

    await assertEnvironmentIdIsUnoccupied(rootClient, environmentIds.applied);
    console.log('[content-diff e2e] Running the bundled migrations:run');
    try {
      await runCli({
        binPath: pluginDevBin,
        args: [
          'migrations:run',
          `--source=${environmentIds.destination}`,
          `--destination=${environmentIds.applied}`,
          `--config-file=${configPath}`,
        ],
        cwd: workspace,
        apiToken: configuration.apiToken,
      });
      createdEnvironmentIds.push(environmentIds.applied);
    } catch (error) {
      await trackAppliedEnvironmentAfterFailure({
        rootClient,
        apiToken: configuration.apiToken,
        sourceEnvironmentId: environmentIds.destination,
        destinationEnvironmentId: environmentIds.applied,
        migrationModelApiKey,
        createdEnvironmentIds,
      });
      throw error;
    }

    const appliedClient = buildClient(
      configuration.apiToken,
      environmentIds.applied,
    );
    assert.ok(scenario.verify, 'successful scenario must define verify()');
    await scenario.verify({
      seed,
      expected,
      sourceClient,
      destinationClient,
      appliedClient,
      migrationFilename,
      migrationFilePath,
      planFilePath,
      migrationModelApiKey,
    });

    await assertGeneratedMigrationIsIdempotent({
      appliedClient,
      appliedEnvironmentId: environmentIds.applied,
      migrationFilePath,
    });
    await assertRegeneratedDiffIsNoop({
      scenario,
      seed,
      sourceEnvironmentId: environmentIds.source,
      appliedEnvironmentId: environmentIds.applied,
      migrationModelApiKey,
      apiToken: configuration.apiToken,
    });

    console.log('[content-diff e2e] Scenario passed');
  } catch (error) {
    if (!(error instanceof ExpectedGenerationFailureObserved)) {
      primaryFailure = safeError(error);
    }
  }

  const cleanupErrors: Error[] = [];
  try {
    await rm(workspace, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(
      safeError(error, `could not remove local E2E workspace ${workspace}`),
    );
  }

  if (configuration.keepEnvironments) {
    if (createdEnvironmentIds.length > 0) {
      console.log(
        `[content-diff e2e] KEEP enabled; retained environments: ${createdEnvironmentIds.join(
          ', ',
        )}`,
      );
    }
  } else {
    cleanupErrors.push(
      ...(await cleanupEnvironments(rootClient, createdEnvironmentIds)),
    );
  }

  const cleanupFailure =
    cleanupErrors.length > 0
      ? new Error(
          `one or more E2E resources could not be cleaned up: ${cleanupErrors
            .map(({ message }) => message)
            .join('; ')}`,
        )
      : undefined;

  if (cleanupFailure && primaryFailure) {
    console.error(`[content-diff e2e] ${cleanupFailure.message}`);
  }

  if (primaryFailure) {
    throw primaryFailure;
  }

  if (cleanupFailure) {
    throw cleanupFailure;
  }
}

function buildContentDiffArgs<Seed extends RealCmaScenarioSeed, Expected>({
  scenario,
  name,
  sourceEnvironmentId,
  destinationEnvironmentId,
  itemTypeApiKeys,
  configPath,
  json = false,
}: Readonly<{
  scenario: RealCmaScenario<Seed, Expected>;
  name: string;
  sourceEnvironmentId: string;
  destinationEnvironmentId: string;
  itemTypeApiKeys: readonly string[];
  configPath: string;
  json?: boolean;
}>): string[] {
  const scenarioArgs = scenario.contentDiffArgs ?? [];
  const migrationFormat = scenario.migrationFormat ?? 'js';
  const hasUploadScope = scenarioArgs.some((argument) =>
    argument.startsWith('--uploads='),
  );

  return [
    'content:diff',
    name,
    `--autogenerate=${sourceEnvironmentId}:${destinationEnvironmentId}`,
    `--item-types=${itemTypeApiKeys.join(',')}`,
    ...(hasUploadScope ? [] : ['--uploads=referenced']),
    `--${migrationFormat}`,
    `--config-file=${configPath}`,
    ...scenarioArgs,
    ...(json ? ['--json'] : []),
  ];
}

async function assertGeneratedMigrationIsIdempotent({
  appliedClient,
  appliedEnvironmentId,
  migrationFilePath,
}: Readonly<{
  appliedClient: CmaClient.Client;
  appliedEnvironmentId: string;
  migrationFilePath: string;
}>): Promise<void> {
  console.log(
    '[content-diff e2e] Invoking the generated wrapper directly to prove replay is mutation-free',
  );
  const before = await captureEnvironmentFingerprint(appliedClient);
  await invokeGeneratedMigrationForReplay(
    migrationFilePath,
    appliedClient,
    appliedEnvironmentId,
  );
  const after = await captureEnvironmentFingerprint(appliedClient);
  assert.equal(
    after,
    before,
    'direct replay of the generated migration changed raw CMA state',
  );
}

type GeneratedMigration = (
  client: CmaClient.Client,
  executionContext?: Readonly<{
    environmentId: string;
    inPlace: boolean;
    allowPrimary: boolean;
    contentDiffProtocolVersion: 1;
  }>,
) => Promise<void> | void;

/**
 * Load replay artifacts through the same transpile-only loader used by
 * migrations:run. In particular, type-only imports are erased instead of
 * being resolved from the harness's temporary artifact directory.
 */
export function loadGeneratedMigrationForReplay(
  migrationFilePath: string,
): GeneratedMigration {
  const requiredModule = requireWithCoreTsx(
    migrationFilePath,
    coreMigrationRunnerPath,
  );
  const defaultExport =
    requiredModule !== null &&
    typeof requiredModule === 'object' &&
    'default' in requiredModule
      ? requiredModule.default
      : undefined;
  const loadedModule =
    typeof requiredModule === 'function'
      ? requiredModule
      : typeof defaultExport === 'function'
        ? defaultExport
        : undefined;
  if (typeof loadedModule !== 'function') {
    throw new Error('generated migration does not export a function');
  }

  return loadedModule as GeneratedMigration;
}

export async function invokeGeneratedMigrationForReplay(
  migrationFilePath: string,
  client: CmaClient.Client,
  environmentId: string,
): Promise<void> {
  const migration = loadGeneratedMigrationForReplay(migrationFilePath);
  const guardedClient = guardCmaClientAgainstMutations(client);
  await Reflect.apply(migration, undefined, [
    guardedClient,
    {
      environmentId,
      inPlace: false,
      allowPrimary: false,
      contentDiffProtocolVersion: 1,
    },
  ]);
}

/**
 * Keeps the replay check honest: unchanged final bytes are insufficient if a
 * migration still issued idempotent writes and triggered audit/webhook side
 * effects. Every runtime mutator is rejected while real CMA reads continue.
 */
export function guardCmaClientAgainstMutationsForTest<T extends object>(
  client: T,
): T {
  return guardObjectAgainstMutations(client, '', new WeakMap()) as T;
}

function guardCmaClientAgainstMutations(
  client: CmaClient.Client,
): CmaClient.Client {
  return guardCmaClientAgainstMutationsForTest(client);
}

function guardObjectAgainstMutations(
  target: object,
  path: string,
  proxies: WeakMap<object, object>,
): object {
  const existing = proxies.get(target);
  if (existing) return existing;

  const proxy = new Proxy(target, {
    get(current, property) {
      const value = Reflect.get(current, property, current) as unknown;
      const key = typeof property === 'string' ? property : String(property);
      const childPath = path ? `${path}.${key}` : key;

      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          if (
            GENERATED_REPLAY_MUTATION_METHODS.has(key) ||
            key.startsWith('activate') ||
            key.startsWith('bulk')
          ) {
            throw new Error(
              `generated migration replay attempted CMA mutation ${childPath}`,
            );
          }
          return Reflect.apply(value, current, args);
        };
      }

      if (value !== null && typeof value === 'object') {
        return guardObjectAgainstMutations(value, childPath, proxies);
      }

      return value;
    },
  });
  proxies.set(target, proxy);
  return proxy;
}

async function assertRegeneratedDiffIsNoop<
  Seed extends RealCmaScenarioSeed,
  Expected,
>({
  scenario,
  seed,
  sourceEnvironmentId,
  appliedEnvironmentId,
  migrationModelApiKey,
  apiToken,
}: Readonly<{
  scenario: RealCmaScenario<Seed, Expected>;
  seed: Seed;
  sourceEnvironmentId: string;
  appliedEnvironmentId: string;
  migrationModelApiKey: string;
  apiToken: string;
}>): Promise<void> {
  console.log(
    '[content-diff e2e] Regenerating source -> applied and requiring a zero-operation JSON plan',
  );
  const workspace = await mkdtemp(
    join(tmpdir(), 'datocms-content-diff-e2e-regenerate-'),
  );

  try {
    const migrationsDirectory = join(workspace, 'migrations');
    const configPath = join(workspace, 'datocms.config.json');
    await mkdir(migrationsDirectory);
    await writeFile(
      configPath,
      JSON.stringify(
        {
          profiles: {
            default: {
              apiTokenEnvName: API_TOKEN_ENV,
              logLevel: 'NONE',
              migrations: {
                directory: 'migrations',
                modelApiKey: migrationModelApiKey,
              },
            },
          },
        },
        null,
        2,
      ),
    );
    const result = await runCli({
      binPath: pluginDevBin,
      args: buildContentDiffArgs({
        scenario,
        name: 'real CMA regenerated no-op',
        sourceEnvironmentId,
        destinationEnvironmentId: appliedEnvironmentId,
        itemTypeApiKeys: seed.itemTypeApiKeys,
        configPath,
        json: true,
      }),
      cwd: workspace,
      apiToken,
    });
    const output = parseJsonObject(result.stdout, 'content:diff JSON output');
    const summary = parseJsonObject(output.summary, 'content:diff summary');
    const counts = parseJsonObject(summary.counts, 'content:diff counts');
    for (const [name, count] of Object.entries(counts)) {
      assert.equal(
        count,
        0,
        `regenerated content diff reports non-zero ${name}`,
      );
    }
    assert.equal(summary.destructiveActionCount, 0);
    const legacyIds = parseJsonObject(
      summary.legacyIds,
      'content:diff legacy-ID summary',
    );
    assert.equal(legacyIds.requiresLegacyIdRemapping, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export function loadHarnessConfiguration(): HarnessConfiguration {
  if (process.env[E2E_OPT_IN_ENV] !== '1') {
    throw new Error(
      `${E2E_OPT_IN_ENV}=1 is required; refusing to run a mutating real-CMA test`,
    );
  }

  const apiToken = process.env[API_TOKEN_ENV];
  if (!apiToken) {
    throw new Error(
      `${API_TOKEN_ENV} must contain a CMA token for the disposable E2E project`,
    );
  }

  return {
    apiToken,
    keepEnvironments: process.env[E2E_KEEP_ENV] === '1',
  };
}

async function assertDisposableProjectSafety({
  apiToken,
  primaryEnvironmentId,
  projectId,
  projectName,
}: Readonly<{
  apiToken: string;
  primaryEnvironmentId: string;
  projectId: string;
  projectName: string;
}>): Promise<void> {
  const primaryClient = buildClient(apiToken, primaryEnvironmentId);
  const [itemTypes, items, uploads] = await Promise.all([
    primaryClient.itemTypes.list(),
    primaryClient.items.rawList({ page: { limit: 1 } }),
    primaryClient.uploads.rawList({ page: { limit: 1 } }),
  ]);
  const counts = {
    models: itemTypes.length,
    records: items.meta.total_count,
    uploads: uploads.meta.total_count,
  };
  const isEmpty = Object.values(counts).every((count) => count === 0);

  if (isEmpty) {
    return;
  }

  const markerMatches = process.env[E2E_DISPOSABLE_PROJECT_ENV] === projectId;
  const nameMatches = DISPOSABLE_PROJECT_NAME.test(projectName);

  if (!markerMatches || !nameMatches) {
    throw new Error(
      [
        `refusing to run against non-empty project ${JSON.stringify(
          projectName,
        )} (${projectId})`,
        `primary contains ${counts.models} model(s), ${counts.records} record(s), and ${counts.uploads} upload(s)`,
        `the project name must contain e2e, test, or disposable as a separate word and ${E2E_DISPOSABLE_PROJECT_ENV} must exactly equal ${projectId}`,
      ].join('; '),
    );
  }
}

export function buildClient(
  apiToken: string,
  environment?: string,
): CmaClient.Client {
  return CmaClient.buildClient({
    apiToken,
    ...(environment ? { environment } : {}),
    autoRetry: true,
    requestTimeout: 120_000,
    logLevel: CmaClient.LogLevel.NONE,
  });
}

async function forkEnvironment(
  rootClient: CmaClient.Client,
  sourceEnvironmentId: string,
  destinationEnvironmentId: string,
  createdEnvironmentIds: string[],
): Promise<void> {
  await assertEnvironmentIdIsUnoccupied(rootClient, destinationEnvironmentId);
  console.log(
    `[content-diff e2e] Forking ${sourceEnvironmentId} -> ${destinationEnvironmentId}`,
  );
  try {
    await rootClient.environments.fork(sourceEnvironmentId, {
      id: destinationEnvironmentId,
    });
    createdEnvironmentIds.push(destinationEnvironmentId);
  } catch (error) {
    if (
      !(
        error instanceof CmaClient.ApiError &&
        error.findError('VALIDATION_UNIQUENESS')
      )
    ) {
      await trackForkAfterAmbiguousFailure({
        rootClient,
        sourceEnvironmentId,
        destinationEnvironmentId,
        createdEnvironmentIds,
      });
    }
    throw error;
  }
}

async function assertEnvironmentIdIsUnoccupied(
  rootClient: CmaClient.Client,
  environmentId: string,
): Promise<void> {
  const existing = await findEnvironmentOrNull(rootClient, environmentId);
  assert.equal(
    existing,
    null,
    `refusing to use existing environment ID ${environmentId}`,
  );
}

async function trackForkAfterAmbiguousFailure({
  rootClient,
  sourceEnvironmentId,
  destinationEnvironmentId,
  createdEnvironmentIds,
}: Readonly<{
  rootClient: CmaClient.Client;
  sourceEnvironmentId: string;
  destinationEnvironmentId: string;
  createdEnvironmentIds: string[];
}>): Promise<void> {
  const candidate = await findEnvironmentOrNull(
    rootClient,
    destinationEnvironmentId,
  );
  if (candidate?.meta.forked_from === sourceEnvironmentId) {
    createdEnvironmentIds.push(destinationEnvironmentId);
  }
}

async function trackAppliedEnvironmentAfterFailure({
  rootClient,
  apiToken,
  sourceEnvironmentId,
  destinationEnvironmentId,
  migrationModelApiKey,
  createdEnvironmentIds,
}: Readonly<{
  rootClient: CmaClient.Client;
  apiToken: string;
  sourceEnvironmentId: string;
  destinationEnvironmentId: string;
  migrationModelApiKey: string;
  createdEnvironmentIds: string[];
}>): Promise<void> {
  const candidate = await findEnvironmentOrNull(
    rootClient,
    destinationEnvironmentId,
  );
  if (candidate?.meta.forked_from !== sourceEnvironmentId) return;

  try {
    const candidateClient = buildClient(apiToken, destinationEnvironmentId);
    const itemTypes = await candidateClient.itemTypes.list();
    if (
      appliedEnvironmentOwnershipIsProven({
        candidate,
        sourceEnvironmentId,
        itemTypeApiKeys: itemTypes.map(({ api_key }) => api_key),
        migrationModelApiKey,
      })
    ) {
      createdEnvironmentIds.push(destinationEnvironmentId);
    }
  } catch {
    // If ownership cannot be proved through the per-run tracking model, leave
    // the cde2e-prefixed sandbox for manual cleanup instead of risking deletion
    // of an environment created by another process after the absence check.
  }
}

export function appliedEnvironmentOwnershipIsProven({
  candidate,
  sourceEnvironmentId,
  itemTypeApiKeys,
  migrationModelApiKey,
}: Readonly<{
  candidate: null | Readonly<{
    meta: Readonly<{ forked_from: string | null }>;
  }>;
  sourceEnvironmentId: string;
  itemTypeApiKeys: readonly string[];
  migrationModelApiKey: string;
}>): boolean {
  return (
    candidate?.meta.forked_from === sourceEnvironmentId &&
    itemTypeApiKeys.includes(migrationModelApiKey)
  );
}

async function findEnvironmentOrNull(
  rootClient: CmaClient.Client,
  environmentId: string,
): Promise<CmaClient.ApiTypes.Environment | null> {
  try {
    return await rootClient.environments.find(environmentId);
  } catch (error) {
    if (error instanceof CmaClient.ApiError && error.findError('NOT_FOUND')) {
      return null;
    }
    throw error;
  }
}

async function cleanupEnvironments(
  rootClient: CmaClient.Client,
  createdEnvironmentIds: readonly string[],
): Promise<Error[]> {
  const errors: Error[] = [];

  for (const environmentId of [...createdEnvironmentIds].reverse()) {
    try {
      console.log(`[content-diff e2e] Destroying ${environmentId}`);
      await rootClient.environments.destroy(environmentId);
    } catch (error) {
      if (error instanceof CmaClient.ApiError && error.findError('NOT_FOUND')) {
        continue;
      }

      errors.push(safeError(error, `could not destroy ${environmentId}`));
    }
  }

  return errors;
}

async function runCli({
  binPath,
  args,
  cwd,
  apiToken,
}: Readonly<{
  binPath: string;
  args: readonly string[];
  cwd: string;
  apiToken: string;
}>): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd,
      env: {
        ...process.env,
        DATOCMS_API_TOKEN: apiToken,
        DATOCMS_PROFILE: 'default',
      },
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
    child.once('error', (error) => {
      rejectPromise(
        new Error(
          `could not start ${basename(binPath)}: ${redact(
            error.message,
            apiToken,
          )}`,
        ),
      );
    });
    child.once('close', (exitCode, signal) => {
      if (exitCode === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      rejectPromise(
        new Error(
          [
            `${basename(binPath)} exited with ${
              exitCode ?? `signal ${signal}`
            }`,
            redact(stdout, apiToken).trim(),
            redact(stderr, apiToken).trim(),
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      );
    });
  });
}

export async function captureEnvironmentFingerprint(
  client: CmaClient.Client,
): Promise<string> {
  const [
    site,
    itemTypeResponse,
    currentItems,
    publishedItems,
    uploads,
    collections,
  ] = await Promise.all([
    client.site.rawFind().then(({ data }) => data),
    client.itemTypes.rawList(),
    captureAllRawItems(client, 'current'),
    captureAllRawItems(client, 'published'),
    captureAllRawUploads(client),
    client.uploadCollections.rawList().then(({ data }) => data),
  ]);
  const itemTypes = sortResourcesById(itemTypeResponse.data);
  const schema = await Promise.all(
    itemTypes.map(async (itemType) => {
      const [fields, fieldsets] = await Promise.all([
        client.fields.rawList(itemType.id).then(({ data }) => data),
        client.fieldsets.rawList(itemType.id).then(({ data }) => data),
      ]);
      return {
        itemType,
        fields: sortResourcesById(fields),
        fieldsets: sortResourcesById(fieldsets),
      };
    }),
  );
  const serialized = stableJson({
    // Site metadata contains asynchronously refreshed operational timestamps
    // (for example last_data_change_at). They can advance after the first
    // migration has already returned, which would make a read-only replay look
    // mutating. Keep only environment content semantics in this fingerprint.
    site: {
      id: site.id,
      locales: site.attributes.locales,
      timezone: site.attributes.timezone,
      environmentSemantics: {
        improvedTimezoneManagement: site.meta.improved_timezone_management,
        improvedBooleanFields: site.meta.improved_boolean_fields,
        improvedValidationAtPublishing:
          site.meta.improved_validation_at_publishing,
        millisecondsInDatetime: site.meta.milliseconds_in_datetime,
        nonLocalizedFocalPoints: site.meta.non_localized_focal_points,
        improvedHexManagement: site.meta.improved_hex_management,
      },
    },
    schema,
    content: {
      current: sortResourcesById(currentItems),
      published: sortResourcesById(publishedItems),
    },
    uploads: sortResourcesById(uploads),
    uploadCollections: sortResourcesById(collections),
  });
  return createHash('sha256').update(serialized).digest('hex');
}

async function captureAllRawItems(
  client: CmaClient.Client,
  version: 'current' | 'published',
): Promise<CmaClient.RawApiTypes.Item[]> {
  const resources: CmaClient.RawApiTypes.Item[] = [];
  let expectedTotal: number | null = null;

  while (expectedTotal === null || resources.length < expectedTotal) {
    const response = await client.items.rawList({
      nested: true,
      order_by: 'id_ASC',
      version,
      page: { offset: resources.length, limit: 30 },
    });
    if (expectedTotal === null) expectedTotal = response.meta.total_count;
    assert.equal(
      response.meta.total_count,
      expectedTotal,
      `${version} record count changed during fingerprint capture`,
    );
    if (response.data.length === 0) {
      assert.equal(
        resources.length,
        expectedTotal,
        `${version} record pagination ended early`,
      );
      break;
    }
    resources.push(...response.data);
  }

  return resources;
}

async function captureAllRawUploads(
  client: CmaClient.Client,
): Promise<CmaClient.RawApiTypes.Upload[]> {
  const resources: CmaClient.RawApiTypes.Upload[] = [];
  let expectedTotal: number | null = null;

  while (expectedTotal === null || resources.length < expectedTotal) {
    const response = await client.uploads.rawList({
      order_by: 'id_ASC',
      page: { offset: resources.length, limit: 500 },
    });
    if (expectedTotal === null) expectedTotal = response.meta.total_count;
    assert.equal(
      response.meta.total_count,
      expectedTotal,
      'upload count changed during fingerprint capture',
    );
    if (response.data.length === 0) {
      assert.equal(
        resources.length,
        expectedTotal,
        'upload pagination ended early',
      );
      break;
    }
    resources.push(...response.data);
  }

  return resources;
}

function sortResourcesById<T extends { id: string }>(
  resources: readonly T[],
): T[] {
  return [...resources].sort((left, right) => left.id.localeCompare(right.id));
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalizeForFingerprint(value));
}

function canonicalizeForFingerprint(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForFingerprint(entry) ?? null);
  }
  if (typeof value !== 'object') return String(value);

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, entry]) => {
        const canonical = canonicalizeForFingerprint(entry);
        return canonical === undefined ? [] : [[key, canonical]];
      }),
  );
}

function parseJsonObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object`);
  }
  return parsed as Record<string, unknown>;
}

async function captureGoldenRawState(
  client: CmaClient.Client,
  modelId: string,
): Promise<RawGoldenState> {
  const [current, published] = await Promise.all([
    client.items.rawList<GoldenFixtureDefinition>({
      filter: { type: modelId },
      version: 'current',
      page: { limit: 500 },
    }),
    client.items.rawList<GoldenFixtureDefinition>({
      filter: { type: modelId },
      version: 'published',
      page: { limit: 500 },
    }),
  ]);

  return {
    current: rawRecordsById(current.data),
    published: rawRecordsById(published.data),
    currentIds: current.data.map(({ id }) => id).sort(),
    publishedIds: published.data.map(({ id }) => id).sort(),
  };
}

function rawRecordsById(
  records: readonly CmaClient.RawApiTypes.Item<GoldenFixtureDefinition>[],
): Readonly<Record<string, RawGoldenRecord>> {
  return Object.fromEntries(
    records
      .map(
        (record) =>
          [
            record.id,
            {
              id: record.id,
              itemTypeId: record.relationships.item_type.data.id,
              title: record.attributes.title,
              body: record.attributes.body,
              related: record.attributes.related,
            },
          ] as const,
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function safeError(error: unknown, prefix?: string): Error {
  if (error instanceof CmaClient.ApiError) {
    const details = error.errors.map(({ attributes }) => ({
      code: attributes.code,
      details: attributes.details,
    }));
    return new Error(
      `${prefix ? `${prefix}: ` : ''}CMA ${
        error.response.status
      }: ${JSON.stringify(details)}`,
    );
  }

  if (error instanceof Error) {
    return new Error(`${prefix ? `${prefix}: ` : ''}${error.message}`);
  }

  return new Error(`${prefix ? `${prefix}: ` : ''}${String(error)}`);
}

function redact(value: string, apiToken: string): string {
  return value.split(apiToken).join('[REDACTED]');
}
