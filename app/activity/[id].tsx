/**
 * UI/UX §10/§11 Activity Detail. All optional fields shown unconditionally
 * for Phase 1 — the per-field "Activity Details" show/hide customization
 * (settings/activity-details.tsx, §17 UI/UX) is Phase 3, not built yet
 * (see README "Known gaps"). Date/time editing (基本設計 §12 "過去日時への
 * 記録") is also not built yet — it needs a native date/time picker, which
 * this phase deliberately avoids adding before the first on-device build
 * (see README).
 */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import * as ActivityService from '../../services/ActivityService';
import { contextLabel } from '../../lib/labels';
import type { Activity } from '../../types/Activity';

function formatDateTime(activity: Activity): string {
  const [y, m, d] = activity.occurredLocalDate.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [hh, mm] = activity.occurredLocalTime.split(':').map(Number);
  const period = hh < 12 ? 'AM' : 'PM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${months[m - 1]} ${d}, ${y} · ${hour12}:${String(mm).padStart(2, '0')} ${period}`;
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

  const load = useCallback(async () => {
    if (!id) return;
    const found = await ActivityRepository.findActivityById(db, id);
    setActivity(found);
    if (found) {
      setOrgasm(found.orgasm);
      setEjaculation(found.ejaculation);
      setProtectionUsed(found.protectionUsed);
      setMoodBefore(found.moodBefore);
      setMoodAfter(found.moodAfter);
      setDurationMinutes(found.durationSeconds ? String(Math.round(found.durationSeconds / 60)) : '');
      setDurationTouched(false);
      setNote(found.note ?? '');
    }
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!activity) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>Loading…</Text>
      </SafeAreaView>
    );
  }

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
      });
      router.back();
    } catch (error) {
      Alert.alert('Could not save', 'Your changes were not saved. Please try again.');
      console.error('updateActivity failed', error);
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
          try {
            await ActivityService.deleteActivity(db, activity.id);
            router.back();
          } catch (error) {
            Alert.alert('Could not delete', 'Please try again.');
            console.error('deleteActivity failed', error);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.contextTitle, { color: colors.textPrimary }]}>{contextLabel(activity.context)}</Text>

        <View style={styles.fieldBlock}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>DATE & TIME</Text>
          <Text style={[styles.dateTimeText, { color: colors.textPrimary }]}>{formatDateTime(activity)}</Text>
        </View>

        <TriState label="Orgasm" value={orgasm} onChange={setOrgasm} colors={colors} />
        <TriState label="Ejaculation" value={ejaculation} onChange={setEjaculation} colors={colors} />
        <TriState label="Protection" value={protectionUsed} onChange={setProtectionUsed} colors={colors} />

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
        </View>

        <MoodRow label="Mood before" value={moodBefore} onChange={setMoodBefore} colors={colors} />
        <MoodRow label="Mood after" value={moodAfter} onChange={setMoodAfter} colors={colors} />

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 },
  contextTitle: { fontSize: 22, fontWeight: '700' },
  fieldBlock: { gap: spacing.xs },
  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  dateTimeText: { fontSize: 16, fontWeight: '500' },
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
  saveButton: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  saveButtonText: { fontSize: 16, fontWeight: '700' },
  deleteButton: { alignItems: 'center', paddingVertical: 12, minHeight: minTouchTarget, justifyContent: 'center' },
  deleteButtonText: { fontSize: 15, fontWeight: '600' },
});
