import { isPortableDatoId } from './canonicalize';
import { buildBlockOwnershipIndex } from './dependencies';
import type { ContentDiffPlan } from './types';

/** Re-derives every ID that an executable plan can ask CMA to create. */
export function findNonPortableCreateIds(plan: ContentDiffPlan): string[] {
  const candidates = new Set<string>();
  const createRecords = Object.fromEntries(
    plan.records
      .filter((record) => record.action === 'create' && record.desired)
      .map((record) => [record.id, record.desired!]),
  );

  for (const record of plan.records) {
    if (record.action !== 'create' || !record.desired) continue;
    candidates.add(record.id);
  }
  const captureSchema = {
    ...plan.schema,
    itemTypes: [...plan.schema.itemTypes, ...plan.targetInspection.itemTypes],
  };
  for (const blockId of Object.keys(
    buildBlockOwnershipIndex(createRecords, captureSchema),
  )) {
    candidates.add(blockId);
  }
  for (const upload of plan.uploads) {
    if (upload.action === 'create') candidates.add(upload.id);
  }
  for (const collection of plan.uploadCollections) {
    if (collection.action === 'create') candidates.add(collection.id);
  }

  return [...candidates].filter((id) => !isPortableDatoId(id)).sort();
}

export function findRecordSnapshotIdentityMismatches(
  plan: ContentDiffPlan,
): string[] {
  const mismatches: string[] = [];
  for (const record of plan.records) {
    if (record.baseline && record.baseline.id !== record.id) {
      mismatches.push(`${record.id}:baseline=${record.baseline.id}`);
    }
    if (record.baseline && record.baseline.itemTypeId !== record.itemTypeId) {
      mismatches.push(
        `${record.id}:baselineItemType=${record.baseline.itemTypeId}`,
      );
    }
    if (record.desired && record.desired.id !== record.id) {
      mismatches.push(`${record.id}:desired=${record.desired.id}`);
    }
    if (record.desired && record.desired.itemTypeId !== record.itemTypeId) {
      mismatches.push(
        `${record.id}:desiredItemType=${record.desired.itemTypeId}`,
      );
    }
  }
  return mismatches.sort();
}
