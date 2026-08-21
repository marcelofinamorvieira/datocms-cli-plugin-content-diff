import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appliedEnvironmentOwnershipIsProven,
  guardCmaClientAgainstMutationsForTest,
  invokeGeneratedMigrationForReplay,
} from './real-cma-harness';

describe('real-CMA harness cleanup ownership', () => {
  const expectedSource = 'cde2e-source';
  const trackingModel = 'cde2e_migrations_run';

  it('requires both the expected fork source and the per-run tracking model', () => {
    assert.equal(
      appliedEnvironmentOwnershipIsProven({
        candidate: { meta: { forked_from: expectedSource } },
        sourceEnvironmentId: expectedSource,
        itemTypeApiKeys: ['fixture', trackingModel],
        migrationModelApiKey: trackingModel,
      }),
      true,
    );
  });

  it('does not adopt an absent, unrelated, or same-source colliding environment', () => {
    for (const testCase of [
      {
        candidate: null,
        itemTypeApiKeys: [trackingModel],
      },
      {
        candidate: { meta: { forked_from: 'another-source' } },
        itemTypeApiKeys: [trackingModel],
      },
      {
        candidate: { meta: { forked_from: expectedSource } },
        itemTypeApiKeys: ['somebody_elses_model'],
      },
    ] as const) {
      assert.equal(
        appliedEnvironmentOwnershipIsProven({
          ...testCase,
          sourceEnvironmentId: expectedSource,
          migrationModelApiKey: trackingModel,
        }),
        false,
      );
    }
  });
});

describe('real-CMA harness replay mutation guard', () => {
  it('allows reads and rejects mutators before calling the underlying client', async () => {
    const calls: string[] = [];
    const client = {
      items: {
        async find(id: string) {
          calls.push(`find:${id}`);
          return { id };
        },
        async update(id: string) {
          calls.push(`update:${id}`);
          return { id };
        },
      },
      uploads: {
        async updateFromLocalFile(id: string) {
          calls.push(`upload:${id}`);
          return { id };
        },
      },
    };
    const guarded = guardCmaClientAgainstMutationsForTest(client);

    assert.deepEqual(await guarded.items.find('record-1'), { id: 'record-1' });
    assert.throws(
      () => guarded.items.update('record-1'),
      /attempted CMA mutation items\.update/,
    );
    assert.throws(
      () => guarded.uploads.updateFromLocalFile('upload-1'),
      /attempted CMA mutation uploads\.updateFromLocalFile/,
    );
    assert.deepEqual(calls, ['find:record-1']);
  });

  it('loads TypeScript with the core tsx semantics and passes the guarded protocol context', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-diff-ts-replay-'));
    const migrationPath = join(directory, '1700000000_replay.ts');
    const calls: string[] = [];
    const client = {
      items: {
        async find(id: string) {
          calls.push(`find:${id}`);
          return { id };
        },
        async update(id: string) {
          calls.push(`update:${id}`);
          return { id };
        },
      },
    };

    try {
      await writeFile(
        migrationPath,
        `import type { Client } from 'datocms/lib/cma-client-node';

export default async function migration(
  client: Client,
  executionContext: unknown,
): Promise<void> {
  (globalThis as any).__contentDiffReplayContext = executionContext;
  await client.items.find('record-1');
  await client.items.update('record-1', {});
}
`,
      );

      await assert.rejects(
        invokeGeneratedMigrationForReplay(
          migrationPath,
          client as never,
          'applied-environment',
        ),
        /attempted CMA mutation items\.update/,
      );
      assert.deepEqual(
        (globalThis as Record<string, unknown>).__contentDiffReplayContext,
        {
          environmentId: 'applied-environment',
          inPlace: false,
          allowPrimary: false,
          contentDiffProtocolVersion: 1,
        },
      );
      assert.deepEqual(calls, ['find:record-1']);
    } finally {
      (globalThis as Record<string, unknown>).__contentDiffReplayContext =
        undefined;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
