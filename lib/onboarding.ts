/**
 * A single device-local UI flag: has the Privacy Introduction screen
 * (UI/UX §6) been shown yet? Deliberately kept out of `types/Settings.ts`
 * — it isn't a product "setting" (nothing to export, no default a person
 * would ever want to change), just app-launch routing state, so it talks
 * to `app_settings` directly instead of going through the typed
 * `SettingsRepository`.
 */
import { nowUtcIso } from './datetime';
import type { SqlExecutor } from '../database/SqlExecutor';

const KEY = 'onboarding.privacyIntroSeenAt';

export async function hasSeenPrivacyIntro(executor: SqlExecutor): Promise<boolean> {
  const result = await executor.execute('SELECT value FROM app_settings WHERE key = ?', [KEY]);
  return (result.rows ?? []).length > 0;
}

export async function markPrivacyIntroSeen(executor: SqlExecutor): Promise<void> {
  await executor.execute(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, 'true', ?)
     ON CONFLICT (key) DO NOTHING`,
    [KEY, nowUtcIso()],
  );
}
