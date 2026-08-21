import type { ContentDiffPlan, UploadPlan, UploadSnapshot } from './types';
export declare function uploadFilenameExtension(filename: string): string;
export declare function uploadBasenameFromFilename(filename: string): string;
export declare function compareUploadChanges(desired: UploadSnapshot, baseline: UploadSnapshot): UploadPlan['changes'];
export declare function uploadManualMetadataChanged(baseline: UploadSnapshot, desired: UploadSnapshot): boolean;
/**
 * Proves that the current UploadRequest filename normalizer will preserve the
 * requested filename byte-for-byte. The API transliterates and lowercases,
 * replaces non `[a-z0-9_-]` bytes with `-`, collapses adjacent separators,
 * and trims separators. Restricting both parts to this ASCII fixed-point
 * language is deliberately fail-closed for Unicode transliteration.
 */
export declare function isUploadRequestFilenameFixedPoint(filename: string): boolean;
export declare function uploadPlanRequiresFilenameRequest(upload: UploadPlan): boolean;
export declare function uploadPlanRequiresBinaryTransfer(upload: UploadPlan): boolean;
export declare function expectedUploadPlanChanges(upload: UploadPlan): UploadPlan['changes'] | null;
export declare function uploadPlanContractError(upload: UploadPlan, schema: ContentDiffPlan['schema']): string | null;
export declare function deriveRequiredUploadActions(uploadPlans: ContentDiffPlan['uploads']): ContentDiffPlan['requiredPermissions']['uploadActions'];
