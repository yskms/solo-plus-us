/**
 * 基本設計 v0.11 §5 / §9 — Health Connect / HealthKit sync tables.
 *
 * Two tables, two jobs, per D-03:
 *  - `health_sync`      current mapping only. Only a living Activity has a row (FK RESTRICT).
 *  - `health_sync_jobs` outbox of pending work. No FK — must be able to outlive the Activity
 *                       (a pending `delete` job exists precisely because the Activity is gone).
 *
 * Phase 1 note: these types exist and the tables are created because the
 * schema is fixed up front (§2, avoid future migrations), but nothing in
 * Phase 1 talks to a native Health provider yet. `services/ActivityService`
 * only enqueues rows here when a provider is registered as active — see
 * `services/syncJobPlanner.ts`.
 */

export type Provider = 'health_connect' | 'healthkit';

export type JobOperation = 'create' | 'update' | 'delete' | 'recreate';

/** Internal error codes for `last_error_code` — never store a raw OS/API error string (§5.2). */
export type SyncErrorCode =
  | 'PERMISSION_DENIED'
  | 'UNAVAILABLE'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'LOCAL_ACTIVITY_NOT_FOUND' // §9.5.3: internal inconsistency, not a retryable error
  | 'UNKNOWN';

export interface HealthSyncRow {
  activityId: string;
  provider: Provider;
  /** health_connect: optional, addressed by clientRecordId instead (§5.4). healthkit: required. */
  externalRecordId: string | null;
  lastSyncedAt: string;
}

export interface HealthSyncJobRow {
  id: string;
  activityId: string;
  provider: Provider;
  operation: JobOperation;
  externalRecordId: string | null;
  revision: number; // §9.5: optimistic concurrency for the worker's claim/finalize cycle
  claimedAt: string | null; // null = not claimed
  notBefore: string | null; // null = manual-retry-only (D-25); otherwise earliest time the worker may claim it
  attempts: number; // incremented at claim time, not on failure (§9.5.2) — attempts > 0 means "may have reached the provider"
  lastErrorCode: SyncErrorCode | null;
  createdAt: string;
}
