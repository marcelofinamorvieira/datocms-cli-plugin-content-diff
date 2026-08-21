import { expect } from 'chai';
import { isPortableDatoId } from '../../src/content-diff/canonicalize';
import {
  CROSS_PROJECT_E2E_ENV,
  alignedFixtureIds,
  buildCrossProjectConfig,
} from './cross-project-harness';

describe('aligned cross-project real-CMA harness contracts', () => {
  it('uses deterministic portable identities for independently seeded projects', () => {
    const first = alignedFixtureIds('same-seed');
    const second = alignedFixtureIds('same-seed');

    expect(first).to.deep.equal(second);
    expect(new Set(Object.values(first)).size).to.equal(
      Object.values(first).length,
    );
    for (const id of Object.values(first)) {
      expect(isPortableDatoId(id), id).to.equal(true);
    }
  });

  it('keeps both profile credentials environment-backed and shares only destination-owned migration settings', () => {
    expect(buildCrossProjectConfig('migration_log')).to.deep.equal({
      profiles: {
        cross_source: {
          apiTokenEnvName: CROSS_PROJECT_E2E_ENV.sourceToken,
          logLevel: 'NONE',
          migrations: {
            directory: 'migrations',
            modelApiKey: 'migration_log',
          },
        },
        cross_destination: {
          apiTokenEnvName: CROSS_PROJECT_E2E_ENV.destinationToken,
          logLevel: 'NONE',
          migrations: {
            directory: 'migrations',
            modelApiKey: 'migration_log',
          },
        },
      },
    });
  });
});
