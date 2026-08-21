import { RUNTIME_VERSION } from './runtime-template';
import { type ContentDiffPlan } from './types';
export interface ContentPlanEnvelope {
    formatVersion: 9;
    runtimeVersion: typeof RUNTIME_VERSION;
    integrity: {
        algorithm: 'sha256';
        planSha256: string;
    };
    plan: ContentDiffPlan;
}
export interface WriteContentDiffArtifactsInput {
    plan: ContentDiffPlan;
    migrationFilePath: string;
    format: 'js' | 'ts';
    bundleAssets: boolean;
    fetchFn?: typeof fetch;
}
export interface WrittenContentDiffArtifacts {
    migrationPath: string;
    planPath: string;
    runtimePath: string;
    assetsPath?: string;
    manifestSha256: string;
}
export declare function writeContentDiffArtifacts({ plan, migrationFilePath, format, bundleAssets, fetchFn, }: WriteContentDiffArtifactsInput): Promise<WrittenContentDiffArtifacts>;
export declare function buildEnvelope(plan: ContentDiffPlan): ContentPlanEnvelope;
