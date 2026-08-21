import type { ContentDiffPlan } from './types';
/** Re-derives every ID that an executable plan can ask CMA to create. */
export declare function findNonPortableCreateIds(plan: ContentDiffPlan): string[];
export declare function findRecordSnapshotIdentityMismatches(plan: ContentDiffPlan): string[];
