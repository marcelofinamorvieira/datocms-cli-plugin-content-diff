import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CmaClient } from '@datocms/cli-utils';
import type { RealCmaScenario, RealCmaScenarioSeed } from './real-cma-harness';

type FreshNestedUpdateSeed = RealCmaScenarioSeed &
  Readonly<{
    modelId: string;
    modelApiKey: string;
    blockModelId: string;
    recordId: string;
    baselineBlockId: string;
  }>;

export type RecordBlockState = Readonly<{
  status: string;
  currentValid: boolean;
  publishedValid: boolean;
  currentTitle: string;
  currentBlockId: string;
  currentBlockItemTypeId: string;
  currentBlockLabel: string;
  publishedTitle: string;
  publishedBlockId: string;
  publishedBlockItemTypeId: string;
  publishedBlockLabel: string;
}>;

type FreshNestedUpdateExpected = Readonly<{
  source: RecordBlockState;
  destination: RecordBlockState;
}>;

export const freshNestedUpdateGateScenario: RealCmaScenario<
  FreshNestedUpdateSeed,
  FreshNestedUpdateExpected
> = {
  name: 'preserve an aggregate whose staged updates need fresh nested IDs',

  async seedSource({ client, runId }) {
    console.log(
      '[content-diff e2e] Creating fresh nested UPDATE safety fixture',
    );
    const suffix = createHash('sha256')
      .update(runId)
      .digest('hex')
      .slice(0, 12);
    const modelApiKey = `cde2e_fu_r${suffix}`;
    const blockModelApiKey = `cde2e_fb_r${suffix}`;
    const blockModel = await client.itemTypes.create({
      name: `Fresh update block ${runId}`,
      api_key: blockModelApiKey,
      modular_block: true,
    });
    await client.fields.create(blockModel.id, {
      label: 'Label',
      api_key: 'label',
      field_type: 'string',
      localized: false,
      validators: { required: {} },
    });
    const model = await client.itemTypes.create({
      name: `Fresh update owner ${runId}`,
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
    await client.fields.create(model.id, {
      label: 'Title',
      api_key: 'title',
      field_type: 'string',
      localized: false,
      validators: { required: {} },
    });
    await client.fields.create(model.id, {
      label: 'Hero',
      api_key: 'hero',
      field_type: 'single_block',
      localized: false,
      validators: {
        single_block_blocks: { item_types: [blockModel.id] },
      },
    });
    const record = await client.items.create({
      item_type: { id: model.id, type: 'item_type' },
      title: 'baseline',
      hero: block(blockModel.id, 'baseline block'),
    });
    await client.items.publish(record.id);
    const baseline = await captureRecordBlockState(client, record.id);
    assert.equal(
      baseline.currentBlockId,
      baseline.publishedBlockId,
      'seed publication did not retain one exact nested identity',
    );

    return {
      itemTypeApiKeys: [modelApiKey],
      modelId: model.id,
      modelApiKey,
      blockModelId: blockModel.id,
      recordId: record.id,
      baselineBlockId: baseline.currentBlockId,
    };
  },

  async introduceDrift({ seed, sourceClient, destinationClient }) {
    const beforePublishedUpdate = await sourceClient.items.find(seed.recordId);
    await sourceClient.items.update(seed.recordId, {
      title: 'source published',
      hero: block(seed.blockModelId, 'source published block'),
      meta: { current_version: beforePublishedUpdate.meta.current_version },
    });
    await sourceClient.items.publish(seed.recordId);

    const beforeCurrentUpdate = await sourceClient.items.find(seed.recordId);
    await sourceClient.items.update(seed.recordId, {
      title: 'source current',
      hero: block(seed.blockModelId, 'source current block'),
      meta: { current_version: beforeCurrentUpdate.meta.current_version },
    });

    const [source, destination] = await Promise.all([
      captureRecordBlockState(sourceClient, seed.recordId),
      captureRecordBlockState(destinationClient, seed.recordId),
    ]);
    assert.notEqual(source.publishedBlockId, seed.baselineBlockId);
    assert.notEqual(source.currentBlockId, seed.baselineBlockId);
    assert.notEqual(source.currentBlockId, source.publishedBlockId);
    assert.equal(source.status, 'updated');
    assert.equal(source.currentValid, true);
    assert.equal(source.publishedValid, true);
    assert.equal(source.currentTitle, 'source current');
    assert.equal(source.currentBlockItemTypeId, seed.blockModelId);
    assert.equal(source.currentBlockLabel, 'source current block');
    assert.equal(source.publishedTitle, 'source published');
    assert.equal(source.publishedBlockItemTypeId, seed.blockModelId);
    assert.equal(source.publishedBlockLabel, 'source published block');
    assert.deepEqual(destination, {
      status: 'published',
      currentValid: true,
      publishedValid: true,
      currentTitle: 'baseline',
      currentBlockId: seed.baselineBlockId,
      currentBlockItemTypeId: seed.blockModelId,
      currentBlockLabel: 'baseline block',
      publishedTitle: 'baseline',
      publishedBlockId: seed.baselineBlockId,
      publishedBlockItemTypeId: seed.blockModelId,
      publishedBlockLabel: 'baseline block',
    });

    return { source, destination };
  },

  async verifyGeneratedPlan({ seed, expected, planFilePath }) {
    const envelope = object(JSON.parse(await readFile(planFilePath, 'utf8')));
    const plan = object(envelope.plan);
    const invalidContent = object(plan.invalidContent);
    const skipped = array(invalidContent.skippedRecords).map((value) =>
      object(value),
    );

    assert.equal(envelope.formatVersion, 9);
    assert.equal(envelope.runtimeVersion, '15');
    assert.equal(plan.formatVersion, 9);
    assert.deepEqual(array(plan.records), []);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].id, seed.recordId);
    assert.equal(skipped[0].disposition, 'preserve_target');
    assert.deepEqual(array(skipped[0].targetNestedBlockIds), [
      seed.baselineBlockId,
    ]);
    assert.deepEqual(
      array(skipped[0].sourceNestedBlockIds).map(String).sort(),
      [expected.source.currentBlockId, expected.source.publishedBlockId].sort(),
    );

    const reasons = array(skipped[0].reasons).map((value) => object(value));
    const current = reasons.find(({ slice }) => slice === 'current');
    const published = reasons.find(({ slice }) => slice === 'published');
    assert.ok(current, 'missing current fresh nested UPDATE reason');
    assert.ok(published, 'missing published fresh nested UPDATE reason');
    for (const reason of [current, published]) {
      assert.equal(reason.code, 'UNSUPPORTED_FRESH_NESTED_BLOCK_UPDATE');
      assert.deepEqual(array(reason.dependencyChain), [
        seed.recordId,
        reason.dependencyId,
      ]);
    }
    assert.equal(current.dependencyId, expected.source.currentBlockId);
    assert.equal(published.dependencyId, expected.source.publishedBlockId);
    assert.deepEqual(array(invalidContent.validatorRelaxations), []);
    assert.deepEqual(
      array(object(plan.execution).revalidateBeforePublishIds),
      [],
    );
  },

  async verify({
    seed,
    expected,
    sourceClient,
    destinationClient,
    appliedClient,
  }) {
    const [source, destination, applied] = await Promise.all([
      captureRecordBlockState(sourceClient, seed.recordId),
      captureRecordBlockState(destinationClient, seed.recordId),
      captureRecordBlockState(appliedClient, seed.recordId),
    ]);
    assert.deepEqual(source, expected.source, 'source fixture changed');
    assert.deepEqual(
      destination,
      expected.destination,
      'destination fixture changed',
    );
    assert.deepEqual(
      applied,
      expected.destination,
      'skipped aggregate was not preserved exactly in applied',
    );
  },
};

function block(blockModelId: string, label: string) {
  return CmaClient.buildBlockRecord({
    item_type: { id: blockModelId, type: 'item_type' },
    label,
  });
}

async function captureRecordBlockState(
  client: CmaClient.Client,
  recordId: string,
): Promise<RecordBlockState> {
  const [current, published] = await Promise.all([
    client.items.find(recordId, { version: 'current', nested: true }),
    client.items.find(recordId, { version: 'published', nested: true }),
  ]);
  return projectFreshNestedRecordState(current, published, recordId);
}

export function projectFreshNestedRecordState(
  current: unknown,
  published: unknown,
  recordId: string,
): RecordBlockState {
  const currentRecord = object(current, `${recordId}.current`);
  const publishedRecord = object(published, `${recordId}.published`);
  const currentMeta = object(currentRecord.meta, `${recordId}.meta`);
  const currentBlock = nestedBlockProjection(
    currentRecord.hero,
    `${recordId}.current.hero`,
  );
  const publishedBlock = nestedBlockProjection(
    publishedRecord.hero,
    `${recordId}.published.hero`,
  );
  return {
    status: stringField(currentMeta, 'status', `${recordId}.meta.status`),
    currentValid: booleanField(
      currentMeta,
      'is_current_version_valid',
      `${recordId}.meta.is_current_version_valid`,
    ),
    publishedValid: booleanField(
      currentMeta,
      'is_published_version_valid',
      `${recordId}.meta.is_published_version_valid`,
    ),
    currentTitle: stringField(
      currentRecord,
      'title',
      `${recordId}.current.title`,
    ),
    currentBlockId: currentBlock.id,
    currentBlockItemTypeId: currentBlock.itemTypeId,
    currentBlockLabel: currentBlock.label,
    publishedTitle: stringField(
      publishedRecord,
      'title',
      `${recordId}.published.title`,
    ),
    publishedBlockId: publishedBlock.id,
    publishedBlockItemTypeId: publishedBlock.itemTypeId,
    publishedBlockLabel: publishedBlock.label,
  };
}

function nestedBlockProjection(
  value: unknown,
  path: string,
): { id: string; itemTypeId: string; label: string } {
  const nested = object(value, path);
  const attributes = object(nested.attributes, `${path}.attributes`);
  const relationships = object(nested.relationships, `${path}.relationships`);
  const itemTypeRelationship = object(
    relationships.item_type,
    `${path}.relationships.item_type`,
  );
  const itemType = object(
    itemTypeRelationship.data,
    `${path}.relationships.item_type.data`,
  );
  return {
    id: stringField(nested, 'id', `${path}.id`),
    itemTypeId: stringField(
      itemType,
      'id',
      `${path}.relationships.item_type.data.id`,
    ),
    label: stringField(attributes, 'label', `${path}.attributes.label`),
  };
}

function stringField(value: unknown, field: string, path: string): string {
  const record = object(value);
  assert.equal(typeof record[field], 'string', `${path} is not a string`);
  return record[field] as string;
}

function booleanField(value: unknown, field: string, path: string): boolean {
  const record = object(value);
  assert.equal(typeof record[field], 'boolean', `${path} is not a boolean`);
  return record[field] as boolean;
}

function object(value: unknown, path = 'value'): Record<string, unknown> {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    `${path} is not an object`,
  );
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}
