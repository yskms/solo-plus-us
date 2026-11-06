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
 * default flow: the wheels (`components/DateTimeWheel.tsx`) are always on
 * screen, and turning them is what sets `customFields` (until then they
 * follow the clock, and Solo/Partnered record the moment they're tapped).
 * The wheels never correct a pick (that fought the finger and froze the
 * screen), so a time after now and a day the month doesn't have (Nov 31) can
 * both be parked on. Both are dealt with when Solo/Partnered is tapped
 * (`record` below): a future time asks for a confirmation, a day that
 * doesn't exist is refused with an alert. "Just now" is neither, so the
 * default flow gets no extra step. There is deliberately no "Just now" / picked-time text above them: the
 * wheels already show the value, and a line that appears on the first
 * change would push them down mid-gesture. No timezone picker in v1 (§4.4
 * known limitation) — the picked wall-clock time is always interpreted in
 * the device's current IANA zone, via `ActivityService.recordActivity`'s
 * existing `timezoneId` default (`getDeviceTimeZoneId()`), which also
 * resolves the DST-correct offset for that moment
 * (`resolveOffsetMinutesForZone`).
 *
 * The wheels are plain in-tree views, not a native dialog/sheet, so
 * `contexts/AppLock.tsx`'s overlay covers them with the rest of the screen
 * (see that file's doc comment). `app/activity/[id].tsx`'s post-hoc edit
 * (D-50) still uses the native picker (`hooks/useNativeDateTimePicker.ts`).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';
import { useDatabase } from '../contexts/DatabaseContext';
import { useRecordFeedback } from '../contexts/RecordFeedback';
import { DateTimeWheel } from '../components/DateTimeWheel';
import { instantForPastLocalDateAtNow, sameMinute } from '../lib/datetime';
import { type WheelFields, fromWheelFields, isValidWheelDate, toWheelFields } from '../lib/dateTimeWheel';
import { contextLabel, contextCaption } from '../lib/labels';
import { logError } from '../lib/log';
import { formatPickedDateTime, formatWheelFields } from '../lib/timeFormat';
import * as ActivityService from '../services/ActivityService';
import { getSetting } from '../services/SettingsRepository';
import type { ActivityContext } from '../types/Activity';
import type { TimeFormat } from '../types/Settings';

// How long after a touch ends a wheel may still be coasting to its resting row.
const WHEEL_COAST_MS = 1500;

export default function RecordScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const db = useDatabase();
  const { announceRecorded } = useRecordFeedback();
  const [saving, setSaving] = useState(false);
  // True while a "future time" / "no such date" alert is up: stops a second tap from stacking another.
  const alertOpenRef = useRef(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');
  const getNow = () => new Date();
  // The Calendar tab's "add to this day" passes `date` (YYYY-MM-DD); it starts
  // the picked time as that day + the current time of day. `null` (no/invalid
  // param, today, or a future day) leaves the normal "Just now" flow.
  const { date } = useLocalSearchParams<{ date?: string }>();
  // The picked time as the wheel's five numbers (not a `Date`: the wheel can hold Nov 31, see `record`).
  const [customFields, setCustomFields] = useState<WheelFields | null>(() => {
    const instant = typeof date === 'string' ? instantForPastLocalDateAtNow(date) : null;
    return instant ? toWheelFields(instant) : null;
  });
  // What the wheels show while `customFields` is still null ("Just now"). It
  // follows the clock (below) so the wheels never read a different minute
  // from the one Solo/Partnered will record.
  const [wheelBase, setWheelBase] = useState(getNow);
  // Until this time (ms) the wheels are being touched or are still coasting;
  // the clock must not move them under a finger.
  const wheelBusyUntilRef = useRef(0);

  useEffect(() => {
    getSetting(db, 'preferences.timeFormat')
      .then(setTimeFormat)
      .catch((error) => logError('Loading preferences.timeFormat failed', error));
  }, [db]);

  useEffect(() => {
    if (customFields) return;
    const id = setInterval(() => {
      if (Date.now() < wheelBusyUntilRef.current) return;
      setWheelBase((base) => (sameMinute(base, getNow()) ? base : getNow()));
    }, 5000);
    return () => clearInterval(id);
  }, [customFields]);

  const resetToNow = () => {
    setCustomFields(null);
    setWheelBase(getNow());
  };

  const save = async (context: ActivityContext, instantUtc: Date) => {
    if (saving) return; // guards against a double-tap firing two records
    setSaving(true);
    try {
      const activity = await ActivityService.recordActivity(db, { context, instantUtc });
      router.back();
      announceRecorded(activity);
    } catch (error) {
      Alert.alert(t('record.couldNotRecord'), t('common.pleaseTryAgain'));
      logError('recordActivity failed', error);
    } finally {
      setSaving(false);
    }
  };

  const record = (context: ActivityContext) => {
    if (saving || alertOpenRef.current) return;
    if (!customFields) {
      void save(context, new Date());
      return;
    }
    const closeAlert = () => {
      alertOpenRef.current = false;
    };
    // The wheel lets "Nov 31" sit there (it never corrects a pick under the
    // finger); a `Date` would quietly turn it into Dec 1, so refuse it here.
    if (!isValidWheelDate(customFields)) {
      alertOpenRef.current = true;
      Alert.alert(
        t('record.invalidDateTitle'),
        t('record.invalidDateMessage', { datetime: formatWheelFields(t, customFields, timeFormat) }),
        [{ text: t('common.ok'), onPress: closeAlert }],
        { cancelable: true, onDismiss: closeAlert },
      );
      return;
    }
    const instant = fromWheelFields(customFields);
    if (instant.getTime() <= Date.now()) {
      void save(context, instant);
      return;
    }
    // A future time is allowed, but it's far more often a slip (the hour was
    // turned to 23 and the day left alone) than intended, so ask once.
    alertOpenRef.current = true;
    Alert.alert(
      t('record.futureTitle'),
      t('record.futureMessage', { datetime: formatPickedDateTime(t, instant, timeFormat) }),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: closeAlert },
        {
          text: t('record.futureConfirm'),
          onPress: () => {
            closeAlert();
            void save(context, instant);
          },
        },
      ],
      { cancelable: true, onDismiss: closeAlert },
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t('record.title')}</Text>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('record.close')}>
          <Text style={[styles.close, { color: colors.textSecondary }]}>✕</Text>
        </Pressable>
      </View>

      <Text style={[styles.prompt, { color: colors.textSecondary }]}>{t('record.prompt')}</Text>

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
          <Text style={[styles.optionTitle, { color: colors.textPrimary }]}>{contextLabel(t, 'solo')}</Text>
          <Text style={[styles.optionCaption, { color: colors.textSecondary }]}>{contextCaption(t, 'solo')}</Text>
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
          <Text style={[styles.optionTitle, { color: colors.textPrimary }]}>{contextLabel(t, 'partnered')}</Text>
          <Text style={[styles.optionCaption, { color: colors.textSecondary }]}>{contextCaption(t, 'partnered')}</Text>
        </View>
      </Pressable>

      <View style={styles.whenBlock}>
        <View
          onTouchStart={() => {
            wheelBusyUntilRef.current = Number.POSITIVE_INFINITY;
          }}
          onTouchEnd={() => {
            wheelBusyUntilRef.current = Date.now() + WHEEL_COAST_MS;
          }}
          onTouchCancel={() => {
            wheelBusyUntilRef.current = Date.now() + WHEEL_COAST_MS;
          }}
        >
          <DateTimeWheel
            value={customFields ?? toWheelFields(wheelBase)}
            now={getNow()}
            timeFormat={timeFormat}
            onChange={setCustomFields}
          />
        </View>
        {/* Always laid out, only shown once there's something to reset: the
            content is centered on the screen, so a row that came and went
            would shift the wheels under the finger. */}
        <Pressable
          onPress={resetToNow}
          disabled={!customFields}
          style={[styles.resetRow, !customFields && styles.resetRowHidden]}
          accessibilityRole="button"
          accessibilityLabel={t('record.useNowInsteadA11y')}
          accessibilityElementsHidden={!customFields}
          importantForAccessibility={customFields ? 'auto' : 'no-hide-descendants'}
        >
          <Text style={[styles.resetLink, { color: colors.textTertiary }]}>{t('record.useNowInstead')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.md, justifyContent: 'center' },
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
  whenBlock: { alignItems: 'stretch', marginTop: spacing.md },
  resetRow: { minHeight: minTouchTarget, justifyContent: 'center', alignItems: 'center' },
  resetRowHidden: { opacity: 0 },
  resetLink: { fontSize: 12, textDecorationLine: 'underline' },
});
