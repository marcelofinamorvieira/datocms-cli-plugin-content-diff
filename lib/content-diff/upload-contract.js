"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadFilenameExtension = uploadFilenameExtension;
exports.uploadBasenameFromFilename = uploadBasenameFromFilename;
exports.compareUploadChanges = compareUploadChanges;
exports.uploadManualMetadataChanged = uploadManualMetadataChanged;
exports.isUploadRequestFilenameFixedPoint = isUploadRequestFilenameFixedPoint;
exports.uploadPlanRequiresFilenameRequest = uploadPlanRequiresFilenameRequest;
exports.uploadPlanRequiresBinaryTransfer = uploadPlanRequiresBinaryTransfer;
exports.expectedUploadPlanChanges = expectedUploadPlanChanges;
exports.uploadPlanContractError = uploadPlanContractError;
exports.deriveRequiredUploadActions = deriveRequiredUploadActions;
const canonicalize_1 = require("./canonicalize");
const EMPTY_CHANGES = {
    binary: false,
    metadata: false,
    collection: false,
};
const CREATE_CHANGES = {
    binary: true,
    metadata: true,
    collection: true,
};
const UPLOAD_MANUAL_KEYS = [
    'author',
    'collectionId',
    'copyright',
    'defaultFieldMetadata',
    'notes',
    'tags',
];
const UPLOAD_SNAPSHOT_KEYS = [
    'basename',
    'consistency',
    'filename',
    'hash',
    'id',
    'manual',
    'md5',
    'mimeType',
    'size',
    'transport',
];
function uploadFilenameExtension(filename) {
    const finalSlash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
    const finalDot = filename.lastIndexOf('.');
    return finalDot > finalSlash + 1 ? filename.slice(finalDot) : '';
}
function uploadBasenameFromFilename(filename) {
    const finalSlash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
    const finalDot = filename.lastIndexOf('.');
    const stemEnd = finalDot > finalSlash + 1 ? finalDot : filename.length;
    return filename.slice(finalSlash + 1, stemEnd);
}
function compareUploadChanges(desired, baseline) {
    const desiredMetadata = {
        basename: desired.basename,
        filename: desired.filename,
        manual: { ...desired.manual, collectionId: null },
    };
    const baselineMetadata = {
        basename: baseline.basename,
        filename: baseline.filename,
        manual: { ...baseline.manual, collectionId: null },
    };
    return {
        binary: desired.md5 !== baseline.md5 ||
            uploadFilenameExtension(desired.filename) !==
                uploadFilenameExtension(baseline.filename),
        metadata: (0, canonicalize_1.stableStringify)(desiredMetadata) !== (0, canonicalize_1.stableStringify)(baselineMetadata),
        collection: desired.manual.collectionId !== baseline.manual.collectionId,
    };
}
function uploadManualMetadataChanged(baseline, desired) {
    const baselineManual = { ...baseline.manual, collectionId: null };
    const desiredManual = { ...desired.manual, collectionId: null };
    return (0, canonicalize_1.stableStringify)(baselineManual) !== (0, canonicalize_1.stableStringify)(desiredManual);
}
/**
 * Proves that the current UploadRequest filename normalizer will preserve the
 * requested filename byte-for-byte. The API transliterates and lowercases,
 * replaces non `[a-z0-9_-]` bytes with `-`, collapses adjacent separators,
 * and trims separators. Restricting both parts to this ASCII fixed-point
 * language is deliberately fail-closed for Unicode transliteration.
 */
function isUploadRequestFilenameFixedPoint(filename) {
    if (filename.length === 0 ||
        filename.includes('/') ||
        filename.includes('\\') ||
        containsAsciiControl(filename)) {
        return false;
    }
    const extension = uploadFilenameExtension(filename);
    const basename = uploadBasenameFromFilename(filename);
    const fixedPointPart = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
    if (!fixedPointPart.test(basename))
        return false;
    if (extension && !fixedPointPart.test(extension.slice(1)))
        return false;
    return `${basename}${extension}` === filename;
}
function uploadPlanRequiresFilenameRequest(upload) {
    if (upload.action === 'create')
        return true;
    if (upload.action !== 'update' || !upload.baseline || !upload.desired) {
        return false;
    }
    const changes = compareUploadChanges(upload.desired, upload.baseline);
    return (changes.binary ||
        upload.baseline.basename !== upload.desired.basename ||
        upload.baseline.filename !== upload.desired.filename);
}
function uploadPlanRequiresBinaryTransfer(upload) {
    if (upload.action === 'create')
        return true;
    return (upload.action === 'update' &&
        Boolean(upload.baseline &&
            upload.desired &&
            compareUploadChanges(upload.desired, upload.baseline).binary));
}
function expectedUploadPlanChanges(upload) {
    if (upload.action === 'create')
        return CREATE_CHANGES;
    if (upload.action === 'delete' || upload.action === 'noop') {
        return EMPTY_CHANGES;
    }
    if (upload.action === 'update' && upload.baseline && upload.desired) {
        return compareUploadChanges(upload.desired, upload.baseline);
    }
    return null;
}
function uploadPlanContractError(upload, schema) {
    const { action, baseline, desired } = upload;
    if (!['create', 'update', 'delete', 'noop'].includes(action)) {
        return 'action is invalid';
    }
    if (action === 'create' && !(0, canonicalize_1.isPortableDatoId)(upload.id)) {
        return 'create ID is not a portable DatoCMS ID';
    }
    if (baseline && baseline.id !== upload.id) {
        return 'baseline ID does not match the plan ID';
    }
    if (desired && desired.id !== upload.id) {
        return 'desired ID does not match the plan ID';
    }
    if ((action === 'create' &&
        (baseline !== null || !desired || upload.expectedTargetHash !== null)) ||
        (action === 'update' &&
            (!baseline || !desired || upload.expectedTargetHash !== baseline.hash)) ||
        (action === 'delete' &&
            (!baseline ||
                desired !== null ||
                upload.expectedTargetHash !== baseline.hash)) ||
        (action === 'noop' &&
            (!baseline ||
                !desired ||
                baseline.hash !== desired.hash ||
                upload.expectedTargetHash !== baseline.hash))) {
        return `action ${action} is inconsistent with baseline, desired, or expectedTargetHash`;
    }
    for (const [label, snapshot] of [
        ['baseline', baseline],
        ['desired', desired],
    ]) {
        if (snapshot &&
            ((0, canonicalize_1.stableStringify)(Object.keys(snapshot).sort()) !==
                (0, canonicalize_1.stableStringify)(UPLOAD_SNAPSHOT_KEYS) ||
                typeof snapshot.id !== 'string' ||
                snapshot.id.length === 0 ||
                typeof snapshot.md5 !== 'string' ||
                !/^[a-f0-9]{32}$/.test(snapshot.md5) ||
                typeof snapshot.basename !== 'string' ||
                snapshot.basename.length === 0 ||
                typeof snapshot.filename !== 'string' ||
                snapshot.filename.length === 0 ||
                typeof snapshot.hash !== 'string' ||
                !Number.isSafeInteger(snapshot.size) ||
                snapshot.size < 0 ||
                (snapshot.mimeType !== null && typeof snapshot.mimeType !== 'string') ||
                uploadTransportContractError(snapshot.transport, false) !== null ||
                uploadConsistencyContractError(snapshot.consistency) !== null ||
                uploadManualContractError(snapshot, schema, false) !== null)) {
            return `${label} snapshot is malformed`;
        }
        if (snapshot &&
            snapshot.basename !== uploadBasenameFromFilename(snapshot.filename)) {
            return `${label} basename does not match its filename stem`;
        }
        if (snapshot &&
            snapshot.hash !==
                (0, canonicalize_1.semanticHash)({
                    id: snapshot.id,
                    md5: snapshot.md5,
                    basename: snapshot.basename,
                    filename: snapshot.filename,
                    manual: snapshot.manual,
                })) {
            return `${label} semantic hash does not match its upload state`;
        }
    }
    if (desired && uploadPlanRequiresDefaultFieldMetadataWrite(upload)) {
        const metadataError = uploadDefaultFieldMetadataContractError(desired.manual.defaultFieldMetadata, schema, desired, true);
        if (metadataError) {
            return `desired defaultFieldMetadata is not safely writable: ${metadataError}`;
        }
    }
    const expectedChanges = expectedUploadPlanChanges(upload);
    if (!expectedChanges ||
        (0, canonicalize_1.stableStringify)(upload.changes) !== (0, canonicalize_1.stableStringify)(expectedChanges)) {
        return 'changes do not match the exact baseline/desired deltas';
    }
    if (action === 'update' && !Object.values(expectedChanges).some(Boolean)) {
        return 'update action has no baseline/desired delta';
    }
    if (desired &&
        uploadPlanRequiresBinaryTransfer(upload) &&
        uploadTransportContractError(desired.transport, true) !== null) {
        return 'desired binary transport is not an exact HTTP(S) or bundled source contract';
    }
    if (desired &&
        uploadPlanRequiresFilenameRequest(upload) &&
        !isUploadRequestFilenameFixedPoint(desired.filename)) {
        return 'desired filename is not a byte-stable UploadRequest normalization fixed point';
    }
    return null;
}
function uploadPlanRequiresDefaultFieldMetadataWrite(upload) {
    if (upload.action === 'create')
        return true;
    return (upload.action === 'update' &&
        Boolean(upload.baseline &&
            upload.desired &&
            (0, canonicalize_1.stableStringify)(upload.baseline.manual.defaultFieldMetadata) !==
                (0, canonicalize_1.stableStringify)(upload.desired.manual.defaultFieldMetadata)));
}
function uploadTransportContractError(value, requireUsableSource) {
    if (!isPlainJsonObject(value))
        return 'transport must be an object';
    if ((0, canonicalize_1.stableStringify)(Object.keys(value).sort()) !==
        (0, canonicalize_1.stableStringify)(['bundledPath', 'sha256', 'sourceUrl'])) {
        return 'transport keys are not exact';
    }
    const sourceUrl = value.sourceUrl;
    const bundledPath = value.bundledPath;
    const sha256 = value.sha256;
    if (typeof sourceUrl !== 'string')
        return 'sourceUrl is not a string';
    if (bundledPath !== null && typeof bundledPath !== 'string') {
        return 'bundledPath is not string|null';
    }
    if (sha256 !== null && typeof sha256 !== 'string') {
        return 'sha256 is not string|null';
    }
    const bundled = typeof bundledPath === 'string' &&
        bundledPath.length > 0 &&
        !bundledPath.startsWith('/') &&
        !/^[a-z]:/i.test(bundledPath) &&
        !bundledPath.includes('\\') &&
        !containsAsciiControl(bundledPath) &&
        !bundledPath
            .split('/')
            .some((part) => part === '' || part === '.' || part === '..') &&
        typeof sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(sha256);
    if ((bundledPath === null) !== (sha256 === null)) {
        return 'bundledPath and sha256 must be present together';
    }
    if (bundled)
        return null;
    if (bundledPath !== null || sha256 !== null) {
        return 'bundled transport is malformed';
    }
    if (!requireUsableSource)
        return null;
    return isAbsoluteHttpUrl(sourceUrl) ? null : 'sourceUrl is invalid';
}
function uploadConsistencyContractError(value) {
    if (!isPlainJsonObject(value))
        return 'consistency must be an object';
    if ((0, canonicalize_1.stableStringify)(Object.keys(value).sort()) !==
        (0, canonicalize_1.stableStringify)(['antivirusStatus', 'updatedAt'])) {
        return 'consistency keys are not exact';
    }
    if (value.updatedAt !== null && typeof value.updatedAt !== 'string') {
        return 'updatedAt is not string|null';
    }
    if (!['clean', 'skipped'].includes(String(value.antivirusStatus))) {
        return 'antivirusStatus is not terminal';
    }
    return null;
}
function uploadManualContractError(snapshot, schema, requireWritableMetadata) {
    const value = snapshot.manual;
    if (!isPlainJsonObject(value))
        return 'manual metadata must be an object';
    if ((0, canonicalize_1.stableStringify)(Object.keys(value).sort()) !==
        (0, canonicalize_1.stableStringify)(UPLOAD_MANUAL_KEYS)) {
        return 'manual metadata keys are not exact';
    }
    const manual = value;
    for (const key of ['author', 'copyright', 'notes']) {
        if (manual[key] !== null && typeof manual[key] !== 'string') {
            return `${key} is not string|null`;
        }
        if (typeof manual[key] === 'string' &&
            (isRubyBlank(manual[key]) || manual[key].includes('\u0000'))) {
            return `${key} is blank or contains NUL and cannot round-trip`;
        }
    }
    if (manual.collectionId !== null &&
        (typeof manual.collectionId !== 'string' ||
            manual.collectionId.length === 0)) {
        return 'collectionId is not string|null';
    }
    const metadataError = uploadDefaultFieldMetadataContractError(manual.defaultFieldMetadata, schema, snapshot, requireWritableMetadata);
    if (metadataError) {
        return metadataError;
    }
    if (!Array.isArray(manual.tags) ||
        manual.tags.some((tag) => typeof tag !== 'string' ||
            tag.length === 0 ||
            containsAsciiControl(tag) ||
            tag !== rubySquish(tag).toLowerCase()) ||
        (0, canonicalize_1.stableStringify)(manual.tags) !==
            (0, canonicalize_1.stableStringify)([...new Set(manual.tags)].sort())) {
        return 'tags are not sorted unique strings';
    }
    return null;
}
function uploadDefaultFieldMetadataContractError(value, schema, snapshot, requireWritable) {
    if (!isPlainJsonObject(value)) {
        return 'defaultFieldMetadata is not a plain JSON object';
    }
    if (containsJsonNullByte(value)) {
        return 'defaultFieldMetadata contains a NUL byte that cannot be stored';
    }
    const locales = schema.locales;
    const localeKeys = [...locales].sort();
    if (schema.environmentSemantics.nonLocalizedFocalPoints) {
        if (!hasExactKeys(value, [
            'alt',
            'custom_data',
            'focal_point',
            'poster_time',
            'title',
        ])) {
            return 'defaultFieldMetadata field-keyed shape is not exact';
        }
        for (const key of ['alt', 'title']) {
            const localized = value[key];
            if (!isPlainJsonObject(localized) ||
                !hasAllowedLocaleKeys(localized, localeKeys, requireWritable)) {
                return `defaultFieldMetadata.${key} locales are not ${requireWritable ? 'complete' : 'a canonical subset'}`;
            }
            if (Object.values(localized).some((entry) => entry !== null &&
                (typeof entry !== 'string' || !isRubyStripFixedPoint(entry)))) {
                return `defaultFieldMetadata.${key} values are not canonical`;
            }
        }
        const customData = value.custom_data;
        if (!isPlainJsonObject(customData) ||
            !hasAllowedLocaleKeys(customData, localeKeys, requireWritable)) {
            return `defaultFieldMetadata.custom_data locales are not ${requireWritable ? 'complete' : 'a canonical subset'}`;
        }
        if (Object.values(customData).some((entry) => !isPlainJsonObject(entry) || !isJsonValue(entry))) {
            return 'defaultFieldMetadata.custom_data values are not JSON objects';
        }
        const focalPointError = uploadFocalPointContractError(value.focal_point, snapshot, requireWritable);
        if (focalPointError)
            return focalPointError;
        return uploadPosterTimeContractError(value.poster_time);
    }
    if (!hasAllowedLocaleKeys(value, localeKeys, requireWritable)) {
        return `defaultFieldMetadata legacy locale set is not ${requireWritable ? 'complete' : 'a canonical subset'}`;
    }
    let firstFocalPoint;
    let firstPosterTime;
    const presentLocales = Object.keys(value).sort();
    for (const [index, locale] of presentLocales.entries()) {
        const entry = value[locale];
        if (!isPlainJsonObject(entry) ||
            !hasExactKeys(entry, [
                'alt',
                'custom_data',
                'focal_point',
                'poster_time',
                'title',
            ])) {
            return `defaultFieldMetadata.${locale} shape is not exact`;
        }
        for (const key of ['alt', 'title']) {
            if (entry[key] !== null &&
                (typeof entry[key] !== 'string' ||
                    !isRubyStripFixedPoint(entry[key]))) {
                return `defaultFieldMetadata.${locale}.${key} is not canonical`;
            }
        }
        if (!isPlainJsonObject(entry.custom_data) ||
            !isJsonValue(entry.custom_data)) {
            return `defaultFieldMetadata.${locale}.custom_data is not a JSON object`;
        }
        const focalPointError = uploadFocalPointContractError(entry.focal_point, snapshot, requireWritable);
        if (focalPointError)
            return focalPointError;
        const posterTimeError = uploadPosterTimeContractError(entry.poster_time);
        if (posterTimeError)
            return posterTimeError;
        if (index === 0) {
            firstFocalPoint = entry.focal_point;
            firstPosterTime = entry.poster_time;
        }
        else if ((0, canonicalize_1.stableStringify)(entry.focal_point) !== (0, canonicalize_1.stableStringify)(firstFocalPoint) ||
            (0, canonicalize_1.stableStringify)(entry.poster_time) !== (0, canonicalize_1.stableStringify)(firstPosterTime)) {
            return 'defaultFieldMetadata legacy focal_point/poster_time values are not uniform';
        }
    }
    return null;
}
function uploadFocalPointContractError(value, snapshot, requireWritable) {
    if (value === null)
        return null;
    if (!isPlainJsonObject(value) || !hasExactKeys(value, ['x', 'y'])) {
        return 'defaultFieldMetadata focal_point is not exact';
    }
    for (const coordinate of [value.x, value.y]) {
        if (typeof coordinate !== 'number' ||
            !Number.isFinite(coordinate) ||
            coordinate < 0 ||
            coordinate > 1 ||
            Math.round(coordinate * 100) / 100 !== coordinate) {
            return 'defaultFieldMetadata focal_point coordinates are not canonical';
        }
    }
    const imgixExtensions = new Set([
        '.ai',
        '.avif',
        '.bmp',
        '.gif',
        '.heic',
        '.ico',
        '.icns',
        '.jpg',
        '.jpeg',
        '.pct',
        '.png',
        '.psd',
        '.tif',
        '.tiff',
        '.webp',
    ]);
    if (requireWritable &&
        !imgixExtensions.has(uploadFilenameExtension(snapshot.filename).toLowerCase())) {
        return 'defaultFieldMetadata focal_point is unsupported for this upload format';
    }
    return null;
}
function hasAllowedLocaleKeys(value, locales, requireComplete) {
    const keys = Object.keys(value).sort();
    return requireComplete
        ? (0, canonicalize_1.stableStringify)(keys) === (0, canonicalize_1.stableStringify)(locales)
        : keys.every((key) => locales.includes(key));
}
function uploadPosterTimeContractError(value) {
    if (value === null)
        return null;
    if (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        Math.round(value * 1000) / 1000 !== value) {
        return 'defaultFieldMetadata poster_time is not canonical';
    }
    return null;
}
function hasExactKeys(value, keys) {
    return (0, canonicalize_1.stableStringify)(Object.keys(value).sort()) === (0, canonicalize_1.stableStringify)(keys);
}
function isRubyStripFixedPoint(value) {
    return rubyStrip(value) === value;
}
function isRubyBlank(value) {
    return /^\p{White_Space}*$/u.test(value);
}
function rubySquish(value) {
    return rubyStrip(value.replace(/\p{White_Space}+/gu, ' '));
}
function rubyStrip(value) {
    const isStrippedByte = (code) => code === 0 || (code >= 9 && code <= 13) || code === 32;
    let start = 0;
    let end = value.length;
    while (start < end && isStrippedByte(value.charCodeAt(start)))
        start += 1;
    while (end > start && isStrippedByte(value.charCodeAt(end - 1)))
        end -= 1;
    return value.slice(start, end);
}
function containsJsonNullByte(value) {
    if (typeof value === 'string')
        return value.includes('\u0000');
    if (Array.isArray(value))
        return value.some(containsJsonNullByte);
    if (!isPlainJsonObject(value))
        return false;
    return Object.entries(value).some(([key, child]) => key.includes('\u0000') || containsJsonNullByte(child));
}
function containsAsciiControl(value) {
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint <= 0x1f || codePoint === 0x7f)
            return true;
    }
    return false;
}
function isAbsoluteHttpUrl(value) {
    if (!/^https?:\/\//i.test(value))
        return false;
    try {
        const parsed = new URL(value);
        return ((parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            parsed.hostname.length > 0);
    }
    catch {
        return false;
    }
}
function isPlainJsonObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function isJsonValue(value) {
    if (value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number')
        return Number.isFinite(value);
    if (Array.isArray(value))
        return value.every(isJsonValue);
    if (!isPlainJsonObject(value))
        return false;
    return Object.values(value).every(isJsonValue);
}
function deriveRequiredUploadActions(uploadPlans) {
    const actions = new Set(['read']);
    for (const upload of uploadPlans) {
        if (upload.action === 'create')
            actions.add('create');
        if (upload.action === 'delete')
            actions.add('delete');
        if (upload.action !== 'update' || !upload.baseline || !upload.desired) {
            continue;
        }
        const changes = compareUploadChanges(upload.desired, upload.baseline);
        if (uploadManualMetadataChanged(upload.baseline, upload.desired) ||
            (changes.binary &&
                ['author', 'copyright', 'notes'].some((key) => upload.baseline.manual[key] ===
                    null &&
                    upload.desired.manual[key] ===
                        null))) {
            actions.add('update');
        }
        if (changes.binary ||
            upload.baseline.basename !== upload.desired.basename ||
            upload.baseline.filename !== upload.desired.filename) {
            actions.add('replace_asset');
        }
        if (changes.collection)
            actions.add('move');
    }
    const order = [
        'read',
        'create',
        'update',
        'replace_asset',
        'move',
        'delete',
    ];
    return order.filter((action) => actions.has(action));
}
