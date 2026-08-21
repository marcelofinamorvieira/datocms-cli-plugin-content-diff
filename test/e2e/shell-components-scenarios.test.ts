import { expect } from 'chai';
import {
  buildShellComponentsApiKey,
  independentRequiredShellComponentsScenario,
} from './shell-components-scenarios';

describe('independent shell-components real-CMA scenario contract', () => {
  it('uses a live-valid isolated model API key', () => {
    const apiKey = buildShellComponentsApiKey('test-run');
    expect(apiKey).to.match(/^[a-z](?:[a-z0-9]|_(?![_0-9]))*[a-z0-9]$/);
    expect(apiKey).to.have.length.at.most(30);
  });

  it('requires explicit invalid-content migration authorization', () => {
    expect(
      independentRequiredShellComponentsScenario.contentDiffArgs,
    ).to.deep.equal(['--migrate-invalid-content']);
  });
});
