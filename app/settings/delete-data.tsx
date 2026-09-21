/**
 * UI/UX §17 Screen 07 DATA section "Delete Data" / 基本設計 §10.6.
 *
 * Deliberate scope trim vs. §18's mockup, confirmed with the user
 * (README's Phase 3 "Preferences・About" section — this was called out
 * there as a separate task): the mockup's live "Health Connect 12/47"
 * progress screen isn't built here. 基本設計 §10.6 itself doesn't persist
 * the total across a restart ("進行総数は永続化しないため、再起動後は残り
 * 件数だけを表示する"), and Settings > Health Connect's existing "Unsynced
 * changes" list (§10.4, `health-connect.tsx`) already gives exactly that
 * after-the-fact visibility — including per-job retry/discard — without
 * building a second, parallel polling UI. This screen owns only the
 * up-front confirmation and the (local-only, so effectively immediate)
 * delete itself; the Health Connect outbox left behind is that existing
 * screen's job, same as it already is for every other source of pending
 * jobs (§9.6/§10.4/§10.5).
 *
 * Confirmation is a dedicated screen step, not a native `Alert.alert`,
 * matching `app/settings/data.tsx`'s `confirmReplace` step — this
 * codebase's precedent for "the most destructive action in the app"
 * confirmations (§17 "全削除は「記録を消したい」という意思が最も強い場面").
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import * as ActivityService from '../../services/ActivityService';
import * as SyncCoordinator from '../../services/SyncCoordinator';
import * as HealthSyncJobRepository from '../../repositories/HealthSyncJobRepository';
import { logError } from '../../lib/log';

type Step = 'confirm' | 'busy';

export default function DeleteDataScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { bump } = useDataRevision();
  const [step, setStep] = useState<Step>('confirm');

  const handleDelete = async () => {
    setStep('busy');
    try {
      // §9.12/CLAUDE.md「Health Connect 同期の排他制御」: destructive ops go
      // through SyncCoordinator.runExclusive, and the callback does only the
      // DB write — no drain/queue processing called from inside (nesting
      // deadlocks the serialization queue, see SyncCoordinator's doc
      // comment "直列化").
      await SyncCoordinator.runExclusive(() => ActivityService.deleteAllActivities(db));
      bump(); // Today/Calendar/Insights etc. pick up the now-empty state immediately.

      let pendingDeleteCount = 0;
      if (Platform.OS === 'android') {
        try {
          // Every remaining job for this provider is necessarily a 'delete'
          // job by construction — deleteAllActivities already resolved every
          // other §10.1 branch (dropped or turned into 'delete') for every
          // Activity that existed.
          pendingDeleteCount = (await HealthSyncJobRepository.findAllJobsForProvider(db, 'health_connect')).length;
        } catch (error) {
          // The delete itself already succeeded — a failure to count what's
          // left over must not be reported as "could not delete". Settings >
          // Health Connect can still be checked directly.
          logError('Counting remaining Health Connect delete jobs after deleteAllActivities failed', error);
        }
      }

      Alert.alert(
        pendingDeleteCount > 0 ? 'Deleted from this device' : 'All data deleted',
        pendingDeleteCount > 0
          ? `Every activity has been deleted from this device. ${pendingDeleteCount} deletion${pendingDeleteCount > 1 ? 's are' : ' is'} still being sent to Health Connect — check progress anytime in Settings › Health Connect.`
          : 'Every activity has been permanently deleted.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      logError('deleteAllActivities failed', error);
      setStep('confirm');
      Alert.alert('Could not delete', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {step === 'confirm' && (
          <View style={styles.section}>
            <Text style={[styles.headline, { color: colors.textPrimary }]}>Delete all data?</Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>
              Every activity on this device will be deleted immediately.
            </Text>
            {Platform.OS === 'android' && (
              <Text style={[styles.caption, { color: colors.textTertiary }]}>
                Records already sent to Health Connect will be deleted there too, which can take a moment. If you
                uninstall Solo + Us before that finishes, those records will remain in Health Connect.
              </Text>
            )}
            <Text style={[styles.caption, { color: colors.textTertiary }]}>
              This can&apos;t be undone. If you want to keep a copy, export your data first — Settings › Export &amp;
              Import.
            </Text>
            <View style={styles.actions}>
              <Pressable
                onPress={handleDelete}
                style={[styles.button, { backgroundColor: colors.destructive }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.background }]}>Delete All Data</Text>
              </Pressable>
              <Pressable
                onPress={() => router.back()}
                style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.textPrimary }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        )}

        {step === 'busy' && (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={[styles.caption, { color: colors.textSecondary }]}>Deleting…</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.lg },
  section: { gap: spacing.xs },
  caption: { fontSize: 12, paddingHorizontal: spacing.xs, lineHeight: 17 },
  headline: { fontSize: 16, fontWeight: '600', paddingHorizontal: spacing.xs },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  button: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  secondaryButton: { borderWidth: StyleSheet.hairlineWidth, backgroundColor: 'transparent' },
  buttonText: { fontSize: 16, fontWeight: '700' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center', paddingVertical: spacing.lg },
});
