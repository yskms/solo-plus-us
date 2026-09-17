/**
 * UI/UX §19 Screen 09 — App Lock settings. "UNLOCK WITH" has only one
 * option (Device authentication) — no app-specific PIN, per §19's
 * "アプリ独自の PIN を実装しない" — so that row is informational, not a
 * picker.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useAppLockActions } from '../../contexts/AppLock';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import { logError } from '../../lib/log';
import type { AppLockTiming } from '../../types/Settings';

const TIMING_OPTIONS: { value: AppLockTiming; label: string }[] = [
  { value: 'immediately', label: 'Immediately' },
  { value: '1m', label: 'After 1 minute' },
  { value: '5m', label: 'After 5 minutes' },
];

export default function AppLockSettingsScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { refreshAppLockSettings, authenticate } = useAppLockActions();

  const [enabled, setEnabled] = useState(false);
  const [timing, setTiming] = useState<AppLockTiming>('immediately');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [e, t] = await Promise.all([getSetting(db, 'appLock.enabled'), getSetting(db, 'appLock.timing')]);
    setEnabled(e);
    setTiming(t);
    setLoaded(true);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const persistEnabled = async (next: boolean) => {
    if (next) {
      // Enabling App Lock on a device with no usable authentication method
      // would lock the person out of the app with no way back in — there
      // is deliberately no app-level PIN or fallback to offer instead
      // (see contexts/AppLock.tsx). Refuse rather than let that happen.
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) {
        Alert.alert(
          'No device authentication set up',
          'Set up a passcode, fingerprint, or face unlock on this device before turning on App Lock.',
        );
        return;
      }
    } else {
      // Turning App Lock off is otherwise reachable by anyone holding an
      // already-unlocked phone, not just its owner — not in the design
      // docs explicitly, but symmetric with what turning it *on* already
      // requires, so the same authentication is required to turn it off.
      // Goes through AppLockProvider's `authenticate` (not
      // `LocalAuthentication.authenticateAsync` directly) so its shared
      // `authenticatingRef` guard is held for this prompt too — otherwise
      // the AppState churn this prompt can cause (a real backgrounding
      // event on Android, whose passcode fallback is a separate Activity)
      // would be mistaken for the person leaving the app, re-locking it
      // right as this authentication succeeds.
      const success = await authenticate('Confirm to turn off App Lock');
      if (!success) return;
    }
    setBusy(true);
    try {
      await setSetting(db, 'appLock.enabled', next);
      setEnabled(next);
      await refreshAppLockSettings();
    } catch (error) {
      logError('Saving appLock.enabled failed', error);
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const persistTiming = async (next: AppLockTiming) => {
    setBusy(true);
    try {
      await setSetting(db, 'appLock.timing', next);
      setTiming(next);
      await refreshAppLockSettings();
    } catch (error) {
      logError('Saving appLock.timing failed', error);
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
          <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Use App Lock</Text>
          <Switch value={enabled} onValueChange={persistEnabled} disabled={busy} />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>UNLOCK WITH</Text>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.optionRow}>
              <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>Device authentication</Text>
              <Text style={[styles.checkmark, { color: colors.solo }]}>✓</Text>
            </View>
          </View>
          <Text style={[styles.caption, { color: colors.textTertiary }]}>
            Biometrics, or your device passcode if unavailable.
          </Text>
        </View>

        {enabled && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>LOCK</Text>
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {TIMING_OPTIONS.map((option, i) => (
                <Pressable
                  key={option.value}
                  onPress={() => persistTiming(option.value)}
                  disabled={busy}
                  style={[
                    styles.optionRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: timing === option.value }}
                >
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>{option.label}</Text>
                  {timing === option.value && <Text style={[styles.checkmark, { color: colors.solo }]}>✓</Text>}
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouchTarget,
  },
  rowLabel: { fontSize: 16, fontWeight: '500' },
  section: { gap: spacing.xs },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing.xs },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: minTouchTarget,
  },
  optionLabel: { fontSize: 15 },
  checkmark: { fontSize: 16, fontWeight: '700' },
  caption: { fontSize: 12, paddingHorizontal: spacing.xs },
});
