import { semanticHash } from './canonicalize';
import type {
  ContentInspectionSnapshot,
  ContentSnapshot,
  ItemTypeSchemaSnapshot,
  SchemaSnapshot,
  StructuralContentIssue,
} from './types';
import { ContentDiffError } from './types';

export function inspectionItemTypesDigest(
  itemTypes: readonly ItemTypeSchemaSnapshot[],
): string {
  return semanticHash({
    itemTypes: [...itemTypes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((itemType) => ({
        id: itemType.id,
        apiKey: itemType.apiKey,
        modularBlock: itemType.modularBlock,
        singleton: itemType.singleton,
        sortable: itemType.sortable,
        tree: itemType.tree,
        draftModeActive: itemType.draftModeActive,
        draftSavingActive: itemType.draftSavingActive,
        allLocalesRequired: itemType.allLocalesRequired,
        workflowId: itemType.workflowId,
        fields: itemType.fields.map((field) => ({
          id: field.id,
          apiKey: field.apiKey,
          fieldType: field.fieldType,
          localized: field.localized,
          position: field.position,
          defaultValue:
            field.defaultValue === undefined ? null : field.defaultValue,
          validators: field.validators,
        })),
      })),
  });
}

export function buildContentInspectionSnapshot(
  fullSchema: SchemaSnapshot,
  managedSchema: SchemaSnapshot,
  encounteredItemTypeIds: ReadonlySet<string>,
  structuralIssues: readonly StructuralContentIssue[],
): ContentInspectionSnapshot {
  const managedIds = new Set(managedSchema.itemTypes.map(({ id }) => id));
  const fullById = new Map(
    fullSchema.itemTypes.map((itemType) => [itemType.id, itemType]),
  );
  const itemTypes = [...encounteredItemTypeIds]
    .filter((id) => !managedIds.has(id))
    .sort()
    .map((id) => {
      const itemType = fullById.get(id);
      if (!itemType?.modularBlock) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Content inspection cannot resolve modular block model ${id}.`,
          { itemTypeId: id },
        );
      }
      return itemType;
    });

  return {
    itemTypes,
    digest: inspectionItemTypesDigest(itemTypes),
    structuralIssues: [...structuralIssues].sort(compareStructuralIssues),
  };
}

export function contentTraversalSchema(
  snapshot: Pick<ContentSnapshot, 'schema' | 'inspection'>,
): SchemaSnapshot {
  return schemaWithInspectionItemTypes(
    snapshot.schema,
    snapshot.inspection.itemTypes,
  );
}

export function schemaWithInspectionItemTypes(
  managedSchema: SchemaSnapshot,
  inspectionItemTypes: readonly ItemTypeSchemaSnapshot[],
): SchemaSnapshot {
  const managedIds = new Set(managedSchema.itemTypes.map(({ id }) => id));
  const duplicates = inspectionItemTypes
    .map(({ id }) => id)
    .filter((id) => managedIds.has(id));
  if (duplicates.length > 0) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `Inspection schema overlaps managed item types: ${[...new Set(duplicates)]
        .sort()
        .join(', ')}.`,
      { itemTypeIds: [...new Set(duplicates)].sort() },
    );
  }

  return {
    ...managedSchema,
    itemTypes: [...managedSchema.itemTypes, ...inspectionItemTypes].sort(
      (left, right) => left.id.localeCompare(right.id),
    ),
    // This merged object is a traversal aid, never a compatibility state.
    digest: managedSchema.digest,
  };
}

export function inspectionSubsetMatches(
  inspection: ContentInspectionSnapshot,
  refreshedFullSchema: SchemaSnapshot,
): boolean {
  const wantedIds = new Set(inspection.itemTypes.map(({ id }) => id));
  const refreshed = refreshedFullSchema.itemTypes
    .filter(({ id }) => wantedIds.has(id))
    .sort((left, right) => left.id.localeCompare(right.id));
  return (
    refreshed.length === wantedIds.size &&
    inspectionItemTypesDigest(refreshed) === inspection.digest
  );
}

function compareStructuralIssues(
  left: StructuralContentIssue,
  right: StructuralContentIssue,
): number {
  return (
    left.recordId.localeCompare(right.recordId) ||
    left.slice.localeCompare(right.slice) ||
    left.fieldPath.localeCompare(right.fieldPath) ||
    (left.locale ?? '').localeCompare(right.locale ?? '') ||
    left.validatorKey.localeCompare(right.validatorKey) ||
    left.blockId.localeCompare(right.blockId) ||
    left.blockItemTypeId.localeCompare(right.blockItemTypeId)
  );
}
