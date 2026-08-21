import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import {
  assertNoLegacyDestinationIdCollisions,
  assertPublicationBoundarySafety,
  assertPublishedDeleteReleasesValid,
  assertTransientDeleteReleaseIdsUnoccupied,
  generateContentDiffMigration,
} from '../../src/content-diff';
import type { DeleteReleaseStep } from '../../src/content-diff';
import { ContentDiffError } from '../../src/content-diff';

describe('content diff orchestration', () => {
  it('uses each project root client for its own permission proof', async () => {
    let sourcePermissionChecks = 0;
    let destinationPermissionChecks = 0;
    let contentReads = 0;
    const schemaClient = (siteId: string) =>
      ({
        site: {
          find: async () => ({
            id: siteId,
            locales: ['en'],
            timezone: 'UTC',
            meta: {
              improved_timezone_management: true,
              improved_boolean_fields: true,
              improved_validation_at_publishing: true,
              milliseconds_in_datetime: true,
              non_localized_focal_points: true,
              improved_hex_management: true,
            },
          }),
        },
        itemTypes: {
          list: async () => [
            {
              id: 'article-model',
              name: 'Article',
              api_key: 'article',
              modular_block: false,
              singleton: false,
              sortable: false,
              tree: false,
              draft_mode_active: true,
              draft_saving_active: false,
              all_locales_required: false,
              workflow: null,
            },
          ],
        },
        fields: {
          list: async () => [
            {
              id: 'title-field',
              api_key: 'title',
              field_type: 'string',
              localized: false,
              position: 1,
              default_value: null,
              validators: {},
            },
          ],
        },
        workflows: { list: async () => [] },
        items: {
          listPagedIterator: () => {
            contentReads += 1;
            throw new Error('Content must not be read without both proofs');
          },
        },
      }) as any;

    try {
      await generateContentDiffMigration({
        source: {
          rootClient: {
            users: {
              findMe: async () => {
                sourcePermissionChecks += 1;
                return { type: 'account' };
              },
            },
          } as any,
          environmentClient: schemaClient('source-site'),
          environmentId: 'main',
        },
        destination: {
          rootClient: {
            users: {
              findMe: async () => {
                destinationPermissionChecks += 1;
                return undefined;
              },
            },
          } as any,
          environmentClient: schemaClient('destination-site'),
          environmentId: 'main',
        },
        migrationFilePath: '/not-created.js',
        format: 'js',
        options: {
          itemTypes: 'all',
          uploads: 'referenced',
          includeDeletions: false,
          bundleAssets: false,
          migrateInvalidContent: false,
        },
      });
    } catch (error) {
      expect(error).to.be.instanceOf(ContentDiffError);
      expect((error as ContentDiffError).code).to.equal('UNPROVEN_FULL_ACCESS');
      expect(sourcePermissionChecks).to.equal(1);
      expect(destinationPermissionChecks).to.equal(1);
      expect(contentReads).to.equal(0);
      return;
    }

    throw new Error('Expected the destination permission proof to fail');
  });

  it('stops on managed schema drift before content reads or artifact creation', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'datocms-content-schema-gate-'),
    );
    const migrationFilePath = join(temporaryDirectory, '1700000000_sync.js');
    let contentReads = 0;

    const schemaClient = (
      siteId: string,
      validators: Record<string, unknown>,
    ) =>
      ({
        site: {
          find: async () => ({
            id: siteId,
            locales: ['en'],
            timezone: 'UTC',
            meta: {
              improved_timezone_management: true,
              improved_boolean_fields: true,
              improved_validation_at_publishing: true,
              milliseconds_in_datetime: true,
              non_localized_focal_points: true,
              improved_hex_management: true,
            },
          }),
        },
        itemTypes: {
          list: async () => [
            {
              id: 'article-model',
              api_key: 'article',
              modular_block: false,
              singleton: false,
              sortable: false,
              tree: false,
              draft_mode_active: true,
              draft_saving_active: false,
              all_locales_required: false,
              workflow: null,
            },
          ],
        },
        fields: {
          list: async () => [
            {
              id: 'title-field',
              api_key: 'title',
              field_type: 'string',
              localized: false,
              position: 1,
              validators,
            },
          ],
        },
        workflows: { list: async () => [] },
        items: {
          listPagedIterator: () => {
            contentReads += 1;
            throw new Error('Content must not be read after schema mismatch');
          },
        },
        uploads: {
          listPagedIterator: () => {
            contentReads += 1;
            throw new Error('Uploads must not be read after schema mismatch');
          },
        },
      }) as any;

    const clients = {
      source: schemaClient('source-site', {}),
      destination: schemaClient('destination-site', { required: {} }),
    };

    try {
      await generateContentDiffMigration({
        source: {
          rootClient: {} as any,
          environmentClient: clients.source,
          environmentId: 'main',
        },
        destination: {
          rootClient: {} as any,
          environmentClient: clients.destination,
          environmentId: 'main',
        },
        migrationFilePath,
        format: 'js',
        options: {
          itemTypes: 'all',
          uploads: 'referenced',
          includeDeletions: false,
          bundleAssets: false,
          migrateInvalidContent: true,
        },
      });
    } catch (error) {
      expect(error).to.be.instanceOf(ContentDiffError);
      expect((error as ContentDiffError).code).to.equal('SCHEMA_MISMATCH');
      expect(contentReads).to.equal(0);

      try {
        await access(migrationFilePath);
        throw new Error('Schema mismatch unexpectedly created an artifact');
      } catch (accessError) {
        expect((accessError as NodeJS.ErrnoException).code).to.equal('ENOENT');
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }

      return;
    }

    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error('Expected managed schema mismatch to fail generation');
  });

  it('stops on environment semantics drift before ledger or content reads', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'datocms-content-environment-gate-'),
    );
    const migrationFilePath = join(temporaryDirectory, '1700000000_sync.js');
    let contentReads = 0;
    const schemaClient = (improvedValidationAtPublishing: boolean) =>
      ({
        site: {
          find: async () => ({
            id: 'site-id',
            locales: ['en'],
            timezone: 'UTC',
            meta: {
              improved_timezone_management: true,
              improved_boolean_fields: true,
              improved_validation_at_publishing: improvedValidationAtPublishing,
              milliseconds_in_datetime: true,
              non_localized_focal_points: true,
              improved_hex_management: true,
            },
          }),
        },
        itemTypes: {
          list: async () => [
            {
              id: 'article-model',
              name: 'Article',
              api_key: 'article',
              modular_block: false,
              singleton: false,
              sortable: false,
              tree: false,
              draft_mode_active: true,
              draft_saving_active: false,
              all_locales_required: false,
              workflow: null,
            },
          ],
        },
        fields: {
          list: async () => [
            {
              id: 'title-field',
              api_key: 'title',
              field_type: 'string',
              localized: false,
              position: 1,
              default_value: null,
              validators: {},
            },
          ],
        },
        workflows: { list: async () => [] },
        items: {
          listPagedIterator: () => {
            contentReads += 1;
            throw new Error(
              'Records must not be read after semantics mismatch',
            );
          },
        },
      }) as any;
    const clients = {
      source: schemaClient(true),
      destination: schemaClient(false),
    };

    try {
      await generateContentDiffMigration({
        source: {
          rootClient: {} as any,
          environmentClient: clients.source,
          environmentId: 'source',
        },
        destination: {
          rootClient: {} as any,
          environmentClient: clients.destination,
          environmentId: 'destination',
        },
        migrationFilePath,
        format: 'js',
        options: {
          itemTypes: 'all',
          uploads: 'referenced',
          includeDeletions: false,
          bundleAssets: false,
          migrateInvalidContent: true,
        },
      });
    } catch (error) {
      expect(error).to.be.instanceOf(ContentDiffError);
      expect((error as ContentDiffError).code).to.equal(
        'ENVIRONMENT_SEMANTICS_MISMATCH',
      );
      expect(contentReads).to.equal(0);
      await rm(temporaryDirectory, { recursive: true, force: true });
      return;
    }

    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error('Expected environment semantics mismatch');
  });

  it('requires out-of-scope published dependencies to already be published', async () => {
    const client = {
      items: {
        find: async () => {
          throw { response: { status: 404 } };
        },
        references: async () => [],
      },
    } as any;

    try {
      await assertPublicationBoundarySafety(
        client,
        makePublicationPlan([
          {
            id: 'managed',
            action: 'create',
            baseline: null,
            desired: { published: { fields: {}, hash: 'published' } },
            publishedDependencies: ['external'],
          },
        ]),
      );
    } catch (error) {
      expect(error).to.be.instanceOf(ContentDiffError);
      expect((error as ContentDiffError).code).to.equal(
        'UNSUPPORTED_CONTENT_STATE',
      );
      expect((error as Error).message).to.contain('outside the selected scope');
      return;
    }

    throw new Error('Expected unpublished external dependency to fail');
  });

  it('rejects an out-of-scope destination Item occupying a legacy source ID before remapping', () => {
    expect(() =>
      assertNoLegacyDestinationIdCollisions([
        { id: '178178741', kind: 'record', topRecordId: '178178741' },
      ]),
    ).to.throw(ContentDiffError, 'already belong to out-of-scope destination');
  });

  it('accepts ordered selected referrers and rejects external published referrers', async () => {
    const safeClient = {
      items: {
        find: async () => ({ id: 'published' }),
        references: async () => [{ id: 'referrer' }],
      },
    } as any;
    const safePlan = makePublicationPlan(
      [
        {
          id: 'target',
          action: 'update',
          baseline: { published: { fields: {}, hash: 'old' } },
          desired: { published: null },
          publishedDependencies: [],
        },
        {
          id: 'referrer',
          action: 'update',
          baseline: { published: { fields: {}, hash: 'old-referrer' } },
          desired: { published: { fields: {}, hash: 'new-referrer' } },
          publishedDependencies: [],
        },
      ],
      ['referrer', 'target'],
    );

    await assertPublicationBoundarySafety(safeClient, safePlan);

    const unsafeClient = {
      items: {
        find: async () => ({ id: 'published' }),
        references: async () => [{ id: 'external-referrer' }],
      },
    } as any;
    try {
      await assertPublicationBoundarySafety(unsafeClient, safePlan);
    } catch (error) {
      expect(error).to.be.instanceOf(ContentDiffError);
      expect((error as Error).message).to.contain(
        'outside the selected reconciliation order',
      );
      return;
    }

    throw new Error('Expected external published referrer to fail');
  });

  it('keeps published delete cycles local and rejects cross-boundary referrers', async () => {
    const sameIslandPlan = makePublicationPlan([
      {
        id: 'delete-a',
        action: 'delete',
        baseline: { published: { fields: {}, hash: 'published-a' } },
        desired: null,
        publishedDependencies: [],
      },
      {
        id: 'delete-b',
        action: 'delete',
        baseline: { published: { fields: {}, hash: 'published-b' } },
        desired: null,
        publishedDependencies: [],
      },
    ]);
    await assertPublicationBoundarySafety(
      {
        items: {
          find: async () => ({ id: 'published' }),
          references: async (id: string) =>
            id === 'delete-a' ? [{ id: 'delete-b' }] : [{ id: 'delete-a' }],
        },
      } as any,
      sameIslandPlan,
    );

    try {
      await assertPublicationBoundarySafety(
        {
          items: {
            find: async () => ({ id: 'published' }),
            references: async () => [{ id: 'retained-referrer' }],
          },
        } as any,
        sameIslandPlan,
      );
    } catch (error) {
      expect(error).to.be.instanceOf(ContentDiffError);
      expect((error as Error).message).to.contain(
        'outside the selected reconciliation or deletion island',
      );
      return;
    }

    throw new Error('Expected cross-boundary deletion referrer to fail');
  });

  it('requires temporary published deletion-release dependencies to be published', async () => {
    const plan = makePublicationPlan([
      {
        id: 'delete-owner',
        itemTypeId: 'model',
        action: 'delete',
        baseline: {
          id: 'delete-owner',
          itemTypeId: 'model',
          current: { fields: { target: 'external' }, hash: 'current' },
          published: { fields: { target: 'external' }, hash: 'published' },
          topology: { parentId: null, position: null },
        },
        desired: null,
        publishedDependencies: [],
      },
    ]);
    plan.schema = {
      itemTypes: [
        {
          id: 'model',
          fields: [
            {
              apiKey: 'target',
              fieldType: 'link',
              localized: false,
              validators: {},
            },
          ],
        },
      ],
    };
    plan.execution.deleteReleases = [
      {
        recordId: 'delete-owner',
        fields: { target: 'external' },
        intermediateCurrentHash: 'released',
        publish: true,
        transientNestedBlockIds: [],
      },
    ];

    try {
      await assertPublicationBoundarySafety(
        {
          items: {
            find: async () => {
              throw { response: { status: 404 } };
            },
            references: async () => [],
          },
        } as any,
        plan,
      );
    } catch (error) {
      expect(error).to.be.instanceOf(ContentDiffError);
      expect((error as Error).message).to.contain(
        'temporary published content',
      );
      return;
    }

    throw new Error('Expected unpublished release dependency to fail');
  });

  it('prevalidates published deletion releases without wrapping their fields', async () => {
    const calls: Array<{ id: string; body: unknown }> = [];
    let active = 0;
    let maximumActive = 0;
    const client = {
      items: {
        validateExisting: async (id: string, body: unknown) => {
          calls.push({ id, body });
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await Promise.resolve();
          active -= 1;
        },
      },
    } as any;
    const releases = Array.from({ length: 7 }, (_, index) =>
      makeRelease(`record-${index}`, index !== 6),
    );

    await assertPublishedDeleteReleasesValid(client, releases);

    expect(calls).to.have.length(6);
    expect(maximumActive).to.be.at.most(5);
    expect(calls[0]).to.deep.equal({
      id: 'record-0',
      body: { title: 'record-0', target: null },
    });
  });

  it('prevalidates published-derived nested blocks as fresh validation-only payloads', async () => {
    const calls: unknown[] = [];
    const release: DeleteReleaseStep = {
      recordId: 'record-nested',
      fields: {
        body: {
          schema: 'dast',
          document: {
            type: 'root',
            children: [
              {
                type: 'block',
                item: {
                  id: 'YhEa5SbeSl6KwIFizzkzig',
                  type: 'item',
                  relationships: {
                    item_type: {
                      data: { id: 'block-model', type: 'item_type' },
                    },
                  },
                  attributes: { label: 'retained' },
                },
              },
            ],
          },
        },
      },
      intermediateCurrentHash: 'release-hash',
      publish: true,
      transientNestedBlockIds: ['YhEa5SbeSl6KwIFizzkzig'],
    };
    const destination = {
      records: { 'record-nested': { itemTypeId: 'model' } },
      schema: {
        itemTypes: [
          {
            id: 'model',
            modularBlock: false,
            fields: [
              {
                apiKey: 'body',
                fieldType: 'structured_text',
                localized: false,
              },
            ],
          },
          {
            id: 'block-model',
            modularBlock: true,
            fields: [
              { apiKey: 'label', fieldType: 'string', localized: false },
            ],
          },
        ],
      },
      inspection: { itemTypes: [] },
    } as any;

    await assertPublishedDeleteReleasesValid(
      {
        items: {
          validateExisting: async (_id: string, body: unknown) => {
            calls.push(body);
          },
        },
      } as any,
      [release],
      new Set(),
      destination,
    );

    const body = calls[0] as any;
    const block = body.body.document.children[0].item;
    expect(block).not.to.have.property('id');
    expect(block.attributes).to.deep.equal({ label: 'retained' });
    expect(block.relationships.item_type.data.id).to.equal('block-model');
  });

  it('fails closed when a transient deletion-release block ID is occupied', async () => {
    const release = makeRelease('record-owner', true);
    release.transientNestedBlockIds = ['YhEa5SbeSl6KwIFizzkzig'];

    try {
      await assertTransientDeleteReleaseIdsUnoccupied(
        {
          items: {
            find: async () => ({ id: 'YhEa5SbeSl6KwIFizzkzig' }),
          },
        } as any,
        [release],
      );
    } catch (error) {
      expect(error).to.be.instanceOf(ContentDiffError);
      expect((error as ContentDiffError).code).to.equal(
        'BLOCK_OWNERSHIP_CONFLICT',
      );
      expect((error as Error).message).to.contain('No migration artifacts');
      return;
    }

    throw new Error('Expected occupied transient block ID to fail');
  });

  it('rejects a release that cannot be validly published', async () => {
    const client = {
      items: {
        validateExisting: async () => {
          throw new Error('invalid record');
        },
      },
    } as any;

    try {
      await assertPublishedDeleteReleasesValid(client, [
        makeRelease('record-invalid', true),
      ]);
    } catch (error) {
      expect(error).to.be.instanceOf(ContentDiffError);
      expect((error as ContentDiffError).code).to.equal(
        'UNSUPPORTED_CONTENT_STATE',
      );
      expect((error as Error).message).to.contain('No migration artifacts');
      return;
    }

    throw new Error('Expected published deletion release validation to fail');
  });

  it('defers only validator-owned published deletion releases until the relaxed runtime preflight', async () => {
    const calls: string[] = [];
    const client = {
      items: {
        validateExisting: async (id: string) => {
          calls.push(id);
          if (id === 'record-relaxed') throw new Error('required');
        },
      },
    } as any;

    await assertPublishedDeleteReleasesValid(
      client,
      [makeRelease('record-valid', true), makeRelease('record-relaxed', true)],
      new Set(['record-relaxed']),
    );

    expect(calls).to.deep.equal(['record-valid']);
  });
});

function makeRelease(recordId: string, publish: boolean): DeleteReleaseStep {
  return {
    recordId,
    fields: { title: recordId, target: null },
    intermediateCurrentHash: `hash-${recordId}`,
    publish,
    transientNestedBlockIds: [],
  };
}

function makePublicationPlan(
  records: Array<Record<string, any>>,
  publishOrder = records.map(({ id }) => String(id)),
): any {
  return {
    records,
    schema: { itemTypes: [] },
    execution: { publishOrder, deleteReleases: [] },
  };
}
