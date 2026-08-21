import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import {
  semanticHash,
  stableStringify,
} from '../../src/content-diff/canonicalize';
import {
  CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION,
  RUNTIME_VERSION,
  renderRuntime,
} from '../../src/content-diff/runtime-template';
import type {
  ContentDiffPlan,
  JsonValue,
  RecordSnapshot,
  UploadCollectionSnapshot,
  UploadSnapshot,
} from '../../src/content-diff/types';
import {
  CONTENT_DIFF_GENERATOR_VERSION,
  CONTENT_PLAN_FORMAT_VERSION,
  INVALID_CONTENT_FORMAT_VERSION,
  LEGACY_ID_MAPPING_FORMAT_VERSION,
} from '../../src/content-diff/types';
import { compareUploadChanges } from '../../src/content-diff/upload-contract';
import {
  type ContentPlanEnvelope,
  writeContentDiffArtifacts,
} from '../../src/content-diff/write-artifacts';

const temporaryDirectories: string[] = [];

describe('content diff artifact writer', () => {
  afterEach(async () => {
    (
      globalThis as Record<string, unknown>
    ).__contentDiffGeneratedWrapperInvocation = undefined;
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('writes a checksummed manifest, immutable runtime, and migration wrapper', async () => {
    const directory = await makeTemporaryDirectory();
    const migrationPath = join(directory, '1700000000_syncContent.js');
    const plan = makePlan();
    const result = await writeContentDiffArtifacts({
      plan,
      migrationFilePath: migrationPath,
      format: 'js',
      bundleAssets: false,
    });

    const manifestBytes = await readFile(result.planPath);
    const manifest = JSON.parse(
      manifestBytes.toString('utf8'),
    ) as ContentPlanEnvelope;
    const wrapper = await readFile(result.migrationPath, 'utf8');
    const runtime = await readFile(result.runtimePath, 'utf8');

    expect(result.manifestSha256).to.equal(sha256(manifestBytes));
    expect(manifest.formatVersion).to.equal(10);
    expect(manifest.runtimeVersion).to.equal(RUNTIME_VERSION);
    expect(manifest.integrity.planSha256).to.equal(
      sha256(stableStringify(manifest.plan)),
    );
    expect(manifest.plan).to.deep.equal(plan);
    expect(wrapper).to.contain(
      `./.datocms-content/runtime-v${RUNTIME_VERSION}`,
    );
    expect(wrapper).to.contain(result.manifestSha256);
    expect(wrapper).to.contain('// datocms-content-diff-binding ');
    expect(wrapper).to.contain('"bindingVersion":1');
    expect(wrapper).to.contain('"targetSiteId":"site-id"');
    expect(wrapper).to.contain(
      `"manifestBasename":"1700000000_syncContent.plan.json"`,
    );
    expect(wrapper).to.contain(
      'module.exports = async function contentDiffMigration(client, executionContext)',
    );
    expect(wrapper).to.contain(
      `executionContext.contentDiffProtocolVersion !== ${CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION}`,
    );
    expect(wrapper).to.contain('executionContext,');
    expect(runtime).to.equal(`${renderRuntime('js').trimEnd()}\n`);
    expect(result.assetsPath).to.equal(undefined);
    await expectNoStagingDirectories(directory);
  });

  it('writes an equivalent TypeScript migration wrapper', async () => {
    const directory = await makeTemporaryDirectory();
    const result = await writeContentDiffArtifacts({
      plan: makePlan(),
      migrationFilePath: join(directory, '1700000001_syncContent.ts'),
      format: 'ts',
      bundleAssets: false,
    });
    const wrapper = await readFile(result.migrationPath, 'utf8');

    expect(wrapper).to.contain(
      "import type { Client } from 'datocms/lib/cma-client-node'",
    );
    expect(wrapper).to.contain(
      `import { runContentDiffMigration } from "./.datocms-content/runtime-v${RUNTIME_VERSION}"`,
    );
    expect(wrapper).to.contain('type MigrationExecutionContext =');
    expect(wrapper).to.contain('executionContext?: MigrationExecutionContext');
    expect(wrapper).to.contain(
      `readonly contentDiffProtocolVersion: ${CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION}`,
    );
    expect(wrapper).to.contain('export default async function');
    expect(wrapper).to.contain(result.manifestSha256);
    expect(result.runtimePath).to.match(
      new RegExp(`runtime-v${RUNTIME_VERSION}\\.ts$`),
    );
  });

  it('generated wrappers reject old runners before dispatch and accept the current protocol', async () => {
    const directory = await makeTemporaryDirectory();
    const result = await writeContentDiffArtifacts({
      plan: makePlan(),
      migrationFilePath: join(directory, '1700000002_protocol.js'),
      format: 'js',
      bundleAssets: false,
    });
    await writeFile(
      result.runtimePath,
      `'use strict';\nmodule.exports.runContentDiffMigration = async function (_client, _envelope, options) {\n  globalThis.__contentDiffGeneratedWrapperInvocation = options;\n};\n`,
    );
    const localRequire = createRequire(join(directory, 'loader.cjs'));
    const migration = localRequire(result.migrationPath) as (
      client: unknown,
      context?: { contentDiffProtocolVersion?: number },
    ) => Promise<void>;
    let clientReads = 0;
    const client = new Proxy(
      {},
      {
        get() {
          clientReads += 1;
          throw new Error('CMA client was accessed');
        },
      },
    );

    for (const context of [undefined, {}, { contentDiffProtocolVersion: 0 }]) {
      const error = await expectRejects(migration(client, context));
      expect(error.message).to.contain(
        `expected ${CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION}`,
      );
      expect(error.message).to.contain('Upgrade the datocms CLI');
      expect(
        (globalThis as Record<string, unknown>)
          .__contentDiffGeneratedWrapperInvocation,
      ).to.equal(undefined);
    }

    await migration(client, {
      contentDiffProtocolVersion: CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION,
    });
    const invocation = (globalThis as Record<string, unknown>)
      .__contentDiffGeneratedWrapperInvocation as {
      migrationFilePath: string;
      manifestPath: string;
      executionContext: { contentDiffProtocolVersion: number };
    };
    expect(invocation.executionContext).to.deep.equal({
      contentDiffProtocolVersion: CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION,
    });
    expect(await realpath(invocation.migrationFilePath)).to.equal(
      await realpath(result.migrationPath),
    );
    expect(await realpath(invocation.manifestPath)).to.equal(
      await realpath(result.planPath),
    );
    expect(clientReads).to.equal(0);
  });

  it('rejects unauthorized validator relaxations before installing artifacts', async () => {
    const directory = await makeTemporaryDirectory();
    const migrationPath = join(directory, '1700000002_invalidPlan.js');
    const plan = makePlan();
    plan.invalidContent.validatorRelaxations.push({
      fieldId: 'field-id',
      itemTypeId: 'model-id',
      originalValidators: { required: {} },
      relaxedValidators: {},
      originalHash: 'original-hash',
      relaxedHash: 'relaxed-hash',
      allowedValidatorHashes: ['original-hash', 'relaxed-hash'],
      relaxedValidatorKeys: ['required'],
      affectedRecordIds: ['record-id'],
      reasons: [],
    });

    const error = await expectRejects(
      writeContentDiffArtifacts({
        plan,
        migrationFilePath: migrationPath,
        format: 'js',
        bundleAssets: false,
      }),
    );

    expect((error as Error).message).to.contain('--migrate-invalid-content');
    expect(await pathExists(migrationPath)).to.equal(false);
    expect(
      await pathExists(
        join(directory, '.datocms-content', '1700000002_invalidPlan.plan.json'),
      ),
    ).to.equal(false);
    await expectNoStagingDirectories(directory);
  });

  it('refuses to serialize an executable UPDATE that introduces a fresh nested block ID', async () => {
    const directory = await makeTemporaryDirectory();
    const migrationPath = join(directory, '1700000003_freshBlockUpdate.js');
    const plan = makePlan();
    const baseline = makeRecordSnapshotWithBlock(
      'record-id',
      'YhEa5SbeSl6KwIFizzkzig',
      'baseline',
    );
    const desired = makeRecordSnapshotWithBlock(
      'record-id',
      'XSPMXvayT-yMUrVxP-YoSw',
      'desired',
    );
    plan.records.push({
      id: 'record-id',
      itemTypeId: 'model-id',
      action: 'update',
      expectedTargetHash: baseline.hash,
      baseline,
      desired,
      changes: {
        current: true,
        published: false,
        topology: false,
        lifecycle: false,
        stage: false,
        schedules: false,
      },
      dependencies: [],
      publishedDependencies: [],
      allowedIntermediateHashes: [],
    });

    const error = await expectRejects(
      writeContentDiffArtifacts({
        plan,
        migrationFilePath: migrationPath,
        format: 'js',
        bundleAssets: false,
      }),
    );

    expect(error.message).to.contain(
      'fresh nested block XSPMXvayT-yMUrVxP-YoSw during current-restore',
    );
    expect(error.message).to.contain('executable V10 content migration');
    expect(await pathExists(migrationPath)).to.equal(false);
    await expectNoStagingDirectories(directory);
  });

  it('refuses to serialize a unique release targeting an embedded field', async () => {
    const directory = await makeTemporaryDirectory();
    const migrationPath = join(directory, '1700000003_embeddedRelease.js');
    const plan = makePlan();
    plan.schema.itemTypes.push({
      id: 'model-id',
      apiKey: 'model',
      name: 'Model',
      modularBlock: false,
      singleton: false,
      sortable: false,
      tree: false,
      draftModeActive: true,
      draftSavingActive: true,
      allLocalesRequired: false,
      workflowId: null,
      fields: [
        {
          id: 'content-field-id',
          apiKey: 'content',
          fieldType: 'single_block',
          localized: false,
          position: 1,
          validators: { unique: {} },
        },
      ],
    });
    const snapshot = makeRecordSnapshotWithBlock(
      'record-id',
      'YhEa5SbeSl6KwIFizzkzig',
      'baseline',
    );
    const intermediateCurrentHash = semanticHash(snapshot.current.fields);
    plan.records.push({
      id: 'record-id',
      itemTypeId: 'model-id',
      action: 'update',
      expectedTargetHash: snapshot.hash,
      baseline: snapshot,
      desired: structuredClone(snapshot),
      changes: {
        current: false,
        published: false,
        topology: false,
        lifecycle: false,
        stage: false,
        schedules: false,
      },
      dependencies: [],
      publishedDependencies: [],
      allowedIntermediateHashes: [intermediateCurrentHash],
    });
    plan.execution.uniqueReleases.push({
      recordId: 'record-id',
      fields: snapshot.current.fields,
      consumerRecordIds: [],
      intermediateCurrentHash,
    });

    const error = await expectRejects(
      writeContentDiffArtifacts({
        plan,
        migrationFilePath: migrationPath,
        format: 'js',
        bundleAssets: false,
      }),
    );

    expect(error.message).to.contain(
      'does not resolve to a string, slug, or link field carrying a unique validator',
    );
    expect(await pathExists(migrationPath)).to.equal(false);
    await expectNoStagingDirectories(directory);
  });

  it('refuses to serialize a published-derived deletion release with transient nested block IDs', async () => {
    const directory = await makeTemporaryDirectory();
    const migrationPath = join(directory, '1700000003_transientRelease.js');
    const plan = makePlan();
    plan.execution.deleteReleases.push({
      recordId: 'record-id',
      fields: {},
      intermediateCurrentHash: semanticHash({}),
      publish: true,
      transientNestedBlockIds: ['YhEa5SbeSl6KwIFizzkzig'],
    });

    const error = await expectRejects(
      writeContentDiffArtifacts({
        plan,
        migrationFilePath: migrationPath,
        format: 'js',
        bundleAssets: false,
      }),
    );

    expect(error.message).to.contain(
      'cannot be serialized as an executable V10 content migration',
    );
    expect(await pathExists(migrationPath)).to.equal(false);
    expect(
      await pathExists(
        join(
          directory,
          '.datocms-content',
          '1700000003_transientRelease.plan.json',
        ),
      ),
    ).to.equal(false);
    await expectNoStagingDirectories(directory);
  });

  it('refuses to overwrite an existing migration or content plan', async () => {
    const directory = await makeTemporaryDirectory();
    const migrationPath = join(directory, '1700000001_existing.js');
    const first = await writeContentDiffArtifacts({
      plan: makePlan(),
      migrationFilePath: migrationPath,
      format: 'js',
      bundleAssets: false,
    });
    const originalMigration = await readFile(first.migrationPath);
    const originalPlan = await readFile(first.planPath);

    const migrationError = await expectRejects(
      writeContentDiffArtifacts({
        plan: makePlan(),
        migrationFilePath: migrationPath,
        format: 'js',
        bundleAssets: false,
      }),
    );
    expect(migrationError.message).to.contain(
      'Refusing to overwrite existing migration',
    );
    expect(await readFile(first.migrationPath)).to.deep.equal(
      originalMigration,
    );
    expect(await readFile(first.planPath)).to.deep.equal(originalPlan);

    const secondMigration = join(directory, '1700000002_existingPlan.js');
    const secondPlan = join(
      directory,
      '.datocms-content',
      '1700000002_existingPlan.plan.json',
    );
    await mkdir(join(directory, '.datocms-content'), { recursive: true });
    await writeFile(secondPlan, 'keep me\n');

    const planError = await expectRejects(
      writeContentDiffArtifacts({
        plan: makePlan(),
        migrationFilePath: secondMigration,
        format: 'js',
        bundleAssets: false,
      }),
    );
    expect(planError.message).to.contain(
      'Refusing to overwrite existing content plan',
    );
    expect(await readFile(secondPlan, 'utf8')).to.equal('keep me\n');
    expect(await pathExists(secondMigration)).to.equal(false);
    await expectNoStagingDirectories(directory);
  });

  it('reuses byte-identical runtimes and rejects a mismatched runtime', async () => {
    const directory = await makeTemporaryDirectory();
    const first = await writeContentDiffArtifacts({
      plan: makePlan(),
      migrationFilePath: join(directory, '1700000003_first.js'),
      format: 'js',
      bundleAssets: false,
    });
    const originalRuntime = await readFile(first.runtimePath);
    const second = await writeContentDiffArtifacts({
      plan: makePlan(),
      migrationFilePath: join(directory, '1700000004_second.js'),
      format: 'js',
      bundleAssets: false,
    });

    expect(second.runtimePath).to.equal(first.runtimePath);
    expect(await readFile(second.runtimePath)).to.deep.equal(originalRuntime);

    await writeFile(first.runtimePath, 'mismatched runtime\n');
    const thirdMigration = join(directory, '1700000005_third.js');
    const mismatchError = await expectRejects(
      writeContentDiffArtifacts({
        plan: makePlan(),
        migrationFilePath: thirdMigration,
        format: 'js',
        bundleAssets: false,
      }),
    );

    expect(mismatchError.message).to.contain(
      'Refusing to overwrite mismatched immutable runtime',
    );
    expect(await pathExists(thirdMigration)).to.equal(false);
    expect(
      await pathExists(
        join(directory, '.datocms-content', '1700000005_third.plan.json'),
      ),
    ).to.equal(false);
    expect(await readFile(first.runtimePath, 'utf8')).to.equal(
      'mismatched runtime\n',
    );
    await expectNoStagingDirectories(directory);
  });

  it('installs runtime v16 beside an immutable legacy runtime v15', async () => {
    const directory = await makeTemporaryDirectory();
    const contentDirectory = join(directory, '.datocms-content');
    const legacyRuntimePath = join(contentDirectory, 'runtime-v15.js');
    const legacyBytes = 'immutable runtime v15 bytes\n';
    await mkdir(contentDirectory, { recursive: true });
    await writeFile(legacyRuntimePath, legacyBytes);

    const result = await writeContentDiffArtifacts({
      plan: makePlan(),
      migrationFilePath: join(directory, '1700000005_runtimeV15.js'),
      format: 'js',
      bundleAssets: false,
    });

    expect(RUNTIME_VERSION).to.equal('16');
    expect(result.runtimePath).to.equal(
      join(contentDirectory, 'runtime-v16.js'),
    );
    expect(await readFile(legacyRuntimePath, 'utf8')).to.equal(legacyBytes);
    expect(await readFile(result.runtimePath, 'utf8')).to.equal(
      `${renderRuntime('js').trimEnd()}\n`,
    );
  });

  it('removes staged output when a bundled asset fails its MD5 check', async () => {
    const directory = await makeTemporaryDirectory();
    const migrationPath = join(directory, '1700000006_badAsset.js');
    const plan = makePlanWithUpload('00000000000000000000000000000000');
    const fetchFn = (async () =>
      new Response('different asset bytes')) as typeof fetch;
    const error = await expectRejects(
      writeContentDiffArtifacts({
        plan,
        migrationFilePath: migrationPath,
        format: 'js',
        bundleAssets: true,
        fetchFn,
      }),
    );

    expect(error.message).to.contain('changed while bundling');
    expect(await pathExists(migrationPath)).to.equal(false);
    expect(
      await pathExists(
        join(directory, '.datocms-content', '1700000006_badAsset.plan.json'),
      ),
    ).to.equal(false);
    expect(
      await pathExists(
        join(directory, '.datocms-content', `runtime-v${RUNTIME_VERSION}.js`),
      ),
    ).to.equal(false);
    expect(
      await pathExists(
        join(directory, '.datocms-content', '1700000006_badAsset.assets'),
      ),
    ).to.equal(false);
    expect(plan.uploads[0].desired?.transport.bundledPath).to.equal(null);
    expect(plan.uploads[0].desired?.transport.sha256).to.equal(null);
    await expectNoStagingDirectories(directory);
  });

  it('rejects upload action, delta, permission, and filename tampering before artifact exposure', async () => {
    const directory = await makeTemporaryDirectory();
    const cases: Array<{
      name: string;
      mutate(plan: ContentDiffPlan): void;
    }> = [
      {
        name: 'manual metadata array',
        mutate(plan) {
          const desired = plan.uploads[0].desired!;
          desired.manual = [] as unknown as UploadSnapshot['manual'];
          refreshUploadHash(desired);
        },
      },
      {
        name: 'manual metadata missing key',
        mutate(plan) {
          const desired = plan.uploads[0].desired!;
          Reflect.deleteProperty(desired.manual, 'notes');
          refreshUploadHash(desired);
        },
      },
      {
        name: 'blank manual text',
        mutate(plan) {
          const desired = plan.uploads[0].desired!;
          desired.manual.notes = ' \t ';
          refreshUploadHash(desired);
        },
      },
      {
        name: 'Unicode-blank manual text',
        mutate(plan) {
          const desired = plan.uploads[0].desired!;
          desired.manual.notes = '\u0085';
          refreshUploadHash(desired);
        },
      },
      {
        name: 'NUL manual text',
        mutate(plan) {
          const desired = plan.uploads[0].desired!;
          desired.manual.notes = 'note\u0000suffix';
          refreshUploadHash(desired);
        },
      },
      {
        name: 'incomplete writable default metadata',
        mutate(plan) {
          const desired = plan.uploads[0].desired!;
          desired.manual.defaultFieldMetadata = {};
          refreshUploadHash(desired);
        },
      },
      {
        name: 'undeclared legacy transport fields',
        mutate(plan) {
          Object.assign(plan.uploads[0].desired!, {
            bundledPath: 'migration.assets/injected.bin',
            bundledSha256: 'a'.repeat(64),
          });
        },
      },
      {
        name: 'noncanonical tags',
        mutate(plan) {
          const desired = plan.uploads[0].desired!;
          desired.manual.tags = [' Foo ', 'foo'];
          refreshUploadHash(desired);
        },
      },
      {
        name: 'Unicode-space tag',
        mutate(plan) {
          const desired = plan.uploads[0].desired!;
          desired.manual.tags = ['blue\u0085tag'];
          refreshUploadHash(desired);
        },
      },
      {
        name: 'noncanonical MD5',
        mutate(plan) {
          const desired = plan.uploads[0].desired!;
          desired.md5 = desired.md5.toUpperCase();
          refreshUploadHash(desired);
        },
      },
      {
        name: 'negative size',
        mutate(plan) {
          plan.uploads[0].desired!.size = -1;
        },
      },
      {
        name: 'empty collection ID',
        mutate(plan) {
          const desired = plan.uploads[0].desired!;
          desired.manual.collectionId = '';
          refreshUploadHash(desired);
        },
      },
      {
        name: 'unusable binary transport',
        mutate(plan) {
          plan.uploads[0].desired!.transport.sourceUrl =
            'ftp://example.test/asset.txt';
        },
      },
      {
        name: 'HTTP shorthand binary transport',
        mutate(plan) {
          plan.uploads[0].desired!.transport.sourceUrl = 'http:asset.txt';
        },
      },
      ...[
        'C:/migration.assets/upload.bin',
        'migration.assets/./upload.bin',
        'migration.assets/\u0000upload.bin',
      ].map((bundledPath) => ({
        name: `unsafe bundled path ${bundledPath}`,
        mutate(plan: ContentDiffPlan) {
          plan.uploads[0].desired!.transport.bundledPath = bundledPath;
          plan.uploads[0].desired!.transport.sha256 = 'a'.repeat(64);
        },
      })),
      {
        name: 'semantic hash binding',
        mutate(plan) {
          plan.uploads[0].desired!.hash = 'stale-upload-hash';
        },
      },
      {
        name: 'binary changes tuple',
        mutate(plan) {
          const upload = convertCreateUploadToUpdate(plan);
          upload.baseline!.md5 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
          refreshUploadHash(upload.baseline!);
          upload.expectedTargetHash = upload.baseline!.hash;
          upload.changes.binary = false;
          plan.requiredPermissions.uploadActions = ['read'];
        },
      },
      {
        name: 'binary EXIF correction permission',
        mutate(plan) {
          const upload = convertCreateUploadToUpdate(plan);
          upload.desired!.md5 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
          refreshUploadHash(upload.desired!);
          upload.changes = compareUploadChanges(
            upload.desired!,
            upload.baseline!,
          );
          plan.requiredPermissions.uploadActions = ['read', 'replace_asset'];
        },
      },
      {
        name: 'collection changes tuple',
        mutate(plan) {
          const upload = convertCreateUploadToUpdate(plan);
          upload.desired!.manual.collectionId = 'collection-id';
          refreshUploadHash(upload.desired!);
          upload.changes.collection = false;
          plan.requiredPermissions.uploadActions = ['read'];
        },
      },
      {
        name: 'manual update permission',
        mutate(plan) {
          const upload = convertCreateUploadToUpdate(plan);
          upload.desired!.manual.notes = 'changed notes';
          refreshUploadHash(upload.desired!);
          upload.changes = compareUploadChanges(
            upload.desired!,
            upload.baseline!,
          );
          plan.requiredPermissions.uploadActions = ['read'];
        },
      },
      {
        name: 'rename permission',
        mutate(plan) {
          const upload = convertCreateUploadToUpdate(plan);
          upload.desired!.basename = 'renamed-asset';
          upload.desired!.filename = 'renamed-asset.txt';
          refreshUploadHash(upload.desired!);
          upload.changes = compareUploadChanges(
            upload.desired!,
            upload.baseline!,
          );
          plan.requiredPermissions.uploadActions = ['read'];
        },
      },
      {
        name: 'action baseline binding',
        mutate(plan) {
          plan.uploads[0].baseline = structuredClone(plan.uploads[0].desired);
        },
      },
      {
        name: 'non-portable upload create ID',
        mutate(plan) {
          const upload = plan.uploads[0];
          upload.id = 'bad/upload';
          upload.desired!.id = upload.id;
          refreshUploadHash(upload.desired!);
        },
      },
      ...[
        'Asset.txt',
        'asset name.txt',
        'fôô.txt',
        'asset--name.txt',
        'folder/asset.txt',
        'asset\\name.txt',
        'asset\u0000name.txt',
        '',
      ].map((filename) => ({
        name: `filename ${JSON.stringify(filename)}`,
        mutate(plan: ContentDiffPlan) {
          const desired = plan.uploads[0].desired!;
          desired.filename = filename;
          desired.basename = uploadStem(filename);
          refreshUploadHash(desired);
        },
      })),
    ];

    for (const [index, testCase] of cases.entries()) {
      const plan = makePlanWithUpload(
        createHash('md5').update('portable asset bytes').digest('hex'),
      );
      testCase.mutate(plan);
      const untouchedParent = join(directory, `case-${index}`);
      const error = await expectRejects(
        writeContentDiffArtifacts({
          plan,
          migrationFilePath: join(untouchedParent, 'migration.js'),
          format: 'js',
          bundleAssets: false,
        }),
      );
      expect(error.message, testCase.name).to.match(
        /upload|filename|baseline|permission|contract|portable|create/i,
      );
      expect(await pathExists(untouchedParent), testCase.name).to.equal(false);
    }
  });

  it('accepts sparse captured media defaults when a rename does not write them', async () => {
    const directory = await makeTemporaryDirectory();
    const plan = makePlanWithUpload(
      createHash('md5').update('portable asset bytes').digest('hex'),
    );
    const upload = convertCreateUploadToUpdate(plan);
    const sparseMetadata = {
      alt: {},
      title: {},
      custom_data: {},
      focal_point: null,
      poster_time: null,
    };
    upload.baseline!.manual.defaultFieldMetadata =
      structuredClone(sparseMetadata);
    upload.desired!.manual.defaultFieldMetadata =
      structuredClone(sparseMetadata);
    upload.desired!.basename = 'renamed-asset';
    upload.desired!.filename = 'renamed-asset.txt';
    refreshUploadHash(upload.baseline!);
    refreshUploadHash(upload.desired!);
    upload.expectedTargetHash = upload.baseline!.hash;
    upload.changes = compareUploadChanges(upload.desired!, upload.baseline!);
    plan.requiredPermissions.uploadActions = ['read', 'replace_asset'];

    const result = await writeContentDiffArtifacts({
      plan,
      migrationFilePath: join(directory, 'sparse-media-rename.js'),
      format: 'js',
      bundleAssets: false,
    });
    expect(await pathExists(result.migrationPath)).to.equal(true);
  });

  it('rejects re-signed record create identities before artifact filesystem writes', async () => {
    const directory = await makeTemporaryDirectory();
    const cases: Array<{
      name: string;
      mutate(plan: ContentDiffPlan): void;
    }> = [
      {
        name: 'desired record ID mismatch',
        mutate(plan) {
          plan.records[0].desired!.id = 'bad/record';
        },
      },
      {
        name: 'desired record item type mismatch',
        mutate(plan) {
          plan.records[0].desired!.itemTypeId = 'block-model-id';
        },
      },
      {
        name: 'non-portable nested block ID',
        mutate(plan) {
          const block = plan.records[0].desired!.current.fields.content as {
            id: string;
          };
          block.id = 'bad/block';
        },
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const plan = makeWriterCreatePlanWithBlock();
      testCase.mutate(plan);
      const untouchedParent = join(directory, `record-case-${index}`);
      const error = await expectRejects(
        writeContentDiffArtifacts({
          plan,
          migrationFilePath: join(untouchedParent, 'migration.js'),
          format: 'js',
          bundleAssets: false,
        }),
      );
      expect(error.message, testCase.name).to.match(/identit|portable|create/i);
      expect(await pathExists(untouchedParent), testCase.name).to.equal(false);
    }
  });

  it('rejects upload-collection contract, order, and permission tampering before files', async () => {
    const directory = await makeTemporaryDirectory();
    const collectionId = 'YhEa5SbeSl6KwIFizzkzig';
    const cases: Array<{
      name: string;
      mutate(plan: ContentDiffPlan): void;
    }> = [
      {
        name: 'desired ID mismatch',
        mutate(plan) {
          const desired = plan.uploadCollections[0].desired;
          desired.id = 'bad/collection';
          refreshCollectionHash(desired);
        },
      },
      {
        name: 'stale semantic hash',
        mutate(plan) {
          plan.uploadCollections[0].desired.hash = 'stale-hash';
        },
      },
      {
        name: 'update without delta',
        mutate(plan) {
          const collection = plan.uploadCollections[0];
          collection.desired = structuredClone(collection.baseline!);
        },
      },
      {
        name: 'missing execution order',
        mutate(plan) {
          plan.execution.collectionOrder = [];
        },
      },
      {
        name: 'missing manage permission',
        mutate(plan) {
          plan.requiredPermissions.manageUploadCollections = false;
        },
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const plan = makePlan();
      const baseline = makeWriterCollectionSnapshot(
        collectionId,
        'baseline-label',
        1,
      );
      const desired = makeWriterCollectionSnapshot(
        collectionId,
        'desired-label',
        2,
      );
      plan.uploadCollections = [
        {
          id: collectionId,
          action: 'update',
          expectedTargetHash: baseline.hash,
          baseline,
          desired,
        },
      ];
      plan.execution.collectionOrder = [collectionId];
      plan.requiredPermissions.manageUploadCollections = true;
      testCase.mutate(plan);

      const untouchedParent = join(directory, `collection-case-${index}`);
      const error = await expectRejects(
        writeContentDiffArtifacts({
          plan,
          migrationFilePath: join(untouchedParent, 'migration.js'),
          format: 'js',
          bundleAssets: false,
        }),
      );
      expect(error.message, testCase.name).to.match(
        /collection|permission|order|contract/i,
      );
      expect(await pathExists(untouchedParent), testCase.name).to.equal(false);
    }
  });

  it('never removes an exposed runtime when a concurrent writer wins a later artifact path', async () => {
    const directory = await makeTemporaryDirectory();
    const migrationPath = join(directory, '1700000007_raced.js');
    const contentDirectory = join(directory, '.datocms-content');
    const planPath = join(contentDirectory, '1700000007_raced.plan.json');
    const assetBytes = 'portable asset bytes';
    const plan = makePlanWithUpload(
      createHash('md5').update(assetBytes).digest('hex'),
    );
    const fetchFn = (async () => {
      await mkdir(contentDirectory, { recursive: true });
      await writeFile(planPath, 'concurrent writer\n');
      return new Response(assetBytes);
    }) as typeof fetch;

    const error = await expectRejects(
      writeContentDiffArtifacts({
        plan,
        migrationFilePath: migrationPath,
        format: 'js',
        bundleAssets: true,
        fetchFn,
      }),
    );
    const runtimePath = join(
      contentDirectory,
      `runtime-v${RUNTIME_VERSION}.js`,
    );

    expect((error as NodeJS.ErrnoException).code).to.equal('EEXIST');
    expect(await readFile(planPath, 'utf8')).to.equal('concurrent writer\n');
    expect(await readFile(runtimePath, 'utf8')).to.equal(
      `${renderRuntime('js').trimEnd()}\n`,
    );
    expect(await pathExists(migrationPath)).to.equal(false);
    expect(
      await pathExists(join(contentDirectory, '1700000007_raced.assets')),
    ).to.equal(false);
    await expectNoStagingDirectories(directory);
  });

  it('rejects a tampered CREATE sanitizer risk before any artifact filesystem write', async () => {
    const directory = await makeTemporaryDirectory();
    const untouchedParent = join(directory, 'must-not-exist');
    const plan = makePlan();
    const recordId = 'YhEa5SbeSl6KwIFizzkzig';
    const fields = { body: '<p>This <br /> text</p>' };
    const current = { fields, hash: semanticHash(fields) };
    const desired: RecordSnapshot = {
      id: recordId,
      itemTypeId: 'sanitize-model-id',
      current,
      published: null,
      topology: { parentId: null, position: null },
      lifecycle: {
        createdAt: '2026-01-01T00:00:00.000Z',
        firstPublishedAt: null,
      },
      validity: { current: true, published: null },
      stage: null,
      schedules: { publication: null, unpublishing: null },
      hash: semanticHash({ recordId, current }),
      consistency: {
        currentVersion: 'version-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        publishedAt: null,
        currentValid: true,
        publishedValid: null,
      },
    };
    plan.schema.itemTypes = [
      {
        id: 'sanitize-model-id',
        apiKey: 'sanitize_model',
        name: 'Sanitize model',
        modularBlock: false,
        singleton: false,
        sortable: false,
        tree: false,
        draftModeActive: true,
        draftSavingActive: false,
        allLocalesRequired: false,
        workflowId: null,
        fields: [
          {
            id: 'body-field',
            apiKey: 'body',
            fieldType: 'text',
            localized: false,
            position: 1,
            defaultValue: null,
            validators: {
              sanitized_html: { sanitize_before_validation: true },
            },
          },
        ],
      },
    ];
    plan.records = [
      {
        id: recordId,
        itemTypeId: 'sanitize-model-id',
        action: 'create',
        expectedTargetHash: null,
        baseline: null,
        desired,
        changes: {
          current: true,
          published: false,
          topology: false,
          lifecycle: false,
          stage: false,
          schedules: false,
        },
        dependencies: [],
        publishedDependencies: [],
        allowedIntermediateHashes: [],
      },
    ];
    plan.execution.createOrder = [recordId];

    const error = await expectRejects(
      writeContentDiffArtifacts({
        plan,
        migrationFilePath: join(
          untouchedParent,
          'migrations',
          '1700000008_sanitizer.js',
        ),
        format: 'js',
        bundleAssets: false,
      }),
    );

    expect(error.message).to.contain(
      'CMA sanitized_html processing during create',
    );
    expect(await pathExists(untouchedParent)).to.equal(false);
  });

  it('rejects a tampered full-rehydrate UPDATE risk before filesystem writes', async () => {
    const directory = await makeTemporaryDirectory();
    const untouchedParent = join(directory, 'must-not-exist-update');
    const plan = makePlan();
    const recordId = 'SanitizeUpdate1234567';
    const baseline = simpleRecordSnapshot(recordId, {
      body: '<p>Historical <br /> text</p>',
      marker: 'before',
    });
    const desired = simpleRecordSnapshot(recordId, {
      body: '<p>Historical <br /> text</p>',
      marker: 'after',
    });
    plan.schema.itemTypes = [
      {
        id: 'sanitize-model-id',
        apiKey: 'sanitize_model',
        name: 'Sanitize model',
        modularBlock: false,
        singleton: false,
        sortable: false,
        tree: false,
        draftModeActive: true,
        draftSavingActive: false,
        allLocalesRequired: false,
        workflowId: null,
        fields: [
          {
            id: 'body-field',
            apiKey: 'body',
            fieldType: 'text',
            localized: false,
            position: 1,
            defaultValue: null,
            validators: {
              sanitized_html: { sanitize_before_validation: true },
            },
          },
          {
            id: 'marker-field',
            apiKey: 'marker',
            fieldType: 'string',
            localized: false,
            position: 2,
            defaultValue: null,
            validators: {},
          },
        ],
      },
    ];
    plan.records = [
      {
        id: recordId,
        itemTypeId: 'sanitize-model-id',
        action: 'update',
        expectedTargetHash: baseline.hash,
        baseline,
        desired,
        changes: {
          current: true,
          published: false,
          topology: false,
          lifecycle: false,
          stage: false,
          schedules: false,
        },
        dependencies: [],
        publishedDependencies: [],
        allowedIntermediateHashes: [],
      },
    ];
    plan.execution.publishOrder = [recordId];
    plan.execution.updateOrder = [recordId];

    const error = await expectRejects(
      writeContentDiffArtifacts({
        plan,
        migrationFilePath: join(
          untouchedParent,
          'migrations',
          '1700000009_update-sanitizer.js',
        ),
        format: 'js',
        bundleAssets: false,
      }),
    );

    expect(error.message).to.contain(
      'CMA sanitized_html processing during current-restore',
    );
    expect(await pathExists(untouchedParent)).to.equal(false);
  });

  it('includes target-inspection block validators in delete-release safety', async () => {
    const directory = await makeTemporaryDirectory();
    const untouchedParent = join(directory, 'must-not-exist-inspection');
    const plan = makePlan();
    const recordId = 'SanitizeDelete1234567';
    const blockId = 'SanitizeRetired123456';
    const baseline = simpleRecordSnapshot(recordId, {
      feature: {
        id: blockId,
        type: 'item',
        attributes: { body: '<p>Retired <br /> block</p>' },
        relationships: {
          item_type: {
            data: { id: 'retired-block-model', type: 'item_type' },
          },
        },
      },
      marker: 'before',
    });
    plan.schema.itemTypes = [
      {
        id: 'sanitize-model-id',
        apiKey: 'sanitize_model',
        name: 'Sanitize model',
        modularBlock: false,
        singleton: false,
        sortable: false,
        tree: false,
        draftModeActive: true,
        draftSavingActive: false,
        allLocalesRequired: false,
        workflowId: null,
        fields: [
          {
            id: 'feature-field',
            apiKey: 'feature',
            fieldType: 'single_block',
            localized: false,
            position: 1,
            defaultValue: null,
            validators: {},
          },
          {
            id: 'marker-field',
            apiKey: 'marker',
            fieldType: 'string',
            localized: false,
            position: 2,
            defaultValue: null,
            validators: {},
          },
        ],
      },
    ];
    plan.targetInspection.itemTypes = [
      {
        id: 'retired-block-model',
        apiKey: 'retired_block',
        name: 'Retired block',
        modularBlock: true,
        singleton: false,
        sortable: false,
        tree: false,
        draftModeActive: false,
        draftSavingActive: false,
        allLocalesRequired: false,
        workflowId: null,
        fields: [
          {
            id: 'retired-body-field',
            apiKey: 'body',
            fieldType: 'text',
            localized: false,
            position: 1,
            defaultValue: null,
            validators: {
              sanitized_html: { sanitize_before_validation: true },
            },
          },
        ],
      },
    ];
    plan.records = [
      {
        id: recordId,
        itemTypeId: 'sanitize-model-id',
        action: 'delete',
        expectedTargetHash: baseline.hash,
        baseline,
        desired: null,
        changes: {
          current: false,
          published: false,
          topology: false,
          lifecycle: false,
          stage: false,
          schedules: false,
        },
        dependencies: [],
        publishedDependencies: [],
        allowedIntermediateHashes: ['release-hash'],
      },
    ];
    plan.execution.deleteReleases = [
      {
        recordId,
        fields: { marker: 'released' },
        intermediateCurrentHash: 'release-hash',
        publish: false,
        transientNestedBlockIds: [],
      },
    ];
    plan.execution.deleteOrder = [recordId];

    const error = await expectRejects(
      writeContentDiffArtifacts({
        plan,
        migrationFilePath: join(
          untouchedParent,
          'migrations',
          '1700000010_inspection-sanitizer.js',
        ),
        format: 'js',
        bundleAssets: false,
      }),
    );

    expect(error.message).to.contain('field retired-body-field');
    expect(error.message).to.contain('during delete-release');
    expect(await pathExists(untouchedParent)).to.equal(false);
  });
});

function simpleRecordSnapshot(
  recordId: string,
  fields: Record<string, JsonValue>,
): RecordSnapshot {
  const current = { fields, hash: semanticHash(fields) };
  const state = {
    id: recordId,
    itemTypeId: 'sanitize-model-id',
    current,
    published: null,
    topology: { parentId: null, position: null },
    lifecycle: {
      createdAt: '2026-01-01T00:00:00.000Z',
      firstPublishedAt: null,
    },
    validity: { current: true, published: null },
    stage: null,
    schedules: { publication: null, unpublishing: null },
  };
  return {
    ...state,
    hash: semanticHash(state),
    consistency: {
      currentVersion: 'version-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      publishedAt: null,
      currentValid: true,
      publishedValid: null,
    },
  };
}

function makePlan(): ContentDiffPlan {
  return {
    formatVersion: CONTENT_PLAN_FORMAT_VERSION,
    generatorVersion: CONTENT_DIFF_GENERATOR_VERSION,
    source: {
      siteId: 'site-id',
      environmentId: 'source',
      schemaDigest: 'schema-digest',
      snapshotDigest: 'source-snapshot',
      capturedAt: '2026-01-01T00:00:00.000Z',
    },
    target: {
      siteId: 'site-id',
      environmentId: 'destination',
      schemaDigest: 'schema-digest',
      snapshotDigest: 'destination-snapshot',
      capturedAt: '2026-01-01T00:00:00.000Z',
    },
    options: {
      projectMode: 'same_project',
      includeDeletions: false,
      uploads: 'referenced',
      migrateInvalidContent: false,
      migrationsModelApiKey: 'schema_migration',
    },
    schema: {
      siteId: 'site-id',
      environmentId: 'source',
      locales: ['en'],
      environmentSemantics: {
        timezone: 'UTC',
        improvedTimezoneManagement: true,
        improvedBooleanFields: true,
        improvedValidationAtPublishing: true,
        millisecondsInDatetime: true,
        nonLocalizedFocalPoints: true,
        improvedHexManagement: true,
      },
      itemTypes: [],
      workflows: [],
      digest: 'schema-digest',
    },
    targetInspection: {
      itemTypes: [],
      digest: semanticHash({ itemTypes: [] }),
    },
    records: [],
    uploads: [],
    uploadCollections: [],
    legacyIdMappings: {
      formatVersion: LEGACY_ID_MAPPING_FORMAT_VERSION,
      schema: {
        model: {
          id: 'YhEa5SbeSl6KwIFizzkzig',
          apiKey: 'datocms_content_diff',
          name: 'Content diff',
          modularBlock: false,
          singleton: false,
          sortable: false,
          tree: false,
          draftModeActive: true,
          draftSavingActive: false,
          allLocalesRequired: false,
          inverseRelationshipsEnabled: false,
          workflowId: null,
          status: 'new',
        },
        nameField: {
          id: 'XSPMXvayT-yMUrVxP-YoSw',
          apiKey: 'name',
          label: 'Name',
          fieldType: 'string',
          localized: false,
          position: 1,
          validators: { required: {}, unique: {} },
          status: 'new',
        },
        mappingField: {
          id: '-40RNzgBSJaJsXiLSYhtVA',
          apiKey: 'mapping',
          label: 'Mapping',
          fieldType: 'json',
          localized: false,
          position: 2,
          validators: { required: {} },
          status: 'new',
        },
      },
      existingMappingRecords: [],
      entries: [],
      skippedEntries: [],
      newMappingBatch: null,
    },
    invalidContent: {
      formatVersion: INVALID_CONTENT_FORMAT_VERSION,
      migrateInvalidContent: false,
      schemaStates: {
        originalDigest: 'schema-digest',
        fullyRelaxedDigest: 'schema-digest',
        partialRelaxationContract: 'per_field_original_or_relaxed',
      },
      detectedRecordIds: [],
      migratedRecordIds: [],
      propagatedSkipCount: 0,
      validatorRelaxations: [],
      skippedRecords: [],
    },
    execution: {
      collectionOrder: [],
      uploadOrder: [],
      uniqueReleases: [],
      deleteReleases: [],
      shellRecordIds: [],
      shellComponents: [],
      revalidateBeforePublishIds: [],
      createOrder: [],
      publicationSeedOrder: [],
      publishOrder: [],
      updateOrder: [],
      deleteOrder: [],
    },
    targetPreconditions: null,
    requiredPermissions: {
      readItemTypes: [],
      itemTypes: [],
      uploadActions: ['read'],
      manageUploadCollections: false,
      manageSchedules: false,
      editSchema: false,
    },
    warnings: [],
    summary: {
      records: { create: 0, update: 0, delete: 0 },
      uploads: { create: 0, update: 0, delete: 0 },
      uploadCollections: { create: 0, update: 0 },
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
      legacyIdMappings: {
        detected: 0,
        existing: 0,
        created: 0,
        skipped: 0,
        records: 0,
      },
      warnings: 0,
    },
  };
}

function makePlanWithUpload(md5: string): ContentDiffPlan {
  const plan = makePlan();
  const desired: UploadSnapshot = {
    id: 'QtiP3aRYQhK9jRVGDL6kPg',
    md5,
    basename: 'asset',
    filename: 'asset.txt',
    transport: {
      sourceUrl: 'https://example.test/asset.txt',
      bundledPath: null,
      sha256: null,
    },
    size: 21,
    mimeType: 'text/plain',
    manual: {
      author: null,
      copyright: null,
      notes: null,
      defaultFieldMetadata: {
        alt: { en: null },
        title: { en: null },
        custom_data: { en: {} },
        focal_point: null,
        poster_time: null,
      },
      tags: [],
      collectionId: null,
    },
    hash: '',
    consistency: { updatedAt: null, antivirusStatus: 'clean' },
  };
  refreshUploadHash(desired);

  plan.uploads = [
    {
      id: desired.id,
      action: 'create',
      expectedTargetHash: null,
      baseline: null,
      desired,
      changes: { binary: true, metadata: true, collection: true },
    },
  ];
  plan.execution.uploadOrder = [desired.id];
  plan.requiredPermissions.uploadActions = ['read', 'create'];
  plan.summary.uploads.create = 1;

  return plan;
}

function convertCreateUploadToUpdate(plan: ContentDiffPlan) {
  const upload = plan.uploads[0];
  upload.action = 'update';
  upload.baseline = structuredClone(upload.desired);
  upload.expectedTargetHash = upload.baseline!.hash;
  upload.changes = compareUploadChanges(upload.desired!, upload.baseline!);
  plan.requiredPermissions.uploadActions = ['read'];
  return upload;
}

function refreshUploadHash(upload: UploadSnapshot): void {
  upload.hash = semanticHash({
    id: upload.id,
    md5: upload.md5,
    basename: upload.basename,
    filename: upload.filename,
    manual: upload.manual,
  });
}

function uploadStem(filename: string): string {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const dot = filename.lastIndexOf('.');
  return filename.slice(slash + 1, dot > slash + 1 ? dot : filename.length);
}

function makeRecordSnapshotWithBlock(
  recordId: string,
  blockId: string,
  text: string,
): RecordSnapshot {
  const fields = {
    content: {
      id: blockId,
      type: 'item',
      relationships: {
        item_type: { data: { id: 'block-model-id', type: 'item_type' } },
      },
      attributes: { text },
    },
  };
  const version = { fields, hash: semanticHash(fields) };
  return {
    id: recordId,
    itemTypeId: 'model-id',
    current: version,
    published: null,
    topology: { parentId: null, position: null },
    lifecycle: {
      createdAt: '2026-01-01T00:00:00.000Z',
      firstPublishedAt: null,
    },
    validity: { current: true, published: null },
    stage: null,
    schedules: { publication: null, unpublishing: null },
    hash: semanticHash({ fields, text }),
    consistency: {
      currentVersion: `version-${text}`,
      updatedAt: '2026-01-01T00:00:00.000Z',
      publishedAt: null,
      currentValid: true,
      publishedValid: null,
    },
  };
}

function makeWriterCreatePlanWithBlock(): ContentDiffPlan {
  const plan = makePlan();
  const recordId = 'YhEa5SbeSl6KwIFizzkzig';
  const blockId = 'X4h0kJ7xQy2oO3UscO9V6Q';
  const desired = makeRecordSnapshotWithBlock(recordId, blockId, 'created');
  plan.schema.itemTypes = [
    {
      id: 'model-id',
      modularBlock: false,
      fields: [
        {
          apiKey: 'content',
          fieldType: 'single_block',
          localized: false,
        },
      ],
    },
    {
      id: 'block-model-id',
      modularBlock: true,
      fields: [{ apiKey: 'text', fieldType: 'string', localized: false }],
    },
  ] as ContentDiffPlan['schema']['itemTypes'];
  plan.records = [
    {
      id: recordId,
      itemTypeId: 'model-id',
      action: 'create',
      expectedTargetHash: null,
      baseline: null,
      desired,
      changes: {
        current: true,
        published: false,
        topology: false,
        lifecycle: false,
        stage: false,
        schedules: false,
      },
      dependencies: [],
      publishedDependencies: [],
      allowedIntermediateHashes: [],
    },
  ];
  plan.execution.createOrder = [recordId];
  return plan;
}

function makeWriterCollectionSnapshot(
  id: string,
  label: string,
  position: number,
): UploadCollectionSnapshot {
  const snapshot: UploadCollectionSnapshot = {
    id,
    label,
    parentId: null,
    position,
    hash: '',
  };
  refreshCollectionHash(snapshot);
  return snapshot;
}

function refreshCollectionHash(snapshot: UploadCollectionSnapshot): void {
  snapshot.hash = semanticHash({
    id: snapshot.id,
    label: snapshot.label,
    parentId: snapshot.parentId,
    position: snapshot.position,
  });
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'datocms-content-writer-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function expectRejects(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).to.be.instanceOf(Error);
    return error as Error;
  }

  throw new Error('Expected promise to reject');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function expectNoStagingDirectories(directory: string): Promise<void> {
  const entries = await readdir(directory);
  expect(
    entries.filter((entry) => entry.startsWith('.datocms-content-stage-')),
  ).to.deep.equal([]);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
