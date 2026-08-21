import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CmaClient, CmaClientCommand } from '@datocms/cli-utils';
import { runCommand } from '@oclif/test';
import { expect } from 'chai';
import { stableStringify } from '../../src/content-diff/canonicalize';

type BuildClient = (options?: { environment?: string }) => Promise<
  Record<string, unknown>
>;

const commandPrototype = CmaClientCommand.prototype as unknown as {
  buildClient: BuildClient;
};

function exactMigrationModel(): CmaClient.ApiTypes.ItemType {
  return {
    id: 'migration-model',
    type: 'item_type',
    name: 'Schema migration',
    api_key: 'schema_migration',
    modular_block: false,
    singleton: false,
    sortable: false,
    tree: false,
    draft_mode_active: false,
    draft_saving_active: false,
    all_locales_required: false,
    workflow: null,
  } as CmaClient.ApiTypes.ItemType;
}

function exactMigrationNameField(): CmaClient.ApiTypes.Field {
  return {
    id: 'migration-name-field',
    type: 'field',
    label: 'Migration file name',
    api_key: 'name',
    field_type: 'string',
    localized: false,
    default_value: null,
    validators: { required: {} },
  } as CmaClient.ApiTypes.Field;
}

function apiError(status: number, statusText: string): CmaClient.ApiError {
  return new CmaClient.ApiError({
    request: {
      url: '/item-types/schema_migration',
      method: 'GET',
      headers: {},
    },
    response: { status, statusText, headers: {} },
  });
}

async function writeBoundContentMigration(
  migrationsDirectory: string,
  options: {
    projectMode?: 'same_project' | 'aligned_projects';
    sourceSiteId?: string;
    targetSiteId?: string;
  } = {},
): Promise<{ migrationPath: string; manifestPath: string }> {
  const migrationBasename = '1700000100_bound';
  const manifestBasename = `${migrationBasename}.plan.json`;
  const migrationPath = join(migrationsDirectory, `${migrationBasename}.js`);
  const contentDirectory = join(migrationsDirectory, '.datocms-content');
  const manifestPath = join(contentDirectory, manifestBasename);
  const sourceSiteId = options.sourceSiteId ?? 'source-site';
  const targetSiteId = options.targetSiteId ?? 'target-site';
  const plan = {
    formatVersion: 10,
    source: {
      siteId: sourceSiteId,
      environmentId: 'main',
    },
    target: {
      siteId: targetSiteId,
      environmentId: 'main',
    },
    schema: { siteId: sourceSiteId },
    options: {
      projectMode: options.projectMode ?? 'aligned_projects',
    },
  };
  const manifest = {
    formatVersion: 10,
    runtimeVersion: '16',
    integrity: {
      algorithm: 'sha256',
      planSha256: createHash('sha256')
        .update(stableStringify(plan))
        .digest('hex'),
    },
    plan,
  };
  const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = createHash('sha256')
    .update(manifestContents)
    .digest('hex');
  const binding = {
    bindingVersion: 1,
    targetSiteId,
    manifestBasename,
    manifestSha256,
  };

  await mkdir(contentDirectory);
  await writeFile(manifestPath, manifestContents);
  await writeFile(
    migrationPath,
    `// datocms-content-diff-binding ${JSON.stringify(binding)}
// .datocms-content/runtime-v16
module.exports = async function () {
  globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
};
`,
  );

  return { migrationPath, manifestPath };
}

describe('migrations:run execution context', () => {
  let temporaryDirectory: string;
  let migrationsDirectory: string;
  let configPath: string;
  let originalBuildClient: BuildClient;
  let targetClient: Record<string, unknown>;
  let builtEnvironmentIds: Array<string | undefined>;
  let forkCalls: Array<{ sourceId: string; destinationId: string }>;
  let migrationRecordWrites: number;
  let actualSiteId: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'datocms-migrations-run-'),
    );
    migrationsDirectory = join(temporaryDirectory, 'migrations');
    configPath = join(temporaryDirectory, 'datocms.config.json');
    builtEnvironmentIds = [];
    forkCalls = [];
    migrationRecordWrites = 0;
    actualSiteId = 'target-site';

    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          default: {
            migrations: { directory: 'migrations' },
          },
        },
      }),
    );
    await mkdir(migrationsDirectory);

    const environments = [
      { id: 'primary', meta: { primary: true } },
      { id: 'source', meta: { primary: false } },
      { id: 'sandbox', meta: { primary: false } },
    ];
    const rootClient = {
      site: {
        find: async () => ({ id: actualSiteId }),
      },
      environments: {
        list: async () => environments,
        find: async (id: string) =>
          environments.find((environment) => environment.id === id),
        fork: async (sourceId: string, body: { id: string }) => {
          forkCalls.push({ sourceId, destinationId: body.id });
        },
      },
    };
    targetClient = {
      marker: 'target-client',
      itemTypes: {
        find: async () => exactMigrationModel(),
      },
      fields: {
        list: async () => [exactMigrationNameField()],
      },
      items: {
        async *listPagedIterator() {},
        create: async () => {
          migrationRecordWrites += 1;
          return { id: 'migration-record' };
        },
      },
    };

    originalBuildClient = commandPrototype.buildClient;
    commandPrototype.buildClient = async (options) => {
      builtEnvironmentIds.push(options?.environment);
      return options?.environment ? targetClient : rootClient;
    };
  });

  afterEach(async () => {
    commandPrototype.buildClient = originalBuildClient;
    (globalThis as Record<string, unknown>).__migrationContext = undefined;
    (globalThis as Record<string, unknown>).__oneArgumentMigrationClient =
      undefined;
    (globalThis as Record<string, unknown>).__migrationInvocations = undefined;
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('passes the actual fork target and flags while one-argument migrations remain compatible', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_old.js'),
      `module.exports = async function (client) {
        globalThis.__oneArgumentMigrationClient = client.marker;
      };`,
    );
    await writeFile(
      join(migrationsDirectory, '1700000001_context.js'),
      `module.exports = async function (client, context) {
        globalThis.__migrationContext = { client: client.marker, context };
      };`,
    );

    const { error } = await runCommand(
      `migrations:run --source=source --destination=generated-fork --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(forkCalls).to.deep.equal([
      { sourceId: 'source', destinationId: 'generated-fork' },
    ]);
    expect(builtEnvironmentIds).to.deep.equal([
      undefined,
      'source',
      'generated-fork',
    ]);
    expect(
      (globalThis as Record<string, unknown>).__oneArgumentMigrationClient,
    ).to.equal('target-client');
    expect(
      (globalThis as Record<string, unknown>).__migrationContext,
    ).to.deep.equal({
      client: 'target-client',
      context: {
        environmentId: 'generated-fork',
        inPlace: false,
        allowPrimary: false,
        contentDiffProtocolVersion: 1,
      },
    });
  });

  it('passes both explicit primary opt-ins to migrations', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_context.js'),
      `module.exports = async function (_client, context) {
        globalThis.__migrationContext = context;
      };`,
    );

    const { error, stderr } = await runCommand(
      `migrations:run --source=primary --in-place --allow-primary --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(
      (globalThis as Record<string, unknown>).__migrationContext,
    ).to.deep.equal({
      environmentId: 'primary',
      inPlace: true,
      allowPrimary: true,
      contentDiffProtocolVersion: 1,
    });
    expect(stderr).to.contain('no automatic rollback');
  });

  it('validates and runs a destination-bound content migration', async () => {
    await writeBoundContentMigration(migrationsDirectory);

    const { error } = await runCommand(
      `migrations:run --source=source --destination=generated-fork --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(forkCalls).to.deep.equal([
      { sourceId: 'source', destinationId: 'generated-fork' },
    ]);
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(1);
    expect(migrationRecordWrites).to.equal(1);
  });

  it('rejects a destination binding for another profile before any mutation', async () => {
    await writeBoundContentMigration(migrationsDirectory);
    actualSiteId = 'wrong-site';
    let migrationModelCreates = 0;
    targetClient.itemTypes = {
      find: async () => {
        throw apiError(404, 'Not Found');
      },
      create: async () => {
        migrationModelCreates += 1;
        return exactMigrationModel();
      },
    };

    const { error } = await runCommand(
      `migrations:run --source=source --destination=generated-fork --config-file=${configPath}`,
    );

    expect(error?.message).to.contain('active profile targets "wrong-site"');
    expect(forkCalls).to.deep.equal([]);
    expect(migrationModelCreates).to.equal(0);
    expect(migrationRecordWrites).to.equal(0);
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(undefined);
  });

  it('rejects a tampered manifest before creating a fork or tracking record', async () => {
    const { manifestPath } =
      await writeBoundContentMigration(migrationsDirectory);
    await writeFile(manifestPath, '{"tampered":true}\n');

    const { error } = await runCommand(
      `migrations:run --source=source --destination=generated-fork --config-file=${configPath}`,
    );

    expect(error?.message).to.contain('manifest integrity validation failed');
    expect(forkCalls).to.deep.equal([]);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('rejects a manifest path binding that does not match the migration filename', async () => {
    const { migrationPath } =
      await writeBoundContentMigration(migrationsDirectory);
    const source = await readFile(migrationPath, 'utf8');
    await writeFile(
      migrationPath,
      source.replace(
        '1700000100_bound.plan.json',
        '1700000100_other.plan.json',
      ),
    );

    const { error } = await runCommand(
      `migrations:run --source=source --destination=generated-fork --config-file=${configPath}`,
    );

    expect(error?.message).to.contain('instead of');
    expect(forkCalls).to.deep.equal([]);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('rejects a runtime-v16 wrapper whose static binding was removed', async () => {
    const { migrationPath } =
      await writeBoundContentMigration(migrationsDirectory);
    const source = await readFile(migrationPath, 'utf8');
    await writeFile(
      migrationPath,
      source
        .split(/\r?\n/u)
        .filter((line) => !line.startsWith('// datocms-content-diff-binding '))
        .join('\n'),
    );

    const { error } = await runCommand(
      `migrations:run --source=source --destination=generated-fork --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'missing its required static destination binding',
    );
    expect(forkCalls).to.deep.equal([]);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('rejects a static target-site binding that was changed independently of its manifest', async () => {
    const { migrationPath } =
      await writeBoundContentMigration(migrationsDirectory);
    const source = await readFile(migrationPath, 'utf8');
    await writeFile(
      migrationPath,
      source.replace(
        '"targetSiteId":"target-site"',
        '"targetSiteId":"other-site"',
      ),
    );

    const { error } = await runCommand(
      `migrations:run --source=source --destination=generated-fork --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'static destination binding does not match the manifest target site',
    );
    expect(forkCalls).to.deep.equal([]);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('rejects inconsistent project-mode metadata before any mutation', async () => {
    await writeBoundContentMigration(migrationsDirectory, {
      projectMode: 'same_project',
      sourceSiteId: 'source-site',
      targetSiteId: 'target-site',
    });

    const { error } = await runCommand(
      `migrations:run --source=source --destination=generated-fork --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'inconsistent project-mode or endpoint metadata',
    );
    expect(forkCalls).to.deep.equal([]);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('validates destination bindings during dry runs without mutating or invoking scripts', async () => {
    await writeBoundContentMigration(migrationsDirectory);

    const { error } = await runCommand(
      `migrations:run --source=source --destination=generated-fork --dry-run --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(forkCalls).to.deep.equal([]);
    expect(migrationRecordWrites).to.equal(0);
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(undefined);
  });

  it('keeps unbound runtime-v15 content migrations runnable', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000100_legacyContentDiff.js'),
      `// .datocms-content/runtime-v15\nmodule.exports = async function () {
        globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
      };`,
    );

    const { error } = await runCommand(
      `migrations:run --source=sandbox --in-place --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(1);
    expect(migrationRecordWrites).to.equal(1);
  });

  it('retains the primary guard and does not invoke a migration without --allow-primary', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_context.js'),
      `module.exports = async function () {
        globalThis.__migrationContext = 'invoked';
      };`,
    );

    const { error } = await runCommand(
      `migrations:run --source=primary --in-place --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'Running migrations on primary environment is not allowed',
    );
    expect((globalThis as Record<string, unknown>).__migrationContext).to.equal(
      undefined,
    );
    expect(builtEnvironmentIds).to.deep.equal([undefined]);
  });

  it('rejects --allow-primary unless --in-place is also explicit', async () => {
    const { error } = await runCommand(
      `migrations:run --source=primary --allow-primary --config-file=${configPath}`,
    );

    expect(error?.message).to.contain('--allow-primary');
    expect(error?.message).to.contain('--in-place');
    expect(builtEnvironmentIds).to.deep.equal([]);
  });

  it('rejects the reserved content-diff ledger as the configured migrations model before any CMA call', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          default: {
            migrations: {
              directory: 'migrations',
              modelApiKey: 'datocms_content_diff',
            },
          },
        },
      }),
    );

    const { error } = await runCommand(
      `migrations:run --source=source --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'reserved for the content-diff legacy-ID mapping ledger',
    );
    expect(builtEnvironmentIds).to.deep.equal([undefined]);
    expect(forkCalls).to.deep.equal([]);
  });

  it('rejects a reserved --migrations-model override before any CMA call', async () => {
    const { error } = await runCommand(
      `migrations:run --source=source --migrations-model=datocms_content_diff --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'reserved for the content-diff legacy-ID mapping ledger',
    );
    expect(builtEnvironmentIds).to.deep.equal([undefined]);
    expect(forkCalls).to.deep.equal([]);
  });

  it('fails closed before invoking scripts when the tracker lookup API fails', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_count.js'),
      `module.exports = async function () {
        globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
      };`,
    );
    targetClient.itemTypes = {
      find: async () => {
        throw apiError(403, 'Forbidden');
      },
    };

    const { error } = await runCommand(
      `migrations:run --source=sandbox --in-place --config-file=${configPath}`,
    );

    expect(error?.message).to.contain('403 Forbidden');
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(undefined);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('fails closed before invoking scripts when tracker model creation fails', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_count.js'),
      `module.exports = async function () {
        globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
      };`,
    );
    targetClient.itemTypes = {
      find: async () => {
        throw apiError(404, 'Not Found');
      },
      create: async () => {
        throw apiError(403, 'Forbidden');
      },
    };

    const { error } = await runCommand(
      `migrations:run --source=sandbox --in-place --config-file=${configPath}`,
    );

    expect(error?.message).to.contain('403 Forbidden');
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(undefined);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('fails closed before invoking scripts when tracker fields cannot be read', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_count.js'),
      `module.exports = async function () {
        globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
      };`,
    );
    targetClient.fields = {
      list: async () => {
        throw apiError(403, 'Forbidden');
      },
    };

    const { error } = await runCommand(
      `migrations:run --source=sandbox --in-place --config-file=${configPath}`,
    );

    expect(error?.message).to.contain('403 Forbidden');
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(undefined);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('keeps compatible custom tracking models with optional audit fields working', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_count.js'),
      `module.exports = async function () {
        globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
      };`,
    );
    targetClient.itemTypes = {
      find: async () => ({
        ...exactMigrationModel(),
        name: 'User-owned model',
      }),
    };
    targetClient.fields = {
      list: async () => [
        {
          ...exactMigrationNameField(),
          label: 'Applied migration',
          validators: {},
        },
        {
          id: 'optional-audit-note',
          type: 'field',
          label: 'Audit note',
          api_key: 'audit_note',
          field_type: 'string',
          localized: false,
          default_value: null,
          validators: {},
        },
      ],
    };

    const { error } = await runCommand(
      `migrations:run --source=sandbox --in-place --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(1);
    expect(migrationRecordWrites).to.equal(1);
  });

  it('rejects an unusable custom tracker before invoking scripts', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_count.js'),
      `module.exports = async function () {
        globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
      };`,
    );
    targetClient.fields = {
      list: async () => [
        exactMigrationNameField(),
        {
          id: 'required-audit-note',
          type: 'field',
          label: 'Audit note',
          api_key: 'audit_note',
          field_type: 'string',
          localized: false,
          default_value: null,
          validators: { required: {} },
        },
      ],
    };

    const { error } = await runCommand(
      `migrations:run --source=sandbox --in-place --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'cannot safely track migration file names',
    );
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(undefined);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('does not repair a fieldless tracker when migration history already exists', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_count.js'),
      `module.exports = async function () {
        globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
      };`,
    );
    let fieldCreateCalls = 0;
    targetClient.fields = {
      list: async () => [],
      create: async () => {
        fieldCreateCalls += 1;
        return exactMigrationNameField();
      },
    };
    targetClient.items = {
      async *listPagedIterator() {
        yield { id: 'orphaned-migration-record' };
      },
      create: async () => {
        migrationRecordWrites += 1;
        return { id: 'migration-record' };
      },
    };

    const { error } = await runCommand(
      `migrations:run --source=sandbox --in-place --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'cannot safely reconstruct the lost migration history',
    );
    expect(fieldCreateCalls).to.equal(0);
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(undefined);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('fails closed when an existing tracker record has no migration name', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_count.js'),
      `module.exports = async function () {
        globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
      };`,
    );
    targetClient.items = {
      async *listPagedIterator() {
        yield { id: 'invalid-migration-record', name: null };
      },
      create: async () => {
        migrationRecordWrites += 1;
        return { id: 'migration-record' };
      },
    };

    const { error } = await runCommand(
      `migrations:run --source=sandbox --in-place --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'cannot safely determine which scripts already ran',
    );
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(undefined);
    expect(migrationRecordWrites).to.equal(0);
  });

  it('fails closed on field creation and resumes an exact partial tracker on rerun', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_count.js'),
      `module.exports = async function () {
        globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
      };`,
    );
    const model = exactMigrationModel();
    const nameField = exactMigrationNameField();
    let modelExists = false;
    let fieldExists = false;
    let modelCreateCalls = 0;
    let fieldCreateCalls = 0;
    targetClient.itemTypes = {
      find: async () => {
        if (!modelExists) throw apiError(404, 'Not Found');
        return model;
      },
      create: async () => {
        modelCreateCalls += 1;
        modelExists = true;
        return model;
      },
    };
    targetClient.fields = {
      list: async () => (fieldExists ? [nameField] : []),
      create: async () => {
        fieldCreateCalls += 1;
        if (fieldCreateCalls === 1) throw apiError(403, 'Forbidden');
        fieldExists = true;
        return nameField;
      },
    };

    const firstRun = await runCommand(
      `migrations:run --source=sandbox --in-place --config-file=${configPath}`,
    );

    expect(firstRun.error?.message).to.contain('403 Forbidden');
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(undefined);
    expect(migrationRecordWrites).to.equal(0);
    expect(modelCreateCalls).to.equal(1);
    expect(fieldCreateCalls).to.equal(1);

    const secondRun = await runCommand(
      `migrations:run --source=sandbox --in-place --config-file=${configPath}`,
    );

    expect(secondRun.error).to.equal(undefined);
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(1);
    expect(migrationRecordWrites).to.equal(1);
    expect(modelCreateCalls).to.equal(1);
    expect(fieldCreateCalls).to.equal(2);
  });

  it('keeps dry-run read-only when the tracker model is absent', async () => {
    await writeFile(
      join(migrationsDirectory, '1700000000_count.js'),
      `module.exports = async function () {
        globalThis.__migrationInvocations = (globalThis.__migrationInvocations || 0) + 1;
      };`,
    );
    let modelCreateCalls = 0;
    targetClient.itemTypes = {
      find: async () => {
        throw apiError(404, 'Not Found');
      },
      create: async () => {
        modelCreateCalls += 1;
        return exactMigrationModel();
      },
    };

    const { error, stdout } = await runCommand(
      `migrations:run --source=source --destination=generated-fork --dry-run --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(stdout).to.contain(
      'Migrations will be simulated (dry run) in "generated-fork" sandbox environment',
    );
    expect(stdout).to.contain(
      'Successfully simulated 1 migration scripts (dry run, no changes were made)',
    );
    expect(forkCalls).to.deep.equal([]);
    expect(modelCreateCalls).to.equal(0);
    expect(
      (globalThis as Record<string, unknown>).__migrationInvocations,
    ).to.equal(undefined);
    expect(migrationRecordWrites).to.equal(0);
  });
});
