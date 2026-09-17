/**
 * 基本設計 v0.11 §13 (D-10) — strict restore.
 *
 * Two modes, both implemented here: `performReplaceImport` (§13.3's
 * primary/default mode: wipe local data, then insert the file's contents,
 * in one transaction) and `performAppendImport` ("追加のみ" — insert only
 * activities whose `id` isn't already present; existing rows and settings
 * are left untouched).
 *
 * Validation (`services/importValidation`) must already have accepted the
 * file before either runs — this module trusts a `valid: true` result and
 * does not re-derive it, though `ActivityRepository.restoreActivityRow`
 * still re-validates per row as defense in depth (§5.1).
 */
import type { Transactor } from '../database/SqlExecutor';
import { deleteAllActivities, findActivityById, restoreActivityRow } from '../repositories/ActivityRepository';
import { deleteAllMappings } from '../repositories/HealthSyncRepository';
import { deleteAllJobs } from '../repositories/HealthSyncJobRepository';
import { setSetting } from './SettingsRepository';
import type { ExportFileV1 } from '../types/Export';
import { SYNC_DERIVED_SETTING_KEYS } from '../types/Settings';
import type { Activity } from '../types/Activity';

export interface ReplaceImportResult {
  importedCount: number;
}

function toActivity(entry: ExportFileV1['activities'][number]): Activity {
  return { ...entry }; // ExportActivityV1 and Activity are field-for-field identical (types/Export.ts).
}

/**
 * §13.3: replace-restore. §13.3.1's split — settings from the file
 * (already limited to `EXPORTABLE_SETTING_KEYS` by the validator) are
 * written; sync-state-derived settings not in that list (currently just
 * `healthConnect.lastSyncedAt`) are explicitly reset, not left alone,
 * because every mapping is being wiped in the same transaction — leaving
 * a stale "Last synced" would recreate exactly the misleading state the
 * allowlist exists to avoid. Device-owned settings (App Lock, HC enabled)
 * are simply never touched here.
 */
export async function performReplaceImport(db: Transactor, file: ExportFileV1): Promise<ReplaceImportResult> {
  await db.transaction(async (tx) => {
    await deleteAllJobs(tx);
    await deleteAllMappings(tx);
    await deleteAllActivities(tx);

    for (const entry of file.activities) {
      await restoreActivityRow(tx, toActivity(entry));
    }

    for (const [key, value] of Object.entries(file.settings)) {
      // `file.settings` was already narrowed to EXPORTABLE_SETTING_KEYS by
      // the validator; this cast just restates that to TypeScript.
      await setSetting(tx, key as keyof typeof file.settings, value as never);
    }

    for (const key of SYNC_DERIVED_SETTING_KEYS) {
      await setSetting(tx, key, null);
    }
  });

  return { importedCount: file.activities.length };
}

export interface AppendImportResult {
  importedCount: number;
  skippedCount: number;
}

/**
 * §13.3 "追加のみ": id が未存在のものだけ追加する。既存 id は変更しない — and
 * unlike `performReplaceImport`, `settings` is entirely ignored (§13.3:
 * "追加のみモードでは無視する"), since this mode never claims to represent
 * a full device state, only to backfill missing history. Not gated by
 * §13.3's safety-export requirement — that only applies to the
 * destructive replace path (`app/settings/data.tsx`), since nothing
 * existing is ever overwritten or deleted here.
 */
export async function performAppendImport(db: Transactor, file: ExportFileV1): Promise<AppendImportResult> {
  let importedCount = 0;
  let skippedCount = 0;

  await db.transaction(async (tx) => {
    for (const entry of file.activities) {
      const existing = await findActivityById(tx, entry.id);
      if (existing) {
        skippedCount++;
        continue;
      }
      await restoreActivityRow(tx, toActivity(entry));
      importedCount++;
    }
  });

  return { importedCount, skippedCount };
}
