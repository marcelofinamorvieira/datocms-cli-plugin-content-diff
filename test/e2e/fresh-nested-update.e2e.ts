import { freshNestedUpdateGateScenario } from './fresh-nested-update-scenario';
import { runRealCmaScenario } from './real-cma-harness';

describe('content:diff fresh nested UPDATE real CMA E2E', function () {
  this.timeout(1_800_000);

  it('preserves an existing aggregate when published staging and current restoration need fresh nested IDs', async () => {
    await runRealCmaScenario(freshNestedUpdateGateScenario);
  });
});
