/**
 * 基本設計 v0.11 §5 — schema version 1.
 *
 * This is the fixed DDL. Per D-11 / Rule 4, changes to shipped columns are
 * `ALTER TABLE ADD COLUMN` only; a rename or type change means a new table,
 * a copy, and a swap inside a migration transaction — never an edit to the
 * statements below once this has shipped.
 *
 * §5.1: `length(x) = N` CHECKs are a guard on length, not a format check.
 * ISO-8601 parsing and UUID v4 validation happen in the Repository layer
 * (`lib/datetime.ts`, `lib/id.ts`), which is the only path allowed to write
 * here (§17 "Repository を DB への唯一の入口とする").
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_V1_STATEMENTS: readonly string[] = [
  `CREATE TABLE activities (
      id                      TEXT PRIMARY KEY NOT NULL
                                CHECK (length(id) = 36),

      context                 TEXT NOT NULL
                                CHECK (context IN ('solo','partnered')),

      occurred_at_utc         TEXT NOT NULL
                                CHECK (length(occurred_at_utc) = 20),
      occurred_local_date     TEXT NOT NULL
                                CHECK (length(occurred_local_date) = 10),
      occurred_local_time     TEXT NOT NULL
                                CHECK (length(occurred_local_time) = 5),
      timezone_offset_minutes INTEGER NOT NULL
                                CHECK (timezone_offset_minutes BETWEEN -840 AND 840),
      timezone_id             TEXT,

      orgasm                  INTEGER CHECK (orgasm          IN (0,1)),
      ejaculation              INTEGER CHECK (ejaculation     IN (0,1)),
      protection_used          INTEGER CHECK (protection_used IN (0,1)),

      duration_seconds        INTEGER
                                CHECK (duration_seconds IS NULL
                                       OR (duration_seconds > 0
                                           AND duration_seconds <= 86400)),
      mood_before              INTEGER CHECK (mood_before BETWEEN 1 AND 5),
      mood_after               INTEGER CHECK (mood_after  BETWEEN 1 AND 5),
      note                     TEXT    CHECK (note IS NULL OR length(note) <= 2000),

      sync_version             INTEGER NOT NULL DEFAULT 1 CHECK (sync_version >= 1),

      created_at               TEXT NOT NULL CHECK (length(created_at) = 20),
      updated_at                TEXT NOT NULL CHECK (length(updated_at) = 20),

      CHECK (updated_at >= created_at)
  )`,

  `CREATE INDEX idx_activities_local_date   ON activities(occurred_local_date)`,
  `CREATE INDEX idx_activities_utc          ON activities(occurred_at_utc)`,
  `CREATE INDEX idx_activities_context_date ON activities(context, occurred_local_date)`,

  `CREATE TABLE health_sync (
      activity_id        TEXT NOT NULL,
      provider           TEXT NOT NULL
                           CHECK (provider IN ('health_connect','healthkit')),
      external_record_id TEXT,
      last_synced_at      TEXT NOT NULL CHECK (length(last_synced_at) = 20),

      PRIMARY KEY (activity_id, provider),
      FOREIGN KEY (activity_id)
        REFERENCES activities(id)
        ON DELETE RESTRICT
  )`,

  `CREATE TABLE health_sync_jobs (
      id                 TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
      activity_id        TEXT NOT NULL CHECK (length(activity_id) = 36),
      provider           TEXT NOT NULL
                           CHECK (provider IN ('health_connect','healthkit')),
      operation          TEXT NOT NULL
                           CHECK (operation IN ('create','update','delete','recreate')),
      external_record_id TEXT,

      revision            INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      claimed_at          TEXT,
      not_before          TEXT,
      attempts            INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      last_error_code     TEXT,
      created_at          TEXT NOT NULL CHECK (length(created_at) = 20)
  )`,

  `CREATE UNIQUE INDEX uq_health_sync_jobs
     ON health_sync_jobs(activity_id, provider)`,

  `CREATE INDEX idx_health_sync_jobs_due
     ON health_sync_jobs(provider, not_before)
     WHERE claimed_at IS NULL AND not_before IS NOT NULL`,

  `CREATE TABLE app_settings (
      key        TEXT PRIMARY KEY NOT NULL CHECK (length(key) > 0),
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL CHECK (length(updated_at) = 20)
  )`,
];
