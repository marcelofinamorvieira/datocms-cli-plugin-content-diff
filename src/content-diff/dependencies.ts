import { createHash } from 'node:crypto';
import { semanticHash } from './canonicalize';
import type {
  BlockOwnership,
  ContentSnapshot,
  CreateCycleShellCandidate,
  DeleteReleaseStep,
  FieldSchemaSnapshot,
  ItemTypeSchemaSnapshot,
  JsonObject,
  JsonValue,
  RecordDependencyGraph,
  RecordSnapshot,
  RecordVersionSnapshot,
  ReferenceDependency,
  SchemaSnapshot,
  UniqueReleaseStep,
} from './types';
import { ContentDiffError } from './types';

const REMOVE_OPTIONAL_REFERENCE = Symbol('removeOptionalReference');
const UNWRAP_OPTIONAL_REFERENCE_CHILDREN = Symbol(
  'unwrapOptionalReferenceChildren',
);

interface UnwrappedOptionalReferenceChildren {
  kind: typeof UNWRAP_OPTIONAL_REFERENCE_CHILDREN;
  children: JsonValue[];
}

type StrippedEmbeddedValue =
  | JsonValue
  | typeof REMOVE_OPTIONAL_REFERENCE
  | UnwrappedOptionalReferenceChildren;

export function contentItemNamespaceIds(
  ...snapshots: readonly ContentSnapshot[]
): Set<string> {
  return new Set(
    snapshots.flatMap((snapshot) => [
      ...snapshot.visibleRecordIds,
      ...Object.keys(snapshot.records),
      ...Object.keys(snapshot.blockOwnership),
    ]),
  );
}

export function buildBlockOwnershipIndex(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
): Record<string, BlockOwnership[]> {
  const result: Record<string, BlockOwnership[]> = {};
  const itemTypes = new Map(
    schema.itemTypes.map((itemType) => [itemType.id, itemType]),
  );

  for (const record of Object.values(records).sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    for (const [version, snapshot] of [
      ['current', record.current] as const,
      ['published', record.published] as const,
    ]) {
      if (!snapshot) {
        continue;
      }

      const itemType = itemTypes.get(record.itemTypeId);

      if (!itemType) {
        throw new ContentDiffError(
          'INCOMPATIBLE_SCHEMA',
          `Record ${record.id} refers to unknown model ${record.itemTypeId}.`,
        );
      }

      walkFields(
        snapshot.fields,
        itemType,
        schema,
        (block, blockType, location) => {
          const ownership: BlockOwnership = {
            blockId: block.id,
            topRecordId: record.id,
            itemTypeId: blockType.id,
            version,
            fieldPath: location.fieldPath,
            locale: location.locale,
          };

          const existingOwnership = result[block.id] ?? [];
          existingOwnership.push(ownership);
          result[block.id] = existingOwnership;
        },
      );
    }
  }

  for (const entries of Object.values(result)) {
    entries.sort(compareOwnership);
  }

  assertNoBlockOwnershipConflicts(result);

  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function assertNoBlockOwnershipConflicts(
  index: Record<string, BlockOwnership[]>,
): void {
  for (const [blockId, entries] of Object.entries(index)) {
    const locations = new Set(entries.map(ownershipLocationKey));
    const versionedLocations = new Set(
      entries.map((entry) => `${entry.version}:${ownershipLocationKey(entry)}`),
    );

    if (locations.size > 1 || versionedLocations.size !== entries.length) {
      throw new ContentDiffError(
        'BLOCK_OWNERSHIP_CONFLICT',
        `Block ${blockId} is reused or relocated across records, fields, or locales. V1 cannot safely reproduce this state.`,
        {
          blockId,
          locations: [...locations].sort(),
        },
      );
    }
  }
}

export function assertCompatibleBlockOwnership(
  source: Record<string, BlockOwnership[]>,
  target: Record<string, BlockOwnership[]>,
): void {
  for (const blockId of Object.keys(source)) {
    if (!target[blockId]) {
      continue;
    }

    const sourceLocations = new Set(source[blockId].map(ownershipLocationKey));
    const targetLocations = new Set(target[blockId].map(ownershipLocationKey));

    if (
      sourceLocations.size !== targetLocations.size ||
      [...sourceLocations].some((location) => !targetLocations.has(location))
    ) {
      throw new ContentDiffError(
        'BLOCK_OWNERSHIP_CONFLICT',
        `Block ${blockId} would move across records, fields, or locales. Existing block IDs cannot be relocated.`,
        {
          blockId,
          sourceLocations: [...sourceLocations].sort(),
          targetLocations: [...targetLocations].sort(),
        },
      );
    }
  }
}

export function collectRecordReferences(
  record: RecordSnapshot,
  schema: SchemaSnapshot,
): ReferenceDependency[] {
  const result = [
    ...collectRecordVersionReferences(
      record,
      record.current,
      schema,
      'current',
    ),
    ...(record.published
      ? collectRecordVersionReferences(
          record,
          record.published,
          schema,
          'published',
        )
      : []),
  ];

  if (record.topology.parentId) {
    result.push({
      fromRecordId: record.id,
      toRecordId: record.topology.parentId,
      path: 'topology.parentId',
      required: true,
    });
  }

  return deduplicateReferences(result);
}

export function collectPublishedRecordReferences(
  record: RecordSnapshot,
  schema: SchemaSnapshot,
): ReferenceDependency[] {
  return record.published
    ? collectRecordVersionReferences(
        record,
        record.published,
        schema,
        'published',
      )
    : [];
}

function collectRecordVersionReferences(
  record: RecordSnapshot,
  snapshot: RecordVersionSnapshot,
  schema: SchemaSnapshot,
  version: 'current' | 'published',
): ReferenceDependency[] {
  const itemType = findItemType(schema, record.itemTypeId);
  const result: ReferenceDependency[] = [];

  collectReferencesFromFields(
    snapshot.fields,
    itemType,
    schema,
    version,
    true,
    (toRecordId, path, required) => {
      result.push({
        fromRecordId: record.id,
        toRecordId,
        path,
        required,
      });
    },
  );

  return deduplicateReferences(result);
}

export function collectUploadReferences(
  record: RecordSnapshot,
  schema: SchemaSnapshot,
): string[] {
  const itemType = findItemType(schema, record.itemTypeId);
  const uploadIds = new Set<string>();

  for (const snapshot of [record.current, record.published]) {
    if (!snapshot) {
      continue;
    }

    collectUploadsFromFields(snapshot.fields, itemType, schema, uploadIds);
  }

  return [...uploadIds].sort();
}

export function buildRecordDependencyGraph(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
  additionalDependencies: ReferenceDependency[] = [],
  creationRecordIds: ReadonlySet<string> = new Set(Object.keys(records)),
  supportedShellRecordIds: ReadonlySet<string> = new Set(),
): RecordDependencyGraph {
  const recordIds = new Set(Object.keys(records));
  const references = [
    ...Object.values(records).flatMap((record) =>
      collectRecordReferences(record, schema),
    ),
    ...additionalDependencies,
  ].filter(
    ({ fromRecordId, toRecordId }) =>
      recordIds.has(fromRecordId) && recordIds.has(toRecordId),
  );
  const dependencies = Object.fromEntries(
    [...recordIds].sort().map((recordId) => [recordId, [] as string[]]),
  );

  for (const reference of references) {
    dependencies[reference.fromRecordId].push(reference.toRecordId);
  }

  for (const values of Object.values(dependencies)) {
    values.splice(0, values.length, ...[...new Set(values)].sort());
  }

  const components = stronglyConnectedComponents(dependencies);
  const seedReferences = [
    ...[...creationRecordIds].flatMap((recordId) => {
      const record = records[recordId];

      if (!record) {
        return [];
      }

      return collectRecordVersionReferences(
        record,
        record.published ?? record.current,
        schema,
        record.published ? 'published' : 'current',
      );
    }),
    ...references.filter(
      ({ fromRecordId, path }) =>
        creationRecordIds.has(fromRecordId) &&
        (path === 'topology.parentId' || path.startsWith('unique:')),
    ),
  ].filter(
    ({ fromRecordId, toRecordId }) =>
      creationRecordIds.has(fromRecordId) && creationRecordIds.has(toRecordId),
  );
  const createDependencies = Object.fromEntries(
    [...creationRecordIds]
      .sort()
      .map((recordId) => [
        recordId,
        [
          ...new Set(
            seedReferences
              .filter(({ fromRecordId }) => fromRecordId === recordId)
              .map(({ toRecordId }) => toRecordId),
          ),
        ].sort(),
      ]),
  );
  const createComponents = stronglyConnectedComponents(createDependencies);
  const cyclicCreateComponents: Set<string>[] = [];
  const invalidDraftShellComponents: Set<string>[] = [];

  for (const component of createComponents) {
    const componentIds = new Set(component);
    const cyclic =
      component.length > 1 ||
      (createDependencies[component[0]] ?? []).includes(component[0]);

    if (!cyclic) {
      continue;
    }

    const allAllowInvalidDraftShells = component.every(
      (recordId) =>
        supportedShellRecordIds.has(recordId) ||
        recordAllowsInvalidDraftShell(records[recordId], schema),
    );
    const topologyDependencies = Object.fromEntries(
      component.map((recordId) => [
        recordId,
        (createDependencies[recordId] ?? []).filter(
          (dependencyId) =>
            componentIds.has(dependencyId) &&
            seedReferences.some(
              (reference) =>
                reference.fromRecordId === recordId &&
                reference.toRecordId === dependencyId &&
                reference.path === 'topology.parentId',
            ),
        ),
      ]),
    );

    // Tree topology is not a field payload that invalid-draft saving can
    // relax. A cyclic parent graph is intrinsically invalid and cannot be
    // repaired after shell creation.
    if (graphHasCycle(topologyDependencies)) {
      throw new ContentDiffError(
        'REQUIRED_REFERENCE_CYCLE',
        `Source-only records ${component
          .sort()
          .join(', ')} form a cyclic tree-parent dependency.`,
        { recordIds: component.sort() },
      );
    }

    // Self-references cannot exist at create time. They are accepted only
    // when the model explicitly allows saving an invalid draft shell, which
    // the runtime fills once the requested stable ID exists.
    if (component.length === 1 && !allAllowInvalidDraftShells) {
      throw new ContentDiffError(
        'REQUIRED_REFERENCE_CYCLE',
        `Source-only record ${component[0]} refers to itself and its model does not allow saving an invalid draft shell.`,
        { recordIds: component },
      );
    }

    const requiredDependencies = Object.fromEntries(
      component.map((recordId) => [
        recordId,
        (createDependencies[recordId] ?? []).filter(
          (dependencyId) =>
            componentIds.has(dependencyId) &&
            seedReferences.some(
              (reference) =>
                reference.fromRecordId === recordId &&
                reference.toRecordId === dependencyId &&
                reference.required,
            ),
        ),
      ]),
    );

    const hasRequiredCycle = graphHasCycle(requiredDependencies);

    if (hasRequiredCycle && !allAllowInvalidDraftShells) {
      throw new ContentDiffError(
        'REQUIRED_REFERENCE_CYCLE',
        `Source-only records ${component
          .sort()
          .join(
            ', ',
          )} form a required cyclic create dependency and not every model allows saving invalid draft shells.`,
        { recordIds: component.sort() },
      );
    }

    cyclicCreateComponents.push(componentIds);
    if (
      component.length === 1 ||
      hasRequiredCycle ||
      [...componentIds].every((recordId) =>
        supportedShellRecordIds.has(recordId),
      )
    ) {
      invalidDraftShellComponents.push(componentIds);
    }
  }

  for (const component of components) {
    const componentIds = new Set(component);
    const cyclic =
      component.length > 1 ||
      (dependencies[component[0]] ?? []).includes(component[0]);

    if (!cyclic) {
      continue;
    }

    const internalReferences = references.filter(
      ({ fromRecordId, toRecordId }) =>
        componentIds.has(fromRecordId) && componentIds.has(toRecordId),
    );
    const uniqueCycle = internalReferences.every(({ path }) =>
      path.startsWith('unique:'),
    );
    if (uniqueCycle) {
      throw new ContentDiffError(
        'UNIQUE_VALUE_CYCLE',
        `Records ${component
          .sort()
          .join(
            ', ',
          )} form a cyclic unique-value swap that V1 cannot reproduce safely.`,
        {
          recordIds: component.sort(),
          path: internalReferences[0]?.path ?? '',
        },
      );
    }
  }

  const createOrderingDependencies = Object.fromEntries(
    Object.entries(createDependencies).map(([recordId, values]) => [
      recordId,
      values.filter((dependencyId) => {
        const invalidDraftShellDependency = invalidDraftShellComponents.some(
          (component) =>
            component.has(recordId) &&
            component.has(dependencyId) &&
            [...component].every(
              (componentRecordId) =>
                supportedShellRecordIds.has(componentRecordId) ||
                recordAllowsInvalidDraftShell(
                  records[componentRecordId],
                  schema,
                ),
            ),
        );
        const optionalShellDependency = cyclicCreateComponents.some(
          (component) =>
            component.has(recordId) &&
            component.has(dependencyId) &&
            !seedReferences.some(
              (reference) =>
                reference.fromRecordId === recordId &&
                reference.toRecordId === dependencyId &&
                reference.required,
            ),
        );

        return !invalidDraftShellDependency && !optionalShellDependency;
      }),
    ]),
  );
  const updateDependencies = Object.fromEntries(
    Object.entries(dependencies).map(([recordId, values]) => [
      recordId,
      values.filter((dependencyId) => {
        const sameCyclicComponent = components.some(
          (component) =>
            (component.length > 1 ||
              (dependencies[component[0]] ?? []).includes(component[0])) &&
            component.includes(recordId) &&
            component.includes(dependencyId),
        );

        return !sameCyclicComponent;
      }),
    ]),
  );
  const createOrder = topologicalSort(createOrderingDependencies);
  const createOrderIndex = new Map(
    createOrder.map((recordId, index) => [recordId, index]),
  );
  const shellComponents = invalidDraftShellComponents
    .map((component) => [...component].sort())
    .sort((left, right) => left.join(',').localeCompare(right.join(',')));
  const shellRecordIds = [...new Set(shellComponents.flat())].sort();
  const publicationSeedRecordIds = new Set(
    cyclicCreateComponents
      .filter(
        (component) =>
          !invalidDraftShellComponents.some(
            (invalidComponent) =>
              invalidComponent.size === component.size &&
              [...component].every((recordId) =>
                invalidComponent.has(recordId),
              ) &&
              ![...component].every((recordId) =>
                supportedShellRecordIds.has(recordId),
              ),
          ),
      )
      .flatMap((component) => [...component]),
  );
  let publicationSeedClosureChanged = true;

  while (publicationSeedClosureChanged) {
    publicationSeedClosureChanged = false;

    for (const recordId of [...publicationSeedRecordIds]) {
      const recordIndex = createOrderIndex.get(recordId);

      for (const reference of seedReferences.filter(
        ({ fromRecordId, path }) =>
          fromRecordId === recordId && !path.startsWith('unique:'),
      )) {
        const dependencyIndex = createOrderIndex.get(reference.toRecordId);

        // A later optional dependency is absent from this record's create
        // seed. Earlier dependencies remain in the seed and must themselves
        // have a publication before the cyclic seed can be published.
        if (
          recordIndex !== undefined &&
          dependencyIndex !== undefined &&
          dependencyIndex < recordIndex &&
          !publicationSeedRecordIds.has(reference.toRecordId)
        ) {
          publicationSeedRecordIds.add(reference.toRecordId);
          publicationSeedClosureChanged = true;
        }
      }
    }
  }
  const temporarySeedRecordIds = [
    ...new Set([
      ...shellRecordIds,
      ...seedReferences
        .filter(({ fromRecordId, toRecordId }) => {
          const fromIndex = createOrderIndex.get(fromRecordId);
          const toIndex = createOrderIndex.get(toRecordId);

          return (
            fromIndex !== undefined &&
            toIndex !== undefined &&
            toIndex > fromIndex
          );
        })
        .map(({ fromRecordId }) => fromRecordId),
    ]),
  ].sort();

  return {
    dependencies,
    references: deduplicateReferences(references),
    createOrder,
    updateOrder: topologicalSort(updateDependencies),
    temporarySeedRecordIds,
    shellRecordIds,
    shellComponents,
    publicationSeedOrder: createOrder.filter((recordId) =>
      publicationSeedRecordIds.has(recordId),
    ),
  };
}

/**
 * Computes deterministic source-only create-cycle seed payloads for the
 * generator's read-only diagnostic validation pass. Every intra-component
 * record reference is removed, including references currently made required
 * by a relaxable field validator. Tree-parent cycles are marked structural
 * because no field-validator change can make them persistable.
 */
export function collectCreateCycleShellCandidates(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
  creationRecordIds: ReadonlySet<string>,
): CreateCycleShellCandidate[] {
  const seedReferences = [...creationRecordIds]
    .sort()
    .flatMap((recordId) => {
      const record = records[recordId];

      if (!record) return [];

      return collectRecordVersionReferences(
        record,
        record.published ?? record.current,
        schema,
        record.published ? 'published' : 'current',
      );
    })
    .filter(
      ({ fromRecordId, toRecordId }) =>
        creationRecordIds.has(fromRecordId) &&
        creationRecordIds.has(toRecordId),
    );
  const topologyReferences: ReferenceDependency[] = [...creationRecordIds]
    .sort()
    .flatMap((recordId) => {
      const parentId = records[recordId]?.topology.parentId;

      return parentId && creationRecordIds.has(parentId)
        ? [
            {
              fromRecordId: recordId,
              toRecordId: parentId,
              path: 'topology.parentId',
              required: true,
            },
          ]
        : [];
    });
  const allReferences = [...seedReferences, ...topologyReferences];
  const dependencies = dependencyGraphFor(creationRecordIds, allReferences);
  const result: CreateCycleShellCandidate[] = [];

  for (const component of stronglyConnectedComponents(dependencies)) {
    const componentIds = new Set(component);
    const cyclic =
      component.length > 1 ||
      (dependencies[component[0]] ?? []).includes(component[0]);

    if (!cyclic) continue;

    const topologyGraph = dependencyGraphFor(
      componentIds,
      topologyReferences.filter(
        ({ fromRecordId, toRecordId }) =>
          componentIds.has(fromRecordId) && componentIds.has(toRecordId),
      ),
    );
    const topologyCycle = graphHasCycle(topologyGraph);

    for (const recordId of [...componentIds].sort()) {
      const record = records[recordId];
      const itemType = findItemType(schema, record.itemTypeId);
      const seed = record.published ?? record.current;
      const fields = stripReferencesFromFields(
        seed.fields,
        itemType,
        schema,
        componentIds,
        true,
      );

      result.push({
        recordId,
        itemTypeId: record.itemTypeId,
        componentRecordIds: [...componentIds].sort(),
        fields,
        versionHash: semanticHash(fields),
        topologyCycle,
      });
    }
  }

  return result.sort(
    (left, right) =>
      left.componentRecordIds
        .join(',')
        .localeCompare(right.componentRecordIds.join(',')) ||
      left.recordId.localeCompare(right.recordId),
  );
}

/**
 * Computes the exact create-time field payload for every cyclic source-only
 * component. Required/self cycles use the component-wide shell that the
 * runtime declares explicitly. Optional multi-record cycles instead use the
 * deterministic create order and remove only references to records that do
 * not exist yet, exactly like `expectedCreateSeedFields()` in the runtime.
 *
 * Keeping this projection separate from `collectCreateCycleShellCandidates()`
 * is intentional: callers that reason specifically about declared invalid
 * draft shells still need the component-wide form, while validator
 * diagnostics must exercise the actual request body sent to `items.create()`.
 */
export function collectCreateCycleIntermediateCandidates(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
  creationRecordIds: ReadonlySet<string>,
): CreateCycleShellCandidate[] {
  const shellCandidates = collectCreateCycleShellCandidates(
    records,
    schema,
    creationRecordIds,
  );
  const byComponent = new Map<string, CreateCycleShellCandidate[]>();

  for (const candidate of shellCandidates) {
    const key = candidate.componentRecordIds.join('\0');
    const entries = byComponent.get(key) ?? [];
    entries.push(candidate);
    byComponent.set(key, entries);
  }

  const topologyCycleRecordIds = new Set(
    shellCandidates
      .filter(({ topologyCycle }) => topologyCycle)
      .flatMap(({ componentRecordIds }) => componentRecordIds),
  );
  const declaredShellRecordIds = new Set<string>();
  const optionalComponentKeys = new Set<string>();

  for (const [key, candidates] of byComponent) {
    if (candidates[0].topologyCycle) continue;

    const componentIds = new Set(candidates[0].componentRecordIds);
    const seedReferences = candidates.flatMap(({ recordId }) => {
      const record = records[recordId];
      if (!record) return [];
      const seed = record.published ?? record.current;

      return collectRecordVersionReferences(
        record,
        seed,
        schema,
        record.published ? 'published' : 'current',
      ).filter(
        ({ fromRecordId, toRecordId }) =>
          componentIds.has(fromRecordId) && componentIds.has(toRecordId),
      );
    });
    const requiredDependencies = dependencyGraphFor(
      componentIds,
      seedReferences.filter(({ required }) => required),
    );
    const requiresDeclaredShell =
      componentIds.size === 1 || graphHasCycle(requiredDependencies);

    if (requiresDeclaredShell) {
      componentIds.forEach((recordId) => declaredShellRecordIds.add(recordId));
    } else {
      optionalComponentKeys.add(key);
    }
  }

  if (optionalComponentKeys.size === 0) return shellCandidates;

  // Topology cycles are intrinsically unsupported and are removed only from
  // this ordering projection. The planner retains their original candidates
  // and reports the structural failure for the complete component.
  const orderableRecords = Object.fromEntries(
    Object.entries(records).filter(
      ([recordId]) => !topologyCycleRecordIds.has(recordId),
    ),
  );
  const orderableCreationRecordIds = new Set(
    [...creationRecordIds].filter(
      (recordId) => !topologyCycleRecordIds.has(recordId),
    ),
  );
  const dependencyGraph = buildRecordDependencyGraph(
    orderableRecords,
    schema,
    [],
    orderableCreationRecordIds,
    declaredShellRecordIds,
  );
  const createOrderIndex = new Map(
    dependencyGraph.createOrder.map((recordId, index) => [recordId, index]),
  );

  return shellCandidates.map((candidate) => {
    const key = candidate.componentRecordIds.join('\0');
    if (!optionalComponentKeys.has(key)) return candidate;

    const record = records[candidate.recordId];
    const itemType = findItemType(schema, record.itemTypeId);
    const seed = record.published ?? record.current;
    const recordIndex = createOrderIndex.get(record.id);

    if (recordIndex === undefined) {
      throw new ContentDiffError(
        'REQUIRED_REFERENCE_CYCLE',
        `Source-only create cycle record ${record.id} is missing from the deterministic create order.`,
        { recordId: record.id },
      );
    }

    const laterCreates = new Set(
      [...orderableCreationRecordIds].filter((recordId) => {
        const candidateIndex = createOrderIndex.get(recordId);
        return candidateIndex !== undefined && candidateIndex > recordIndex;
      }),
    );
    const fields = stripReferencesFromFields(
      seed.fields,
      itemType,
      schema,
      laterCreates,
      false,
    );

    return {
      ...candidate,
      fields,
      versionHash: semanticHash(fields),
    };
  });
}

/** Returns nodes with dependencies before their consumers. */
export function topologicalSort(
  dependencies: Record<string, string[]>,
): string[] {
  const nodes = new Set([
    ...Object.keys(dependencies),
    ...Object.values(dependencies).flat(),
  ]);
  const remaining = new Map(
    [...nodes].map((node) => [
      node,
      new Set((dependencies[node] ?? []).filter((value) => value !== node)),
    ]),
  );
  const result: string[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter(([, values]) =>
        [...values].every((value) => !remaining.has(value)),
      )
      .map(([node]) => node)
      .sort();

    if (ready.length === 0) {
      throw new ContentDiffError(
        'REQUIRED_REFERENCE_CYCLE',
        `Dependency graph contains a cycle involving ${[...remaining.keys()]
          .sort()
          .join(', ')}.`,
        { recordIds: [...remaining.keys()].sort() },
      );
    }

    for (const node of ready) {
      remaining.delete(node);
      result.push(node);
    }
  }

  return result;
}

export function buildDeletionOrder(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
): string[] {
  return analyzeDeletionDependencies(records, schema).deleteOrder;
}

/**
 * One destination-only required-reference SCC and the exact unlink versions
 * that can break it. An empty `releases` array is fail-closed: at least one
 * structural/topology edge cannot be represented by a field-only update.
 */
export interface RequiredDeletionCycleReleaseCandidate {
  componentRecordIds: string[];
  releases: DeleteReleaseStep[];
  unsupportedPaths: string[];
}

/**
 * One destination-only optional-reference SCC and the exact unlink versions
 * that break it. These releases still need full validation when their model
 * cannot persist invalid drafts, or when the release must be published.
 */
export interface OptionalDeletionCycleReleaseCandidate {
  componentRecordIds: string[];
  releases: DeleteReleaseStep[];
  unsupportedPaths: string[];
}

export interface AnalyzeDeletionDependenciesOptions {
  /**
   * Required-reference SCCs are destructive only after the invalid-content
   * planner has diagnosed their exact unlink versions. Every member of an SCC
   * must be present in this set; partial authorization is never accepted.
   */
  supportedRequiredCycleRecordIds?: ReadonlySet<string>;
  /** Complete visible Item namespace reserved before transient block allocation. */
  reservedItemIds?: ReadonlySet<string>;
}

export function collectRequiredDeletionCycleReleaseCandidates(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
  options: Pick<AnalyzeDeletionDependenciesOptions, 'reservedItemIds'> = {},
): RequiredDeletionCycleReleaseCandidate[] {
  const { references, graph } = deletionReferenceGraph(records, schema);
  const result: RequiredDeletionCycleReleaseCandidate[] = [];
  const reservedItemIds = deletionReleaseReservedItemIds(
    records,
    schema,
    options.reservedItemIds,
  );

  for (const component of stronglyConnectedComponents(graph)) {
    if (component.length < 2) continue;

    const componentIds = new Set(component);
    const internal = references.filter(
      ({ fromRecordId, toRecordId }) =>
        componentIds.has(fromRecordId) && componentIds.has(toRecordId),
    );
    const requiredGraph = dependencyGraphFor(
      componentIds,
      internal.filter(({ required }) => required),
    );

    if (!graphHasCycle(requiredGraph)) continue;

    const removable = internal.filter(
      ({ path }) => path !== 'topology.parentId',
    );
    const structural = internal.filter(
      ({ path }) => path === 'topology.parentId',
    );
    const remainingGraph = dependencyGraphFor(componentIds, structural);
    const unsupportedPaths = new Set<string>();

    if (graphHasCycle(remainingGraph)) {
      structural.forEach(({ path }) => unsupportedPaths.add(path));
    }

    const releaseTargets = new Map<string, Set<string>>();
    for (const reference of removable) {
      const targets =
        releaseTargets.get(reference.fromRecordId) ?? new Set<string>();
      targets.add(reference.toRecordId);
      releaseTargets.set(reference.fromRecordId, targets);
    }

    const releases = [...releaseTargets]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([recordId, targets]) => {
        const projected = projectDeletionRelease(
          recordId,
          targets,
          records,
          schema,
          true,
          reservedItemIds,
        );
        projected.unresolvedPaths.forEach((path) => unsupportedPaths.add(path));
        return projected.unresolvedPaths.length === 0
          ? [projected.release]
          : [];
      });

    result.push({
      componentRecordIds: [...componentIds].sort(),
      releases:
        unsupportedPaths.size === 0 && releases.length === releaseTargets.size
          ? releases
          : [],
      unsupportedPaths: [...unsupportedPaths].sort(),
    });
  }

  return result.sort((left, right) =>
    left.componentRecordIds
      .join(',')
      .localeCompare(right.componentRecordIds.join(',')),
  );
}

export function collectOptionalDeletionCycleReleaseCandidates(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
  options: Pick<AnalyzeDeletionDependenciesOptions, 'reservedItemIds'> = {},
): OptionalDeletionCycleReleaseCandidate[] {
  const { references, graph } = deletionReferenceGraph(records, schema);
  const result: OptionalDeletionCycleReleaseCandidate[] = [];
  const reservedItemIds = deletionReleaseReservedItemIds(
    records,
    schema,
    options.reservedItemIds,
  );

  for (const component of stronglyConnectedComponents(graph)) {
    if (component.length < 2) continue;

    const componentIds = new Set(component);
    const internal = references.filter(
      ({ fromRecordId, toRecordId }) =>
        componentIds.has(fromRecordId) && componentIds.has(toRecordId),
    );
    const requiredGraph = dependencyGraphFor(
      componentIds,
      internal.filter(({ required }) => required),
    );

    // Required SCCs have a separate, forceful projection and authorization
    // path. This collector owns only cycles that can be broken by removing
    // optional field references.
    if (graphHasCycle(requiredGraph)) continue;

    const optional = internal.filter(
      ({ required, path }) => !required && path !== 'topology.parentId',
    );
    if (optional.length === 0) continue;

    const releaseTargets = new Map<string, Set<string>>();
    for (const reference of optional) {
      const targets =
        releaseTargets.get(reference.fromRecordId) ?? new Set<string>();
      targets.add(reference.toRecordId);
      releaseTargets.set(reference.fromRecordId, targets);
    }

    const unsupportedPaths = new Set<string>();
    const releases = [...releaseTargets]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([recordId, targets]) => {
        const projected = projectDeletionRelease(
          recordId,
          targets,
          records,
          schema,
          false,
          reservedItemIds,
        );
        projected.unresolvedPaths.forEach((path) => unsupportedPaths.add(path));
        return projected.unresolvedPaths.length === 0
          ? [projected.release]
          : [];
      });

    result.push({
      componentRecordIds: [...componentIds].sort(),
      releases:
        unsupportedPaths.size === 0 && releases.length === releaseTargets.size
          ? releases
          : [],
      unsupportedPaths: [...unsupportedPaths].sort(),
    });
  }

  return result.sort((left, right) =>
    left.componentRecordIds
      .join(',')
      .localeCompare(right.componentRecordIds.join(',')),
  );
}

/**
 * Returns every deletion SCC whose published unlink projection would need
 * fresh nested block IDs. The CMA full-validation update path rehydrates any
 * nested payload carrying an ID as an existing block, so these components
 * must be preserved instead of emitted as executable release steps.
 */
export function collectUnsupportedPublishedNestedDeletionComponents(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
  options: Pick<AnalyzeDeletionDependenciesOptions, 'reservedItemIds'> = {},
): string[][] {
  const requiredCandidates = collectRequiredDeletionCycleReleaseCandidates(
    records,
    schema,
    options,
  );
  const result = requiredCandidates
    .filter(({ releases }) =>
      releases.some(
        ({ transientNestedBlockIds }) => transientNestedBlockIds.length > 0,
      ),
    )
    .map(({ componentRecordIds }) => componentRecordIds);
  const { references, graph } = deletionReferenceGraph(records, schema);
  const reservedItemIds = deletionReleaseReservedItemIds(
    records,
    schema,
    options.reservedItemIds,
  );

  for (const component of stronglyConnectedComponents(graph)) {
    if (component.length < 2) continue;

    const componentIds = new Set(component);
    const internal = references.filter(
      ({ fromRecordId, toRecordId }) =>
        componentIds.has(fromRecordId) && componentIds.has(toRecordId),
    );
    const requiredGraph = dependencyGraphFor(
      componentIds,
      internal.filter(({ required }) => required),
    );

    if (graphHasCycle(requiredGraph)) continue;

    const releaseTargets = new Map<string, Set<string>>();
    for (const reference of internal.filter(
      ({ required, path }) => !required && path !== 'topology.parentId',
    )) {
      const targets =
        releaseTargets.get(reference.fromRecordId) ?? new Set<string>();
      targets.add(reference.toRecordId);
      releaseTargets.set(reference.fromRecordId, targets);
    }

    const releases = [...releaseTargets]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([recordId, targets]) =>
        projectDeletionRelease(
          recordId,
          targets,
          records,
          schema,
          false,
          reservedItemIds,
        ),
      );

    if (
      releases.some(
        ({ release, unresolvedPaths }) =>
          unresolvedPaths.length === 0 &&
          release.transientNestedBlockIds.length > 0,
      )
    ) {
      result.push([...componentIds].sort());
    }
  }

  return [...new Map(result.map((ids) => [ids.join('\0'), ids])).values()].sort(
    (left, right) => left.join(',').localeCompare(right.join(',')),
  );
}

export function analyzeDeletionDependencies(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
  options: AnalyzeDeletionDependenciesOptions = {},
): { deleteOrder: string[]; releases: DeleteReleaseStep[] } {
  const { recordIds, references, graph } = deletionReferenceGraph(
    records,
    schema,
  );
  const removedReferences = new Set<string>();
  const releaseTargets = new Map<string, Set<string>>();
  const requiredCandidates = new Map(
    collectRequiredDeletionCycleReleaseCandidates(records, schema, {
      reservedItemIds: options.reservedItemIds,
    }).map((candidate) => [candidate.componentRecordIds.join('\0'), candidate]),
  );
  const reservedItemIds = deletionReleaseReservedItemIds(
    records,
    schema,
    options.reservedItemIds,
  );
  for (const candidate of requiredCandidates.values()) {
    candidate.releases.forEach((release) =>
      release.transientNestedBlockIds.forEach((id) => reservedItemIds.add(id)),
    );
  }
  const requiredReleases: DeleteReleaseStep[] = [];

  for (const component of stronglyConnectedComponents(graph)) {
    if (component.length < 2) continue;

    const componentIds = new Set(component);
    const internal = references.filter(
      ({ fromRecordId, toRecordId }) =>
        componentIds.has(fromRecordId) && componentIds.has(toRecordId),
    );
    const requiredGraph = dependencyGraphFor(
      componentIds,
      internal.filter(({ required }) => required),
    );

    if (graphHasCycle(requiredGraph)) {
      const componentRecordIds = [...component].sort();
      const candidate = requiredCandidates.get(componentRecordIds.join('\0'));
      const supported = options.supportedRequiredCycleRecordIds;
      const authorized = Boolean(
        supported &&
          componentRecordIds.every((recordId) => supported.has(recordId)),
      );

      if (
        !authorized ||
        !candidate ||
        candidate.releases.length === 0 ||
        candidate.unsupportedPaths.length > 0
      ) {
        throw new ContentDiffError(
          'REQUIRED_REFERENCE_CYCLE',
          `Deletion candidates contain an unbreakable required-reference cycle involving ${componentRecordIds.join(
            ', ',
          )}.`,
          {
            recordIds: componentRecordIds,
            unsupportedPaths: candidate?.unsupportedPaths ?? [],
          },
        );
      }

      requiredReleases.push(...candidate.releases);
      for (const reference of internal) {
        if (reference.path !== 'topology.parentId') {
          removedReferences.add(referenceKey(reference));
        }
      }
      continue;
    }

    const optional = internal.filter(
      ({ required, path }) => !required && path !== 'topology.parentId',
    );

    if (optional.length === 0) {
      throw new ContentDiffError(
        'REQUIRED_REFERENCE_CYCLE',
        `Deletion candidates contain an unbreakable reference cycle involving ${component
          .sort()
          .join(', ')}.`,
        { recordIds: component.sort() },
      );
    }

    for (const reference of optional) {
      removedReferences.add(referenceKey(reference));
      const targets = releaseTargets.get(reference.fromRecordId) ?? new Set();
      targets.add(reference.toRecordId);
      releaseTargets.set(reference.fromRecordId, targets);
    }
  }

  const remainingReferences = references.filter(
    (reference) => !removedReferences.has(referenceKey(reference)),
  );
  const remainingGraph = dependencyGraphFor(recordIds, remainingReferences);

  if (graphHasCycle(remainingGraph)) {
    throw new ContentDiffError(
      'REQUIRED_REFERENCE_CYCLE',
      `Deletion candidates contain an unbreakable reference cycle involving ${Object.keys(
        remainingGraph,
      )
        .sort()
        .join(', ')}.`,
      { recordIds: Object.keys(remainingGraph).sort() },
    );
  }

  const optionalReleases = [...releaseTargets]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([recordId, targets]): DeleteReleaseStep => {
      const projected = projectDeletionRelease(
        recordId,
        targets,
        records,
        schema,
        false,
        reservedItemIds,
      );

      if (projected.unresolvedPaths.length > 0) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Optional references from deletion candidate ${recordId} could not be represented as a deterministic unlink update.`,
          { recordId, paths: projected.unresolvedPaths },
        );
      }

      return projected.release;
    });
  const releases = [...requiredReleases, ...optionalReleases].sort(
    (left, right) => left.recordId.localeCompare(right.recordId),
  );

  return {
    deleteOrder: topologicalSort(remainingGraph).reverse(),
    releases,
  };
}

function deletionReferenceGraph(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
): {
  recordIds: Set<string>;
  references: ReferenceDependency[];
  graph: Record<string, string[]>;
} {
  const recordIds = new Set(Object.keys(records));
  // Destroy explicitly ignores links from a record to itself. They disappear
  // with the record and therefore do not constrain deletion ordering.
  const references = Object.values(records)
    .flatMap((record) => collectRecordReferences(record, schema))
    .filter(
      ({ fromRecordId, toRecordId }) =>
        fromRecordId !== toRecordId &&
        recordIds.has(fromRecordId) &&
        recordIds.has(toRecordId),
    );

  return {
    recordIds,
    references,
    graph: dependencyGraphFor(recordIds, references),
  };
}

function projectDeletionRelease(
  recordId: string,
  targets: ReadonlySet<string>,
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
  force: boolean,
  reservedItemIds: Set<string>,
): { release: DeleteReleaseStep; unresolvedPaths: string[] } {
  const record = records[recordId];
  const itemType = findItemType(schema, record.itemTypeId);
  const publishedReferences = record.published
    ? collectRecordVersionReferences(
        record,
        record.published,
        schema,
        'published',
      )
    : [];
  const publish = Boolean(
    record.published &&
      itemType.draftModeActive &&
      publishedReferences.some(({ toRecordId }) => targets.has(toRecordId)),
  );
  // When a published edge must be cleared, start from the known published
  // snapshot rather than exposing unrelated current draft edits. The release
  // exists only long enough to break the deletion SCC and destroy the record.
  const releaseBase = publish ? record.published! : record.current;
  const strippedFields = force
    ? stripReferencesFromFields(
        releaseBase.fields,
        itemType,
        schema,
        targets,
        true,
      )
    : stripOptionalReferencesFromFields(
        releaseBase.fields,
        itemType,
        schema,
        targets,
      );
  const transient = publish
    ? rekeyPublishedReleaseNestedBlocks(
        strippedFields,
        schema,
        recordId,
        reservedItemIds,
      )
    : { fields: strippedFields, ids: [] };
  const fields = transient.fields;
  const releaseVersion: RecordVersionSnapshot = {
    fields,
    hash: semanticHash(fields),
  };
  const unresolvedPaths = collectRecordVersionReferences(
    record,
    releaseVersion,
    schema,
    'current',
  )
    .filter(
      ({ toRecordId, required }) =>
        targets.has(toRecordId) && (force || !required),
    )
    .map(({ path }) => path)
    .sort();

  return {
    release: {
      recordId,
      fields,
      intermediateCurrentHash: releaseVersion.hash,
      // Publishing is a controlled transient used only when the old
      // published snapshot participates in the cycle.
      publish,
      transientNestedBlockIds: transient.ids,
    },
    unresolvedPaths,
  };
}

function deletionReleaseReservedItemIds(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
  additional: ReadonlySet<string> | undefined,
): Set<string> {
  return new Set([
    ...(additional ?? []),
    ...Object.keys(records),
    ...Object.keys(buildBlockOwnershipIndex(records, schema)),
  ]);
}

function rekeyPublishedReleaseNestedBlocks(
  fields: JsonObject,
  schema: SchemaSnapshot,
  recordId: string,
  reservedItemIds: Set<string>,
): { fields: JsonObject; ids: string[] } {
  const ids: string[] = [];
  const allocate = (originalBlockId: string): string => {
    let counter = 0;

    while (true) {
      const bytes = createHash('sha256')
        .update(
          [
            'datocms-content-diff-delete-release-block-v1',
            schema.siteId,
            schema.environmentId,
            recordId,
            originalBlockId,
            String(counter),
          ].join('\0'),
        )
        .digest()
        .subarray(0, 16);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const id = bytes.toString('base64url');
      counter += 1;
      if (reservedItemIds.has(id)) continue;
      reservedItemIds.add(id);
      ids.push(id);
      return id;
    }
  };

  const rekey = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(rekey);
    if (!isObject(value)) return value;

    if (isNestedBlock(value)) {
      const blockType = findItemType(schema, nestedBlockTypeId(value));
      if (!blockType.modularBlock) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Deletion release for ${recordId} embeds non-block model ${blockType.id}.`,
          { recordId, itemTypeId: blockType.id },
        );
      }
      const rekeyedFields = rekey(blockFields(value)) as JsonObject;
      const newId = allocate(value.id);

      if (isObject(value.attributes)) {
        return { ...value, id: newId, attributes: rekeyedFields };
      }

      const fieldKeys = new Set(blockType.fields.map(({ apiKey }) => apiKey));
      return {
        ...Object.fromEntries(
          Object.entries(value).filter(([key]) => !fieldKeys.has(key)),
        ),
        id: newId,
        ...rekeyedFields,
      };
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, rekey(child)]),
    );
  };

  return { fields: rekey(fields) as JsonObject, ids: ids.sort() };
}

export function assertExternalReferencesExist(
  references: readonly ReferenceDependency[],
  selectedRecordIds: ReadonlySet<string>,
  targetVisibleRecordIds: ReadonlySet<string>,
): void {
  const missing = references.filter(
    ({ toRecordId }) =>
      !selectedRecordIds.has(toRecordId) &&
      !targetVisibleRecordIds.has(toRecordId),
  );

  if (missing.length > 0) {
    const first = missing[0];
    throw new ContentDiffError(
      'MISSING_EXTERNAL_REFERENCE',
      `Record ${first.fromRecordId} references out-of-scope record ${first.toRecordId}, which is absent from the destination. Widen --item-types to include it.`,
      {
        fromRecordId: first.fromRecordId,
        toRecordId: first.toRecordId,
        path: first.path,
      },
    );
  }
}

export function buildUniqueReleaseDependencies(
  source: ContentSnapshot,
  target: ContentSnapshot,
  includeDeletions: boolean,
): ReferenceDependency[] {
  return analyzeUniqueReleases(source, target, includeDeletions).dependencies;
}

export interface RuntimeCurrentUniqueConflict {
  recordId: string;
  ownerRecordId: string;
  itemTypeId: string;
  fieldId: string;
  fieldApiKey: string;
  path: string;
  phase: 'create-seed' | 'published-stage' | 'current-restore';
}

export interface RuntimeCurrentUniqueTransitionAnalysis {
  publishDependencies: ReferenceDependency[];
  updateDependencies: ReferenceDependency[];
  conflicts: RuntimeCurrentUniqueConflict[];
}

/** Models every unique-value claim visible in runtime CURRENT across phases. */
export function analyzeRuntimeCurrentUniqueTransitions(
  source: ContentSnapshot,
  target: ContentSnapshot,
  excludedSourceRecordIds: ReadonlySet<string> = new Set(),
): RuntimeCurrentUniqueTransitionAnalysis {
  const publishDependencies: ReferenceDependency[] = [];
  const updateDependencies: ReferenceDependency[] = [];
  const conflicts: RuntimeCurrentUniqueConflict[] = [];
  const publishConflictByDependency = new Map<
    string,
    RuntimeCurrentUniqueConflict
  >();
  const updateConflictByDependency = new Map<
    string,
    RuntimeCurrentUniqueConflict
  >();

  for (const itemType of source.schema.itemTypes.filter(
    ({ modularBlock }) => !modularBlock,
  )) {
    const sourceRecords = Object.values(source.records).filter(
      ({ id, itemTypeId }) =>
        itemTypeId === itemType.id && !excludedSourceRecordIds.has(id),
    );
    const targetRecords = Object.values(target.records).filter(
      ({ itemTypeId }) => itemTypeId === itemType.id,
    );

    for (const field of itemType.fields.filter(hasUniqueValidator)) {
      const targetCurrentClaimants = uniqueClaimantSets(
        targetRecords.map((record) => ({
          recordId: record.id,
          version: record.current,
        })),
        field,
      );
      const sourceClaimants = uniqueClaimantSets(
        sourceRecords.flatMap((record) =>
          currentUniqueClaimVersions(record, target).map(({ version }) => ({
            recordId: record.id,
            version,
          })),
        ),
        field,
      );
      const phaseThreeReleaseRecordIds = new Set<string>();

      for (const [key, owners] of targetCurrentClaimants) {
        if (owners.size !== 1) continue;
        const ownerRecordId = [...owners][0];
        const desiredOwner = sourceRecords.find(
          ({ id }) => id === ownerRecordId,
        );
        if (
          !desiredOwner ||
          versionClaimsUniqueKey(desiredOwner.current, field, key)
        ) {
          continue;
        }

        const futureClaimants = sourceClaimants.get(key);
        if (
          futureClaimants &&
          [...futureClaimants].some((recordId) => recordId !== ownerRecordId)
        ) {
          phaseThreeReleaseRecordIds.add(ownerRecordId);
        }
      }

      const phaseSevenStart = new Map<string, RecordVersionSnapshot>();
      for (const record of targetRecords) {
        const desired = sourceRecords.find(({ id }) => id === record.id);
        phaseSevenStart.set(
          record.id,
          desired && phaseThreeReleaseRecordIds.has(record.id)
            ? desired.current
            : record.current,
        );
      }
      for (const record of sourceRecords) {
        if (target.records[record.id]) continue;
        phaseSevenStart.set(record.id, record.published ?? record.current);
      }

      const phaseSevenStartClaimants = uniqueClaimantSets(
        [...phaseSevenStart].map(([recordId, version]) => ({
          recordId,
          version,
        })),
        field,
      );
      const publishedStages = new Map(
        sourceRecords.flatMap((record) => {
          const baseline = target.records[record.id];
          return baseline &&
            record.published &&
            record.published.hash !== baseline.published?.hash
            ? [[record.id, record.published] as const]
            : [];
        }),
      );

      for (const record of sourceRecords) {
        const baseline = target.records[record.id];
        const phase = baseline ? 'published-stage' : 'create-seed';
        const version = baseline
          ? publishedStages.get(record.id)
          : record.published ?? record.current;
        if (!version || (baseline && !record.published)) continue;

        for (const [path, value] of uniqueValues(
          version.fields[field.apiKey],
          field,
        )) {
          const key = `${path}:${semanticHash(value)}`;
          const owners = phaseSevenStartClaimants.get(key);
          if (!owners) continue;

          for (const ownerRecordId of [...owners].sort()) {
            if (ownerRecordId === record.id) continue;

            const conflict: RuntimeCurrentUniqueConflict = {
              recordId: record.id,
              ownerRecordId,
              itemTypeId: itemType.id,
              fieldId: field.id,
              fieldApiKey: field.apiKey,
              path,
              phase,
            };
            const ownerStage = publishedStages.get(ownerRecordId);

            if (
              phase === 'published-stage' &&
              ownerStage &&
              !versionClaimsUniqueKey(ownerStage, field, key)
            ) {
              const dependency: ReferenceDependency = {
                fromRecordId: record.id,
                toRecordId: ownerRecordId,
                path: `unique:published-stage:${itemType.apiKey}.${field.apiKey}.${path}`,
                required: true,
              };
              publishDependencies.push(dependency);
              publishConflictByDependency.set(
                referenceKey(dependency),
                conflict,
              );
            } else {
              conflicts.push(conflict);
            }
          }
        }
      }

      const phaseSevenEnd = new Map(phaseSevenStart);
      for (const [recordId, version] of publishedStages) {
        phaseSevenEnd.set(recordId, version);
      }
      const phaseSevenEndClaimants = uniqueClaimantSets(
        [...phaseSevenEnd].map(([recordId, version]) => ({
          recordId,
          version,
        })),
        field,
      );

      for (const record of sourceRecords) {
        const phaseSevenVersion = phaseSevenEnd.get(record.id);
        if (
          !phaseSevenVersion ||
          phaseSevenVersion.hash === record.current.hash
        ) {
          continue;
        }

        for (const [path, value] of uniqueValues(
          record.current.fields[field.apiKey],
          field,
        )) {
          const key = `${path}:${semanticHash(value)}`;
          const owners = phaseSevenEndClaimants.get(key);
          if (!owners) continue;

          for (const ownerRecordId of [...owners].sort()) {
            if (ownerRecordId === record.id) continue;

            const conflict: RuntimeCurrentUniqueConflict = {
              recordId: record.id,
              ownerRecordId,
              itemTypeId: itemType.id,
              fieldId: field.id,
              fieldApiKey: field.apiKey,
              path,
              phase: 'current-restore',
            };
            const desiredOwner = sourceRecords.find(
              ({ id }) => id === ownerRecordId,
            );

            if (
              desiredOwner &&
              !versionClaimsUniqueKey(desiredOwner.current, field, key)
            ) {
              const dependency: ReferenceDependency = {
                fromRecordId: record.id,
                toRecordId: ownerRecordId,
                path: `unique:current-restore:${itemType.apiKey}.${field.apiKey}.${path}`,
                required: true,
              };
              updateDependencies.push(dependency);
              updateConflictByDependency.set(
                referenceKey(dependency),
                conflict,
              );
            } else {
              conflicts.push(conflict);
            }
          }
        }
      }
    }
  }

  const uniquePublishDependencies = deduplicateReferences(publishDependencies);
  const uniqueUpdateDependencies = deduplicateReferences(updateDependencies);
  const cyclicPublishKeys = cyclicDependencyKeys(uniquePublishDependencies);
  const cyclicUpdateKeys = cyclicDependencyKeys(uniqueUpdateDependencies);
  for (const key of cyclicPublishKeys) {
    const conflict = publishConflictByDependency.get(key);
    if (conflict) conflicts.push(conflict);
  }
  for (const key of cyclicUpdateKeys) {
    const conflict = updateConflictByDependency.get(key);
    if (conflict) conflicts.push(conflict);
  }

  return {
    publishDependencies: uniquePublishDependencies.filter(
      (dependency) => !cyclicPublishKeys.has(referenceKey(dependency)),
    ),
    updateDependencies: uniqueUpdateDependencies.filter(
      (dependency) => !cyclicUpdateKeys.has(referenceKey(dependency)),
    ),
    conflicts: [
      ...new Map(
        conflicts.map((conflict) => [
          [
            conflict.recordId,
            conflict.ownerRecordId,
            conflict.fieldId,
            conflict.path,
            conflict.phase,
          ].join('\0'),
          conflict,
        ]),
      ).values(),
    ].sort(
      (left, right) =>
        left.recordId.localeCompare(right.recordId) ||
        left.ownerRecordId.localeCompare(right.ownerRecordId) ||
        left.fieldId.localeCompare(right.fieldId) ||
        left.path.localeCompare(right.path) ||
        left.phase.localeCompare(right.phase),
    ),
  };
}

function versionClaimsUniqueKey(
  version: RecordVersionSnapshot,
  field: FieldSchemaSnapshot,
  key: string,
): boolean {
  return uniqueValues(version.fields[field.apiKey], field).some(
    ([path, value]) => `${path}:${semanticHash(value)}` === key,
  );
}

function cyclicDependencyKeys(
  dependencies: readonly ReferenceDependency[],
): Set<string> {
  const graph = referenceGraph(dependencies);
  const cyclicComponents = stronglyConnectedComponents(graph).filter(
    (component) =>
      component.length > 1 ||
      (component.length === 1 &&
        (graph[component[0]] ?? []).includes(component[0])),
  );
  const componentByRecordId = new Map(
    cyclicComponents.flatMap((component) =>
      component.map((recordId) => [recordId, component] as const),
    ),
  );

  return new Set(
    dependencies.flatMap((dependency) => {
      const component = componentByRecordId.get(dependency.fromRecordId);
      return component?.includes(dependency.toRecordId)
        ? [referenceKey(dependency)]
        : [];
    }),
  );
}

function assertNoUnsafeRuntimeCurrentUniqueTransitions(
  conflicts: readonly RuntimeCurrentUniqueConflict[],
): void {
  if (conflicts.length === 0) return;

  const first = conflicts[0];
  throw new ContentDiffError(
    'UNSUPPORTED_CONTENT_STATE',
    `Record ${first.recordId} has an unsafe ${first.phase} unique-value transition through CURRENT while record ${first.ownerRecordId} owns the same value on field ${first.fieldApiKey}. Temporary validator relaxation is required.`,
    {
      recordId: first.recordId,
      blockingRecordId: first.ownerRecordId,
      field: first.fieldApiKey,
    },
  );
}

export function analyzeUniqueReleases(
  source: ContentSnapshot,
  target: ContentSnapshot,
  includeDeletions: boolean,
): {
  dependencies: ReferenceDependency[];
  releases: UniqueReleaseStep[];
} {
  const result: ReferenceDependency[] = [];
  const releaseFields = new Map<string, JsonObject>();
  const releaseConsumers = new Map<string, Set<string>>();

  for (const itemType of source.schema.itemTypes.filter(
    ({ modularBlock }) => !modularBlock,
  )) {
    const sourceRecords = Object.values(source.records).filter(
      ({ itemTypeId }) => itemTypeId === itemType.id,
    );
    const targetRecords = Object.values(target.records).filter(
      ({ itemTypeId }) => itemTypeId === itemType.id,
    );

    for (const field of itemType.fields.filter(hasUniqueValidator)) {
      const sourceClaims = sourceRecords.flatMap((record) =>
        currentUniqueClaimVersions(record, target).map(({ version }) => ({
          recordId: record.id,
          version,
        })),
      );
      const targetClaims = targetRecords.map((record) => ({
        recordId: record.id,
        version: record.current,
      }));
      const sourceClaimants = uniqueClaimantSets(sourceClaims, field);
      const targetClaimants = uniqueClaimantSets(targetClaims, field);

      for (const record of sourceRecords) {
        const claimVersions = currentUniqueClaimVersions(record, target);

        for (const { kind, version } of claimVersions) {
          for (const [path, value] of uniqueValues(
            version.fields[field.apiKey],
            field,
          )) {
            const key = `${path}:${semanticHash(value)}`;
            const desiredClaimants = sourceClaimants.get(key);
            const baselineClaimants = targetClaimants.get(key);

            if (
              sameClaimants(desiredClaimants, baselineClaimants) ||
              !baselineClaimants
            ) {
              continue;
            }

            if (baselineClaimants.size !== 1) {
              throw ambiguousUniqueOwnersError(
                record.id,
                field.apiKey,
                baselineClaimants,
                false,
              );
            }

            const currentOwner = [...baselineClaimants][0];

            if (currentOwner === record.id) continue;

            const desiredOwner = source.records[currentOwner];
            if (!desiredOwner) {
              throw new ContentDiffError(
                'UNSUPPORTED_CONTENT_STATE',
                includeDeletions
                  ? `Record ${record.id} needs a unique value held by target-only record ${currentOwner}; create/delete uniqueness handoffs are unsupported in V1.`
                  : `Record ${record.id} needs a unique value still owned by destination record ${currentOwner}.`,
                {
                  recordId: record.id,
                  blockingRecordId: currentOwner,
                  field: field.apiKey,
                },
              );
            }

            const ownerReleasesValue = !uniqueValues(
              desiredOwner.current.fields[field.apiKey],
              field,
            ).some(
              ([ownerPath, ownerValue]) =>
                `${ownerPath}:${semanticHash(ownerValue)}` === key,
            );

            if (!ownerReleasesValue) {
              const ownerPublishedStage = currentUniqueClaimVersions(
                desiredOwner,
                target,
              ).find(({ kind }) => kind === 'published-stage');
              const ownerStageReleasesValue = Boolean(
                ownerPublishedStage &&
                  !uniqueValues(
                    ownerPublishedStage.version.fields[field.apiKey],
                    field,
                  ).some(
                    ([ownerPath, ownerValue]) =>
                      `${ownerPath}:${semanticHash(ownerValue)}` === key,
                  ),
              );

              if (kind === 'published-stage' && ownerStageReleasesValue) {
                continue;
              }

              throw new ContentDiffError(
                'UNSUPPORTED_CONTENT_STATE',
                `Record ${record.id} needs a unique value still owned by destination record ${currentOwner}.`,
                {
                  recordId: record.id,
                  blockingRecordId: currentOwner,
                  field: field.apiKey,
                },
              );
            }

            if (!(field.apiKey in desiredOwner.current.fields)) {
              throw new ContentDiffError(
                'UNSUPPORTED_CONTENT_STATE',
                `Record ${currentOwner} must release a unique value from ${field.apiKey}, but its desired snapshot omits the full field value.`,
                {
                  recordId: currentOwner,
                  field: field.apiKey,
                },
              );
            }

            const fields = releaseFields.get(currentOwner) ?? {};
            fields[field.apiKey] = desiredOwner.current.fields[field.apiKey];
            releaseFields.set(currentOwner, fields);
            const consumers = releaseConsumers.get(currentOwner) ?? new Set();
            consumers.add(record.id);
            releaseConsumers.set(currentOwner, consumers);

            result.push({
              fromRecordId: record.id,
              toRecordId: currentOwner,
              path: `unique:${kind}:${itemType.apiKey}.${field.apiKey}.${path}`,
              required: true,
            });
          }
        }
      }
    }
  }

  const currentTransitions = analyzeRuntimeCurrentUniqueTransitions(
    source,
    target,
  );
  assertNoUnsafeRuntimeCurrentUniqueTransitions(currentTransitions.conflicts);
  result.push(...currentTransitions.updateDependencies);

  const dependencies = deduplicateReferences(result);
  const dependencyGraph = Object.fromEntries(
    [
      ...new Set(
        dependencies.flatMap(({ fromRecordId, toRecordId }) => [
          fromRecordId,
          toRecordId,
        ]),
      ),
    ]
      .sort()
      .map((recordId) => [
        recordId,
        dependencies
          .filter(({ fromRecordId }) => fromRecordId === recordId)
          .map(({ toRecordId }) => toRecordId)
          .sort(),
      ]),
  );

  if (graphHasCycle(dependencyGraph)) {
    throw new ContentDiffError(
      'UNIQUE_VALUE_CYCLE',
      `Records ${Object.keys(dependencyGraph)
        .sort()
        .join(
          ', ',
        )} form a cyclic unique-value swap that V1 cannot reproduce safely.`,
      { recordIds: Object.keys(dependencyGraph).sort() },
    );
  }

  const releaseOrder = topologicalSort(dependencyGraph).filter((recordId) =>
    releaseFields.has(recordId),
  );
  const releases = releaseOrder.map((recordId): UniqueReleaseStep => {
    const baseline = target.records[recordId];
    const fields = releaseFields.get(recordId)!;

    if (!baseline) {
      throw new ContentDiffError(
        'UNSUPPORTED_CONTENT_STATE',
        `Unique-value release owner ${recordId} is absent from the destination snapshot.`,
        { recordId },
      );
    }

    return {
      recordId,
      fields,
      consumerRecordIds: [...(releaseConsumers.get(recordId) ?? [])].sort(),
      intermediateCurrentHash: semanticHash({
        ...baseline.current.fields,
        ...fields,
      }),
    };
  });

  return { dependencies, releases };
}

export function buildPublishedUniqueDependencies(
  source: ContentSnapshot,
  target: ContentSnapshot,
  includeDeletions: boolean,
): ReferenceDependency[] {
  const result: ReferenceDependency[] = [];

  for (const itemType of source.schema.itemTypes.filter(
    ({ modularBlock }) => !modularBlock,
  )) {
    const sourceRecords = Object.values(source.records).filter(
      ({ itemTypeId, published }) =>
        itemTypeId === itemType.id && published !== null,
    );
    const targetRecords = Object.values(target.records).filter(
      ({ itemTypeId, published }) =>
        itemTypeId === itemType.id && published !== null,
    );

    for (const field of itemType.fields.filter(hasUniqueValidator)) {
      const sourceClaimants = uniqueClaimantSets(
        sourceRecords.map((record) => ({
          recordId: record.id,
          version: record.published!,
        })),
        field,
      );
      const targetClaimants = uniqueClaimantSets(
        targetRecords.map((record) => ({
          recordId: record.id,
          version: record.published!,
        })),
        field,
      );

      for (const record of sourceRecords) {
        for (const [path, value] of uniqueValues(
          record.published!.fields[field.apiKey],
          field,
        )) {
          const key = `${path}:${semanticHash(value)}`;
          const desiredClaimants = sourceClaimants.get(key);
          const baselineClaimants = targetClaimants.get(key);

          if (
            sameClaimants(desiredClaimants, baselineClaimants) ||
            !baselineClaimants
          ) {
            continue;
          }

          if (baselineClaimants.size !== 1) {
            throw ambiguousUniqueOwnersError(
              record.id,
              field.apiKey,
              baselineClaimants,
              true,
            );
          }

          const currentOwner = [...baselineClaimants][0];

          if (currentOwner === record.id) continue;

          const desiredOwner = source.records[currentOwner];
          if (!desiredOwner) {
            throw new ContentDiffError(
              'UNSUPPORTED_CONTENT_STATE',
              includeDeletions
                ? `Record ${record.id} needs a published unique value held by target-only record ${currentOwner}; publish/delete uniqueness handoffs are unsupported in V1.`
                : `Record ${record.id} needs a published unique value still owned by destination record ${currentOwner}.`,
              {
                recordId: record.id,
                blockingRecordId: currentOwner,
                field: field.apiKey,
              },
            );
          }

          const ownerReleasesValue =
            desiredOwner.published === null ||
            !uniqueValues(
              desiredOwner.published.fields[field.apiKey],
              field,
            ).some(
              ([ownerPath, ownerValue]) =>
                `${ownerPath}:${semanticHash(ownerValue)}` === key,
            );

          if (!ownerReleasesValue) {
            throw new ContentDiffError(
              'UNSUPPORTED_CONTENT_STATE',
              `Record ${record.id} needs a published unique value still owned by destination record ${currentOwner}.`,
              {
                recordId: record.id,
                blockingRecordId: currentOwner,
                field: field.apiKey,
              },
            );
          }

          result.push({
            fromRecordId: record.id,
            toRecordId: currentOwner,
            path: `unique:published:${itemType.apiKey}.${field.apiKey}.${path}`,
            required: true,
          });
        }
      }
    }
  }

  const currentTransitions = analyzeRuntimeCurrentUniqueTransitions(
    source,
    target,
  );
  assertNoUnsafeRuntimeCurrentUniqueTransitions(currentTransitions.conflicts);
  const dependencies = deduplicateReferences([
    ...result,
    ...currentTransitions.publishDependencies,
  ]);
  const graph = referenceGraph(dependencies);

  if (graphHasCycle(graph)) {
    throw new ContentDiffError(
      'UNIQUE_VALUE_CYCLE',
      `Records ${Object.keys(graph)
        .sort()
        .join(
          ', ',
        )} form a cyclic published unique-value swap that V1 cannot reproduce safely.`,
      { recordIds: Object.keys(graph).sort() },
    );
  }

  return dependencies;
}

export interface BuildPublishOrderOptions {
  deletionRecordIds?: ReadonlySet<string>;
  publicationSeedRecordIds?: ReadonlySet<string>;
}

export function collectPublishedDependencyIds(
  record: RecordSnapshot,
  schema: SchemaSnapshot,
): string[] {
  if (!record.published) return [];

  return [
    ...new Set([
      ...collectPublishedRecordReferences(record, schema).map(
        ({ toRecordId }) => toRecordId,
      ),
      ...(record.topology.parentId ? [record.topology.parentId] : []),
    ]),
  ].sort();
}

/**
 * Produces one forward order for publication reconciliation and unpublishing.
 * Dependencies are always placed before consumers. For unpublishing, the
 * referenced record depends on every published referrer operation that must
 * remove the reference or unpublish first.
 */
export function buildPublishOrder(
  records: Record<string, RecordSnapshot>,
  schema: SchemaSnapshot,
  publishedUniqueDependencies: readonly ReferenceDependency[],
  targetRecords: Readonly<Record<string, RecordSnapshot>> = {},
  options: BuildPublishOrderOptions = {},
): string[] {
  const deletionRecordIds = options.deletionRecordIds ?? new Set<string>();
  const publicationSeedRecordIds =
    options.publicationSeedRecordIds ?? new Set<string>();
  const recordIds = new Set(Object.keys(records));
  const dependencies = Object.fromEntries(
    [...recordIds].sort().map((recordId) => [recordId, [] as string[]]),
  );
  const desiredPublishedDependencies = new Map(
    Object.values(records).map((record) => [
      record.id,
      new Set(collectPublishedDependencyIds(record, schema)),
    ]),
  );
  const targetPublishedDependencies = new Map<string, Set<string>>();

  for (const target of Object.values(targetRecords)) {
    if (!target.published) continue;

    const dependencyIds = collectPublishedRecordReferences(target, schema).map(
      ({ toRecordId }) => toRecordId,
    );
    targetPublishedDependencies.set(target.id, new Set(dependencyIds));
  }

  for (const record of Object.values(records)) {
    if (!record.published) continue;

    for (const dependencyId of desiredPublishedDependencies.get(record.id) ??
      []) {
      const desiredDependency = records[dependencyId];
      const targetDependency = targetRecords[dependencyId];

      if (deletionRecordIds.has(dependencyId)) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Published record ${record.id} references record ${dependencyId}, but that dependency is scheduled for deletion.`,
          { recordId: record.id, dependencyId },
        );
      }

      if (desiredDependency && !desiredDependency.published) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Published record ${record.id} references managed record ${dependencyId}, but the desired dependency is unpublished.`,
          { recordId: record.id, dependencyId },
        );
      }

      // A reference only constrains publication when the referenced record has
      // no published target version yet and this plan intends to publish one.
      // Existing publications already satisfy publish-time reference checks,
      // Valid optional-cycle seeds are also published before final operations,
      // so their ordinary link cycles are benign and must not be rejected.
      if (
        desiredDependency?.published &&
        !targetDependency?.published &&
        !publicationSeedRecordIds.has(dependencyId) &&
        recordIds.has(dependencyId)
      ) {
        dependencies[record.id].push(dependencyId);
      }
    }
  }

  const unpublishIds = new Set([
    ...Object.values(records)
      .filter(
        (record) =>
          !record.published && Boolean(targetRecords[record.id]?.published),
      )
      .map(({ id }) => id),
  ]);

  for (const targetId of [...unpublishIds].sort()) {
    for (const [
      referrerId,
      targetDependencies,
    ] of targetPublishedDependencies) {
      if (referrerId === targetId || !targetDependencies.has(targetId)) {
        continue;
      }

      const desiredReferrer = records[referrerId];

      if (!recordIds.has(referrerId)) {
        const plannedDeletion = deletionRecordIds.has(referrerId);
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          plannedDeletion
            ? `Record ${targetId} cannot be unpublished safely because published deletion candidate ${referrerId} still refers to it until the later deletion phase.`
            : `Record ${targetId} cannot be unpublished because retained published record ${referrerId} still references it. Widen --item-types or include deletions.`,
          { recordId: targetId, referrerId, plannedDeletion },
        );
      }

      if (
        desiredReferrer?.published &&
        desiredPublishedDependencies.get(referrerId)?.has(targetId)
      ) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Record ${targetId} cannot be unpublished because desired published record ${referrerId} still references it.`,
          { recordId: targetId, referrerId },
        );
      }

      // The referrer must either reconcile its published version without this
      // link or become unpublished before the referenced record is unpublished.
      dependencies[targetId].push(referrerId);
    }

    const target = targetRecords[targetId];

    if (!target) continue;

    for (const child of Object.values(targetRecords).filter(
      (candidate) =>
        candidate.id !== targetId &&
        candidate.published &&
        candidate.topology.parentId === targetId,
    )) {
      const desiredChild = records[child.id];

      // Tree parent moves happen before publication operations. A child that
      // is retained but reparented away no longer blocks this unpublish.
      if (desiredChild && desiredChild.topology.parentId !== targetId) {
        continue;
      }

      if (!recordIds.has(child.id)) {
        const plannedDeletion = deletionRecordIds.has(child.id);
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          plannedDeletion
            ? `Tree record ${targetId} cannot be unpublished safely because published deletion candidate ${child.id} remains beneath it until the later deletion phase.`
            : `Tree record ${targetId} cannot be unpublished because retained published child ${child.id} remains beneath it.`,
          { recordId: targetId, childId: child.id, plannedDeletion },
        );
      }

      if (desiredChild?.published) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Tree record ${targetId} cannot be unpublished while desired child ${child.id} remains published beneath it.`,
          { recordId: targetId, childId: child.id },
        );
      }

      dependencies[targetId].push(child.id);
    }
  }

  for (const dependency of publishedUniqueDependencies) {
    if (
      recordIds.has(dependency.fromRecordId) &&
      recordIds.has(dependency.toRecordId)
    ) {
      dependencies[dependency.fromRecordId].push(dependency.toRecordId);
    }
  }

  for (const values of Object.values(dependencies)) {
    values.splice(0, values.length, ...[...new Set(values)].sort());
  }

  if (graphHasCycle(dependencies)) {
    throw new ContentDiffError(
      'REQUIRED_REFERENCE_CYCLE',
      `Publication operation graph contains a cycle involving ${Object.keys(
        dependencies,
      )
        .sort()
        .join(', ')}.`,
      { recordIds: Object.keys(dependencies).sort() },
    );
  }

  return topologicalSort(dependencies);
}

export function assertSingletonIdsMatch(
  source: ContentSnapshot,
  target: ContentSnapshot,
): void {
  for (const itemType of source.schema.itemTypes.filter(
    ({ singleton, modularBlock }) => singleton && !modularBlock,
  )) {
    const sourceIds = Object.values(source.records)
      .filter(({ itemTypeId }) => itemTypeId === itemType.id)
      .map(({ id }) => id)
      .sort();
    const targetIds = Object.values(target.records)
      .filter(({ itemTypeId }) => itemTypeId === itemType.id)
      .map(({ id }) => id)
      .sort();

    const exactMatch = sourceIds.join(',') === targetIds.join(',');
    // A singleton created after the destination fork is safe to reproduce:
    // the runtime requests this exact portable source ID. Every mismatch with
    // an already occupied destination singleton remains ambiguous and unsafe.
    const sourceOnlySingletonCreate =
      sourceIds.length === 1 && targetIds.length === 0;

    if (!exactMatch && !sourceOnlySingletonCreate) {
      throw new ContentDiffError(
        'SINGLETON_ID_MISMATCH',
        `Singleton model ${itemType.apiKey} has different record IDs in source and destination.`,
        { itemTypeId: itemType.id, sourceIds, targetIds },
      );
    }
  }
}

function collectReferencesFromFields(
  fields: JsonObject,
  itemType: ItemTypeSchemaSnapshot,
  schema: SchemaSnapshot,
  prefix: string,
  requiredContext: boolean,
  add: (recordId: string, path: string, required: boolean) => void,
): void {
  for (const field of itemType.fields) {
    if (!(field.apiKey in fields)) {
      continue;
    }

    const value = fields[field.apiKey];
    const fieldPath = `${prefix}.${field.apiKey}`;
    const fieldRequired = requiredContext && hasRequiredValidator(field);

    if (field.localized && isObject(value)) {
      for (const [locale, localizedValue] of Object.entries(value)) {
        collectReferencesFromFieldValue(
          localizedValue,
          field,
          schema,
          `${fieldPath}.${locale}`,
          fieldRequired,
          add,
        );
      }
    } else {
      collectReferencesFromFieldValue(
        value,
        field,
        schema,
        fieldPath,
        fieldRequired,
        add,
      );
    }
  }
}

function stripOptionalReferencesFromFields(
  fields: JsonObject,
  itemType: ItemTypeSchemaSnapshot,
  schema: SchemaSnapshot,
  targetIds: ReadonlySet<string>,
): JsonObject {
  return stripReferencesFromFields(fields, itemType, schema, targetIds, false);
}

function stripReferencesFromFields(
  fields: JsonObject,
  itemType: ItemTypeSchemaSnapshot,
  schema: SchemaSnapshot,
  targetIds: ReadonlySet<string>,
  force: boolean,
): JsonObject {
  const result: JsonObject = { ...fields };

  for (const field of itemType.fields) {
    if (!(field.apiKey in fields)) continue;

    const value = fields[field.apiKey];

    if (field.localized && isObject(value)) {
      result[field.apiKey] = Object.fromEntries(
        Object.entries(value).map(([locale, localizedValue]) => {
          const stripped = stripOptionalReferencesFromFieldValue(
            localizedValue,
            field,
            schema,
            targetIds,
            hasRequiredValidator(field),
            force,
          );

          return [
            locale,
            stripped === REMOVE_OPTIONAL_REFERENCE ? null : stripped,
          ];
        }),
      );
    } else {
      const stripped = stripOptionalReferencesFromFieldValue(
        value,
        field,
        schema,
        targetIds,
        hasRequiredValidator(field),
        force,
      );
      result[field.apiKey] =
        stripped === REMOVE_OPTIONAL_REFERENCE ? null : stripped;
    }
  }

  return result;
}

/** Exact field body used by runtime phase 5 for a source-only record CREATE. */
export function projectCreateSeedFields(
  record: RecordSnapshot,
  schema: SchemaSnapshot,
  createOrder: readonly string[],
  createRecordIds: ReadonlySet<string>,
  shellRecordIds: ReadonlySet<string>,
  shellComponents: readonly (readonly string[])[],
): JsonObject {
  const recordIndex = createOrder.indexOf(record.id);
  if (recordIndex < 0) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `Execution create order is missing source-only record ${record.id}.`,
      { recordId: record.id },
    );
  }
  const laterCreates = new Set(
    [...createRecordIds].filter(
      (id) => id !== record.id && createOrder.indexOf(id) > recordIndex,
    ),
  );
  const isShell = shellRecordIds.has(record.id);
  if (isShell) {
    const component = shellComponents.find((ids) => ids.includes(record.id));
    if (!component) {
      throw new ContentDiffError(
        'UNSUPPORTED_CONTENT_STATE',
        `Execution shell components are missing source-only record ${record.id}.`,
        { recordId: record.id },
      );
    }
    component.forEach((id) => laterCreates.add(id));
  }
  const itemType = findItemType(schema, record.itemTypeId);
  const seed = record.published ?? record.current;
  return stripReferencesFromFields(
    seed.fields,
    itemType,
    schema,
    laterCreates,
    isShell,
  );
}

function stripOptionalReferencesFromFieldValue(
  value: JsonValue,
  field: FieldSchemaSnapshot,
  schema: SchemaSnapshot,
  targetIds: ReadonlySet<string>,
  required: boolean,
  force: boolean,
): JsonValue | typeof REMOVE_OPTIONAL_REFERENCE {
  if (field.fieldType === 'link') {
    return (!required || force) &&
      typeof value === 'string' &&
      targetIds.has(value)
      ? null
      : value;
  }

  if (field.fieldType === 'links' && Array.isArray(value)) {
    return required && !force
      ? value
      : value.filter(
          (recordId) =>
            typeof recordId !== 'string' || !targetIds.has(recordId),
        );
  }

  if (field.fieldType === 'structured_text') {
    const stripped = stripOptionalReferencesFromStructuredTextValue(
      value,
      schema,
      targetIds,
      required,
      force,
    );

    return canonicalProjectedStructuredText(value, stripped);
  }

  if (field.fieldType === 'rich_text' || field.fieldType === 'single_block') {
    const stripped = stripOptionalReferencesFromEmbeddedValue(
      value,
      schema,
      targetIds,
      required,
      force,
    );

    return isUnwrappedOptionalReferenceChildren(stripped)
      ? stripped.children
      : stripped;
  }

  return value;
}

function stripOptionalReferencesFromStructuredTextValue(
  value: JsonValue,
  schema: SchemaSnapshot,
  targetIds: ReadonlySet<string>,
  requiredContext: boolean,
  force: boolean,
): StrippedEmbeddedValue {
  if (!isObject(value) || !isObject(value.document)) return value;

  const strippedDocument = stripOptionalReferencesFromStructuredTextNode(
    value.document,
    schema,
    targetIds,
    requiredContext,
    force,
    value.schema === 'dast',
  );

  if (
    strippedDocument === REMOVE_OPTIONAL_REFERENCE ||
    isUnwrappedOptionalReferenceChildren(strippedDocument)
  ) {
    return strippedDocument;
  }

  return { ...value, document: strippedDocument };
}

function stripOptionalReferencesFromStructuredTextNode(
  value: JsonValue,
  schema: SchemaSnapshot,
  targetIds: ReadonlySet<string>,
  requiredContext: boolean,
  force: boolean,
  normalizeDast: boolean,
): StrippedEmbeddedValue {
  if (!isStructuredTextNode(value)) return value;

  if (
    value.type === 'inlineItem' &&
    typeof value.item === 'string' &&
    targetIds.has(value.item) &&
    (!requiredContext || force)
  ) {
    return REMOVE_OPTIONAL_REFERENCE;
  }

  const strippedChildren = Array.isArray(value.children)
    ? value.children.flatMap((child) => {
        const stripped = stripOptionalReferencesFromStructuredTextNode(
          child,
          schema,
          targetIds,
          requiredContext,
          force,
          normalizeDast,
        );
        if (stripped === REMOVE_OPTIONAL_REFERENCE) return [];
        if (isUnwrappedOptionalReferenceChildren(stripped)) {
          return stripped.children;
        }
        return [stripped];
      })
    : null;
  const normalizedChildren =
    strippedChildren && normalizeDast
      ? normalizeProjectedDastChildren(strippedChildren)
      : strippedChildren;

  if (
    value.type === 'itemLink' &&
    typeof value.item === 'string' &&
    targetIds.has(value.item) &&
    (!requiredContext || force)
  ) {
    return {
      kind: UNWRAP_OPTIONAL_REFERENCE_CHILDREN,
      children: normalizedChildren ?? [],
    };
  }

  const result: JsonObject = { ...value };
  if (normalizedChildren) result.children = normalizedChildren;

  if (
    (value.type === 'block' || value.type === 'inlineBlock') &&
    isObject(value.item) &&
    isNestedBlock(value.item)
  ) {
    const strippedItem = stripOptionalReferencesFromEmbeddedValue(
      value.item,
      schema,
      targetIds,
      requiredContext,
      force,
    );
    if (
      strippedItem !== REMOVE_OPTIONAL_REFERENCE &&
      !isUnwrappedOptionalReferenceChildren(strippedItem)
    ) {
      result.item = strippedItem;
    }
  }

  if (!normalizeDast) return result;
  if (Array.isArray(result.children) && result.children.length === 0) {
    return REMOVE_OPTIONAL_REFERENCE;
  }
  if (
    (result.type === 'link' || result.type === 'itemLink') &&
    Array.isArray(result.children) &&
    result.children.length === 1 &&
    isEmptyDastSpan(result.children[0])
  ) {
    return { type: 'span', value: '' };
  }
  if (isEmptyDastSpan(result)) {
    const { marks: _marks, ...emptySpan } = result;
    return emptySpan;
  }

  return result;
}

function stripOptionalReferencesFromEmbeddedValue(
  value: JsonValue,
  schema: SchemaSnapshot,
  targetIds: ReadonlySet<string>,
  requiredContext: boolean,
  force: boolean,
): StrippedEmbeddedValue {
  if (Array.isArray(value)) {
    const children = value.flatMap((child) => {
      const stripped = stripOptionalReferencesFromEmbeddedValue(
        child,
        schema,
        targetIds,
        requiredContext,
        force,
      );

      if (stripped === REMOVE_OPTIONAL_REFERENCE) return [];
      if (isUnwrappedOptionalReferenceChildren(stripped)) {
        return stripped.children;
      }
      return [stripped];
    });

    return normalizeProjectedDastChildren(children);
  }

  if (!isObject(value)) return value;

  if (
    value.type === 'inlineItem' &&
    typeof value.item === 'string' &&
    targetIds.has(value.item) &&
    (!requiredContext || force)
  ) {
    return REMOVE_OPTIONAL_REFERENCE;
  }

  if (
    value.type === 'itemLink' &&
    typeof value.item === 'string' &&
    targetIds.has(value.item) &&
    (!requiredContext || force)
  ) {
    const strippedChildren = stripOptionalReferencesFromEmbeddedValue(
      Array.isArray(value.children) ? value.children : [],
      schema,
      targetIds,
      requiredContext,
      force,
    );

    return {
      kind: UNWRAP_OPTIONAL_REFERENCE_CHILDREN,
      children: Array.isArray(strippedChildren) ? strippedChildren : [],
    };
  }

  if (isNestedBlock(value)) {
    const blockType = findItemType(schema, nestedBlockTypeId(value));
    const strippedFields = stripReferencesFromFields(
      blockFields(value),
      blockType,
      schema,
      targetIds,
      force,
    );

    if (isObject(value.attributes)) {
      return { ...value, attributes: strippedFields };
    }

    const fieldKeys = new Set(blockType.fields.map(({ apiKey }) => apiKey));
    return {
      ...Object.fromEntries(
        Object.entries(value).filter(([key]) => !fieldKeys.has(key)),
      ),
      ...strippedFields,
    };
  }

  const result = Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const stripped = stripOptionalReferencesFromEmbeddedValue(
        child,
        schema,
        targetIds,
        requiredContext,
        force,
      );

      if (stripped === REMOVE_OPTIONAL_REFERENCE) return [];
      if (isUnwrappedOptionalReferenceChildren(stripped)) {
        return [[key, stripped.children]];
      }
      return [[key, stripped]];
    }),
  );

  if (Array.isArray(result.children) && result.children.length === 0) {
    return REMOVE_OPTIONAL_REFERENCE;
  }
  if (
    (result.type === 'link' || result.type === 'itemLink') &&
    Array.isArray(result.children) &&
    result.children.length === 1 &&
    isEmptyDastSpan(result.children[0])
  ) {
    return { type: 'span', value: '' };
  }
  if (isEmptyDastSpan(result)) {
    const { marks: _marks, ...emptySpan } = result;
    return emptySpan;
  }

  return result;
}

function isUnwrappedOptionalReferenceChildren(
  value: StrippedEmbeddedValue,
): value is UnwrappedOptionalReferenceChildren {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'kind' in value &&
    value.kind === UNWRAP_OPTIONAL_REFERENCE_CHILDREN
  );
}

function normalizeProjectedDastChildren(children: JsonValue[]): JsonValue[] {
  const result: JsonValue[] = [];

  for (const child of children) {
    if (result.length > 0 && isEmptyDastSpan(result[result.length - 1])) {
      result.pop();
    }

    result.push(child);

    if (
      result.length >= 2 &&
      areMergeableDastSpans(
        result[result.length - 2],
        result[result.length - 1],
      )
    ) {
      const right = result.pop() as JsonObject;
      const left = result[result.length - 1] as JsonObject;
      left.value = `${String(left.value)}${String(right.value)}`;
    }

    if (
      result.length >= 2 &&
      areMergeableDastLists(
        result[result.length - 2],
        result[result.length - 1],
      )
    ) {
      const right = result.pop() as JsonObject;
      const left = result[result.length - 1] as JsonObject;
      left.children = [
        ...((left.children as JsonValue[]) ?? []),
        ...((right.children as JsonValue[]) ?? []),
      ];
    }
  }

  if (result.length > 1 && isEmptyDastSpan(result[result.length - 1])) {
    result.pop();
  }

  return result;
}

function areMergeableDastSpans(left: JsonValue, right: JsonValue): boolean {
  if (!isObject(left) || !isObject(right)) return false;
  if (left.type !== 'span' || right.type !== 'span') return false;
  if (typeof left.value !== 'string' || typeof right.value !== 'string') {
    return false;
  }

  const leftMarks = Array.isArray(left.marks) ? left.marks.map(String) : [];
  const rightMarks = Array.isArray(right.marks) ? right.marks.map(String) : [];
  return (
    leftMarks.length === rightMarks.length &&
    leftMarks.every((mark) => rightMarks.includes(mark))
  );
}

function areMergeableDastLists(left: JsonValue, right: JsonValue): boolean {
  return (
    isObject(left) &&
    isObject(right) &&
    left.type === 'list' &&
    right.type === 'list' &&
    left.style === right.style &&
    Array.isArray(left.children) &&
    Array.isArray(right.children)
  );
}

function isEmptyDastSpan(value: JsonValue): value is JsonObject {
  return isObject(value) && value.type === 'span' && value.value === '';
}

function canonicalProjectedStructuredText(
  original: JsonValue,
  stripped: StrippedEmbeddedValue,
): JsonValue {
  if (!isObject(original) || original.schema !== 'dast') {
    if (stripped === REMOVE_OPTIONAL_REFERENCE) return null;
    return isUnwrappedOptionalReferenceChildren(stripped)
      ? stripped.children
      : stripped;
  }

  if (
    stripped === REMOVE_OPTIONAL_REFERENCE ||
    isUnwrappedOptionalReferenceChildren(stripped) ||
    !isObject(stripped) ||
    !isObject(stripped.document)
  ) {
    // validateExisting inspects raw nested-block payloads, while a real write
    // normalizes DAST first. Persist the exact canonical empty shape so both
    // paths diagnose the same required/length validators.
    return emptyDastValue();
  }

  return stripped;
}

function emptyDastValue(): JsonObject {
  return {
    schema: 'dast',
    document: {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'span', value: '' }] },
      ],
    },
  };
}

function collectReferencesFromFieldValue(
  value: JsonValue,
  field: FieldSchemaSnapshot,
  schema: SchemaSnapshot,
  path: string,
  required: boolean,
  add: (recordId: string, path: string, required: boolean) => void,
): void {
  if (field.fieldType === 'link' && typeof value === 'string') {
    add(value, path, required);
    return;
  }

  if (field.fieldType === 'links' && Array.isArray(value)) {
    value.forEach((recordId, index) => {
      if (typeof recordId === 'string') {
        add(recordId, `${path}[${index}]`, required);
      }
    });
    return;
  }

  if (field.fieldType === 'structured_text') {
    walkStructuredTextValue(value, schema, path, required, add);
    return;
  }

  if (field.fieldType === 'rich_text' || field.fieldType === 'single_block') {
    walkEmbeddedValue(value, schema, path, required, add);
  }
}

function walkStructuredTextValue(
  value: JsonValue,
  schema: SchemaSnapshot,
  path: string,
  requiredContext: boolean,
  add: (recordId: string, path: string, required: boolean) => void,
): void {
  if (!isObject(value) || !isObject(value.document)) return;
  walkStructuredTextNode(
    value.document,
    schema,
    `${path}.document`,
    requiredContext,
    add,
  );
}

function walkStructuredTextNode(
  value: JsonValue,
  schema: SchemaSnapshot,
  path: string,
  requiredContext: boolean,
  add: (recordId: string, path: string, required: boolean) => void,
): void {
  if (!isStructuredTextNode(value)) return;

  if (
    (value.type === 'inlineItem' || value.type === 'itemLink') &&
    typeof value.item === 'string'
  ) {
    add(value.item, `${path}.item`, requiredContext);
  }

  if (
    (value.type === 'block' || value.type === 'inlineBlock') &&
    isObject(value.item) &&
    isNestedBlock(value.item)
  ) {
    const blockType = findItemType(schema, nestedBlockTypeId(value.item));
    collectReferencesFromFields(
      blockFields(value.item),
      blockType,
      schema,
      `${path}.item.block:${value.item.id}`,
      true,
      add,
    );
  }

  if (Array.isArray(value.children)) {
    value.children.forEach((child, index) =>
      walkStructuredTextNode(
        child,
        schema,
        `${path}.children[${index}]`,
        requiredContext,
        add,
      ),
    );
  }
}

function walkEmbeddedValue(
  value: JsonValue,
  schema: SchemaSnapshot,
  path: string,
  requiredContext: boolean,
  add: (recordId: string, path: string, required: boolean) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      walkEmbeddedValue(
        child,
        schema,
        `${path}[${index}]`,
        requiredContext,
        add,
      ),
    );
    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (
    (value.type === 'inlineItem' || value.type === 'itemLink') &&
    typeof value.item === 'string'
  ) {
    add(value.item, `${path}.item`, requiredContext);
  }

  if (isNestedBlock(value)) {
    const blockType = findItemType(schema, nestedBlockTypeId(value));
    collectReferencesFromFields(
      blockFields(value),
      blockType,
      schema,
      `${path}.block:${value.id}`,
      true,
      add,
    );
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    walkEmbeddedValue(child, schema, `${path}.${key}`, requiredContext, add);
  }
}

function collectUploadsFromFields(
  fields: JsonObject,
  itemType: ItemTypeSchemaSnapshot,
  schema: SchemaSnapshot,
  uploadIds: Set<string>,
): void {
  for (const field of itemType.fields) {
    if (!(field.apiKey in fields)) {
      continue;
    }

    const value = fields[field.apiKey];
    const values =
      field.localized && isObject(value) ? Object.values(value) : [value];

    for (const fieldValue of values) {
      if (field.fieldType === 'file') {
        const uploadId = uploadIdFromValue(fieldValue);
        if (uploadId) uploadIds.add(uploadId);
      } else if (field.fieldType === 'gallery' && Array.isArray(fieldValue)) {
        fieldValue.forEach((uploadValue) => {
          const uploadId = uploadIdFromValue(uploadValue);
          if (uploadId) uploadIds.add(uploadId);
        });
      } else if (
        field.fieldType === 'seo' &&
        isObject(fieldValue) &&
        typeof fieldValue.image === 'string'
      ) {
        uploadIds.add(fieldValue.image);
      } else if (field.fieldType === 'structured_text') {
        collectUploadsFromStructuredText(fieldValue, schema, uploadIds);
      } else if (
        field.fieldType === 'rich_text' ||
        field.fieldType === 'single_block'
      ) {
        collectUploadsFromEmbedded(fieldValue, schema, uploadIds);
      }
    }
  }
}

function collectUploadsFromStructuredText(
  value: JsonValue,
  schema: SchemaSnapshot,
  uploadIds: Set<string>,
): void {
  if (!isObject(value) || !isObject(value.document)) return;
  collectUploadsFromStructuredTextNode(value.document, schema, uploadIds);
}

function collectUploadsFromStructuredTextNode(
  value: JsonValue,
  schema: SchemaSnapshot,
  uploadIds: Set<string>,
): void {
  if (!isStructuredTextNode(value)) return;

  if (
    (value.type === 'block' || value.type === 'inlineBlock') &&
    isObject(value.item) &&
    isNestedBlock(value.item)
  ) {
    const itemType = findItemType(schema, nestedBlockTypeId(value.item));
    collectUploadsFromFields(
      blockFields(value.item),
      itemType,
      schema,
      uploadIds,
    );
  }

  if (Array.isArray(value.children)) {
    value.children.forEach((child) =>
      collectUploadsFromStructuredTextNode(child, schema, uploadIds),
    );
  }
}

function collectUploadsFromEmbedded(
  value: JsonValue,
  schema: SchemaSnapshot,
  uploadIds: Set<string>,
): void {
  if (Array.isArray(value)) {
    value.forEach((child) =>
      collectUploadsFromEmbedded(child, schema, uploadIds),
    );
    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (isNestedBlock(value)) {
    const itemType = findItemType(schema, nestedBlockTypeId(value));
    collectUploadsFromFields(blockFields(value), itemType, schema, uploadIds);
    return;
  }

  for (const child of Object.values(value)) {
    collectUploadsFromEmbedded(child, schema, uploadIds);
  }
}

function walkFields(
  fields: JsonObject,
  itemType: ItemTypeSchemaSnapshot,
  schema: SchemaSnapshot,
  visit: (
    block: JsonObject & { id: string },
    blockType: ItemTypeSchemaSnapshot,
    location: { fieldPath: string; locale: string | null },
  ) => void,
  prefix = '',
): void {
  for (const field of itemType.fields) {
    if (!(field.apiKey in fields)) {
      continue;
    }

    const value = fields[field.apiKey];
    const fieldPath = prefix ? `${prefix}.${field.apiKey}` : field.apiKey;

    if (field.localized && isObject(value)) {
      for (const [locale, localizedValue] of Object.entries(value)) {
        walkBlocksInFieldValue(
          localizedValue,
          field,
          schema,
          visit,
          fieldPath,
          locale,
        );
      }
    } else {
      walkBlocksInFieldValue(value, field, schema, visit, fieldPath, null);
    }
  }
}

function walkBlocksInFieldValue(
  value: JsonValue,
  field: FieldSchemaSnapshot,
  schema: SchemaSnapshot,
  visit: (
    block: JsonObject & { id: string },
    blockType: ItemTypeSchemaSnapshot,
    location: { fieldPath: string; locale: string | null },
  ) => void,
  fieldPath: string,
  locale: string | null,
): void {
  if (field.fieldType === 'structured_text') {
    if (!isObject(value) || !isObject(value.document)) return;
    walkBlocksInStructuredTextNode(
      value.document,
      schema,
      visit,
      fieldPath,
      locale,
    );
    return;
  }

  if (field.fieldType === 'rich_text' || field.fieldType === 'single_block') {
    walkBlocksInValue(value, schema, visit, fieldPath, locale);
  }
}

function walkBlocksInStructuredTextNode(
  value: JsonValue,
  schema: SchemaSnapshot,
  visit: (
    block: JsonObject & { id: string },
    blockType: ItemTypeSchemaSnapshot,
    location: { fieldPath: string; locale: string | null },
  ) => void,
  fieldPath: string,
  locale: string | null,
): void {
  if (!isStructuredTextNode(value)) return;

  if (
    (value.type === 'block' || value.type === 'inlineBlock') &&
    isObject(value.item) &&
    isNestedBlock(value.item)
  ) {
    const itemType = findItemType(schema, nestedBlockTypeId(value.item));
    visit(value.item, itemType, { fieldPath, locale });
    walkFields(
      blockFields(value.item),
      itemType,
      schema,
      visit,
      `${fieldPath}.block:${value.item.id}`,
    );
  }

  if (Array.isArray(value.children)) {
    value.children.forEach((child) =>
      walkBlocksInStructuredTextNode(child, schema, visit, fieldPath, locale),
    );
  }
}

function walkBlocksInValue(
  value: JsonValue,
  schema: SchemaSnapshot,
  visit: (
    block: JsonObject & { id: string },
    blockType: ItemTypeSchemaSnapshot,
    location: { fieldPath: string; locale: string | null },
  ) => void,
  fieldPath: string,
  locale: string | null,
): void {
  if (Array.isArray(value)) {
    value.forEach((child) =>
      walkBlocksInValue(child, schema, visit, fieldPath, locale),
    );
    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (isNestedBlock(value)) {
    const itemType = findItemType(schema, nestedBlockTypeId(value));
    visit(value, itemType, { fieldPath, locale });
    walkFields(
      blockFields(value),
      itemType,
      schema,
      visit,
      `${fieldPath}.block:${value.id}`,
    );
    return;
  }

  Object.values(value).forEach((child) =>
    walkBlocksInValue(child, schema, visit, fieldPath, locale),
  );
}

function blockFields(block: JsonObject): JsonObject {
  if (isObject(block.attributes)) {
    return block.attributes;
  }

  const reserved = new Set([
    'id',
    'type',
    'item_type',
    '__itemTypeId',
    'meta',
    'creator',
  ]);

  return Object.fromEntries(
    Object.entries(block).filter(([key]) => !reserved.has(key)),
  );
}

function isNestedBlock(
  value: JsonObject,
): value is JsonObject & { id: string } {
  return (
    value.type === 'item' &&
    typeof value.id === 'string' &&
    nestedBlockTypeId(value).length > 0
  );
}

function isStructuredTextNode(value: JsonValue): value is JsonObject {
  return isObject(value) && typeof value.type === 'string' && value.type !== '';
}

function nestedBlockTypeId(value: JsonObject): string {
  if (isObject(value.item_type) && typeof value.item_type.id === 'string') {
    return value.item_type.id;
  }

  if (
    isObject(value.relationships) &&
    isObject(value.relationships.item_type) &&
    isObject(value.relationships.item_type.data) &&
    typeof value.relationships.item_type.data.id === 'string'
  ) {
    return value.relationships.item_type.data.id;
  }

  return typeof value.__itemTypeId === 'string' ? value.__itemTypeId : '';
}

function uploadIdFromValue(value: JsonValue): string | null {
  if (typeof value === 'string') return value;

  return isObject(value) && typeof value.upload_id === 'string'
    ? value.upload_id
    : null;
}

function findItemType(
  schema: SchemaSnapshot,
  itemTypeId: string,
): ItemTypeSchemaSnapshot {
  const itemType = schema.itemTypes.find(({ id }) => id === itemTypeId);

  if (!itemType) {
    throw new ContentDiffError(
      'INCOMPATIBLE_SCHEMA',
      `Content refers to item type ${itemTypeId}, which is absent from the scoped schema.`,
    );
  }

  return itemType;
}

function recordAllowsInvalidDraftShell(
  record: RecordSnapshot | undefined,
  schema: SchemaSnapshot,
): boolean {
  if (!record) return false;

  const itemType = schema.itemTypes.find(({ id }) => id === record.itemTypeId);

  return Boolean(
    itemType &&
      !itemType.modularBlock &&
      itemType.draftModeActive &&
      itemType.draftSavingActive,
  );
}

function ownershipLocationKey(ownership: BlockOwnership): string {
  return [
    ownership.topRecordId,
    ownership.itemTypeId,
    ownership.fieldPath,
    ownership.locale ?? '',
  ].join(':');
}

function compareOwnership(left: BlockOwnership, right: BlockOwnership): number {
  return (
    ownershipLocationKey(left).localeCompare(ownershipLocationKey(right)) ||
    left.version.localeCompare(right.version)
  );
}

function hasRequiredValidator(field: FieldSchemaSnapshot): boolean {
  const validators = field.validators;

  if ('required' in validators) {
    return true;
  }

  const minimum =
    field.fieldType === 'structured_text' ? validators.length : validators.size;

  return (
    isObject(minimum) &&
    ((typeof minimum.min === 'number' && minimum.min > 0) ||
      (typeof minimum.eq === 'number' && minimum.eq > 0))
  );
}

function hasUniqueValidator(field: FieldSchemaSnapshot): boolean {
  return 'unique' in field.validators;
}

function currentUniqueClaimVersions(
  record: RecordSnapshot,
  target: ContentSnapshot,
): Array<{
  kind: 'current' | 'create-seed' | 'published-stage';
  version: RecordVersionSnapshot;
}> {
  const baseline = target.records[record.id];
  const result: Array<{
    kind: 'current' | 'create-seed' | 'published-stage';
    version: RecordVersionSnapshot;
  }> = [{ kind: 'current', version: record.current }];

  if (!baseline && record.published) {
    result.push({ kind: 'create-seed', version: record.published });
  } else if (
    baseline &&
    record.published &&
    record.published.hash !== baseline.published?.hash
  ) {
    result.push({ kind: 'published-stage', version: record.published });
  }

  return result;
}

function uniqueClaimantSets(
  claims: readonly {
    recordId: string;
    version: RecordVersionSnapshot;
  }[],
  field: FieldSchemaSnapshot,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  for (const { recordId, version } of [...claims].sort((left, right) =>
    left.recordId.localeCompare(right.recordId),
  )) {
    for (const [path, value] of uniqueValues(
      version.fields[field.apiKey],
      field,
    )) {
      const key = `${path}:${semanticHash(value)}`;
      const claimants = result.get(key) ?? new Set<string>();
      claimants.add(recordId);
      result.set(key, claimants);
    }
  }

  return result;
}

function sameClaimants(
  left: ReadonlySet<string> | undefined,
  right: ReadonlySet<string> | undefined,
): boolean {
  if (!left || !right) return left === right;

  return (
    left.size === right.size &&
    [...left].every((recordId) => right.has(recordId))
  );
}

function ambiguousUniqueOwnersError(
  recordId: string,
  fieldApiKey: string,
  owners: ReadonlySet<string>,
  published: boolean,
): ContentDiffError {
  const blockingRecordIds = [...owners].sort();

  return new ContentDiffError(
    'UNSUPPORTED_CONTENT_STATE',
    `Record ${recordId} needs a${
      published ? ' published' : ''
    } unique value with multiple destination claimants (${blockingRecordIds.join(
      ', ',
    )}); unequal claimant sets cannot be ordered safely.`,
    {
      recordId,
      blockingRecordIds,
      field: fieldApiKey,
    },
  );
}

function uniqueValues(
  value: JsonValue | undefined,
  field: FieldSchemaSnapshot,
): Array<[string, JsonValue]> {
  if (value === undefined || value === null || uniqueValueIsBlank(value)) {
    return [];
  }

  if (field.localized && isObject(value)) {
    return Object.entries(value)
      .filter(([, localized]) => !uniqueValueIsBlank(localized))
      .map(([locale, localized]) => [locale, localized]);
  }

  return [['value', value]];
}

function uniqueValueIsBlank(value: JsonValue): boolean {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

function deduplicateReferences(
  references: readonly ReferenceDependency[],
): ReferenceDependency[] {
  return [
    ...new Map(
      references.map((reference) => [
        [
          reference.fromRecordId,
          reference.toRecordId,
          reference.path,
          String(reference.required),
        ].join('\0'),
        reference,
      ]),
    ).values(),
  ].sort(
    (left, right) =>
      left.fromRecordId.localeCompare(right.fromRecordId) ||
      left.toRecordId.localeCompare(right.toRecordId) ||
      left.path.localeCompare(right.path),
  );
}

function referenceKey(reference: ReferenceDependency): string {
  return [
    reference.fromRecordId,
    reference.toRecordId,
    reference.path,
    String(reference.required),
  ].join('\0');
}

function dependencyGraphFor(
  recordIds: Iterable<string>,
  references: readonly ReferenceDependency[],
): Record<string, string[]> {
  const ids = [...recordIds].sort();

  return Object.fromEntries(
    ids.map((recordId) => [
      recordId,
      [
        ...new Set(
          references
            .filter(({ fromRecordId }) => fromRecordId === recordId)
            .map(({ toRecordId }) => toRecordId),
        ),
      ].sort(),
    ]),
  );
}

function referenceGraph(
  references: readonly ReferenceDependency[],
): Record<string, string[]> {
  return Object.fromEntries(
    [
      ...new Set(
        references.flatMap(({ fromRecordId, toRecordId }) => [
          fromRecordId,
          toRecordId,
        ]),
      ),
    ]
      .sort()
      .map((recordId) => [
        recordId,
        [
          ...new Set(
            references
              .filter(({ fromRecordId }) => fromRecordId === recordId)
              .map(({ toRecordId }) => toRecordId),
          ),
        ].sort(),
      ]),
  );
}

function stronglyConnectedComponents(
  dependencies: Record<string, string[]>,
): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];

  const visit = (node: string): void => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of dependencies[node] ?? []) {
      if (!(dependency in dependencies)) continue;

      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, indices.get(dependency)!),
        );
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component: string[] = [];
      let member: string;

      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);

      result.push(component.sort());
    }
  };

  Object.keys(dependencies)
    .sort()
    .forEach((node) => {
      if (!indices.has(node)) visit(node);
    });

  return result;
}

function graphHasCycle(dependencies: Record<string, string[]>): boolean {
  const components = stronglyConnectedComponents(dependencies);

  return components.some(
    (component) =>
      component.length > 1 ||
      (dependencies[component[0]] ?? []).includes(component[0]),
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
