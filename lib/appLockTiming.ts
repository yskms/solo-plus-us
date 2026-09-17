/**
 * 基本設計 v0.11 §8.3 / UI/UX §19 — pure "should resuming from background
 * re-lock the app" decision, kept separate from `contexts/AppLock.tsx` so
 * it's unit-testable without `AppState`/`expo-local-authentication` (both
 * native, unavailable under Jest — same constraint as `database/
 * connection.ts`).
 */
import type { AppLockTiming } from '../types/Settings';

export const APP_LOCK_TIMING_MS: Record<AppLockTiming, number> = {
  immediately: 0,
  '1m': 60_000,
  '5m': 5 * 60_000,
};

export interface ShouldLockOnResumeParams {
  enabled: boolean;
  timing: AppLockTiming;
  /** `null` for a cold start — this process never observed going to background. */
  backgroundedAtMs: number | null;
  nowMs: number;
}

/** Cold start (`backgroundedAtMs === null`) always locks when enabled — there's no elapsed time to measure against `timing`, and assuming unlocked would defeat the setting. */
export function shouldLockOnResume(params: ShouldLockOnResumeParams): boolean {
  if (!params.enabled) return false;
  if (params.backgroundedAtMs === null) return true;
  const elapsedMs = params.nowMs - params.backgroundedAtMs;
  return elapsedMs >= APP_LOCK_TIMING_MS[params.timing];
}
