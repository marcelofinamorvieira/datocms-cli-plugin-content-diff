"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUnsupportedFreshNestedBlockUpdates = findUnsupportedFreshNestedBlockUpdates;
const structural_content_1 = require("./structural-content");
/**
 * Models the field-bearing writes performed by runtime phases 5, 7, and 8.
 *
 * CMA's full-validation update path rehydrates every nested object carrying an
 * ID as an already persisted block. An UPDATE therefore cannot introduce a
 * descendant block ID that is absent from the immediately preceding CURRENT
 * version. CREATE may introduce IDs, but any later published/current restore
 * for that same top-level aggregate is subject to the same UPDATE constraint.
 */
function findUnsupportedFreshNestedBlockUpdates(records) {
    var _a, _b;
    const issues = [];
    for (const record of [...records].sort((left, right) => left.id.localeCompare(right.id))) {
        if (!record.desired ||
            record.action === 'delete' ||
            record.action === 'noop') {
            continue;
        }
        if (!record.baseline) {
            // Phase 5 creates the top-level aggregate from its published slice when
            // present, otherwise from CURRENT. Reference-shell projection can change
            // values in this seed, but it preserves every descendant block identity.
            const seed = (_a = record.desired.published) !== null && _a !== void 0 ? _a : record.desired.current;
            collectFreshUpdateIssue(issues, record.id, 'current-restore', 'current', seed, record.desired.current);
            continue;
        }
        let precedingCurrent = record.baseline.current;
        // Phase 7 writes the desired published version into CURRENT only when the
        // published slice itself differs. If publication already matches, runtime
        // returns before staging and CURRENT remains the baseline draft exactly.
        if (record.desired.published &&
            record.desired.published.hash !== ((_b = record.baseline.published) === null || _b === void 0 ? void 0 : _b.hash)) {
            collectFreshUpdateIssue(issues, record.id, 'published-stage', 'published', precedingCurrent, record.desired.published);
            precedingCurrent = record.desired.published;
        }
        // Phase 8 restores the desired CURRENT version after publication handling.
        collectFreshUpdateIssue(issues, record.id, 'current-restore', 'current', precedingCurrent, record.desired.current);
    }
    return issues;
}
function collectFreshUpdateIssue(output, recordId, stage, slice, precedingCurrent, desired) {
    if (precedingCurrent.hash === desired.hash)
        return;
    const precedingIds = nestedBlockIds(precedingCurrent.fields);
    const freshIds = [...nestedBlockIds(desired.fields)]
        .filter((id) => !precedingIds.has(id))
        .sort();
    if (freshIds.length === 0)
        return;
    output.push({ recordId, stage, slice, blockId: freshIds[0] });
}
function nestedBlockIds(value) {
    const result = new Set();
    collectNestedBlockIds(value, result, 'record fields');
    return result;
}
function collectNestedBlockIds(value, output, path) {
    if (Array.isArray(value)) {
        value.forEach((child, index) => collectNestedBlockIds(child, output, `${path}[${index}]`));
        return;
    }
    if (!value || typeof value !== 'object')
        return;
    const identity = (0, structural_content_1.nestedBlockIdentity)(value, path);
    if (identity)
        output.add(identity.id);
    for (const [key, child] of Object.entries(value)) {
        collectNestedBlockIds(child, output, `${path}.${key}`);
    }
}
