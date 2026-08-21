import assert from 'node:assert/strict';
import {
  analyzeComplexFields,
  buildComplexStressFields,
  complexRecursiveApiKeys,
} from './complex-recursive-boundary-scenario';

describe('complex recursive boundary real-CMA fixture contract', () => {
  it('builds 500 unique blocks at depth five with the complete DAST grammar', () => {
    const fields = buildComplexStressFields({
      runId: 'offline-boundary',
      blockModelId: 'abcdefghij',
      anchorRecordId: 'klmnopqrst',
      blockCount: 500,
      blockDepth: 5,
      variant: 'current',
    });
    const analysis = analyzeComplexFields(fields);
    assert.equal(analysis.blockCount, 500);
    assert.equal(new Set(analysis.blockIds).size, 500);
    assert.equal(analysis.blockDepth, 5);
    assert.ok(analysis.serializedBytes >= 250_000);
    for (const type of [
      'root',
      'paragraph',
      'heading',
      'span',
      'link',
      'inlineItem',
      'itemLink',
      'inlineBlock',
      'list',
      'listItem',
      'code',
      'blockquote',
      'thematicBreak',
      'block',
    ]) {
      assert.ok(analysis.dastNodeTypes.includes(type), `missing ${type}`);
    }
  });

  it('uses deterministic compact model API keys', () => {
    const first = complexRecursiveApiKeys('very-long-run-id-123');
    const second = complexRecursiveApiKeys('very-long-run-id-123');
    assert.deepEqual(first, second);
    assert.notEqual(first.model, first.block);
    for (const apiKey of Object.values(first)) {
      assert.match(apiKey, /^[a-z](?:[a-z0-9]|_(?![_0-9]))*[a-z0-9]$/);
      assert.ok(apiKey.length <= 30);
    }
  });
});
