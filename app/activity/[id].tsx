/**
 * UI/UX §10/§11 Activity Detail. Per-field show/hide customization (§6.3,
 * `settings/activity-details.tsx`) gates which *unrecorded* fields render —
 * the invariant (§6.3) is that a field with an already-recorded value is
 * always shown regardless of the setting, so visibility is computed from
 * `activity` (the loaded, stable snapshot) rather than the live-edited
 * field state — see `lib/activityDetailsFields.ts`. `revealed` (via
 * `AddMoreDetailsSheet`, the "その他の項目を追加" escape hatch) is
 * per-visit only, reset on every `load()`, never persisted — deliberately
 * does not survive leaving and reopening this screen.
 *
 * Date/time editing: originally scoped out of this screen (README read
 * UI/UX §27's Phase 3 line as limited to the Add Activity entry point
 * only), then brought into scope by 設計判断記録 D-50. Tapping DATE & TIME
 * opens the same native picker as `app/record.tsx`'s "Change date & time"
 * (`hooks/useNativeDateTimePicker.ts` + `components/DateTimePickerSheet.tsx`,
 * shared by both screens — see that hook's doc comment and `contexts/
 * AppLock.tsx` for why the iOS sheet is a plain absolutely-positioned
 * `View`, not RN's `<Modal>`). Unlike `record.tsx`, there is no "use now
 * instead" reset — this screen always has a real recorded value, never a
 * "Just now" placeholder. The picked value is held in `customInstant` and
 * only actually persisted when the screen's own Save button is pressed,
 * same as every other field here.
 *
 * The picker is seeded from `toLocalDate(activity.occurredLocalDate,
 * activity.occurredLocalTime)` below — a `Date` built by feeding those
 * stored digits straight into the *local* `Date` constructor, read back
 * only ever via *local* getters. This makes the `Date` a pure "carrier"
 * for the Y/M/D/H/Min digits, not a real instant: the native picker
 * always displays/edits a `Date` via those same local getters/setters
 * (there's still no timezone-aware picker, §4.4's known v1 limitation),
 * so this keeps the picker's *starting* position, every intermediate
 * `formatPickedDateTime` display while editing, and the DATE & TIME text
 * shown before you ever tap it, all showing the *same* wall-clock digits
 * — no jump when you open it, no mismatch while you edit it.
 *
 * That Date's own `.getTime()` (its "instant", as far as JS is concerned)
 * is meaningless and never used directly — it's whatever the device's
 * *current* zone happens to make of those digits, which is wrong the
 * moment the device's current zone differs from the zone the event was
 * actually recorded in. Converting the final edited digits into the real
 * UTC instant to save — as wall-clock time *in the record's own
 * `timezoneId`*, never the device's current one — is `resolveOccurredAtEdit`'s
 * job (`lib/datetime.ts`); see its doc comment for the two wrong
 * approaches this replaced (D-50 review findings #1, across two rounds).
 *
 * The picker's own *future*-time guard (native `maximumDate` props, and
 * the Android chained-dialog combine-then-clamp) must judge "future-ness"
 * the same digit-carrier way — against `nowAsZonedDigits(activity.
 * timezoneId)` (`getMax` below), not real "now". A 3rd review round found
 * that comparing a digit carrier against real "now" silently replaced a
 * genuinely valid *past* moment with an unrelated one whenever the
 * record's zone is east of the device's — see `nowAsZonedDigits`'s doc
 * comment in `lib/datetime.ts` for the concrete scenario.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useAppLockActions } from '../../contexts/AppLock';
import { useNativeDateTimePicker } from '../../hooks/useNativeDateTimePicker';
import { DateTimePickerSheet } from '../../components/DateTimePickerSheet';
import { AddMoreDetailsSheet } from '../../components/AddMoreDetailsSheet';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import * as ActivityService from '../../services/ActivityService';
import { getSetting } from '../../services/SettingsRepository';
import { contextLabel } from '../../lib/labels';
import { formatCalendarDateTime, formatPickedDateTime } from '../../lib/timeFormat';
import { getDeviceTimeZoneId, nowAsZonedDigits, resolveOccurredAtEdit } from '../../lib/datetime';
import { logError } from '../../lib/log';
import { ACTIVITY_DETAIL_FIELDS, isFieldVisible, type ActivityDetailField } from '../../lib/activityDetailsFields';
import type { Activity } from '../../types/Activity';
import type { TimeFormat } from '../../types/Settings';

type ActivityDetailSettingKey = (typeof ACTIVITY_DETAIL_FIELDS)[number]['settingKey'];
type DetailSettings = Record<ActivityDetailSettingKey, boolean>;

function formatDateTime(activity: Activity, timeFormat: TimeFormat): string {
  const [y, m, d] = activity.occurredLocalDate.split('-').map(Number);
  return formatCalendarDateTime(y, m - 1, d, activity.occurredLocalTime, timeFormat);
}

/**
 * Digit carrier for seeding the picker — see the file doc comment for why
 * this must NOT be treated as a real instant. Known limitation: if the
 * device's *current* zone doesn't recognize this wall-clock time (a DST
 * "spring forward" gap), `Date`'s local constructor silently shifts it
 * forward by the gap (e.g. a stored 02:30 becomes 03:30) rather than
 * rejecting it — same class of undefended DST-gap edge case as
 * `lib/androidDateTimePicker.ts`'s own comment. Very rare in practice
 * (requires editing right as a DST transition is being crossed) and not
 * specially handled.
 */
function toLocalDate(localDate: string, localTime: string): Date {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh, mm] = localTime.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function TriState({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const options: { key: string; value: boolean | null; text: string }[] = [
    { key: 'unset', value: null, text: 'Not recorded' },
    { key: 'yes', value: true, text: 'Yes' },
    { key: 'no', value: false, text: 'No' },
  ];
  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.segmentedRow}>
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <Pressable
              key={opt.key}
              onPress={() => onChange(opt.value)}
              style={[
                styles.segment,
                { borderColor: colors.border, backgroundColor: selected ? colors.solo : 'transparent' },
              ]}
            >
              <Text style={{ color: selected ? colors.background : colors.textPrimary, fontSize: 13 }}>{opt.text}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MoodRow({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.segmentedRow}>
        {[1, 2, 3, 4, 5].map((n) => {
          const selected = value === n;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(selected ? null : n)}
              style={[
                styles.moodDot,
                { borderColor: colors.border, backgroundColor: selected ? colors.solo : 'transparent' },
              ]}
            >
              <Text style={{ color: selected ? colors.background : colors.textSecondary, fontSize: 13 }}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const db = useDatabase();
  const { isLocked } = useAppLockActions();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [orgasm, setOrgasm] = useState<boolean | null>(null);
  const [ejaculation, setEjaculation] = useState<boolean | null>(null);
  const [protectionUsed, setProtectionUsed] = useState<boolean | null>(null);
  const [moodBefore, setMoodBefore] = useState<number | null>(null);
  const [moodAfter, setMoodAfter] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<string>('');
  // Whether the person has actually edited the duration field this visit.
  // Without this, re-saving an untouched duration would round-trip through
  // whole minutes and silently corrupt it: 20s displays as "0" and saves
  // back as null; 90s displays as "2" and saves back as 120. Tracking
  // "touched" lets an unedited field pass the exact original value through
  // unchanged instead of the lossy rounded-then-reparsed one.
  const [durationTouched, setDurationTouched] = useState(false);
  const [note, setNote] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');
  const [detailSettings, setDetailSettings] = useState<DetailSettings | null>(null);
  const [revealed, setRevealed] = useState<Set<ActivityDetailField>>(new Set());
  const [addMoreVisible, setAddMoreVisible] = useState(false);
  const getBase = () => (activity ? toLocalDate(activity.occurredLocalDate, activity.occurredLocalTime) : new Date());
  const getMax = () => (activity ? nowAsZonedDigits(activity.timezoneId ?? getDeviceTimeZoneId()) : new Date());
  const { customInstant, iosPickerVisible, pendingInstant, setPendingInstant, open, confirmIos, cancelIos, reset } =
    useNativeDateTimePicker(getBase, getMax, isLocked);

  const load = useCallback(async () => {
    if (!id) return;
    const [found, tf, detailEntries] = await Promise.all([
      ActivityRepository.findActivityById(db, id),
      getSetting(db, 'preferences.timeFormat'),
      Promise.all(ACTIVITY_DETAIL_FIELDS.map(async ({ settingKey }) => [settingKey, await getSetting(db, settingKey)] as const)),
    ]);
    setActivity(found);
    setTimeFormat(tf);
    setDetailSettings(Object.fromEntries(detailEntries) as DetailSettings);
    setRevealed(new Set()); // per-visit only (§6.3 "その他の項目を追加"), never persisted
    if (found) {
      setOrgasm(found.orgasm);
      setEjaculation(found.ejaculation);
      setProtectionUsed(found.protectionUsed);
      setMoodBefore(found.moodBefore);
      setMoodAfter(found.moodAfter);
      setDurationMinutes(found.durationSeconds ? String(Math.round(found.durationSeconds / 60)) : '');
      setDurationTouched(false);
      setNote(found.note ?? '');
      reset();
    }
  }, [db, id, reset]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!activity || !detailSettings) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  // Computed from `activity` (the stable, loaded snapshot) rather than the
  // live-edited orgasm/ejaculation/etc. state — see file doc comment: a
  // field must not disappear mid-edit just because its value was cleared.
  const visible = Object.fromEntries(
    ACTIVITY_DETAIL_FIELDS.map(({ field, settingKey }) => [
      field,
      isFieldVisible(field, detailSettings[settingKey], activity, revealed),
    ]),
  ) as Record<ActivityDetailField, boolean>;
  const hiddenFields = ACTIVITY_DETAIL_FIELDS.filter(({ field }) => !visible[field]);

  const save = async () => {
    let durationSeconds: number | null;
    if (!durationTouched) {
      // Field was never edited this visit — pass the exact original value
      // through. Recomputing from the rounded-to-minutes display value
      // would silently corrupt any duration that isn't a whole number of
      // minutes (see `durationTouched` doc comment above).
      durationSeconds = activity.durationSeconds;
    } else if (durationMinutes.trim() === '') {
      durationSeconds = null; // explicitly cleared
    } else {
      const parsedMinutes = Number(durationMinutes);
      if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
        Alert.alert('Invalid duration', 'Enter a duration in minutes, or leave it blank.');
        return;
      }
      durationSeconds = Math.round(parsedMinutes * 60);
    }

    // {} when the picker was never opened, or was opened and confirmed
    // without actually changing the recorded minute — see
    // `resolveOccurredAtEdit`'s doc comment (lib/datetime.ts) for why this
    // must resolve against the record's own timezoneId, not the device's
    // current one.
    const dateTimePatch = resolveOccurredAtEdit(activity.occurredAtUtc, activity.timezoneId, customInstant);

    setSaving(true);
    try {
      await ActivityService.updateActivity(db, activity.id, {
        orgasm,
        ejaculation,
        protectionUsed,
        moodBefore,
        moodAfter,
        durationSeconds,
        note: note.trim() === '' ? null : note,
        ...dateTimePatch,
      });
      router.back();
    } catch (error) {
      Alert.alert('Could not save', 'Your changes were not saved. Please try again.');
      logError('updateActivity failed', error);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert('Delete this activity?', 'This will remove the record from this app.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // This Alert is a system dialog — it renders above the App
          // Lock overlay (contexts/AppLock.tsx), so it can still be
          // sitting open and tappable if the app was backgrounded and
          // locked while it was up. Checked here, not before opening the
          // Alert: the screen itself is already unreachable once locked
          // (pointerEvents="none"), so this only ever matters for an
          // Alert that was already open before the lock happened.
          if (isLocked()) return;
          try {
            await ActivityService.deleteActivity(db, activity.id);
            router.back();
          } catch (error) {
            Alert.alert('Could not delete', 'Please try again.');
            logError('deleteActivity failed', error);
          }
        },
      },
    ]);
  };

  const dateTimeText = customInstant ? formatPickedDateTime(customInstant, timeFormat) : formatDateTime(activity, timeFormat);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.contextTitle, { color: colors.textPrimary }]}>{contextLabel(activity.context)}</Text>

        <View style={styles.fieldBlock}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>DATE & TIME</Text>
          <Pressable
            onPress={open}
            disabled={saving}
            style={({ pressed }) => [styles.dateTimeRow, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={dateTimeText}
            accessibilityHint="Opens a date and time picker to change when this happened"
          >
            <Text style={[styles.dateTimeText, { color: colors.textPrimary }]}>{dateTimeText}</Text>
            <Text style={[styles.dateTimeChevron, { color: colors.textTertiary }]}>›</Text>
          </Pressable>
        </View>

        {visible.orgasm && <TriState label="Orgasm" value={orgasm} onChange={setOrgasm} colors={colors} />}
        {visible.ejaculation && (
          <TriState label="Ejaculation" value={ejaculation} onChange={setEjaculation} colors={colors} />
        )}
        {visible.protection && (
          <TriState label="Protection" value={protectionUsed} onChange={setProtectionUsed} colors={colors} />
        )}

        {visible.duration && (
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Duration (minutes)</Text>
            <TextInput
              value={durationMinutes}
              onChangeText={(value) => {
                setDurationMinutes(value);
                setDurationTouched(true);
              }}
              keyboardType="number-pad"
              placeholder="Not recorded"
              placeholderTextColor={colors.textTertiary}
              style={[styles.textInput, { color: colors.textPrimary, borderColor: colors.border }]}
            />
            {!durationTouched && activity.durationSeconds != null && activity.durationSeconds % 60 !== 0 && (
              // This field only edits whole minutes, so any duration that
              // isn't an exact multiple of 60s displays rounded here — not
              // just the < 60s case (90s still shows "2"). Say the real
              // value so the rounding is never mistaken for what's actually
              // recorded. Untouched, saving still keeps the exact original
              // value (see `durationTouched` above); this is display-only.
              <Text style={[styles.fieldCaption, { color: colors.textTertiary }]}>
                Recorded as {activity.durationSeconds} seconds, shown here as{' '}
                {Math.round(activity.durationSeconds / 60)} min. Editing this field will replace it with a whole
                number of minutes.
              </Text>
            )}
          </View>
        )}

        {visible.mood && (
          <>
            <MoodRow label="Mood before" value={moodBefore} onChange={setMoodBefore} colors={colors} />
            <MoodRow label="Mood after" value={moodAfter} onChange={setMoodAfter} colors={colors} />
          </>
        )}

        {visible.note && (
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Notes</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Add a note"
              placeholderTextColor={colors.textTertiary}
              style={[styles.textArea, { color: colors.textPrimary, borderColor: colors.border }]}
            />
          </View>
        )}

        {hiddenFields.length > 0 && (
          <Pressable
            onPress={() => setAddMoreVisible(true)}
            style={styles.addMoreRow}
            accessibilityRole="button"
          >
            <Text style={[styles.addMoreLink, { color: colors.solo }]}>+ Add more details</Text>
          </Pressable>
        )}

        <Pressable
          onPress={save}
          disabled={saving}
          style={[styles.saveButton, { backgroundColor: colors.solo, opacity: saving ? 0.7 : 1 }]}
        >
          <Text style={[styles.saveButtonText, { color: colors.background }]}>Save</Text>
        </Pressable>

        <Pressable onPress={confirmDelete} style={styles.deleteButton}>
          <Text style={[styles.deleteButtonText, { color: colors.destructive }]}>Delete Activity</Text>
        </Pressable>
      </ScrollView>

      <DateTimePickerSheet
        visible={iosPickerVisible}
        value={pendingInstant ?? getBase()}
        maximumDate={getMax()}
        onChange={setPendingInstant}
        onCancel={cancelIos}
        onDone={confirmIos}
      />

      <AddMoreDetailsSheet
        visible={addMoreVisible}
        hiddenFields={hiddenFields}
        onReveal={(field) => setRevealed((current) => new Set(current).add(field))}
        onClose={() => setAddMoreVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 },
  contextTitle: { fontSize: 22, fontWeight: '700' },
  fieldBlock: { gap: spacing.xs },
  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  fieldCaption: { fontSize: 12, lineHeight: 16 },
  dateTimeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: minTouchTarget },
  dateTimeText: { fontSize: 16, fontWeight: '500' },
  dateTimeChevron: { fontSize: 18, fontWeight: '600' },
  segmentedRow: { flexDirection: 'row', gap: spacing.xs },
  segment: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  moodDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: minTouchTarget,
  },
  textArea: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  addMoreRow: { alignItems: 'center', minHeight: minTouchTarget, justifyContent: 'center' },
  addMoreLink: { fontSize: 14, fontWeight: '600' },
  saveButton: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  saveButtonText: { fontSize: 16, fontWeight: '700' },
  deleteButton: { alignItems: 'center', paddingVertical: 12, minHeight: minTouchTarget, justifyContent: 'center' },
  deleteButtonText: { fontSize: 15, fontWeight: '600' },
});
