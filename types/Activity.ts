/**
 * 基本設計 v0.11 §3 — the Activity model.
 *
 * All optional fields use `| null`, never `?:`. This is D-23: the
 * persisted/exported contract distinguishes "not recorded" (null) from
 * "absent key", which `?:` cannot express once this crosses a JSON
 * boundary (Export/Import, §13.4).
 */

/** D-01/D-28: classifies by *who was there*, not by act. Never rename these values — they're the Export contract. */
export type ActivityContext = 'solo' | 'partnered';

export interface Activity {
  id: string;
  context: ActivityContext;

  occurredAtUtc: string; // 'YYYY-MM-DDTHH:MM:SSZ', seconds always ':00' (§4.2)
  occurredLocalDate: string; // 'YYYY-MM-DD'
  occurredLocalTime: string; // 'HH:MM'
  timezoneOffsetMinutes: number;
  timezoneId: string | null;

  // Outcome (§3.4/D-30): recorded and shown, never turned into a statistic.
  orgasm: boolean | null;
  ejaculation: boolean | null;
  protectionUsed: boolean | null;

  // Optional context
  durationSeconds: number | null;
  moodBefore: number | null; // 1–5
  moodAfter: number | null; // 1–5
  note: string | null;

  syncVersion: number; // D-19: monotonically increasing, maps to Health Connect's clientRecordVersion

  createdAt: string;
  updatedAt: string;
}

/** Fields the caller supplies when recording a new Activity; the rest are derived or defaulted. */
export interface NewActivityInput {
  context: ActivityContext;
  occurredAtUtc: string;
  occurredLocalDate: string;
  occurredLocalTime: string;
  timezoneOffsetMinutes: number;
  timezoneId: string | null;
  orgasm?: boolean | null;
  ejaculation?: boolean | null;
  protectionUsed?: boolean | null;
  durationSeconds?: number | null;
  moodBefore?: number | null;
  moodAfter?: number | null;
  note?: string | null;
}

/** Partial update — only the fields present are changed. `updatedAt` and `syncVersion` are always bumped by the Repository (§9.4). */
export type ActivityUpdateInput = Partial<
  Omit<NewActivityInput, 'occurredAtUtc' | 'occurredLocalDate' | 'occurredLocalTime' | 'timezoneOffsetMinutes' | 'timezoneId'>
> & {
  occurredAtUtc?: string;
  occurredLocalDate?: string;
  occurredLocalTime?: string;
  timezoneOffsetMinutes?: number;
  timezoneId?: string | null;
};

export interface ActivityDateRangeQuery {
  /** inclusive, 'YYYY-MM-DD' */
  fromLocalDate: string;
  /** inclusive, 'YYYY-MM-DD' */
  toLocalDate: string;
  context?: ActivityContext;
}
