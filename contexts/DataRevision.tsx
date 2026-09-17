/**
 * A cheap "something changed" signal for screens that show Activity data.
 *
 * `useFocusEffect` alone isn't enough: Undo (from the Snackbar, §9) runs
 * *on* the Today screen without any navigation happening, so nothing
 * re-triggers a focus event and the just-undone Activity stays on screen
 * looking like Undo silently failed. Any write path that isn't reached by
 * a screen transition should call `bump()` after it succeeds; screens add
 * `revision` to their reload `useEffect`'s dependencies.
 */
import React, { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface DataRevisionContextValue {
  revision: number;
  bump: () => void;
}

const DataRevisionContext = createContext<DataRevisionContextValue | null>(null);

export function DataRevisionProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);
  return <DataRevisionContext.Provider value={{ revision, bump }}>{children}</DataRevisionContext.Provider>;
}

export function useDataRevision(): DataRevisionContextValue {
  const ctx = useContext(DataRevisionContext);
  if (!ctx) throw new Error('useDataRevision must be used within DataRevisionProvider');
  return ctx;
}
