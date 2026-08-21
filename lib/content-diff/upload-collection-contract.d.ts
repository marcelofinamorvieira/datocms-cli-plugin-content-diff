import type { UploadCollectionPlan, UploadCollectionSnapshot } from './types';
export declare function deriveRequiredManageUploadCollections(plans: readonly UploadCollectionPlan[]): boolean;
export declare function uploadCollectionPlanContractError(plan: UploadCollectionPlan): string | null;
export declare function uploadCollectionOrderContractError(plans: readonly UploadCollectionPlan[], collectionOrder: readonly string[], initialOccupancy?: readonly UploadCollectionSnapshot[]): string | null;
