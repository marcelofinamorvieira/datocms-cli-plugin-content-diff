import { semanticHash, stableStringify } from './canonicalize';
import { nestedBlockFields, nestedBlockIdentity } from './structural-content';
import { ContentDiffError } from './types';
import type {
  DeleteReleaseStep,
  FieldSchemaSnapshot,
  ItemTypeSchemaSnapshot,
  JsonObject,
  JsonValue,
  RecordPlan,
  SchemaSnapshot,
  UniqueReleaseStep,
} from './types';

export type SanitizedHtmlWriteStage =
  | 'create'
  | 'current-restore'
  | 'delete-release'
  | 'position-finalize'
  | 'published-stage'
  | 'tree-reparent'
  | 'unique-release';

export interface SanitizedHtmlWriteRisk {
  recordId: string;
  itemTypeId: string;
  fieldId: string;
  stage: SanitizedHtmlWriteStage;
  path: string;
  locale: string | null;
}

export interface SanitizedHtmlWriteExecution {
  createOrder: readonly string[];
  uniqueReleases: readonly UniqueReleaseStep[];
  deleteReleases: readonly DeleteReleaseStep[];
  deleteOrder: readonly string[];
  publicationSeedOrder: readonly string[];
  publishOrder: readonly string[];
  updateOrder: readonly string[];
  /** Mirrors the runtime's absoluteRecordPositionsReproducible contract. */
  absoluteRecordPositionsReproducible: boolean;
}

/**
 * The CMA uses Ruby Sanitize + Nokogiri HTML5 serialization before CREATE and
 * attribute-bearing UPDATEs. Reproducing those bytes in the generated Node runtime
 * would not be a stable cross-language contract. This deliberately small
 * subset is the only input for which byte identity can be proved without
 * parsing HTML: ordinary text with no markup/entity opener, HTML-significant
 * delimiter, carriage return, C0/C1 control, raw NBSP, surrogate, or Unicode
 * noncharacter.
 */
export function isProvablyCmaSanitizerByteStableText(
  value: JsonValue | undefined,
): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  if (/[<>&\r]/u.test(value)) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x00a0 ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      (codePoint & 0xffff) === 0xfffe ||
      (codePoint & 0xffff) === 0xffff
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Models every CREATE and every UPDATE whose serialized data.attributes is
 * non-empty in execution order. UPDATE field payloads use the same top-field
 * diff as the generated runtime. Reparent and position payloads are also
 * attributes in the CMA client, so their exact topology state machine is
 * projected as well. If no such write occurs, there is no sanitizer risk. If
 * one occurs, the safety proof checks the complete post-write fields: CMA can
 * full-rehydrate omitted fields whenever the current version is invalid or the
 * model is asynchronously validating, and that runtime-only state is not
 * available in a portable plan.
 */
export function findSanitizedHtmlWriteRisks(
  records: readonly RecordPlan[],
  phaseSchema: SchemaSnapshot,
  projectedCreateSeedFields: ReadonlyMap<string, JsonObject>,
  execution: SanitizedHtmlWriteExecution,
): SanitizedHtmlWriteRisk[] {
  const itemTypesById = new Map(
    phaseSchema.itemTypes.map((itemType) => [itemType.id, itemType]),
  );
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const states = new Map<
    string,
    { current: JsonObject; publishedHash: string | null }
  >();
  const topologyStates = new Map<string, TopologyState>();
  const risks: SanitizedHtmlWriteRisk[] = [];
  const publicationSeedIds = new Set(execution.publicationSeedOrder);

  for (const record of records) {
    const itemType = itemTypesById.get(record.itemTypeId);
    if (!itemType) {
      throw unresolvedSanitizerSchemaError(
        record.id,
        record.itemTypeId,
        `record:${record.id}`,
      );
    }
    if (record.action === 'create' && record.desired) {
      const fields = projectedCreateSeedFields.get(record.id);
      if (!fields) {
        throw new ContentDiffError(
          'UNSUPPORTED_CONTENT_STATE',
          `Cannot prove sanitized_html byte stability because projected CREATE fields are missing for record ${record.id}.`,
          { recordId: record.id },
        );
      }
      inspectFields(
        fields,
        itemType,
        itemTypesById,
        record.id,
        'create',
        `record:${record.id}`,
        risks,
      );
      states.set(record.id, {
        current: fields,
        publishedHash:
          !itemType.draftModeActive || publicationSeedIds.has(record.id)
            ? semanticHash(fields)
            : null,
      });
    } else if (record.baseline) {
      states.set(record.id, {
        current: record.baseline.current.fields,
        publishedHash: record.baseline.published?.hash ?? null,
      });
      topologyStates.set(record.id, {
        itemTypeId: record.itemTypeId,
        parentId: record.baseline.topology.parentId,
        position: record.baseline.topology.position,
      });
    }
  }

  for (const record of orderedRecordPlans(
    execution.createOrder,
    records.filter(({ action }) => action === 'create'),
  )) {
    const itemType = itemTypesById.get(record.itemTypeId);
    if (
      !record.desired ||
      !itemType ||
      (!itemType.tree && !itemType.sortable)
    ) {
      continue;
    }
    const position = record.desired.topology.position;
    if (typeof position !== 'number') continue;
    shiftForInsert(
      topologyStates,
      record.itemTypeId,
      record.desired.topology.parentId,
      position,
      record.id,
    );
    topologyStates.set(record.id, {
      itemTypeId: record.itemTypeId,
      parentId: record.desired.topology.parentId,
      position,
    });
  }

  for (const release of execution.uniqueReleases) {
    const record = recordsById.get(release.recordId);
    const itemType = record && itemTypesById.get(record.itemTypeId);
    const state = states.get(release.recordId);
    if (!record || !itemType || !state) {
      throw unresolvedSanitizerSchemaError(
        release.recordId,
        record?.itemTypeId ?? '<unknown>',
        `record:${release.recordId}`,
      );
    }
    const patch = buildProjectedVersionPatch(release.fields, state.current);
    const nextCurrent = applyTopFieldValues(state.current, release.fields);
    if (Object.keys(patch).length > 0) {
      inspectFields(
        nextCurrent,
        itemType,
        itemTypesById,
        record.id,
        'unique-release',
        `record:${record.id}`,
        risks,
      );
    }
    state.current = nextCurrent;
    if (!itemType.draftModeActive && Object.keys(patch).length > 0) {
      state.publishedHash = semanticHash(state.current);
    }
  }

  for (const record of parentFirst(
    records.filter(
      ({ action, desired }) => desired !== null && action !== 'noop',
    ),
  )) {
    const itemType = itemTypesById.get(record.itemTypeId);
    const state = states.get(record.id);
    const topology = topologyStates.get(record.id);
    if (
      !record.desired ||
      !itemType?.tree ||
      !state ||
      !topology ||
      topology.parentId === record.desired.topology.parentId
    ) {
      continue;
    }
    inspectFields(
      state.current,
      itemType,
      itemTypesById,
      record.id,
      'tree-reparent',
      `record:${record.id}`,
      risks,
    );
    topology.parentId = record.desired.topology.parentId;
    topology.position = execution.absoluteRecordPositionsReproducible
      ? nextKnownPosition(
          topologyStates,
          record.itemTypeId,
          topology.parentId,
          record.id,
        )
      : 'unknown-until-positioned';
  }

  for (const recordId of execution.publishOrder) {
    const record = recordsById.get(recordId);
    if (
      !record?.desired ||
      record.action === 'noop' ||
      record.action === 'delete'
    )
      continue;
    const itemType = itemTypesById.get(record.itemTypeId);
    const state = states.get(record.id);
    if (!itemType || !state) {
      throw unresolvedSanitizerSchemaError(
        record.id,
        record.itemTypeId,
        `record:${record.id}`,
      );
    }
    if (record.desired.published) {
      if (state.publishedHash !== record.desired.published.hash) {
        const patch = buildProjectedVersionPatch(
          record.desired.published.fields,
          state.current,
        );
        const nextCurrent = applyTopFieldValues(
          state.current,
          record.desired.published.fields,
        );
        if (Object.keys(patch).length > 0) {
          inspectFields(
            nextCurrent,
            itemType,
            itemTypesById,
            record.id,
            'published-stage',
            `record:${record.id}`,
            risks,
          );
        }
        state.current = nextCurrent;
        state.publishedHash = record.desired.published.hash;
      }
    } else {
      state.publishedHash = null;
    }
  }

  for (const record of orderedRecordPlans(execution.updateOrder, records)) {
    if (
      !record.desired ||
      record.action === 'noop' ||
      record.action === 'delete'
    )
      continue;
    const itemType = itemTypesById.get(record.itemTypeId);
    const state = states.get(record.id);
    if (!itemType || !state) {
      throw unresolvedSanitizerSchemaError(
        record.id,
        record.itemTypeId,
        `record:${record.id}`,
      );
    }
    const patch = buildProjectedVersionPatch(
      record.desired.current.fields,
      state.current,
    );
    const nextCurrent = applyTopFieldValues(
      state.current,
      record.desired.current.fields,
    );
    if (Object.keys(patch).length > 0) {
      inspectFields(
        nextCurrent,
        itemType,
        itemTypesById,
        record.id,
        'current-restore',
        `record:${record.id}`,
        risks,
      );
    }
    state.current = nextCurrent;
  }

  for (const release of execution.deleteReleases) {
    const record = recordsById.get(release.recordId);
    const itemType = record && itemTypesById.get(record.itemTypeId);
    const state = states.get(release.recordId);
    if (!record || !itemType || !state) {
      throw unresolvedSanitizerSchemaError(
        release.recordId,
        record?.itemTypeId ?? '<unknown>',
        `record:${release.recordId}`,
      );
    }
    const patch = buildProjectedVersionPatch(release.fields, state.current);
    const nextCurrent = applyTopFieldValues(state.current, release.fields);
    if (Object.keys(patch).length > 0) {
      inspectFields(
        nextCurrent,
        itemType,
        itemTypesById,
        record.id,
        'delete-release',
        `record:${record.id}`,
        risks,
      );
    }
    state.current = nextCurrent;
  }

  for (const record of orderedRecordPlans(
    execution.deleteOrder,
    records,
  ).filter(({ action }) => action === 'delete')) {
    const deleted = topologyStates.get(record.id);
    if (!deleted) continue;
    for (const child of topologyStates.values()) {
      if (
        child.itemTypeId === record.itemTypeId &&
        child.parentId === record.id
      ) {
        child.parentId = deleted.parentId;
        child.position = 'unknown-until-positioned';
      }
    }
    topologyStates.delete(record.id);
  }

  const affectedGroups = affectedSiblingGroups(records, itemTypesById);
  const positional = records
    .filter((record) => {
      const itemType = itemTypesById.get(record.itemTypeId);
      return Boolean(
        record.desired &&
          typeof record.desired.topology.position === 'number' &&
          itemType &&
          (itemType.tree || itemType.sortable) &&
          affectedGroups.has(
            siblingGroupKey(
              record.itemTypeId,
              record.desired.topology.parentId,
            ),
          ),
      );
    })
    .sort(
      (left, right) =>
        left.itemTypeId.localeCompare(right.itemTypeId) ||
        compareNullable(
          left.desired!.topology.parentId,
          right.desired!.topology.parentId,
        ) ||
        left.desired!.topology.position! - right.desired!.topology.position! ||
        left.id.localeCompare(right.id),
    );
  const seenPositionStates = new Set<string>();
  const maximumPositionSteps = 4 * positional.length * positional.length + 1;
  for (let step = 0; step < maximumPositionSteps; step += 1) {
    const signature = topologyStateSignature(topologyStates);
    if (seenPositionStates.has(signature)) break;
    seenPositionStates.add(signature);
    if (
      positionGoalReached(
        positional,
        topologyStates,
        execution.absoluteRecordPositionsReproducible,
      )
    ) {
      break;
    }
    const next = positional.find((record) => {
      const topology = topologyStates.get(record.id);
      return (
        topology && topology.position !== record.desired!.topology.position
      );
    });
    if (!next) break;
    const state = states.get(next.id);
    const itemType = itemTypesById.get(next.itemTypeId);
    if (!state || !itemType) {
      throw unresolvedSanitizerSchemaError(
        next.id,
        next.itemTypeId,
        `record:${next.id}`,
      );
    }
    inspectFields(
      state.current,
      itemType,
      itemTypesById,
      next.id,
      'position-finalize',
      `record:${next.id}`,
      risks,
    );
    moveStatePosition(
      topologyStates,
      next.id,
      next.desired!.topology.position!,
    );
  }

  const stageOrder: SanitizedHtmlWriteStage[] = [
    'create',
    'unique-release',
    'tree-reparent',
    'published-stage',
    'current-restore',
    'delete-release',
    'position-finalize',
  ];
  const uniqueRisks = [
    ...new Map(
      risks.map((risk) => [
        `${risk.recordId}\u0000${risk.stage}\u0000${risk.fieldId}\u0000${risk.path}`,
        risk,
      ]),
    ).values(),
  ];
  return uniqueRisks.sort(
    (left, right) =>
      left.recordId.localeCompare(right.recordId) ||
      stageOrder.indexOf(left.stage) - stageOrder.indexOf(right.stage) ||
      left.fieldId.localeCompare(right.fieldId) ||
      left.path.localeCompare(right.path),
  );
}

interface TopologyState {
  itemTypeId: string;
  parentId: string | null;
  position: number | 'unknown-until-positioned' | null;
}

function orderedRecordPlans(
  order: readonly string[],
  records: readonly RecordPlan[],
): RecordPlan[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const output: RecordPlan[] = [];
  for (const id of order) {
    const record = byId.get(id);
    if (record && !seen.has(id)) {
      output.push(record);
      seen.add(id);
    }
  }
  for (const record of [...records].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (!seen.has(record.id)) output.push(record);
  }
  return output;
}

function parentFirst(records: readonly RecordPlan[]): RecordPlan[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const depthCache = new Map<string, number>();
  const depth = (record: RecordPlan, visiting: ReadonlySet<string>): number => {
    const cached = depthCache.get(record.id);
    if (cached !== undefined) return cached;
    if (visiting.has(record.id)) return 0;
    const next = new Set(visiting);
    next.add(record.id);
    const parentId = record.desired?.topology.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    const result = parent ? depth(parent, next) + 1 : 0;
    depthCache.set(record.id, result);
    return result;
  };
  return [...records].sort(
    (left, right) =>
      depth(left, new Set()) - depth(right, new Set()) ||
      left.id.localeCompare(right.id),
  );
}

function shiftForInsert(
  states: Map<string, TopologyState>,
  itemTypeId: string,
  parentId: string | null,
  position: number,
  excludedId: string,
): void {
  for (const [id, state] of states) {
    if (
      id !== excludedId &&
      state.itemTypeId === itemTypeId &&
      state.parentId === parentId &&
      typeof state.position === 'number' &&
      state.position >= position
    ) {
      state.position += 1;
    }
  }
}

function nextKnownPosition(
  states: ReadonlyMap<string, TopologyState>,
  itemTypeId: string,
  parentId: string | null,
  excludedId: string,
): number {
  let maximum = 0;
  let found = false;
  for (const [id, state] of states) {
    if (
      id !== excludedId &&
      state.itemTypeId === itemTypeId &&
      state.parentId === parentId &&
      typeof state.position === 'number'
    ) {
      found = true;
      maximum = Math.max(maximum, state.position);
    }
  }
  return found ? maximum + 1 : 1;
}

function affectedSiblingGroups(
  records: readonly RecordPlan[],
  itemTypesById: ReadonlyMap<string, ItemTypeSchemaSnapshot>,
): Set<string> {
  const groups = new Set<string>();
  for (const record of records) {
    const itemType = itemTypesById.get(record.itemTypeId);
    if (
      !itemType ||
      (!itemType.tree && !itemType.sortable) ||
      record.action === 'noop'
    ) {
      continue;
    }
    if (
      record.action === 'create' ||
      record.action === 'delete' ||
      record.changes.topology
    ) {
      if (record.baseline) {
        groups.add(
          siblingGroupKey(record.itemTypeId, record.baseline.topology.parentId),
        );
      }
      if (record.desired) {
        groups.add(
          siblingGroupKey(record.itemTypeId, record.desired.topology.parentId),
        );
      }
    }
  }
  return groups;
}

function siblingGroupKey(itemTypeId: string, parentId: string | null): string {
  return `${itemTypeId}\u0000${String(parentId)}`;
}

function topologyStateSignature(
  states: ReadonlyMap<string, TopologyState>,
): string {
  return stableStringify(
    [...states]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, state]) => ({
        id,
        parentId: state.parentId,
        position: state.position,
      })),
  );
}

function positionGoalReached(
  records: readonly RecordPlan[],
  states: ReadonlyMap<string, TopologyState>,
  absolutePositionsReproducible: boolean,
): boolean {
  if (absolutePositionsReproducible) {
    return records.every((record) => {
      const state = states.get(record.id);
      return Boolean(
        state &&
          state.parentId === record.desired!.topology.parentId &&
          state.position === record.desired!.topology.position,
      );
    });
  }

  const groups = new Map<
    string,
    {
      actual: Array<{ id: string; position: number }>;
      desired: Array<{ id: string; position: number }>;
    }
  >();
  for (const record of records) {
    const state = states.get(record.id);
    if (
      !state ||
      state.parentId !== record.desired!.topology.parentId ||
      typeof state.position !== 'number'
    ) {
      return false;
    }
    const key = siblingGroupKey(record.itemTypeId, state.parentId);
    const group = groups.get(key) ?? { actual: [], desired: [] };
    group.actual.push({ id: record.id, position: state.position });
    group.desired.push({
      id: record.id,
      position: record.desired!.topology.position!,
    });
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const compare = (
      left: { id: string; position: number },
      right: { id: string; position: number },
    ) => left.position - right.position || left.id.localeCompare(right.id);
    if (
      stableStringify([...group.actual].sort(compare).map(({ id }) => id)) !==
      stableStringify([...group.desired].sort(compare).map(({ id }) => id))
    ) {
      return false;
    }
  }
  return true;
}

function moveStatePosition(
  states: Map<string, TopologyState>,
  recordId: string,
  desiredPosition: number,
): void {
  const moved = states.get(recordId);
  if (!moved) return;
  const previous = moved.position;
  for (const [id, state] of states) {
    if (
      id === recordId ||
      state.itemTypeId !== moved.itemTypeId ||
      state.parentId !== moved.parentId ||
      typeof state.position !== 'number'
    ) {
      continue;
    }
    if (typeof previous !== 'number') {
      if (state.position >= desiredPosition) state.position += 1;
    } else if (
      previous < desiredPosition &&
      state.position > previous &&
      state.position <= desiredPosition
    ) {
      state.position -= 1;
    } else if (
      previous > desiredPosition &&
      state.position >= desiredPosition &&
      state.position < previous
    ) {
      state.position += 1;
    }
  }
  moved.position = desiredPosition;
}

function compareNullable(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return left.localeCompare(right);
}

function inspectFields(
  fields: JsonObject,
  itemType: ItemTypeSchemaSnapshot,
  itemTypesById: ReadonlyMap<string, ItemTypeSchemaSnapshot>,
  recordId: string,
  stage: SanitizedHtmlWriteStage,
  path: string,
  risks: SanitizedHtmlWriteRisk[],
): void {
  for (const field of itemType.fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, field.apiKey)) continue;
    const value = fields[field.apiKey];
    const fieldPath = `${path}.${field.apiKey}`;

    if (fieldUsesSanitizer(field)) {
      inspectSanitizedTextValue(
        value,
        field,
        recordId,
        itemType.id,
        stage,
        fieldPath,
        risks,
      );
    }

    if (
      field.fieldType === 'rich_text' ||
      field.fieldType === 'single_block' ||
      field.fieldType === 'structured_text'
    ) {
      const inspect = (embeddedValue: JsonValue | undefined, at: string) => {
        if (field.fieldType === 'structured_text') {
          inspectStructuredTextValue(
            embeddedValue,
            itemTypesById,
            recordId,
            stage,
            at,
            risks,
          );
        } else {
          inspectEmbeddedValue(
            embeddedValue,
            itemTypesById,
            recordId,
            stage,
            at,
            risks,
          );
        }
      };
      if (field.localized && isJsonObject(value)) {
        for (const [locale, localizedValue] of Object.entries(value)) {
          inspect(localizedValue, `${fieldPath}.${locale}`);
        }
      } else {
        inspect(value, fieldPath);
      }
    }
  }
}

function inspectStructuredTextValue(
  value: JsonValue | undefined,
  itemTypesById: ReadonlyMap<string, ItemTypeSchemaSnapshot>,
  recordId: string,
  stage: SanitizedHtmlWriteStage,
  path: string,
  risks: SanitizedHtmlWriteRisk[],
): void {
  if (!isJsonObject(value) || !isJsonObject(value.document)) return;
  inspectStructuredTextNode(
    value.document,
    itemTypesById,
    recordId,
    stage,
    `${path}.document`,
    risks,
  );
}

function inspectStructuredTextNode(
  value: JsonValue,
  itemTypesById: ReadonlyMap<string, ItemTypeSchemaSnapshot>,
  recordId: string,
  stage: SanitizedHtmlWriteStage,
  path: string,
  risks: SanitizedHtmlWriteRisk[],
): void {
  if (!isJsonObject(value) || typeof value.type !== 'string') return;
  if (
    (value.type === 'block' || value.type === 'inlineBlock') &&
    Object.prototype.hasOwnProperty.call(value, 'item')
  ) {
    inspectEmbeddedValue(
      value.item,
      itemTypesById,
      recordId,
      stage,
      `${path}.item`,
      risks,
    );
  }
  if (Array.isArray(value.children)) {
    value.children.forEach((child, index) =>
      inspectStructuredTextNode(
        child,
        itemTypesById,
        recordId,
        stage,
        `${path}.children[${index}]`,
        risks,
      ),
    );
  }
}

function inspectSanitizedTextValue(
  value: JsonValue | undefined,
  field: FieldSchemaSnapshot,
  recordId: string,
  itemTypeId: string,
  stage: SanitizedHtmlWriteStage,
  path: string,
  risks: SanitizedHtmlWriteRisk[],
): void {
  if (field.localized && isJsonObject(value)) {
    for (const [locale, localizedValue] of Object.entries(value)) {
      if (!isProvablyLocalizedSanitizerByteStableText(localizedValue)) {
        risks.push({
          recordId,
          itemTypeId,
          fieldId: field.id,
          stage,
          path: `${path}.${locale}`,
          locale,
        });
      }
    }
    return;
  }

  if (!isProvablyCmaSanitizerByteStableText(value)) {
    risks.push({
      recordId,
      itemTypeId,
      fieldId: field.id,
      stage,
      path,
      locale: null,
    });
  }
}

function inspectEmbeddedValue(
  value: JsonValue | undefined,
  itemTypesById: ReadonlyMap<string, ItemTypeSchemaSnapshot>,
  recordId: string,
  stage: SanitizedHtmlWriteStage,
  path: string,
  risks: SanitizedHtmlWriteRisk[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      inspectEmbeddedValue(
        child,
        itemTypesById,
        recordId,
        stage,
        `${path}[${index}]`,
        risks,
      ),
    );
    return;
  }
  if (!isJsonObject(value)) return;

  const identity = nestedBlockIdentity(value, path);
  if (identity) {
    const blockType = itemTypesById.get(identity.itemTypeId);
    if (!blockType?.modularBlock) {
      throw unresolvedSanitizerSchemaError(recordId, identity.itemTypeId, path);
    }
    inspectFields(
      nestedBlockFields(value, path) as JsonObject,
      blockType,
      itemTypesById,
      recordId,
      stage,
      `${path}.block:${identity.id}`,
      risks,
    );
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    inspectEmbeddedValue(
      child,
      itemTypesById,
      recordId,
      stage,
      `${path}.${key}`,
      risks,
    );
  }
}

function buildProjectedVersionPatch(
  desiredFields: JsonObject,
  currentFields: JsonObject,
): JsonObject {
  const existingBlocks = new Map<string, JsonObject>();
  collectNestedBlocks(currentFields, existingBlocks, 'current');
  return Object.fromEntries(
    Object.entries(desiredFields)
      .filter(
        ([key, value]) =>
          stableStringify(value) !== stableStringify(currentFields[key]),
      )
      .map(([key, value]) => [
        key,
        compactNestedValue(value, existingBlocks, `patch.${key}`),
      ]),
  );
}

function compactNestedValue(
  value: JsonValue,
  existingBlocks: ReadonlyMap<string, JsonObject>,
  path: string,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      compactNestedValue(child, existingBlocks, `${path}[${index}]`),
    );
  }
  if (!isJsonObject(value)) return value;
  const identity = nestedBlockIdentity(value, path);
  if (identity) {
    const existing = existingBlocks.get(identity.id);
    if (existing && stableStringify(existing) === stableStringify(value)) {
      return identity.id;
    }
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      compactNestedValue(child, existingBlocks, `${path}.${key}`),
    ]),
  );
}

function collectNestedBlocks(
  value: JsonValue,
  output: Map<string, JsonObject>,
  path: string,
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectNestedBlocks(child, output, `${path}[${index}]`),
    );
    return;
  }
  if (!isJsonObject(value)) return;
  const identity = nestedBlockIdentity(value, path);
  if (identity) output.set(identity.id, value);
  for (const [key, child] of Object.entries(value)) {
    collectNestedBlocks(child, output, `${path}.${key}`);
  }
}

function applyTopFieldValues(
  current: JsonObject,
  fields: JsonObject,
): JsonObject {
  return { ...current, ...fields };
}

function fieldUsesSanitizer(field: FieldSchemaSnapshot): boolean {
  if (field.fieldType !== 'text') return false;
  const validator = field.validators.sanitized_html;
  return (
    isJsonObject(validator) && validator.sanitize_before_validation === true
  );
}

function isProvablyLocalizedSanitizerByteStableText(
  value: JsonValue | undefined,
): boolean {
  return (
    typeof value === 'string' && isProvablyCmaSanitizerByteStableText(value)
  );
}

function unresolvedSanitizerSchemaError(
  recordId: string,
  itemTypeId: string,
  path: string,
): ContentDiffError {
  return new ContentDiffError(
    'UNSUPPORTED_CONTENT_STATE',
    `Cannot prove sanitized_html byte stability because item type ${itemTypeId} at ${path} is absent from the captured traversal schema.`,
    { recordId, itemTypeId, path },
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
