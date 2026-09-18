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
 * The iOS picker is rendered as a plain absolutely-positioned View inside
 * this screen, deliberately NOT React Native's `<Modal>` — `contexts/
 * AppLock.tsx`'s doc comment explains why `record.tsx` avoids a separate
 * native layer (a native Modal/screen-stack "modal" presentation runs
 * outside the view hierarchy the App Lock overlay covers, so it can't be
 * covered by it). Staying inside the normal view tree means the picker
 * gets covered by the lock overlay for free, same as everything else on
 * this screen.
 *
 * Android's native date/time dialogs (`openAndroidPicker`) ARE a separate
 * window the lock overlay can't cover by construction, but — unlike the
 * iOS case — they're dismissible from code
 * (`DateTimePickerAndroid.dismiss`), so the `AppState` listener below
 * closes them (and the iOS sheet) the moment the app leaves `active`,
 * rather than leaving them open across a lock. `isLocked()` is also
 * re-checked in both the date and time dialogs' own callbacks as a second
 * layer, for the gap between a dialog's callback firing and the listener
 * closing it.
 */
import React, { useEffect, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';
import { useDatabase } from '../contexts/DatabaseContext';
import { useAppLockActions } from '../contexts/AppLock';
import { useRecordFeedback } from '../contexts/RecordFeedback';
import { clampToNow, sameMinute } from '../lib/datetime';
import { formatCalendarDateTime } from '../lib/timeFormat';
import { logError } from '../lib/log';
import * as ActivityService from '../services/ActivityService';
import { getSetting } from '../services/SettingsRepository';
import type { ActivityContext } from '../types/Activity';
import type { TimeFormat } from '../types/Settings';

function formatChosenDateTime(date: Date, timeFormat: TimeFormat): string {
  const localTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return formatCalendarDateTime(date.getFullYear(), date.getMonth(), date.getDate(), localTime, timeFormat);
}

/**
 * Android has no combined date+time control, so date and time are two
 * chained native dialogs (the imperative API — a declarative/inline
 * picker would otherwise stay permanently on-screen on this platform).
 * `maximumDate` on the date dialog only blocks picking a *future day*; the
 * time dialog that follows has no date context and would happily accept
 * e.g. 23:00 on today's date even if it's currently 09:00, producing a
 * future instant. `clampToNow` on the combined result is what actually
 * prevents that.
 */
function openAndroidPicker(current: Date, isLocked: () => boolean, onPicked: (date: Date) => void) {
  DateTimePickerAndroid.open({
    value: current,
    mode: 'date',
    maximumDate: new Date(),
    onChange: (dateEvent, pickedDate) => {
      if (dateEvent.type !== 'set' || !pickedDate) return;
      // Checked before opening the second dialog too, not just in the
      // time dialog's own callback below: without this, confirming the
      // date while locked would still pop the time dialog on top of the
      // lock screen.
      if (isLocked()) return;
      DateTimePickerAndroid.open({
        value: current,
        mode: 'time',
        onChange: (timeEvent, pickedTime) => {
          if (timeEvent.type !== 'set' || !pickedTime) return;
          if (isLocked()) return;
          const combined = new Date(pickedDate);
          // DST gap edge case: if the chosen wall-clock time doesn't
          // exist because a DST transition skips over it, `setHours`
          // silently shifts it forward by the gap rather than rejecting
          // it. Not verified on a real device in a DST-observing
          // timezone, so left as a known limitation rather than a
          // dedicated check.
          combined.setHours(pickedTime.getHours(), pickedTime.getMinutes(), 0, 0);
          const clamped = clampToNow(combined);
          if (sameMinute(clamped, current)) return; // confirmed without actually changing it
          onPicked(clamped);
        },
      });
    },
  });
}

export default function RecordScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { announceRecorded } = useRecordFeedback();
  const { isLocked } = useAppLockActions();
  const [saving, setSaving] = useState(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');
  const [customInstant, setCustomInstant] = useState<Date | null>(null);
  const [iosPickerVisible, setIosPickerVisible] = useState(false);
  const [pendingInstant, setPendingInstant] = useState<Date | null>(null);
  const [pickerBase, setPickerBase] = useState<Date | null>(null);

  useEffect(() => {
    getSetting(db, 'preferences.timeFormat')
      .then(setTimeFormat)
      .catch((error) => logError('Loading preferences.timeFormat failed', error));
  }, [db]);

  // Closes any open picker the moment the app leaves `active` (backgrounded,
  // or a system overlay like the App Lock biometric prompt makes it
  // `inactive`), rather than leaving it open across a lock — see the file
  // doc comment. `DateTimePickerAndroid.dismiss` is safe to call even when
  // no dialog of that mode is currently open (no-op).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      if (Platform.OS === 'android') {
        DateTimePickerAndroid.dismiss('date').catch((error) => logError('Dismissing date picker failed', error));
        DateTimePickerAndroid.dismiss('time').catch((error) => logError('Dismissing time picker failed', error));
      } else {
        setIosPickerVisible(false);
      }
    });
    return () => subscription.remove();
  }, []);

  const openPicker = () => {
    if (isLocked()) return; // shouldn't be reachable (this screen sits behind the lock overlay), but guards the picker itself against ever opening while locked
    const base = customInstant ?? new Date();
    if (Platform.OS === 'android') {
      openAndroidPicker(base, isLocked, setCustomInstant);
    } else {
      setPickerBase(base);
      setPendingInstant(base);
      setIosPickerVisible(true);
    }
  };

  const confirmIosPicker = () => {
    if (!isLocked() && pendingInstant && pickerBase && !sameMinute(pendingInstant, pickerBase)) {
      setCustomInstant(clampToNow(pendingInstant));
    }
    setIosPickerVisible(false);
  };

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
          {customInstant ? formatChosenDateTime(customInstant, timeFormat) : 'Just now'}
        </Text>
        <Pressable
          onPress={openPicker}
          disabled={saving}
          style={({ pressed }) => [styles.changeRow, { opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Change date and time"
        >
          <Text style={[styles.changeLink, { color: colors.solo }]}>Change date & time</Text>
        </Pressable>
        {customInstant && (
          <Pressable
            onPress={() => setCustomInstant(null)}
            style={styles.resetRow}
            accessibilityRole="button"
            accessibilityLabel="Use current time instead"
          >
            <Text style={[styles.resetLink, { color: colors.textTertiary }]}>Use now instead</Text>
          </Pressable>
        )}
      </View>

      {Platform.OS === 'ios' && iosPickerVisible && (
        <View style={styles.pickerOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setIosPickerVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss date picker"
          />
          {/* accessibilityViewIsModal: without it, VoiceOver can still reach the
              Solo/Partnered buttons underneath while this sheet is open — it
              isn't a real OS-level modal (see file doc comment), so nothing
              else marks it as the only reachable content. */}
          <View style={[styles.pickerSheet, { backgroundColor: colors.surface }]} accessibilityViewIsModal>
            <View style={styles.pickerSheetHeader}>
              <Pressable onPress={() => setIosPickerVisible(false)} hitSlop={8}>
                <Text style={{ color: colors.textSecondary, fontSize: 16 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmIosPicker} hitSlop={8}>
                <Text style={{ color: colors.solo, fontSize: 16, fontWeight: '700' }}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={pendingInstant ?? new Date()}
              mode="datetime"
              display="spinner"
              maximumDate={new Date()}
              onChange={(event, date) => {
                if (date) setPendingInstant(date);
              }}
            />
          </View>
        </View>
      )}
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
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  pickerSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.lg },
  pickerSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
});
