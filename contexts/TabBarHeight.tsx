/**
 * The custom bottom tab bar in `app/(tabs)/_layout.tsx` isn't a React
 * Navigation navigator (see that file's doc comment for why), so nothing
 * outside it knows its height. `UndoSnackbar` (`components/UndoSnackbar.tsx`)
 * renders above the root `Stack`, as a sibling of `(tabs)`, and needs that
 * height to sit above the tab bar instead of underneath it. Measured via
 * `onLayout` rather than hardcoded, so it stays correct across devices
 * (safe-area inset) and font-scale settings (tab label height) without
 * needing to duplicate the tab bar's layout math here.
 *
 * `(tabs)` never unmounts once measured (a screen pushed on top just
 * covers it), so this height keeps its last value even while `record` or
 * `activity/[id]` is on top and has no tab bar of its own. That makes the
 * Snackbar sit higher than it needs to on those screens — accepted as a
 * known trade-off rather than a bug, since the Snackbar is only ever
 * triggered from `record` closing back to `(tabs)` (see
 * `contexts/RecordFeedback.tsx`'s only caller).
 */
import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface TabBarHeightContextValue {
  height: number;
  setHeight: (height: number) => void;
}

const TabBarHeightContext = createContext<TabBarHeightContextValue | null>(null);

export function TabBarHeightProvider({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState(0);
  const value = useMemo(() => ({ height, setHeight }), [height]);
  return <TabBarHeightContext.Provider value={value}>{children}</TabBarHeightContext.Provider>;
}

export function useTabBarHeight(): TabBarHeightContextValue {
  const ctx = useContext(TabBarHeightContext);
  if (!ctx) throw new Error('useTabBarHeight must be used within TabBarHeightProvider');
  return ctx;
}
