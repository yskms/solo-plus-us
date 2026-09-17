/**
 * 基本設計 v0.11 §14 — Insights' data needs.
 */
import type { Transactor } from '../database/SqlExecutor';
import { countAllActivities, getActivityTimeSpan, type ActivityCounts, type ActivityTimeSpan } from '../repositories/ActivityRepository';
import { averageIntervalDays } from '../lib/statistics';

export interface InsightsSnapshot {
  counts: ActivityCounts;
  averageIntervalDays: number | null;
}

/**
 * Reads the all-time count and the oldest/newest timestamps together, in
 * one transaction — two separate, un-transacted reads would let a create
 * or delete landing between them pair a count from one moment with a time
 * span from another, skewing the average interval. See `ExportService`'s
 * `buildExportPayload` for the same reasoning applied to Export.
 */
export async function getInsightsSnapshot(db: Transactor): Promise<InsightsSnapshot> {
  let counts: ActivityCounts = { total: 0, solo: 0, partnered: 0 };
  // No initializer: a `= null` initial value here narrows `span` to the
  // literal type `null` for the rest of this function, even after the
  // (closure) reassignment below and even with an explicit wider type
  // annotation — TypeScript can't see into `db.transaction`'s callback to
  // know it reassigns this before the function returns. The definite
  // assignment assertion (`!`) tells it to trust that instead.
  let span!: ActivityTimeSpan | null;

  await db.transaction(async (tx) => {
    counts = await countAllActivities(tx);
    span = await getActivityTimeSpan(tx);
  });

  return {
    counts,
    averageIntervalDays: span ? averageIntervalDays(counts.total, span.oldestOccurredAtUtc, span.newestOccurredAtUtc) : null,
  };
}
