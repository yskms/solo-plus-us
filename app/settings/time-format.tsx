/**
 * UI/UX §17 PREFERENCES — "Time Format". 12-hour / 24-hour, backed by
 * `preferences.timeFormat` (resolved from locale once at first launch —
 * see `services/SettingsRepository.ts`'s `resolveLocaleDefaults`) and
 * consumed by `lib/timeFormat.ts`. `screens/CalendarScreen.tsx` is a
 * persistent tab (not remounted on navigating back from here), so saving
 * must bump `useDataRevision()` for the change to actually reflow it — see
 * that context's file doc comment. `app/record.tsx`/`app/activity/[id].tsx`
 * re-read the setting on their own mount instead, so the bump doesn't
 * matter to them either way. That `bump()` also happens to re-trigger
 * `contexts/SyncWorkerLoop.tsx`'s drain (it subscribes to the same
 * revision counter) — harmless (drains are serialized via `drainingRef`),
 * just not the reason this call exists; noted per 2026-09-21 review.
 * Layout is `components/SettingsOptionScreen.tsx`, shared with
 * `appearance.tsx`/`first-day-of-week.tsx`.
 */
import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import SettingsOptionScreen from '../../components/SettingsOptionScreen';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import { logError } from '../../lib/log';
import type { TimeFormat } from '../../types/Settings';

export default function TimeFormatSettingsScreen() {
  const { t } = useTranslation();
  const db = useDatabase();
  const { bump } = useDataRevision();

  const OPTIONS: { value: TimeFormat; label: string }[] = [
    { value: '12h', label: t('settings.timeFormat.option12h') },
    { value: '24h', label: t('settings.timeFormat.option24h') },
  ];
  const [value, setValue] = useState<TimeFormat | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getSetting(db, 'preferences.timeFormat')
        .then((loaded) => {
          if (!cancelled) setValue(loaded);
        })
        .catch((error) => logError('Loading preferences.timeFormat failed', error));
      return () => {
        cancelled = true;
      };
    }, [db]),
  );

  const persist = async (next: TimeFormat) => {
    if (value === null || next === value) return;
    const previous = value;
    setValue(next);
    setBusy(true);
    try {
      await setSetting(db, 'preferences.timeFormat', next);
      bump();
    } catch (error) {
      setValue(previous);
      logError('Saving preferences.timeFormat failed', error);
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
    } finally {
      setBusy(false);
    }
  };

  return <SettingsOptionScreen options={OPTIONS} value={value} busy={busy} onSelect={persist} />;
}
