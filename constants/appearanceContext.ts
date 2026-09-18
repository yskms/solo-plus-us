/**
 * Just the `AppearanceContext` object, split out of `contexts/Appearance.tsx`
 * so `constants/theme.ts` can read it without a circular import.
 *
 * `contexts/Appearance.tsx` (the provider) imports `contexts/DatabaseContext`,
 * which imports `constants/theme.ts` for `useTheme()`. If `theme.ts` imported
 * the context straight from `contexts/Appearance.tsx`, that would close the
 * cycle back on itself — at runtime this left `theme.ts`'s `spacing` export
 * still undefined when a module earlier in the cycle (`RecoveryScreen.tsx`,
 * via `DatabaseContext.tsx`) evaluated its own `StyleSheet.create({ ... spacing.md ... })`
 * at module load, crashing with "Cannot read property 'md' of undefined".
 * This file has no dependency on `DatabaseContext` or `theme.ts`, so both can
 * import it without forming a cycle.
 */
import { createContext } from 'react';
import type { Appearance } from '../types/Settings';

export interface AppearanceContextValue {
  appearance: Appearance;
  loaded: boolean;
  setAppearance: (next: Appearance) => Promise<void>;
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null);
