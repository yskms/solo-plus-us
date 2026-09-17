/**
 * 基本設計 v0.11 §12.4 — the *normal* Export path: "共有シート／保存先は
 * 利用者に委ねてよい". Unlike `services/SafetyExportService.ts` (§13.3),
 * this never needs to verify where the file ended up, so the share sheet
 * (which can't report that back) is exactly the right tool here.
 *
 * Writes into `Paths.cache`, not Documents — this file only needs to
 * exist long enough for the share sheet to read it, and deleting it
 * once the sheet closes (§12.4: "共有後に一時ファイルを削除する") keeps a
 * plaintext copy of every Activity from lingering on disk (§8/D-05: the
 * DB itself is never meant to exist unencrypted at rest).
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function shareExportFile(fileName: string, contents: string, mimeType: string, uti: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.write(contents);
  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle: 'Export Solo + Us data' });
  } finally {
    try {
      file.delete();
    } catch {
      // Best-effort cleanup — a leftover cache file isn't a correctness
      // issue (cache is OS-reclaimable, and unlike the DB this plaintext
      // copy was already handed to the share target regardless).
    }
  }
}
