/**
 * UI/UX §17 PREFERENCES — "First Day of Week". Monday / Sunday, backed by
 * `preferences.firstDayOfWeek` (resolved from locale once at first launch —
 * see `services/SettingsRepository.ts`'s `resolveLocaleDefaults`). Only
 * `screens/CalendarScreen.tsx` reads this value, and it's a persistent tab
 * (not remounted on navigating back from here), so saving must bump
 * `useDataRevision()` for the change to actually reflow the grid — see
 * that context's file doc comment ("any write path that isn't reached by
 * a screen transition should call `bump()`"). That `bump()` also happens
 * to re-trigger `contexts/SyncWorkerLoop.tsx`'s drain (it subscribes to
 * the same revision counter) — harmless (drains are serialized via
 * `drainingRef`, and an idle drain is a cheap no-op query), just not the
 * reason this call exists; noted per 2026-09-21 review. Layout is
 * `components/SettingsOptionScreen.tsx`, shared with `appearance.tsx`/
 * `time-format.tsx`.
 */
import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import SettingsOptionScreen from '../../components/SettingsOptionScreen';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import { logError } from '../../lib/log';
import type { FirstDayOfWeek } from '../../types/Settings';

const OPTIONS: { value: FirstDayOfWeek; label: string }[] = [
  { value: 'monday', label: 'Monday' },
  { value: 'sunday', label: 'Sunday' },
];

export default function FirstDayOfWeekSettingsScreen() {
  const db = useDatabase();
  const { bump } = useDataRevision();
  const [value, setValue] = useState<FirstDayOfWeek | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getSetting(db, 'preferences.firstDayOfWeek')
        .then((loaded) => {
          if (!cancelled) setValue(loaded);
        })
        .catch((error) => logError('Loading preferences.firstDayOfWeek failed', error));
      return () => {
        cancelled = true;
      };
    }, [db]),
  );

  const persist = async (next: FirstDayOfWeek) => {
    if (value === null || next === value) return;
    const previous = value;
    setValue(next);
    setBusy(true);
    try {
      await setSetting(db, 'preferences.firstDayOfWeek', next);
      bump();
    } catch (error) {
      setValue(previous);
      logError('Saving preferences.firstDayOfWeek failed', error);
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return <SettingsOptionScreen options={OPTIONS} value={value} busy={busy} onSelect={persist} />;
}
