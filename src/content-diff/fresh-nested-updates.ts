import { nestedBlockIdentity } from './structural-content';
import type { JsonValue, RecordPlan, RecordVersionSnapshot } from './types';

export type FreshNestedBlockUpdateStage = 'published-stage' | 'current-restore';

export interface UnsupportedFreshNestedBlockUpdate {
  recordId: string;
  stage: FreshNestedBlockUpdateStage;
  slice: 'current' | 'published';
  blockId: string;
}

type RecordWriteContract = Pick<
  RecordPlan,
  'id' | 'action' | 'baseline' | 'desired'
>;

/**
 * Models the field-bearing writes performed by runtime phases 5, 7, and 8.
 *
 * CMA's full-validation update path rehydrates every nested object carrying an
 * ID as an already persisted block. An UPDATE therefore cannot introduce a
 * descendant block ID that is absent from the immediately preceding CURRENT
 * version. CREATE may introduce IDs, but any later published/current restore
 * for that same top-level aggregate is subject to the same UPDATE constraint.
 */
export function findUnsupportedFreshNestedBlockUpdates(
  records: readonly RecordWriteContract[],
): UnsupportedFreshNestedBlockUpdate[] {
  const issues: UnsupportedFreshNestedBlockUpdate[] = [];

  for (const record of [...records].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (
      !record.desired ||
      record.action === 'delete' ||
      record.action === 'noop'
    ) {
      continue;
    }

    if (!record.baseline) {
      // Phase 5 creates the top-level aggregate from its published slice when
      // present, otherwise from CURRENT. Reference-shell projection can change
      // values in this seed, but it preserves every descendant block identity.
      const seed = record.desired.published ?? record.desired.current;
      collectFreshUpdateIssue(
        issues,
        record.id,
        'current-restore',
        'current',
        seed,
        record.desired.current,
      );
      continue;
    }

    let precedingCurrent = record.baseline.current;

    // Phase 7 writes the desired published version into CURRENT only when the
    // published slice itself differs. If publication already matches, runtime
    // returns before staging and CURRENT remains the baseline draft exactly.
    if (
      record.desired.published &&
      record.desired.published.hash !== record.baseline.published?.hash
    ) {
      collectFreshUpdateIssue(
        issues,
        record.id,
        'published-stage',
        'published',
        precedingCurrent,
        record.desired.published,
      );
      precedingCurrent = record.desired.published;
    }

    // Phase 8 restores the desired CURRENT version after publication handling.
    collectFreshUpdateIssue(
      issues,
      record.id,
      'current-restore',
      'current',
      precedingCurrent,
      record.desired.current,
    );
  }

  return issues;
}

function collectFreshUpdateIssue(
  output: UnsupportedFreshNestedBlockUpdate[],
  recordId: string,
  stage: FreshNestedBlockUpdateStage,
  slice: UnsupportedFreshNestedBlockUpdate['slice'],
  precedingCurrent: RecordVersionSnapshot,
  desired: RecordVersionSnapshot,
): void {
  if (precedingCurrent.hash === desired.hash) return;

  const precedingIds = nestedBlockIds(precedingCurrent.fields);
  const freshIds = [...nestedBlockIds(desired.fields)]
    .filter((id) => !precedingIds.has(id))
    .sort();

  if (freshIds.length === 0) return;

  output.push({ recordId, stage, slice, blockId: freshIds[0] });
}

function nestedBlockIds(value: JsonValue): Set<string> {
  const result = new Set<string>();
  collectNestedBlockIds(value, result, 'record fields');
  return result;
}

function collectNestedBlockIds(
  value: JsonValue,
  output: Set<string>,
  path: string,
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectNestedBlockIds(child, output, `${path}[${index}]`),
    );
    return;
  }

  if (!value || typeof value !== 'object') return;

  const identity = nestedBlockIdentity(value, path);
  if (identity) output.add(identity.id);

  for (const [key, child] of Object.entries(value)) {
    collectNestedBlockIds(child, output, `${path}.${key}`);
  }
}
