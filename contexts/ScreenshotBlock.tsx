/**
 * §18/CLAUDE.md「スクリーンショットに関する方針」— `privacy.blockScreenshots`
 * の DB 永続化と `lib/screenMask.ts` への適用を橋渡しする。`lib/screenMask.ts`
 * の常時オン経路（Recent Apps 非表示）と違い、この設定は DB から読む必要が
 * あるため、`DatabaseProvider` の外側で呼ばれる `useScreenMask()`（`app/_layout.tsx`）
 * とは別に、DB にアクセスできるこの Provider の内側で管理する。
 *
 * `AppLockProvider`（`refreshAppLockSettings`）と同じ「DB の値と React
 * state を明示的に同期する」パターンだが、設定画面側は保存する値を
 * すでに知っているため、DB 再読み込みではなく直接 `setEnabled` で即時反映
 * する（`refreshXxx()` 相当は不要）。
 */
import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useDatabase } from './DatabaseContext';
import { getSetting } from '../services/SettingsRepository';
import { useScreenshotBlock } from '../lib/screenMask';
import { logError } from '../lib/log';

interface ScreenshotBlockContextValue {
  enabled: boolean;
  /** Applies immediately (via `useScreenshotBlock`) — callers still separately persist the value with `setSetting`. */
  setEnabled: (next: boolean) => void;
}

const ScreenshotBlockContext = createContext<ScreenshotBlockContextValue | null>(null);

export function useScreenshotBlockSetting(): ScreenshotBlockContextValue {
  const ctx = useContext(ScreenshotBlockContext);
  if (!ctx) throw new Error('useScreenshotBlockSetting must be used within ScreenshotBlockProvider');
  return ctx;
}

export function ScreenshotBlockProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    getSetting(db, 'privacy.blockScreenshots')
      .then(setEnabled)
      .catch((error) => logError('Loading privacy.blockScreenshots failed', error));
  }, [db]);

  // Applies on mount (once the setting above has loaded) and keeps
  // reapplying on Android across Activity recreation for as long as
  // `enabled` is true — see lib/screenMask.ts's useScreenshotBlock.
  useScreenshotBlock(enabled);

  return <ScreenshotBlockContext.Provider value={{ enabled, setEnabled }}>{children}</ScreenshotBlockContext.Provider>;
}
