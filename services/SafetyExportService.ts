/**
 * 基本設計 v0.11 §13.3 — the mandatory pre-replace safety net. Before a
 * destructive replace-import runs, a *verified* backup of the data about
 * to be wiped must exist: "保存先を選ばせる（共有シートではない）→ 保存の
 * 成功を確認する → 保存したファイルを読み直し、件数が一致することを確認する
 * →キャンセルされた／検証に失敗した場合、置換を開始しない". §12.4 explicitly
 * rules out the share sheet for this specific step — it can't report back
 * whether saving actually succeeded or where the file ended up (D-07's
 * whole point is that Export is the one sanctioned recovery path; a
 * "safety" copy that might silently not exist would defeat that).
 *
 * Platform split below isn't a design choice, it's a real Expo SDK
 * capability gap: `expo-file-system`'s `StorageAccessFramework` — which
 * lets the user pick an arbitrary save location and returns a URI this
 * can read back from to verify — is Android-only (its own type
 * definitions mark every function `@platform Android`). There is no
 * built-in Expo API for "let the person choose a save location outside
 * the share sheet" on iOS.
 *
 * iOS instead writes to the app's own Documents directory (`Paths.document`
 * — deliberately *not* `database/connection.ts`'s `getDbDirectory()`,
 * which the encrypted DB itself sits inside specifically so it can be
 * excluded from OS backup, §8.6/D-07) and reads it back to verify, the
 * same as Android's SAF file. Documents is included in the device's
 * normal iCloud/iTunes backup by default today (see connection.ts's
 * "Known gap" on the still-missing iOS DB-backup-exclusion module) — this
 * assumes any future version of that module keeps scope to the database
 * file specifically, not the whole Documents directory; if that scope
 * ever broadens, this file's safety-export location needs to move
 * somewhere that stays backed up. Unverified on-device, like everything
 * else native in this app (see README).
 */
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { serializeExportFile } from './ExportService';
import { nowUtcIso } from '../lib/datetime';
import type { ExportFileV1 } from '../types/Export';
import { SafetyExportFailedError } from '../lib/errors';

/**
 * Timestamped, not fixed — a fixed name would silently overwrite the
 * previous safety backup on iOS (`File#write` has no "fail if exists"
 * option in use here) while Android's SAF auto-renames on collision,
 * leaving the two platforms with different retention behavior for the
 * same feature. Timestamping keeps every safety backup as its own file
 * on both platforms — there's no delete UI for these yet (README "Known
 * gaps"), so this trades a small amount of accumulated storage for not
 * silently discarding a previous safety copy.
 */
function safetyExportFileBaseName(): string {
  return `solo-plus-us-safety-export-${nowUtcIso().replace(/:/g, '-')}`;
}

export interface SafetyExportResult {
  /** Where the verified copy ended up — a `file://` URI on iOS, a SAF `content://` URI on Android. */
  location: string;
}

function verifyActivityCount(readBackJson: string, expectedCount: number): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readBackJson);
  } catch (error) {
    throw new SafetyExportFailedError({ kind: 'read-back-failed' }, error);
  }
  const activities = (parsed as { activities?: unknown } | null)?.activities;
  const actualCount = Array.isArray(activities) ? activities.length : -1;
  if (actualCount !== expectedCount) {
    throw new SafetyExportFailedError({ kind: 'verification-mismatch', expectedCount, actualCount });
  }
}

async function performSafetyExportIOS(file: ExportFileV1, json: string): Promise<SafetyExportResult> {
  const target = new File(Paths.document, `${safetyExportFileBaseName()}.json`);
  try {
    target.write(json);
  } catch (error) {
    throw new SafetyExportFailedError({ kind: 'write-failed' }, error);
  }
  let readBack: string;
  try {
    readBack = await target.text();
  } catch (error) {
    throw new SafetyExportFailedError({ kind: 'read-back-failed' }, error);
  }
  verifyActivityCount(readBack, file.activities.length);
  return { location: target.uri };
}

async function performSafetyExportAndroid(file: ExportFileV1, json: string): Promise<SafetyExportResult> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) {
    // §13.3: "キャンセルされた…場合、置換を開始しない" — cancelling the
    // location picker is exactly this case, not a lower-severity variant.
    throw new SafetyExportFailedError({ kind: 'no-location-chosen' });
  }

  let fileUri: string;
  try {
    fileUri = await StorageAccessFramework.createFileAsync(permission.directoryUri, safetyExportFileBaseName(), 'application/json');
    await StorageAccessFramework.writeAsStringAsync(fileUri, json);
  } catch (error) {
    throw new SafetyExportFailedError({ kind: 'write-failed' }, error);
  }

  let readBack: string;
  try {
    readBack = await StorageAccessFramework.readAsStringAsync(fileUri);
  } catch (error) {
    throw new SafetyExportFailedError({ kind: 'read-back-failed' }, error);
  }
  verifyActivityCount(readBack, file.activities.length);
  return { location: fileUri };
}

/**
 * `file` is the *current* data (about to be destroyed by the caller's
 * replace-import), not the file being imported — callers must build this
 * from the live DB (`ExportService.buildExportPayload`) immediately
 * before calling this, not reuse the import file.
 */
export async function performSafetyExport(file: ExportFileV1): Promise<SafetyExportResult> {
  const json = serializeExportFile(file);
  return Platform.OS === 'android' ? performSafetyExportAndroid(file, json) : performSafetyExportIOS(file, json);
}
