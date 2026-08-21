"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentDiffError = exports.CONTENT_DIFF_MAPPING_RECORD_MAX_BYTES = exports.CONTENT_DIFF_MAPPING_FIELD_API_KEY = exports.CONTENT_DIFF_MAPPING_NAME_FIELD_API_KEY = exports.DEFAULT_CONTENT_DIFF_MODEL_API_KEY = exports.LEGACY_ID_MAPPING_FORMAT_VERSION = exports.INVALID_CONTENT_FORMAT_VERSION = exports.CONTENT_DIFF_GENERATOR_VERSION = exports.CONTENT_PLAN_FORMAT_VERSION = exports.CONTENT_SNAPSHOT_FORMAT_VERSION = void 0;
exports.CONTENT_SNAPSHOT_FORMAT_VERSION = 3;
exports.CONTENT_PLAN_FORMAT_VERSION = 9;
exports.CONTENT_DIFF_GENERATOR_VERSION = '1.0.0';
exports.INVALID_CONTENT_FORMAT_VERSION = 1;
exports.LEGACY_ID_MAPPING_FORMAT_VERSION = 1;
exports.DEFAULT_CONTENT_DIFF_MODEL_API_KEY = 'datocms_content_diff';
exports.CONTENT_DIFF_MAPPING_NAME_FIELD_API_KEY = 'name';
exports.CONTENT_DIFF_MAPPING_FIELD_API_KEY = 'mapping';
exports.CONTENT_DIFF_MAPPING_RECORD_MAX_BYTES = 128 * 1024;
class ContentDiffError extends Error {
    constructor(code, message, details) {
        super(message);
        this.name = 'ContentDiffError';
        this.code = code;
        this.details = details;
    }
}
exports.ContentDiffError = ContentDiffError;
