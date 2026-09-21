/**
 * UI/UX §17 PREFERENCES — "Appearance". System / Light / Dark, backed by
 * `preferences.appearance` via `contexts/Appearance.tsx` (the single
 * source of truth `constants/theme.ts`'s `useTheme()` also reads — see
 * that context's file doc comment). Layout is `components/
 * SettingsOptionScreen.tsx`, shared with `first-day-of-week.tsx`/
 * `time-format.tsx` — this screen just supplies the options and wires its
 * value/persist through `useAppearanceSetting()`.
 */
import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import SettingsOptionScreen from '../../components/SettingsOptionScreen';
import { useAppearanceSetting } from '../../contexts/Appearance';
import { logError } from '../../lib/log';
import type { Appearance } from '../../types/Settings';

export default function AppearanceSettingsScreen() {
  const { t } = useTranslation();
  const { appearance, loaded, setAppearance } = useAppearanceSetting();
  const [busy, setBusy] = useState(false);

  const OPTIONS: { value: Appearance; label: string }[] = [
    { value: 'system', label: t('settings.appearance.system') },
    { value: 'light', label: t('settings.appearance.light') },
    { value: 'dark', label: t('settings.appearance.dark') },
  ];

  const persist = async (next: Appearance) => {
    if (next === appearance) return;
    setBusy(true);
    try {
      await setAppearance(next);
    } catch (error) {
      logError('Saving preferences.appearance failed', error);
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsOptionScreen
      options={OPTIONS}
      value={loaded ? appearance : null}
      busy={busy}
      onSelect={persist}
      caption={t('settings.appearance.caption')}
    />
  );
}
