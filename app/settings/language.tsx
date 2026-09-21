/**
 * Settings > Language — System / 日本語 / English, backed by
 * `preferences.language` via `contexts/Language.tsx`. Mirrors
 * `app/settings/appearance.tsx` exactly; see that file and
 * `contexts/Language.tsx`'s doc comment for the shared design.
 *
 * The two language names are deliberately NOT run through `t()` — each
 * displays in its own script regardless of the current UI language
 * (the standard convention other apps' language pickers use).
 */
import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import SettingsOptionScreen from '../../components/SettingsOptionScreen';
import { useLanguageSetting } from '../../contexts/Language';
import { logError } from '../../lib/log';
import type { Language } from '../../types/Settings';

export default function LanguageSettingsScreen() {
  const { t } = useTranslation();
  const { language, loaded, setLanguage } = useLanguageSetting();
  const [busy, setBusy] = useState(false);

  const OPTIONS: { value: Language; label: string }[] = [
    { value: 'system', label: t('settings.language.system') },
    { value: 'ja', label: '日本語' },
    { value: 'en', label: 'English' },
  ];

  const persist = async (next: Language) => {
    if (next === language) return;
    setBusy(true);
    try {
      await setLanguage(next);
    } catch (error) {
      logError('Saving preferences.language failed', error);
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsOptionScreen
      options={OPTIONS}
      value={loaded ? language : null}
      busy={busy}
      onSelect={persist}
      caption={t('settings.language.caption')}
    />
  );
}
