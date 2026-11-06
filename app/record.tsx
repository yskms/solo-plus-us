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
 * default flow: the chooser (`components/DateTimeSelector.tsx`: numbers with
 * an arrow above and below, tap a number for a list) is always on screen, and
 * using it is what sets `customFields` (until then it follows the clock, and
 * Solo/Partnered record the moment they're tapped).
 * Nothing is corrected under a finger, so a time after now can be parked on;
 * `record` below asks for a confirmation when Solo/Partnered is tapped with
 * one. "Just now" is never in the future, so the default flow gets no extra
 * step. There is deliberately no "Just now" / picked-time text above the
 * chooser: it already shows the value, and a line that appears on the first
 * change would push it down mid-tap. No timezone picker in v1 (§4.4
 * known limitation) — the picked wall-clock time is always interpreted in
 * the device's current IANA zone, via `ActivityService.recordActivity`'s
 * existing `timezoneId` default (`getDeviceTimeZoneId()`), which also
 * resolves the DST-correct offset for that moment
 * (`resolveOffsetMinutesForZone`).
 *
 * The chooser and its list are plain in-tree views, not a native
 * dialog/sheet/`<Modal>`, so `contexts/AppLock.tsx`'s overlay covers them with
 * the rest of the screen (see that file's doc comment). The list is drawn
 * here, over the whole screen (`popover` below). `app/activity/[id].tsx`'s
 * post-hoc edit (D-50) still uses the native picker
 * (`hooks/useNativeDateTimePicker.ts`).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';
import { useDatabase } from '../contexts/DatabaseContext';
import { useRecordFeedback } from '../contexts/RecordFeedback';
import { useDateTimeSelector } from '../components/DateTimeSelector';
import { instantForPastLocalDateAtNow, sameMinute } from '../lib/datetime';
import { type DateTimeFields, fromDateTimeFields, toDateTimeFields } from '../lib/dateTimeFields';
import { contextLabel, contextCaption } from '../lib/labels';
import { logError } from '../lib/log';
import { formatPickedDateTime } from '../lib/timeFormat';
import * as ActivityService from '../services/ActivityService';
import { getSetting } from '../services/SettingsRepository';
import type { ActivityContext } from '../types/Activity';
import type { TimeFormat } from '../types/Settings';

export default function RecordScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const db = useDatabase();
  const { announceRecorded } = useRecordFeedback();
  const [saving, setSaving] = useState(false);
  // True while the "future time" alert is up: stops a second tap from stacking another.
  const alertOpenRef = useRef(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');
  const getNow = () => new Date();
  // The Calendar tab's "add to this day" passes `date` (YYYY-MM-DD); it starts
  // the picked time as that day + the current time of day. `null` (no/invalid
  // param, today, or a future day) leaves the normal "Just now" flow.
  const { date } = useLocalSearchParams<{ date?: string }>();
  // The picked time as the chooser's five numbers (not a `Date`: see `lib/dateTimeFields.ts`).
  const [customFields, setCustomFields] = useState<DateTimeFields | null>(() => {
    const instant = typeof date === 'string' ? instantForPastLocalDateAtNow(date) : null;
    return instant ? toDateTimeFields(instant) : null;
  });
  // What the chooser shows while `customFields` is still null ("Just now"). It
  // follows the clock (below) so it never reads a different minute from the
  // one Solo/Partnered will record.
  const [timeBase, setTimeBase] = useState(getNow);

  useEffect(() => {
    getSetting(db, 'preferences.timeFormat')
      .then(setTimeFormat)
      .catch((error) => logError('Loading preferences.timeFormat failed', error));
  }, [db]);

  const { selector, popover, isListOpen } = useDateTimeSelector({
    value: customFields ?? toDateTimeFields(timeBase),
    now: getNow(),
    timeFormat,
    onChange: setCustomFields,
  });

  useEffect(() => {
    // Not while a list is open: the number it was opened from must not change under it.
    if (customFields || isListOpen) return;
    const id = setInterval(() => {
      setTimeBase((base) => (sameMinute(base, getNow()) ? base : getNow()));
    }, 5000);
    return () => clearInterval(id);
  }, [customFields, isListOpen]);

  const resetToNow = () => {
    setCustomFields(null);
    setTimeBase(getNow());
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
    const instant = fromDateTimeFields(customFields);
    if (instant.getTime() <= Date.now()) {
      void save(context, instant);
      return;
    }
    // A future time is allowed, but it's far more often a slip (the hour was
    // moved to 23 and the day left alone) than intended, so ask once.
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
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Hidden from screen readers while a list is open: the list is a sibling
          laid over it, not a native modal, so nothing else keeps them out. */}
      <View
        style={styles.container}
        importantForAccessibility={isListOpen ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={isListOpen}
      >
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
          {selector}
          {/* Always laid out, only shown once there's something to reset: the
              content is centered on the screen, so a row that came and went
              would shift the chooser between two taps. */}
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
      </View>
      {popover}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
