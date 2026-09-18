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
 * DB へ保存し、`enabled` を更新する。
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
      setEnabledState(value);
      setLoaded(true);
      if (value) {
        // Best-effort at startup — no UI is waiting on this specific
        // call, unlike setEnabled below. A failure here just means the
        // Settings screen (once visited) shows the switch off from the
        // next attempt, rather than a silently-not-actually-blocking on.
        try {
          await applyScreenshotBlock(true);
        } catch (error) {
          logError('Applying privacy.blockScreenshots at startup failed', error);
        }
      }
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
      await setSetting(db, 'privacy.blockScreenshots', next);
      setEnabledState(next);
    },
    [db],
  );

  return <ScreenshotBlockContext.Provider value={{ enabled, loaded, setEnabled }}>{children}</ScreenshotBlockContext.Provider>;
}
