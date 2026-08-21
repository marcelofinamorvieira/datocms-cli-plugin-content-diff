import type { RecordPlan } from './types';
export type FreshNestedBlockUpdateStage = 'published-stage' | 'current-restore';
export interface UnsupportedFreshNestedBlockUpdate {
    recordId: string;
    stage: FreshNestedBlockUpdateStage;
    slice: 'current' | 'published';
    blockId: string;
}
type RecordWriteContract = Pick<RecordPlan, 'id' | 'action' | 'baseline' | 'desired'>;
/**
 * Models the field-bearing writes performed by runtime phases 5, 7, and 8.
 *
 * CMA's full-validation update path rehydrates every nested object carrying an
 * ID as an already persisted block. An UPDATE therefore cannot introduce a
 * descendant block ID that is absent from the immediately preceding CURRENT
 * version. CREATE may introduce IDs, but any later published/current restore
 * for that same top-level aggregate is subject to the same UPDATE constraint.
 */
export declare function findUnsupportedFreshNestedBlockUpdates(records: readonly RecordWriteContract[]): UnsupportedFreshNestedBlockUpdate[];
export {};
