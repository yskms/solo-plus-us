/**
 * §18/CLAUDE.md「スクリーンショットに関する方針」— `privacy.blockScreenshots`
 * の DB 永続化と `lib/screenMask.ts` への適用を橋渡しする。`lib/screenMask.ts`
 * の常時オン経路（Recent Apps 非表示）と違い、この設定は DB から読む必要が
 * あるため、`DatabaseProvider` の外側で呼ばれる `useScreenMask()`（`app/_layout.tsx`）
 * とは別に、DB にアクセスできるこの Provider の内側で管理する。
 *
 * この Context が `enabled` の唯一の正本——`app/settings/block-screenshots.tsx`
 * は自分で DB を読み直さず、ここから読む（読み取り元が2つあると値がずれる
 * 余地があるため、レビューで指摘）。
 *
 * `setEnabled` は `applyScreenshotBlock` を待ち、失敗したら例外をそのまま
 * 呼び出し元（設定画面）に伝える——ネイティブ側の適用に失敗したのに DB へ
 * 保存し「オンになった」と表示するのは、D-47 の「確認できていない保護を
 * 表示しない」という原則に反する（レビューで指摘）。適用が成功した場合のみ
 * DB へ保存し、`enabled` を更新する。DB 保存自体が失敗した場合は、適用済みの
 * ネイティブ側を `applyScreenshotBlock(!next)` で元に戻してから例外を投げる
 * ——さもないと「DB は古い値のまま、ネイティブは新しい値」という、表示と
 * 実態がずれた状態が残る（2回目のレビューで指摘）。
 *
 * `enabled` は「DB に保存された希望」ではなく「実際に適用できている状態」を
 * 表す——起動時に `applyScreenshotBlock(true)` が失敗した場合、DB の値は
 * `true` のままでも `enabled` は `false` にする（2回目のレビューで指摘：
 * 以前は `applyScreenshotBlock` の前に `enabled` を立てていたため、失敗して
 * いても Switch が ON に見えた）。
 */
import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useDatabase } from './DatabaseContext';
import { getSetting, setSetting } from '../services/SettingsRepository';
import { applyScreenshotBlock, useScreenshotBlock } from '../lib/screenMask';
import { logError } from '../lib/log';

interface ScreenshotBlockContextValue {
  enabled: boolean;
  loaded: boolean;
  /** Applies natively first — throws on failure without touching the persisted setting or `enabled`, so a failed change never gets reported as saved. */
  setEnabled: (next: boolean) => Promise<void>;
}

const ScreenshotBlockContext = createContext<ScreenshotBlockContextValue | null>(null);

export function useScreenshotBlockSetting(): ScreenshotBlockContextValue {
  const ctx = useContext(ScreenshotBlockContext);
  if (!ctx) throw new Error('useScreenshotBlockSetting must be used within ScreenshotBlockProvider');
  return ctx;
}

export function ScreenshotBlockProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const [enabled, setEnabledState] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // The `[db]` dependency below doesn't re-fire in practice today — the
  // `db` reference from `DatabaseContext` is stable for the app's
  // lifetime once ready (there's no live DB-swap path reachable yet;
  // §8.8 Recovery bootstrap, which would swap it, isn't implemented —
  // see README Known gaps). If that ever changes, note this effect
  // doesn't call `applyScreenshotBlock(false)` before re-reading, so a
  // still-enabled block from the old `db` would keep running natively
  // even if the new one's setting is off (flagged in review, accepted
  // as a non-issue for now since the path can't currently execute).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let value = false;
      try {
        value = await getSetting(db, 'privacy.blockScreenshots');
      } catch (error) {
        logError('Loading privacy.blockScreenshots failed', error);
      }
      if (cancelled) return;

      let applied = false;
      if (value) {
        // Best-effort at startup — no UI is waiting on this specific
        // call, unlike setEnabled below. `enabled` below only becomes
        // true if this actually succeeds (see file doc comment) — a
        // failure here shows the switch off next time the Settings
        // screen is visited, rather than on-but-not-actually-blocking.
        try {
          await applyScreenshotBlock(true);
          applied = true;
        } catch (error) {
          logError('Applying privacy.blockScreenshots at startup failed', error);
        }
      }
      if (cancelled) return;
      setEnabledState(applied);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  // Keeps it reapplied on Android across Activity recreation for as
  // long as `enabled` is true — see lib/screenMask.ts's useScreenshotBlock.
  useScreenshotBlock(enabled);

  const setEnabled = useCallback(
    async (next: boolean) => {
      await applyScreenshotBlock(next); // throws on failure — caller (Settings screen) handles it, nothing persisted below if so
      try {
        await setSetting(db, 'privacy.blockScreenshots', next);
      } catch (error) {
        // Native side already changed to `next` but the DB write that
        // was supposed to record it failed — roll the native side back
        // to what the DB (and `enabled`) still actually say, rather
        // than leaving them silently out of sync (2nd review round).
        try {
          await applyScreenshotBlock(!next);
        } catch (rollbackError) {
          logError('Rolling back privacy.blockScreenshots native state failed', rollbackError);
        }
        throw error;
      }
      setEnabledState(next);
    },
    [db],
  );

  return <ScreenshotBlockContext.Provider value={{ enabled, loaded, setEnabled }}>{children}</ScreenshotBlockContext.Provider>;
}
