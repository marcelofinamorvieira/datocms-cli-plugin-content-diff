import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { type CmaClient, CmaClientCommand } from '@datocms/cli-utils';
import { runCommand } from '@oclif/test';
import { expect } from 'chai';
import ContentDiffCommand from '../../../src/commands/content/diff';
import {
  ContentDiffError,
  type ContentDiffMigrationSummary,
} from '../../../src/content-diff';

type GenerateMigration = typeof ContentDiffCommand.generateMigration;
type GenerateMigrationInput = Parameters<GenerateMigration>[0];
type GenerateMigrationResult = Awaited<ReturnType<GenerateMigration>>;

const commandPrototype = CmaClientCommand.prototype as unknown as {
  buildClient: (options?: { environment?: string }) => Promise<unknown>;
};

describe('content:diff', () => {
  let temporaryDirectory: string;
  let configPath: string;
  let capturedInput: GenerateMigrationInput | undefined;
  let generatedSummary: ContentDiffMigrationSummary;
  let originalBuildClient: typeof commandPrototype.buildClient;
  let originalGenerateMigration: GenerateMigration;
  let originalBuildProfileClient: typeof ContentDiffCommand.buildProfileClient;
  let originalResolveLinkedSiteToken: typeof ContentDiffCommand.resolveLinkedSiteToken;

  beforeEach(async () => {
    capturedInput = undefined;
    generatedSummary = buildGeneratedSummary();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'datocms-content-diff-'));
    configPath = join(temporaryDirectory, 'datocms.config.json');

    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          default: {
            migrations: {
              directory: 'custom-migrations',
              modelApiKey: 'migration_log',
              tsconfig: 'tsconfig.migrations.json',
            },
          },
        },
      }),
    );

    originalBuildClient = commandPrototype.buildClient;
    commandPrototype.buildClient = async () => ({
      environments: {
        list: async () => [
          { id: 'primary', meta: { primary: true } },
          { id: 'source', meta: { primary: false } },
          { id: 'destination', meta: { primary: false } },
        ],
      },
    });

    originalGenerateMigration = ContentDiffCommand.generateMigration;
    originalBuildProfileClient = ContentDiffCommand.buildProfileClient;
    originalResolveLinkedSiteToken = ContentDiffCommand.resolveLinkedSiteToken;
    ContentDiffCommand.generateMigration = async (input) => {
      capturedInput = input;
      return buildGeneratedResult(input, generatedSummary);
    };
  });

  afterEach(async () => {
    commandPrototype.buildClient = originalBuildClient;
    ContentDiffCommand.generateMigration = originalGenerateMigration;
    ContentDiffCommand.buildProfileClient = originalBuildProfileClient;
    ContentDiffCommand.resolveLinkedSiteToken = originalResolveLinkedSiteToken;
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('uses the primary destination and configured TypeScript convention', async () => {
    const { stdout, error } = await runCommand(
      `content:diff "sync source content" --autogenerate=source --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(capturedInput?.source.environmentId).to.equal('source');
    expect(capturedInput?.destination.environmentId).to.equal('primary');
    expect(capturedInput?.format).to.equal('ts');
    expect(capturedInput?.options).to.deep.equal({
      itemTypes: 'all',
      uploads: 'referenced',
      includeDeletions: false,
      bundleAssets: false,
      migrateInvalidContent: false,
    });
    expect(capturedInput?.source.migrationsModelApiKey).to.equal(
      'migration_log',
    );
    expect(capturedInput?.destination.migrationsModelApiKey).to.equal(
      'migration_log',
    );
    expect(dirname(capturedInput!.migrationFilePath)).to.equal(
      join(temporaryDirectory, 'custom-migrations'),
    );
    expect(basename(capturedInput!.migrationFilePath)).to.match(
      /^\d+_syncSourceContent\.ts$/,
    );
    expect(stdout).to.contain('Content diff: source -> primary');
    expect(stdout).to.contain('Changes:');
    expect(stdout).to.contain('  none');
  });

  it('supports an explicit destination, filters, deletion, bundling, and JSON', async () => {
    generatedSummary = buildInvalidContentSummary();
    generatedSummary.counts['legacyIdMappings.records'] = 1;
    generatedSummary.counts['legacyIdMappings.detected'] = 3;
    generatedSummary.counts['legacyIdMappings.skipped'] = 1;
    generatedSummary.legacyIdMappings = [
      {
        entityType: 'record',
        sourceId: '178178741',
        targetId: 'YhEa5SbeSl6KwIFizzkzig',
        status: 'new',
      },
      {
        entityType: 'upload',
        sourceId: '178178742',
        targetId: 'LQQiCYCfSU6DTmCQ63-JRw',
        status: 'existing',
      },
    ];
    generatedSummary.skippedLegacyIdMappings = [
      {
        entityType: 'block',
        sourceId: '178178743',
        reason:
          'owning or referring aggregate skipped: INVALID_CURRENT (current)',
      },
    ];

    const { stdout, error } = await runCommand(
      `content:diff "sync selected content" --autogenerate=source:destination --item-types=article,author,article --uploads=all --include-deletions --bundle-assets --migrate-invalid-content --js --json --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(capturedInput?.destination.environmentId).to.equal('destination');
    expect(capturedInput?.format).to.equal('js');
    expect(capturedInput?.options).to.deep.equal({
      itemTypes: ['article', 'author'],
      uploads: 'all',
      includeDeletions: true,
      bundleAssets: true,
      migrateInvalidContent: true,
    });

    const output = JSON.parse(stdout) as {
      sourceEnvironmentId: string;
      destinationEnvironmentId: string;
      format: string;
      summary: {
        counts: Record<string, number>;
        destructiveActionCount: number;
        warningCount: number;
        invalidContent: Record<string, unknown>;
        legacyIds: Record<string, unknown>;
      };
    };

    expect(output).to.include({
      sourceEnvironmentId: 'source',
      destinationEnvironmentId: 'destination',
      format: 'js',
    });
    expect(output.summary).to.deep.equal({
      counts: {
        'records.create': 0,
        'records.delete': 0,
        'records.update': 0,
        'uploadCollections.create': 0,
        'uploadCollections.update': 0,
        'uploads.create': 0,
        'uploads.delete': 0,
        'uploads.update': 0,
        'legacyIdMappings.records': 1,
        'legacyIdMappings.detected': 3,
        'legacyIdMappings.skipped': 1,
      },
      destructiveActionCount: 0,
      warningCount: 1,
      invalidContent: {
        partial: true,
        detectedRecordCount: 3,
        migratedRecordCount: 1,
        skippedRecordCount: 2,
        propagatedSkipCount: 1,
        relaxedFieldCount: 1,
        relaxedValidatorCount: 2,
        requiresTemporaryValidatorRelaxation: true,
      },
      legacyIds: {
        detectedLegacyIdCount: 3,
        legacyIdMappingCount: 2,
        newLegacyIdMappingCount: 1,
        skippedLegacyIdCount: 1,
        mappingRecordCount: 1,
        requiresLegacyIdRemapping: true,
      },
    });
    expect(output.summary).not.to.have.property('records');
    expect(output.summary).not.to.have.property('uploads');
    expect(output.summary).not.to.have.property('warnings');
    expect(output.summary).not.to.have.property('skippedRecords');
    expect(output.summary).not.to.have.property('validatorRelaxations');
    expect(stdout).not.to.contain('178178741');
    expect(stdout).not.to.contain('178178743');
    expect(stdout).not.to.contain('YhEa5SbeSl6KwIFizzkzig');
    expect(stdout).not.to.contain('record-skipped');
    expect(stdout).not.to.contain('DEPENDENCY_ON_SKIPPED_RECORD');
    expect(stdout).not.to.contain('Content diff:');
  });

  it('prints a prominent legacy-ID warning and reviewable mappings', async () => {
    generatedSummary = buildGeneratedSummary();
    generatedSummary.counts['legacyIdMappings.records'] = 1;
    generatedSummary.legacyIdMappings = [
      {
        entityType: 'record',
        sourceId: '178178741',
        targetId: 'YhEa5SbeSl6KwIFizzkzig',
        status: 'new',
      },
    ];
    generatedSummary.skippedLegacyIdMappings = [
      {
        entityType: 'block',
        sourceId: '178178742',
        reason:
          'owning or referring aggregate skipped: INVALID_CURRENT (current)',
      },
    ];

    const { stdout, stderr, error } = await runCommand(
      `content:diff "sync legacy content" --autogenerate=source:destination --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    const warningOutput = stderr
      .replace(/›\s+(?:Warning:\s*)?/g, '')
      .replace(/\s+/g, ' ');
    expect(warningOutput).to.contain('LEGACY ID REMAPPING');
    expect(warningOutput).to.contain('LEGACY IDS SKIPPED');
    for (const phrase of [
      'Legacy IDs cannot',
      'be preserved',
      'persist aliases',
      'datocms_content_diff model',
      'External consumers',
      'using the old IDs must be updated',
    ]) {
      expect(warningOutput).to.contain(phrase);
    }
    expect(stdout).to.contain('Legacy ID mappings:');
    expect(stdout).to.contain(
      'record 178178741 -> YhEa5SbeSl6KwIFizzkzig (new)',
    );
    expect(stdout).to.contain('Skipped legacy IDs (not migrated):');
    expect(stdout).to.contain(
      'block 178178742: owning or referring aggregate skipped: INVALID_CURRENT (current)',
    );
  });

  it('prints deterministic skipped-record diagnostics and prominent relaxation risk without field values', async () => {
    generatedSummary = buildInvalidContentSummary();

    const { stdout, stderr, error } = await runCommand(
      `content:diff "sync invalid content" --autogenerate=source:destination --migrate-invalid-content --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(capturedInput?.options.migrateInvalidContent).to.equal(true);
    expect(stderr).to.contain('TEMPORARY VALIDATOR RELAXATION');
    expect(stderr).to.contain('RESIDUAL RISK');
    expect(stderr).to.contain('PARTIAL CONTENT DIFF');
    expect(stderr).to.contain('migrations:run --in-place --allow-primary');
    expect(stdout).to.contain('Skipped records:');
    expect(stdout).to.contain(
      'model=model-a id=record-skipped slice=current reason=INVALID_CURRENT',
    );
    expect(stdout).to.contain('dependency chain: none');
    expect(stdout).to.contain(
      'model=model-a id=record-skipped slice=published reason=DEPENDENCY_ON_SKIPPED_RECORD',
    );
    expect(stdout).to.contain(
      'dependency chain: record-root -> record-skipped',
    );
    expect(stdout.indexOf('reason=INVALID_CURRENT')).to.be.lessThan(
      stdout.indexOf('reason=DEPENDENCY_ON_SKIPPED_RECORD'),
    );
    expect(stdout).to.contain(
      'model=model-a field=field-title validators=length,required records=record-a,record-z',
    );
    expect(`${stdout}${stderr}`).not.to.contain('private field value');
  });

  it('excludes the default schema migration tracking model', async () => {
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

    const { error } = await runCommand(
      `content:diff sync --autogenerate=source --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(capturedInput?.destination.migrationsModelApiKey).to.equal(
      'schema_migration',
    );
  });

  it('rejects malformed and identical environment selections', async () => {
    const malformed = await runCommand(
      `content:diff sync --autogenerate=source: --config-file=${configPath}`,
    );
    const identical = await runCommand(
      `content:diff sync --autogenerate=source:source --config-file=${configPath}`,
    );

    expect(malformed.error?.message).to.contain('SOURCE or SOURCE:DESTINATION');
    expect(identical.error?.message).to.contain(
      'Source and destination environments must be different',
    );
    expect(capturedInput).to.equal(undefined);
  });

  it('rejects unknown environments before generating files', async () => {
    const missingSource = await runCommand(
      `content:diff sync --autogenerate=missing:destination --config-file=${configPath}`,
    );
    const missingDestination = await runCommand(
      `content:diff sync --autogenerate=source:missing --config-file=${configPath}`,
    );

    expect(missingSource.error?.message).to.contain(
      'Environment "missing" does not exist',
    );
    expect(missingDestination.error?.message).to.contain(
      'Environment "missing" does not exist',
    );
    expect(capturedInput).to.equal(undefined);
  });

  it('uses independent profile clients and destination-owned migration settings', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          source_project: {
            siteId: 'source-site',
            migrations: {
              directory: 'source-migrations',
              modelApiKey: 'source_migration_log',
            },
          },
          destination_project: {
            siteId: 'destination-site',
            migrations: {
              directory: 'destination-migrations',
              modelApiKey: 'destination_migration_log',
              tsconfig: 'destination.tsconfig.json',
            },
          },
        },
      }),
    );

    const builtClients: Array<{
      options: CmaClient.ClientConfigOptions;
      client: CmaClient.Client;
    }> = [];
    installDualProfileClientFactory({
      builtClients,
      sourceCredential: 'source-explicit-credential',
      destinationCredential: 'destination-explicit-credential',
    });
    ContentDiffCommand.resolveLinkedSiteToken = async () => {
      throw new Error('Explicit endpoint credentials must take precedence');
    };

    const { stdout, stderr, error } = await runCommand(
      `content:diff "sync aligned projects" --source-profile=source_project --destination-profile=destination_project --source-api-token=source-explicit-credential --destination-api-token=destination-explicit-credential --autogenerate=main --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(capturedInput?.source.environmentId).to.equal('main');
    expect(capturedInput?.destination.environmentId).to.equal('main');
    expect(capturedInput?.source.migrationsModelApiKey).to.equal(
      'source_migration_log',
    );
    expect(capturedInput?.destination.migrationsModelApiKey).to.equal(
      'destination_migration_log',
    );
    expect(dirname(capturedInput!.migrationFilePath)).to.equal(
      join(temporaryDirectory, 'destination-migrations'),
    );
    expect(capturedInput?.format).to.equal('ts');

    const sourceRoot = builtClients.find(
      ({ options }) =>
        options.apiToken === 'source-explicit-credential' &&
        !options.environment,
    );
    const sourceEnvironment = builtClients.find(
      ({ options }) =>
        options.apiToken === 'source-explicit-credential' &&
        options.environment === 'main',
    );
    const destinationRoot = builtClients.find(
      ({ options }) =>
        options.apiToken === 'destination-explicit-credential' &&
        !options.environment,
    );
    const destinationEnvironment = builtClients.find(
      ({ options }) =>
        options.apiToken === 'destination-explicit-credential' &&
        options.environment === 'main',
    );
    expect(capturedInput?.source.rootClient).to.equal(sourceRoot?.client);
    expect(capturedInput?.source.environmentClient).to.equal(
      sourceEnvironment?.client,
    );
    expect(capturedInput?.destination.rootClient).to.equal(
      destinationRoot?.client,
    );
    expect(capturedInput?.destination.environmentClient).to.equal(
      destinationEnvironment?.client,
    );
    expect(`${stdout}${stderr}`).not.to.contain('source-explicit-credential');
    expect(`${stdout}${stderr}`).not.to.contain(
      'destination-explicit-credential',
    );
    expect(`${stdout}${stderr}`).not.to.contain('source_project');
    expect(`${stdout}${stderr}`).not.to.contain('destination_project');
  });

  it('redacts both endpoint credentials from verbose CMA logs', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          source_project: { migrations: { directory: 'source-migrations' } },
          destination_project: {
            migrations: { directory: 'destination-migrations' },
          },
        },
      }),
    );
    const sourceCredential = 'source-secret-body-and-headers';
    const destinationCredential = 'destination-secret-body-and-headers';

    ContentDiffCommand.buildProfileClient = (options) => {
      const isSource = options.apiToken === sourceCredential;
      const isDestination = options.apiToken === destinationCredential;
      if (!isSource && !isDestination) {
        throw new Error('Unexpected profile credential');
      }
      options.logFn?.(
        `[1] request headers authorization: Bearer ${options.apiToken}`,
      );
      return {
        environments: {
          list: async () => [{ id: 'main', meta: { primary: true } }],
        },
      } as unknown as CmaClient.Client;
    };

    const { stdout, stderr, error } = await runCommand(
      `content:diff sync --source-profile=source_project --destination-profile=destination_project --source-api-token=${sourceCredential} --destination-api-token=${destinationCredential} --autogenerate=main:main --log-level=BODY_AND_HEADERS --log-mode=stdout --config-file=${configPath}`,
    );

    expect(error).to.equal(undefined);
    expect(`${stdout}${stderr}`).to.contain('[REDACTED]');
    expect(`${stdout}${stderr}`).not.to.contain(sourceCredential);
    expect(`${stdout}${stderr}`).not.to.contain(destinationCredential);
  });

  it('resolves linked projects independently before profile environment variables', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          source_project: {
            siteId: 'source-site',
            organizationId: 'source-organization',
            apiTokenEnvName: 'TEST_SOURCE_PROFILE_CREDENTIAL',
            migrations: { directory: 'source-migrations' },
          },
          destination_project: {
            siteId: 'destination-site',
            organizationId: 'destination-organization',
            apiTokenEnvName: 'TEST_DESTINATION_PROFILE_CREDENTIAL',
            migrations: { directory: 'destination-migrations' },
          },
        },
      }),
    );
    const previousSourceCredential = process.env.TEST_SOURCE_PROFILE_CREDENTIAL;
    const previousDestinationCredential =
      process.env.TEST_DESTINATION_PROFILE_CREDENTIAL;
    process.env.TEST_SOURCE_PROFILE_CREDENTIAL = 'ignored-source-environment';
    process.env.TEST_DESTINATION_PROFILE_CREDENTIAL =
      'ignored-destination-environment';
    const linkedSiteRequests: Array<{
      siteId: string;
      organizationId?: string;
    }> = [];
    ContentDiffCommand.resolveLinkedSiteToken = async (
      _command,
      siteId,
      organizationId,
    ) => {
      linkedSiteRequests.push({ siteId, organizationId });
      return siteId === 'source-site'
        ? 'source-oauth-credential'
        : 'destination-oauth-credential';
    };
    const builtClients: Array<{
      options: CmaClient.ClientConfigOptions;
      client: CmaClient.Client;
    }> = [];
    installDualProfileClientFactory({
      builtClients,
      sourceCredential: 'source-oauth-credential',
      destinationCredential: 'destination-oauth-credential',
    });

    try {
      const { error } = await runCommand(
        `content:diff sync --source-profile=source_project --destination-profile=destination_project --autogenerate=source:destination --config-file=${configPath}`,
      );

      expect(error).to.equal(undefined);
      expect(linkedSiteRequests).to.have.deep.members([
        {
          siteId: 'source-site',
          organizationId: 'source-organization',
        },
        {
          siteId: 'destination-site',
          organizationId: 'destination-organization',
        },
      ]);
      expect(
        builtClients.some(
          ({ options }) => options.apiToken === 'ignored-source-environment',
        ),
      ).to.equal(false);
      expect(
        builtClients.some(
          ({ options }) =>
            options.apiToken === 'ignored-destination-environment',
        ),
      ).to.equal(false);
    } finally {
      restoreEnvironmentVariable(
        'TEST_SOURCE_PROFILE_CREDENTIAL',
        previousSourceCredential,
      );
      restoreEnvironmentVariable(
        'TEST_DESTINATION_PROFILE_CREDENTIAL',
        previousDestinationCredential,
      );
    }
  });

  it('resolves each unlinked profile from its configured environment variable', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          source_project: {
            apiTokenEnvName: 'TEST_SOURCE_PROFILE_CREDENTIAL',
            migrations: { directory: 'source-migrations' },
          },
          destination_project: {
            apiTokenEnvName: 'TEST_DESTINATION_PROFILE_CREDENTIAL',
            migrations: { directory: 'destination-migrations' },
          },
        },
      }),
    );
    const previousSourceCredential = process.env.TEST_SOURCE_PROFILE_CREDENTIAL;
    const previousDestinationCredential =
      process.env.TEST_DESTINATION_PROFILE_CREDENTIAL;
    process.env.TEST_SOURCE_PROFILE_CREDENTIAL = 'source-env-credential';
    process.env.TEST_DESTINATION_PROFILE_CREDENTIAL =
      'destination-env-credential';
    const builtClients: Array<{
      options: CmaClient.ClientConfigOptions;
      client: CmaClient.Client;
    }> = [];
    installDualProfileClientFactory({
      builtClients,
      sourceCredential: 'source-env-credential',
      destinationCredential: 'destination-env-credential',
    });

    try {
      const { error } = await runCommand(
        `content:diff sync --source-profile=source_project --destination-profile=destination_project --autogenerate=source:destination --config-file=${configPath}`,
      );

      expect(error).to.equal(undefined);
      expect(
        builtClients.some(
          ({ options }) => options.apiToken === 'source-env-credential',
        ),
      ).to.equal(true);
      expect(
        builtClients.some(
          ({ options }) => options.apiToken === 'destination-env-credential',
        ),
      ).to.equal(true);
    } finally {
      restoreEnvironmentVariable(
        'TEST_SOURCE_PROFILE_CREDENTIAL',
        previousSourceCredential,
      );
      restoreEnvironmentVariable(
        'TEST_DESTINATION_PROFILE_CREDENTIAL',
        previousDestinationCredential,
      );
    }
  });

  it('rejects partial or ambiguous dual-profile authentication flags', async () => {
    const missingDestination = await runCommand(
      `content:diff sync --source-profile=source_project --autogenerate=source:destination --config-file=${configPath}`,
    );
    const endpointTokenWithoutProfiles = await runCommand(
      `content:diff sync --source-api-token=source-credential --autogenerate=source:destination --config-file=${configPath}`,
    );
    const legacyProfile = await runCommand(
      `content:diff sync --source-profile=default --destination-profile=default --profile=default --autogenerate=source:destination --config-file=${configPath}`,
    );
    const legacyToken = await runCommand(
      `content:diff sync --source-profile=default --destination-profile=default --api-token=legacy-credential --autogenerate=source:destination --config-file=${configPath}`,
    );

    expect(missingDestination.error?.message).to.contain(
      '--source-profile and --destination-profile must be provided together',
    );
    expect(endpointTokenWithoutProfiles.error?.message).to.contain(
      '--source-profile and --destination-profile must be provided together',
    );
    expect(legacyProfile.error?.message).to.contain(
      '--profile and --api-token cannot be combined',
    );
    expect(legacyToken.error?.message).to.contain(
      '--profile and --api-token cannot be combined',
    );
    expect(capturedInput).to.equal(undefined);
  });

  it('validates source and destination environments against their respective projects', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          source_project: { migrations: { directory: 'source-migrations' } },
          destination_project: {
            migrations: { directory: 'destination-migrations' },
          },
        },
      }),
    );
    const builtClients: Array<{
      options: CmaClient.ClientConfigOptions;
      client: CmaClient.Client;
    }> = [];
    installDualProfileClientFactory({
      builtClients,
      sourceCredential: 'source-credential',
      destinationCredential: 'destination-credential',
    });
    const commonFlags = `--source-profile=source_project --destination-profile=destination_project --source-api-token=source-credential --destination-api-token=destination-credential --config-file=${configPath}`;

    const missingSource = await runCommand(
      `content:diff sync --autogenerate=destination:destination ${commonFlags}`,
    );
    const missingDestination = await runCommand(
      `content:diff sync --autogenerate=source:source ${commonFlags}`,
    );

    expect(missingSource.error?.message).to.contain(
      'Environment "destination" does not exist',
    );
    expect(missingDestination.error?.message).to.contain(
      'Environment "source" does not exist',
    );
    expect(capturedInput).to.equal(undefined);
  });

  it('does not recommend single-project schema autogeneration for aligned projects', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          source_project: { migrations: { directory: 'source-migrations' } },
          destination_project: {
            migrations: { directory: 'destination-migrations' },
          },
        },
      }),
    );
    const builtClients: Array<{
      options: CmaClient.ClientConfigOptions;
      client: CmaClient.Client;
    }> = [];
    installDualProfileClientFactory({
      builtClients,
      sourceCredential: 'source-credential',
      destinationCredential: 'destination-credential',
    });
    ContentDiffCommand.generateMigration = async () => {
      throw new ContentDiffError('SCHEMA_MISMATCH', 'Internal diagnostic.');
    };

    const { error } = await runCommand(
      `content:diff "sync shared content" --source-profile=source_project --destination-profile=destination_project --source-api-token=source-credential --destination-api-token=destination-credential --autogenerate=source:destination --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'Apply the shared, checked-in schema migration history',
    );
    expect(error?.message).to.contain(
      'Schema autogeneration currently compares environments within one project',
    );
    expect(error?.message).not.to.contain('datocms migrations:new');
  });

  it('translates schema mismatches into an actionable generation error', async () => {
    ContentDiffCommand.generateMigration = async () => {
      throw new ContentDiffError(
        'SCHEMA_MISMATCH',
        'Internal schema diagnostic that should not replace command guidance.',
      );
    };

    const { error, stdout, stderr } = await runCommand(
      `content:diff "sync schema-sensitive content" --autogenerate=source:destination --migrate-invalid-content --api-token=not-a-real-secret --config-file=${configPath}`,
    );

    expect(error?.message).to.equal(
      [
        'Incompatible schema: cannot generate content migration "sync schema-sensitive content" from "source" to "destination" because their managed schemas differ.',
        'No content records were read and no migration artifacts were created.',
        'Generate the schema migration first:',
        '  datocms migrations:new "sync source schema" --autogenerate="source:destination"',
        'Apply it to a fork of the destination:',
        '  datocms migrations:run --source="destination" --destination="destination-schema-ready"',
        'Then regenerate the content diff against that schema-ready fork:',
        '  datocms content:diff "sync schema-sensitive content" --autogenerate="source:destination-schema-ready"',
        '--migrate-invalid-content only handles supported invalid or historical-null content; it does not bypass schema compatibility.',
      ].join('\n'),
    );
    expect(`${stdout}${stderr}${error?.message}`).not.to.contain(
      'not-a-real-secret',
    );
  });

  it('does not present schema autogeneration as sufficient for activation drift', async () => {
    ContentDiffCommand.generateMigration = async () => {
      throw new ContentDiffError(
        'ENVIRONMENT_SEMANTICS_MISMATCH',
        'Internal environment-semantics diagnostic.',
      );
    };

    const { error } = await runCommand(
      `content:diff "sync content" --autogenerate=source:destination --migrate-invalid-content --config-file=${configPath}`,
    );

    expect(error?.message).to.contain(
      'Incompatible environment activation/settings',
    );
    expect(error?.message).to.contain(
      'Schema autogeneration alone may not repair activation mismatches.',
    );
    expect(error?.message).to.contain(
      '--migrate-invalid-content does not bypass environment compatibility.',
    );
    expect(error?.message).not.to.contain('migrations:new');
  });

  it('leaves cross-project errors unchanged', async () => {
    ContentDiffCommand.generateMigration = async () => {
      throw new ContentDiffError(
        'CROSS_PROJECT',
        'Content diff only supports environments from the same DatoCMS project.',
      );
    };

    const { error } = await runCommand(
      `content:diff sync --autogenerate=source:destination --config-file=${configPath}`,
    );

    expect(error?.message).to.equal(
      'Content diff only supports environments from the same DatoCMS project.',
    );
    expect(error?.message).not.to.contain('migrations:new');
  });

  it('is discoverable with the complete generation-only flag surface', async () => {
    const { stdout, error } = await runCommand('content:diff --help');

    expect(error).to.equal(undefined);
    expect(stdout).to.contain(
      'Generate a content migration by comparing two DatoCMS environments',
    );
    for (const flag of [
      '--autogenerate',
      '--source-profile',
      '--destination-profile',
      '--source-api-token',
      '--destination-api-token',
      '--item-types',
      '--uploads',
      '--include-deletions',
      '--bundle-assets',
      '--migrate-invalid-content',
      '--ts',
      '--js',
    ]) {
      expect(stdout).to.contain(flag);
    }
    expect(capturedInput).to.equal(undefined);
  });
});

function buildGeneratedResult(
  input: GenerateMigrationInput,
  summary: ContentDiffMigrationSummary,
): GenerateMigrationResult {
  const baseName = basename(input.migrationFilePath, `.${input.format}`);
  const contentDirectory = join(
    dirname(input.migrationFilePath),
    '.datocms-content',
  );

  return {
    sourceEnvironmentId: input.source.environmentId,
    destinationEnvironmentId: input.destination.environmentId,
    format: input.format,
    migrationPath: input.migrationFilePath,
    planPath: join(contentDirectory, `${baseName}.plan.json`),
    runtimePath: join(contentDirectory, `runtime-v1.${input.format}`),
    ...(input.options.bundleAssets
      ? { assetsPath: join(contentDirectory, `${baseName}.assets`) }
      : {}),
    summary,
  };
}

function buildGeneratedSummary(): ContentDiffMigrationSummary {
  return {
    counts: {
      'records.create': 0,
      'records.update': 0,
      'records.delete': 0,
      'uploads.create': 0,
      'uploads.update': 0,
      'uploads.delete': 0,
      'uploadCollections.create': 0,
      'uploadCollections.update': 0,
      'legacyIdMappings.records': 0,
      'legacyIdMappings.detected': 0,
      'legacyIdMappings.skipped': 0,
    },
    records: [],
    uploads: [],
    destructiveActions: [],
    warnings: [],
    invalidContent: {
      status: 'complete',
      detectedRecords: 0,
      migratedRecords: 0,
      skippedRecords: 0,
      propagatedSkipCount: 0,
      validatorRelaxations: 0,
      relaxedFieldCount: 0,
      relaxedValidatorCount: 0,
      requiresTemporaryValidatorRelaxation: false,
    },
    skippedRecords: [],
    validatorRelaxations: [],
    legacyIdMappings: [],
    skippedLegacyIdMappings: [],
  };
}

function buildInvalidContentSummary(): ContentDiffMigrationSummary {
  return {
    ...buildGeneratedSummary(),
    warnings: ['Invalid content requires review before execution.'],
    invalidContent: {
      status: 'partial',
      detectedRecords: 3,
      migratedRecords: 1,
      skippedRecords: 2,
      propagatedSkipCount: 1,
      validatorRelaxations: 1,
      relaxedFieldCount: 1,
      relaxedValidatorCount: 2,
      requiresTemporaryValidatorRelaxation: true,
    },
    skippedRecords: [
      {
        id: 'record-skipped',
        itemTypeId: 'model-a',
        disposition: 'preserve_target',
        reasons: [
          {
            code: 'DEPENDENCY_ON_SKIPPED_RECORD',
            slice: 'published',
            dependencyId: 'record-root',
            dependencyChain: ['record-root', 'record-skipped'],
          },
          {
            code: 'INVALID_CURRENT',
            slice: 'current',
            dependencyChain: [],
          },
        ],
      },
    ],
    validatorRelaxations: [
      {
        fieldId: 'field-title',
        itemTypeId: 'model-a',
        relaxedValidatorKeys: ['required', 'length'],
        affectedRecordIds: ['record-z', 'record-a'],
      },
    ],
  };
}

function installDualProfileClientFactory({
  builtClients,
  sourceCredential,
  destinationCredential,
}: {
  builtClients: Array<{
    options: CmaClient.ClientConfigOptions;
    client: CmaClient.Client;
  }>;
  sourceCredential: string;
  destinationCredential: string;
}): void {
  ContentDiffCommand.buildProfileClient = (options) => {
    const isSource = options.apiToken === sourceCredential;
    const isDestination = options.apiToken === destinationCredential;

    if (!isSource && !isDestination) {
      throw new Error('Unexpected profile credential');
    }

    const client = {
      environments: {
        list: async () =>
          isSource
            ? [
                { id: 'main', meta: { primary: true } },
                { id: 'source', meta: { primary: false } },
              ]
            : [
                { id: 'main', meta: { primary: true } },
                { id: 'destination', meta: { primary: false } },
              ],
      },
    } as unknown as CmaClient.Client;
    builtClients.push({ options, client });
    return client;
  };
}

function restoreEnvironmentVariable(
  name: string,
  previousValue: string | undefined,
): void {
  if (previousValue === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = previousValue;
  }
}
