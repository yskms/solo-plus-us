/**
 * UI/UX §9 (D-15/D-44) — the "✓ Solo activity recorded · Undo" Snackbar.
 *
 * Two independent timers, on purpose (D-15's key distinction):
 *  - The Snackbar's ~5s *visibility* is a plain UI timer here — purely
 *    cosmetic, resets to nothing if the app is killed.
 *  - The actual sync delay this gates is a persisted `not_before` on the
 *    job row (`services/ActivityService`, `addSecondsIso(createdAt, 5)`),
 *    set once at record time and unaffected by whether this Snackbar is
 *    still on screen.
 * Losing this component (app killed, screen navigated away) never risks
 * losing an Undo that should have been possible, because Undo is just
 * §10.1 順1 of a normal delete — it only stops being *offered*, it was
 * never the only thing making it safe.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as ActivityService from '../services/ActivityService';
import { useDatabase } from './DatabaseContext';
import type { Activity } from '../types/Activity';

const VISIBLE_MS = 5000;

interface FeedbackState {
  activity: Activity;
}

interface RecordFeedbackContextValue {
  state: FeedbackState | null;
  announceRecorded: (activity: Activity) => void;
  undo: () => Promise<void>;
  dismiss: () => void;
}

const RecordFeedbackContext = createContext<RecordFeedbackContextValue | null>(null);

export function RecordFeedbackProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const [state, setState] = useState<FeedbackState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState(null);
  }, []);

  const announceRecorded = useCallback(
    (activity: Activity) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setState({ activity });
      timerRef.current = setTimeout(() => setState(null), VISIBLE_MS);
    },
    [],
  );

  const undo = useCallback(async () => {
    if (!state) return;
    const { activity } = state;
    dismiss();
    await ActivityService.undoLastRecord(db, activity.id);
  }, [state, dismiss, db]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <RecordFeedbackContext.Provider value={{ state, announceRecorded, undo, dismiss }}>
      {children}
    </RecordFeedbackContext.Provider>
  );
}

export function useRecordFeedback(): RecordFeedbackContextValue {
  const ctx = useContext(RecordFeedbackContext);
  if (!ctx) throw new Error('useRecordFeedback must be used within RecordFeedbackProvider');
  return ctx;
}
