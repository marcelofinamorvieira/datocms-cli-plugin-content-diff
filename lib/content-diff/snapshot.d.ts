import type { CmaClient } from '@datocms/cli-utils';
import type { CaptureContentSnapshotInput, ContentSnapshot, JsonObject, RecordScheduleSnapshot, ScheduleAdapter } from './types';
export declare const defaultScheduleAdapter: ScheduleAdapter;
export declare function captureContentSnapshot({ client, environmentId, schema: providedSchema, scope, maxAttempts, scheduleAdapter, fullAccessVerified, }: CaptureContentSnapshotInput): Promise<ContentSnapshot>;
export declare function readScheduleDetails(client: CmaClient.Client, recordId: string, _localeOrder: readonly string[]): Promise<RecordScheduleSnapshot>;
export declare function snapshotSemanticState(snapshot: ContentSnapshot): JsonObject;
