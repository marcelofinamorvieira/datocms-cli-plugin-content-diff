import assert from 'node:assert/strict';
import { SAFELY_RELAXABLE_VALIDATOR_KEYS } from '../../src/content-diff/plan';
import {
  ASSET_SEO_VALIDATOR_GAUNTLET_KEYS,
  SCALAR_VALIDATOR_GAUNTLET_KEYS,
  assetSeoValidatorGauntletScenario,
  buildValidatorGauntletModelApiKey,
  scalarValidatorGauntletScenario,
} from './validator-gauntlet-scenarios';

const PREVIOUSLY_PROVED_LIVE_VALIDATORS = [
  'enum',
  'length',
  'number_range',
  'required',
  'unique',
] as const;

describe('validator gauntlet real-CMA fixture contract', () => {
  it('covers every previously unproved content-invalidating validator exactly once', () => {
    const gauntletKeys = [
      ...Object.values(SCALAR_VALIDATOR_GAUNTLET_KEYS).flat(),
      ...Object.values(ASSET_SEO_VALIDATOR_GAUNTLET_KEYS).flat(),
    ];

    assert.equal(new Set(gauntletKeys).size, gauntletKeys.length);
    assert.deepEqual(
      [...PREVIOUSLY_PROVED_LIVE_VALIDATORS, ...gauntletKeys].sort(),
      SAFELY_RELAXABLE_VALIDATOR_KEYS.filter(
        (validatorKey) => validatorKey !== 'slug_title_field',
      ).sort(),
    );
    assert.equal(gauntletKeys.includes('slug_title_field' as never), false);
  });

  it('keeps invalid migration opt-in and asset bundling explicit', () => {
    assert.deepEqual(scalarValidatorGauntletScenario.contentDiffArgs, [
      '--migrate-invalid-content',
    ]);
    assert.deepEqual(assetSeoValidatorGauntletScenario.contentDiffArgs, [
      '--migrate-invalid-content',
      '--uploads=referenced',
      '--bundle-assets',
    ]);
  });

  it('builds deterministic, distinct, live-compatible model API keys', () => {
    const scalar = buildValidatorGauntletModelApiKey('vgs', 'long-run-id-123');
    const asset = buildValidatorGauntletModelApiKey('vga', 'long-run-id-123');
    assert.equal(
      scalar,
      buildValidatorGauntletModelApiKey('vgs', 'long-run-id-123'),
    );
    assert.notEqual(scalar, asset);
    for (const apiKey of [scalar, asset]) {
      assert.match(apiKey, /^[a-z](?:[a-z0-9]|_(?![_0-9]))*[a-z0-9]$/);
      assert.ok(apiKey.length <= 30);
    }
  });
});
