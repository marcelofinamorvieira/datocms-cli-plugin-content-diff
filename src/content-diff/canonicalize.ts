import { createHash } from 'node:crypto';
import {
  type NestedBlockIdentity,
  nestedBlockFields,
  nestedBlockIdentity,
} from './structural-content';
import type {
  FieldSchemaSnapshot,
  ItemTypeSchemaSnapshot,
  JsonObject,
  JsonValue,
  RecordScheduleSnapshot,
  RecordSnapshot,
  RecordValiditySnapshot,
  RecordVersionSnapshot,
  SchemaSnapshot,
  UploadCollectionSnapshot,
  UploadSnapshot,
} from './types';
import { ContentDiffError } from './types';

const ITEM_RESERVED_KEYS = new Set([
  '__itemTypeId',
  'created_at',
  'creator',
  'current_version',
  'editor',
  'first_published_at',
  'has_children',
  'id',
  'is_current',
  'is_current_version_valid',
  'is_published',
  'is_published_version_valid',
  'is_valid',
  'item_type',
  'meta',
  'parent_id',
  'position',
  'publication_scheduled_at',
  'published_at',
  'published_from',
  'published_until',
  'relationships',
  'stage',
  'status',
  'type',
  'unpublishing_scheduled_at',
  'updated_at',
]);

export function canonicalizeJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ContentDiffError(
        'UNSUPPORTED_CONTENT_STATE',
        'Content contains a non-finite numeric value.',
      );
    }

    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }

  if (typeof value === 'object' && value) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalizeJson(child)]),
    );
  }

  throw new ContentDiffError(
    'UNSUPPORTED_CONTENT_STATE',
    `Content contains a non-JSON value (${typeof value}).`,
  );
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

export function semanticHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function canonicalTimestamp(value: unknown, path: string): string {
  const text = requiredString(value, path);
  const milliseconds = Date.parse(text);

  if (!Number.isFinite(milliseconds)) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `The CMA response contains an invalid timestamp at ${path}.`,
    );
  }

  return new Date(milliseconds).toISOString();
}

export function sortLocalizedObject(
  value: unknown,
  localeOrder: readonly string[],
): JsonObject {
  if (!isObject(value)) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      'A localized field contains a value that is not an object.',
    );
  }

  const rank = new Map(localeOrder.map((locale, index) => [locale, index]));

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => {
        const leftRank = rank.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = rank.get(right) ?? Number.MAX_SAFE_INTEGER;

        return leftRank - rightRank || left.localeCompare(right);
      })
      .map(([locale, child]) => [locale, canonicalizeJson(child)]),
  );
}

export function isPortableDatoId(id: string): boolean {
  try {
    const bytes = Buffer.from(id, 'base64url');

    return (
      bytes.length === 16 &&
      (bytes[6] & 0xf0) === 0x40 &&
      (bytes[8] & 0xc0) === 0x80 &&
      bytes.toString('base64url') === id
    );
  } catch {
    return false;
  }
}

export function canonicalizeRecord(
  currentInput: unknown,
  publishedInput: unknown | null,
  itemType: ItemTypeSchemaSnapshot,
  schema: SchemaSnapshot,
  schedules: RecordScheduleSnapshot,
): RecordSnapshot {
  const currentItem = assertItem(currentInput);
  const publishedItem =
    publishedInput === null ? null : assertItem(publishedInput);
  const current = canonicalizeRecordVersion(currentItem, itemType, schema);
  const published = publishedItem
    ? canonicalizeRecordVersion(publishedItem, itemType, schema)
    : null;
  const currentMeta = isObject(currentItem.meta) ? currentItem.meta : {};
  const publishedMeta =
    publishedItem && isObject(publishedItem.meta) ? publishedItem.meta : null;
  const validity = canonicalizeRecordValidity(
    String(currentItem.id),
    currentMeta,
    publishedMeta,
  );
  const canonicalSchedules = canonicalizeSchedules(schedules, schema.locales);

  const snapshotState = {
    id: String(currentItem.id),
    itemTypeId: itemType.id,
    current,
    published,
    topology: {
      parentId:
        typeof currentItem.parent_id === 'string'
          ? currentItem.parent_id
          : null,
      position:
        typeof currentItem.position === 'number' ? currentItem.position : null,
    },
    lifecycle: {
      createdAt: canonicalTimestamp(currentMeta.created_at, 'meta.created_at'),
      firstPublishedAt:
        typeof currentMeta.first_published_at === 'string'
          ? canonicalTimestamp(
              currentMeta.first_published_at,
              'meta.first_published_at',
            )
          : null,
    },
    validity,
    stage: typeof currentMeta.stage === 'string' ? currentMeta.stage : null,
    schedules: canonicalSchedules,
  };
  const { validity: _validity, ...semanticState } = snapshotState;

  return {
    ...snapshotState,
    hash: semanticHash({
      ...semanticState,
      // Absolute sibling positions are deliberately not conflict state: a
      // retained destination-only sibling can shift every following record.
      topology: { parentId: snapshotState.topology.parentId },
    }),
    consistency: {
      currentVersion: requiredString(
        currentMeta.current_version,
        'meta.current_version',
      ),
      updatedAt: requiredString(currentMeta.updated_at, 'meta.updated_at'),
      publishedAt:
        typeof currentMeta.published_at === 'string'
          ? currentMeta.published_at
          : null,
      currentValid: validity.current,
      publishedValid: validity.published,
    },
  };
}

function canonicalizeRecordValidity(
  recordId: string,
  currentMeta: Record<string, unknown>,
  publishedMeta: Record<string, unknown> | null,
): RecordValiditySnapshot {
  const current = requiredBoolean(
    currentMeta.is_current_version_valid,
    `record ${recordId} meta.is_current_version_valid`,
  );
  const currentSlice = requiredBoolean(
    currentMeta.is_valid,
    `record ${recordId} current meta.is_valid`,
  );

  if (current !== currentSlice) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `Record ${recordId} reports inconsistent current-version validity flags.`,
      { recordId },
    );
  }

  if (!publishedMeta) {
    return { current, published: null };
  }

  const published = requiredBoolean(
    currentMeta.is_published_version_valid,
    `record ${recordId} meta.is_published_version_valid`,
  );
  const publishedSlice = requiredBoolean(
    publishedMeta.is_valid,
    `record ${recordId} published meta.is_valid`,
  );

  if (published !== publishedSlice) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `Record ${recordId} reports inconsistent published-version validity flags.`,
      { recordId },
    );
  }

  return { current, published };
}

export function canonicalizeRecordVersion(
  input: unknown,
  itemType: ItemTypeSchemaSnapshot,
  schema: SchemaSnapshot,
): RecordVersionSnapshot {
  const item = assertItem(input);
  const attributes = itemAttributes(item);
  const fields: JsonObject = {};

  for (const field of [...itemType.fields].sort(compareFields)) {
    if (!(field.apiKey in attributes)) {
      continue;
    }

    fields[field.apiKey] = canonicalizeFieldValue(
      attributes[field.apiKey],
      field,
      schema,
    );
  }

  // Preserve unknown attributes instead of silently erasing content when the
  // client receives a newer response shape than this generator knows about.
  for (const [key, value] of Object.entries(attributes).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (ITEM_RESERVED_KEYS.has(key) || key in fields || value === undefined) {
      continue;
    }

    fields[key] = canonicalizeJson(value);
  }

  return { fields, hash: semanticHash(fields) };
}

export function canonicalizeUpload(
  input: unknown,
  localeOrder: readonly string[],
): UploadSnapshot {
  if (!isObject(input)) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      'The CMA returned an invalid upload resource.',
    );
  }

  const meta = isObject(input.meta) ? input.meta : {};
  const antivirus = isObject(meta.antivirus) ? meta.antivirus : {};
  const antivirusStatus = antivirus.status;

  if (
    antivirusStatus !== 'pending' &&
    antivirusStatus !== 'clean' &&
    antivirusStatus !== 'infected' &&
    antivirusStatus !== 'failed' &&
    antivirusStatus !== 'skipped'
  ) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `Upload ${String(input.id)} has an unknown antivirus state.`,
    );
  }

  if (
    antivirusStatus === 'pending' ||
    antivirusStatus === 'infected' ||
    antivirusStatus === 'failed'
  ) {
    throw new ContentDiffError(
      'UNHEALTHY_UPLOAD',
      `Upload ${String(
        input.id,
      )} cannot be migrated while antivirus status is ${antivirusStatus}.`,
      { uploadId: String(input.id), antivirusStatus },
    );
  }

  const uploadCollection = isObject(input.upload_collection)
    ? input.upload_collection
    : null;
  const metadata = canonicalizeDefaultFieldMetadata(
    input.default_field_metadata,
    localeOrder,
  );
  const manual = {
    author: typeof input.author === 'string' ? input.author : null,
    copyright: typeof input.copyright === 'string' ? input.copyright : null,
    notes: typeof input.notes === 'string' ? input.notes : null,
    defaultFieldMetadata: metadata,
    tags: Array.isArray(input.tags)
      ? [...new Set(input.tags.map(String))].sort()
      : [],
    collectionId:
      uploadCollection && typeof uploadCollection.id === 'string'
        ? uploadCollection.id
        : null,
  };
  const semanticState = {
    id: requiredString(input.id, 'upload.id'),
    md5: requiredString(input.md5, 'upload.md5'),
    basename: requiredString(input.basename, 'upload.basename'),
    filename: requiredString(input.filename, 'upload.filename'),
    manual,
  };

  return {
    ...semanticState,
    size: requiredNumber(input.size, 'upload.size'),
    mimeType: typeof input.mime_type === 'string' ? input.mime_type : null,
    transport: {
      sourceUrl: requiredString(input.url, 'upload.url'),
      bundledPath: null,
      sha256: null,
    },
    hash: semanticHash(semanticState),
    consistency: {
      updatedAt: typeof input.updated_at === 'string' ? input.updated_at : null,
      antivirusStatus,
    },
  };
}

export function canonicalizeUploadCollection(
  input: unknown,
): UploadCollectionSnapshot {
  if (!isObject(input)) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      'The CMA returned an invalid upload collection resource.',
    );
  }

  const parent = isObject(input.parent) ? input.parent : null;
  const semanticState = {
    id: requiredString(input.id, 'uploadCollection.id'),
    label: requiredString(input.label, 'uploadCollection.label'),
    parentId: parent
      ? requiredString(parent.id, 'uploadCollection.parent.id')
      : null,
    position: requiredNumber(input.position, 'uploadCollection.position'),
  };

  return { ...semanticState, hash: semanticHash(semanticState) };
}

function canonicalizeDefaultFieldMetadata(
  input: unknown,
  localeOrder: readonly string[],
): JsonObject {
  if (!isObject(input)) {
    return {};
  }

  const fieldKeyed = [
    'alt',
    'title',
    'custom_data',
    'focal_point',
    'poster_time',
  ].some((key) => key in input);

  // Preserve the legacy locale-keyed request shape used by projects that have
  // not enabled non-localized focal points. It remains writable by the CMA.
  if (!fieldKeyed) {
    return sortLocalizedObject(input, localeOrder);
  }

  const result: JsonObject = {};

  for (const key of ['alt', 'title', 'custom_data'] as const) {
    if (key in input) {
      result[key] = sortLocalizedObject(input[key], localeOrder);
    }
  }

  for (const key of ['focal_point', 'poster_time'] as const) {
    if (key in input) {
      result[key] = canonicalizeJson(input[key]);
    }
  }

  return result;
}

function canonicalizeFieldValue(
  input: unknown,
  field: FieldSchemaSnapshot,
  schema: SchemaSnapshot,
): JsonValue {
  if (field.localized) {
    if (!isObject(input)) {
      return canonicalizeJson(input);
    }

    const ordered = sortLocalizedObject(input, schema.locales);

    return Object.fromEntries(
      Object.entries(ordered).map(([locale, value]) => [
        locale,
        canonicalizeNonLocalizedFieldValue(value, field, schema),
      ]),
    );
  }

  return canonicalizeNonLocalizedFieldValue(input, field, schema);
}

function canonicalizeNonLocalizedFieldValue(
  input: unknown,
  field: FieldSchemaSnapshot,
  schema: SchemaSnapshot,
): JsonValue {
  if (
    field.fieldType === 'rich_text' ||
    field.fieldType === 'single_block' ||
    field.fieldType === 'structured_text'
  ) {
    return canonicalizeEmbeddedContent(input, schema);
  }

  return canonicalizeJson(input);
}

function canonicalizeEmbeddedContent(
  input: unknown,
  schema: SchemaSnapshot,
): JsonValue {
  if (Array.isArray(input)) {
    return input.map((value) => canonicalizeEmbeddedContent(value, schema));
  }

  if (!isObject(input)) {
    return canonicalizeJson(input);
  }

  const identity = nestedBlockIdentity(input, 'embedded content');
  if (identity) {
    return canonicalizeNestedItem(input, schema, identity);
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, canonicalizeEmbeddedContent(value, schema)]),
  );
}

function canonicalizeNestedItem(
  input: JsonObjectLike,
  schema: SchemaSnapshot,
  identity: NestedBlockIdentity,
): JsonObject {
  const itemTypeId = identity.itemTypeId;
  const itemType = schema.itemTypes.find(({ id }) => id === itemTypeId);

  if (!itemType?.modularBlock) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `Nested item ${String(
        input.id,
      )} refers to unknown block model ${itemTypeId}.`,
    );
  }

  const version = canonicalizeRecordVersion(
    { ...input, attributes: nestedBlockFields(input, 'embedded content') },
    itemType,
    schema,
  );

  return {
    id: identity.id,
    type: 'item',
    relationships: {
      item_type: {
        data: { id: itemTypeId, type: 'item_type' },
      },
    },
    attributes: version.fields,
  };
}

export function canonicalizeSchedules(
  schedules: RecordScheduleSnapshot,
  localeOrder: readonly string[],
): RecordScheduleSnapshot {
  const localeRank = new Map(
    localeOrder.map((locale, index) => [locale, index]),
  );
  const sortLocales = (locales: readonly string[]) =>
    [...new Set(locales)].sort((left, right) => {
      const leftRank = localeRank.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = localeRank.get(right) ?? Number.MAX_SAFE_INTEGER;

      return leftRank - rightRank || left.localeCompare(right);
    });

  return {
    publication: schedules.publication
      ? {
          at: canonicalTimestamp(
            schedules.publication.at,
            'schedule.publication.at',
          ),
          selective: schedules.publication.selective
            ? {
                locales: sortLocales(schedules.publication.selective.locales),
                nonLocalized: schedules.publication.selective.nonLocalized,
              }
            : null,
        }
      : null,
    unpublishing: schedules.unpublishing
      ? {
          at: canonicalTimestamp(
            schedules.unpublishing.at,
            'schedule.unpublishing.at',
          ),
          locales: schedules.unpublishing.locales
            ? sortLocales(schedules.unpublishing.locales)
            : null,
        }
      : null,
  };
}

function itemAttributes(value: JsonObjectLike): JsonObjectLike {
  return isObject(value.attributes) ? value.attributes : value;
}

function assertItem(value: unknown): JsonObjectLike {
  if (!isObject(value) || typeof value.id !== 'string') {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      'The CMA returned an invalid record resource.',
    );
  }

  return value;
}

function compareFields(
  left: FieldSchemaSnapshot,
  right: FieldSchemaSnapshot,
): number {
  return (
    left.position - right.position || left.apiKey.localeCompare(right.apiKey)
  );
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `The CMA response is missing ${path}.`,
    );
  }

  return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `The CMA response is missing ${path}.`,
    );
  }

  return value;
}

function requiredNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContentDiffError(
      'UNSUPPORTED_CONTENT_STATE',
      `The CMA response is missing ${path}.`,
    );
  }

  return value;
}

type JsonObjectLike = Record<string, any>;

function isObject(value: unknown): value is JsonObjectLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
