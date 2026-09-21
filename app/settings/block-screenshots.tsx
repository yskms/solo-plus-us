/**
 * UI/UX §17 PRIVACY section — "Block Screenshots". Opt-in, default off
 * (see CLAUDE.md「スクリーンショットに関する方針」/ lib/screenMask.ts) —
 * unlike "Hide App Preview", this one has a real switch.
 *
 * Android below API 33 has no OS API to separate Recent Apps hiding from
 * screenshot blocking (see lib/screenMask.ts's doc comment), so on those
 * devices screenshots are already permanently blocked as a side effect
 * of the always-on Recent Apps protection. The switch there is locked
 * on, with copy explaining why, rather than offering a toggle that
 * wouldn't actually do anything.
 *
 * Reads/writes through `useScreenshotBlockSetting()` rather than its own
 * `getSetting`/`setSetting` calls — `contexts/ScreenshotBlock.tsx` is the
 * single source of truth for the current value (see that file's doc
 * comment on why a second DB read here would risk drifting from it).
 */
import React, { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useScreenshotBlockSetting } from '../../contexts/ScreenshotBlock';
import { logError } from '../../lib/log';

const ANDROID_LEGACY_FORCED_ON = Platform.OS === 'android' && Platform.Version < 33;

export default function BlockScreenshotsSettingsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { enabled, loaded, setEnabled } = useScreenshotBlockSetting();
  const [busy, setBusy] = useState(false);

  const persist = async (next: boolean) => {
    setBusy(true);
    try {
      await setEnabled(next);
    } catch (error) {
      // `enabled` was never updated on failure (see ScreenshotBlock.tsx),
      // so the Switch — bound directly to it — naturally reverts to the
      // last actually-applied value without any extra state here.
      logError('Saving privacy.blockScreenshots failed', error);
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary, padding: spacing.md }}>{t('common.loading')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.row, { borderColor: colors.border }]}>
          <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{t('settings.index.blockScreenshots')}</Text>
          <Switch
            value={ANDROID_LEGACY_FORCED_ON || enabled}
            onValueChange={persist}
            disabled={busy || ANDROID_LEGACY_FORCED_ON}
          />
        </View>
        <Text style={[styles.caption, { color: colors.textTertiary }]}>
          {ANDROID_LEGACY_FORCED_ON
            ? t('settings.blockScreenshots.androidLegacyCaption')
            : t('settings.blockScreenshots.caption')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouchTarget,
  },
  rowLabel: { fontSize: 16, fontWeight: '500' },
  caption: { fontSize: 12, paddingHorizontal: spacing.xs, lineHeight: 17 },
});
