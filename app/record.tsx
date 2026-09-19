/**
 * UI/UX §8 Add Activity. The whole point of this screen is speed: tap
 * Solo or Partnered, it's saved immediately, modal closes (§8 "Quick
 * Record": tap → 1. SQLite保存 2. Modalを閉じる 3. Today更新 4. confirmation
 * 表示). No confirmation dialog in between — the Undo Snackbar (shown back
 * on Today) is the only chance to reconsider, by design (§21/§22: fast,
 * not gated by an extra tap).
 *
 * 基本設計 §11.4/§4.4: changing the recorded time is an optional detour
 * from "Just now", not a required step, so it must not add a tap to the
 * default flow. No timezone picker in v1 (§4.4 known limitation) — the
 * picked wall-clock time is always interpreted in the device's current
 * IANA zone, via `ActivityService.recordActivity`'s existing
 * `timezoneId` default (`getDeviceTimeZoneId()`), which also resolves the
 * DST-correct offset for that moment (`resolveOffsetMinutesForZone`).
 *
 * The iOS picker sheet and Android's chained dialogs are handled by
 * `hooks/useNativeDateTimePicker.ts`, shared with `app/activity/
 * [id].tsx`'s post-hoc edit (D-50) — see that hook's doc comment and
 * `contexts/AppLock.tsx` for why the iOS sheet is a plain
 * absolutely-positioned `View`, not RN's `<Modal>`, and why the Android
 * dialogs are dismissed the moment `AppState` leaves `active`.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';
import { useDatabase } from '../contexts/DatabaseContext';
import { useAppLockActions } from '../contexts/AppLock';
import { useRecordFeedback } from '../contexts/RecordFeedback';
import { useNativeDateTimePicker } from '../hooks/useNativeDateTimePicker';
import { DateTimePickerSheet } from '../components/DateTimePickerSheet';
import { clampToNow } from '../lib/datetime';
import { formatPickedDateTime } from '../lib/timeFormat';
import { logError } from '../lib/log';
import * as ActivityService from '../services/ActivityService';
import { getSetting } from '../services/SettingsRepository';
import type { ActivityContext } from '../types/Activity';
import type { TimeFormat } from '../types/Settings';

export default function RecordScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { announceRecorded } = useRecordFeedback();
  const { isLocked } = useAppLockActions();
  const [saving, setSaving] = useState(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');
  const getNow = () => new Date();
  const { customInstant, iosPickerVisible, pendingInstant, setPendingInstant, open, confirmIos, cancelIos, reset } =
    useNativeDateTimePicker(getNow, getNow, isLocked);

  useEffect(() => {
    getSetting(db, 'preferences.timeFormat')
      .then(setTimeFormat)
      .catch((error) => logError('Loading preferences.timeFormat failed', error));
  }, [db]);

  const record = async (context: ActivityContext) => {
    if (saving) return; // guards against a double-tap firing two records
    setSaving(true);
    try {
      const instantUtc = customInstant ? clampToNow(customInstant) : new Date();
      const activity = await ActivityService.recordActivity(db, { context, instantUtc });
      router.back();
      announceRecorded(activity);
    } catch (error) {
      Alert.alert('Could not record', 'Please try again.');
      logError('recordActivity failed', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Add Activity</Text>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={[styles.close, { color: colors.textSecondary }]}>✕</Text>
        </Pressable>
      </View>

      <Text style={[styles.prompt, { color: colors.textSecondary }]}>How would you like to log?</Text>

      <Pressable
        onPress={() => record('solo')}
        disabled={saving}
        style={({ pressed }) => [
          styles.option,
          { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed || saving ? 0.7 : 1 },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: colors.solo }]} />
        <View>
          <Text style={[styles.optionTitle, { color: colors.textPrimary }]}>Solo</Text>
          <Text style={[styles.optionCaption, { color: colors.textSecondary }]}>Personal activity</Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => record('partnered')}
        disabled={saving}
        style={({ pressed }) => [
          styles.option,
          { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed || saving ? 0.7 : 1 },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: colors.partneredStrong }]} />
        <View>
          <Text style={[styles.optionTitle, { color: colors.textPrimary }]}>Partnered</Text>
          <Text style={[styles.optionCaption, { color: colors.textSecondary }]}>With someone</Text>
        </View>
      </Pressable>

      <View style={styles.whenBlock}>
        <Text style={[styles.now, { color: colors.textTertiary }]}>
          {customInstant ? formatPickedDateTime(customInstant, timeFormat) : 'Just now'}
        </Text>
        <Pressable
          onPress={open}
          disabled={saving}
          style={({ pressed }) => [styles.changeRow, { opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Change date and time"
        >
          <Text style={[styles.changeLink, { color: colors.solo }]}>Change date & time</Text>
        </Pressable>
        {customInstant && (
          <Pressable
            onPress={reset}
            style={styles.resetRow}
            accessibilityRole="button"
            accessibilityLabel="Use current time instead"
          >
            <Text style={[styles.resetLink, { color: colors.textTertiary }]}>Use now instead</Text>
          </Pressable>
        )}
      </View>

      <DateTimePickerSheet
        visible={iosPickerVisible}
        value={pendingInstant ?? getNow()}
        maximumDate={getNow()}
        onChange={setPendingInstant}
        onCancel={cancelIos}
        onDone={confirmIos}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '700' },
  close: { fontSize: 20, minWidth: minTouchTarget, textAlign: 'right' },
  prompt: { fontSize: 15, marginBottom: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  dot: { width: 20, height: 20, borderRadius: 10 },
  optionTitle: { fontSize: 17, fontWeight: '600' },
  optionCaption: { fontSize: 13, marginTop: 2 },
  whenBlock: { alignItems: 'center', marginTop: spacing.sm, gap: 2 },
  now: { fontSize: 13, textAlign: 'center' },
  changeRow: { minHeight: minTouchTarget, justifyContent: 'center', alignItems: 'center' },
  changeLink: { fontSize: 13, fontWeight: '600' },
  resetRow: { minHeight: minTouchTarget, justifyContent: 'center', alignItems: 'center' },
  resetLink: { fontSize: 12, textDecorationLine: 'underline' },
});
