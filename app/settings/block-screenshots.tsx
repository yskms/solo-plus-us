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
 */
import React, { useCallback, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useScreenshotBlockSetting } from '../../contexts/ScreenshotBlock';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import { logError } from '../../lib/log';

const ANDROID_LEGACY_FORCED_ON = Platform.OS === 'android' && Platform.Version < 33;

export default function BlockScreenshotsSettingsScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { setEnabled: applyEnabled } = useScreenshotBlockSetting();

  const [enabled, setEnabledState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const value = await getSetting(db, 'privacy.blockScreenshots');
    setEnabledState(value);
    setLoaded(true);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const persist = async (next: boolean) => {
    setBusy(true);
    try {
      await setSetting(db, 'privacy.blockScreenshots', next);
      setEnabledState(next);
      applyEnabled(next);
    } catch (error) {
      logError('Saving privacy.blockScreenshots failed', error);
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary, padding: spacing.md }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.row, { borderColor: colors.border }]}>
          <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Block Screenshots</Text>
          <Switch
            value={ANDROID_LEGACY_FORCED_ON || enabled}
            onValueChange={persist}
            disabled={busy || ANDROID_LEGACY_FORCED_ON}
          />
        </View>
        <Text style={[styles.caption, { color: colors.textTertiary }]}>
          {ANDROID_LEGACY_FORCED_ON
            ? "Screenshots and screen recordings can't be blocked separately on this version of Android — hiding your Recent Apps preview already blocks them as a side effect."
            : 'Prevent screenshots and screen recordings while Solo + Us is open.'}
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
