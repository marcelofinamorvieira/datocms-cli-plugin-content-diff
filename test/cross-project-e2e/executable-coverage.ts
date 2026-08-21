export type CrossProjectE2EEvidence =
  | Readonly<{
      status: 'live-proven';
      verifiedAt: string;
      command: 'npm run test:e2e:cross-project';
      passingCases: 1;
      failedCases: 0;
      keepEnvironments: false;
      bothPrimariesVerifiedBeforeAndAfter: true;
      suiteSourceSha256: string;
    }>
  | Readonly<{
      status: 'unrun';
      reason: string;
    }>;

/**
 * Change this only after the complete two-project suite passes with cleanup and
 * independent before/after fingerprints for both primary environments.
 */
export const CROSS_PROJECT_EXECUTABLE_LIVE_EVIDENCE: CrossProjectE2EEvidence = {
  status: 'unrun',
  reason:
    'No complete two-project live run has been recorded for this release candidate.',
};

export const CROSS_PROJECT_EXECUTABLE_E2E_COVERAGE = [
  {
    spec: 'cross-project.e2e.ts',
    cases: 1,
    summary:
      'Proves read-only aligned-project generation, destination-only execution, wrong-project zero mutation, replay safety, zero-operation regeneration, primary preservation, and cleanup.',
    evidence: CROSS_PROJECT_EXECUTABLE_LIVE_EVIDENCE,
  },
] as const;
