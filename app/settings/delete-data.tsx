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
 * Same precedent for button order: `confirmReplace` puts the destructive
 * action first/top and Cancel second — this screen matches it rather than
 * the §17 mockup's left-to-right "[ キャンセル ] [ 削除 ]", for consistency
 * with the sibling destructive-confirm screen already in this app.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import * as ActivityService from '../../services/ActivityService';
import * as SyncCoordinator from '../../services/SyncCoordinator';
import * as HealthSyncJobRepository from '../../repositories/HealthSyncJobRepository';
import { getSetting } from '../../services/SettingsRepository';
import { isHealthConnectBuildEnabled } from '../../lib/healthConnectBuild';
import { logError } from '../../lib/log';

type Step = 'confirm' | 'busy';

export default function DeleteDataScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { bump } = useDataRevision();
  const [step, setStep] = useState<Step>('confirm');

  // Guards two separate races, both real on this screen:
  // 1. A fast double-tap on "Delete All Data" — `setStep('busy')` doesn't
  //    take effect (and disable the button) until the next render, so two
  //    taps in the same tick can both reach here before that happens.
  // 2. `router.back()` inside the completion Alert's OK handler — if the
  //    person backs out of this screen while the delete is still running,
  //    `handleDelete`'s promise keeps going (it isn't tied to the
  //    component), and the Alert (an OS-level dialog, not React state)
  //    still appears over whatever screen they're now on. Calling
  //    `router.back()` there would pop *that* screen, not this one —
  //    closing an extra level of Settings navigation the person never
  //    asked to leave. Only pop if this screen is still the one on top.
  const deletingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleDelete = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
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
      let healthConnectEnabled = false;
      if (Platform.OS === 'android') {
        try {
          // Every remaining job for this provider is necessarily a 'delete'
          // job by construction — deleteAllActivities already resolved every
          // other §10.1 branch (dropped or turned into 'delete') for every
          // Activity that existed.
          //
          // TODO(HealthKit): once an iOS provider exists, this Platform.OS
          // check needs to become a real "is there a second provider active"
          // check — right now `ActivityService.ALL_PROVIDERS` includes
          // 'healthkit', but nothing ever queues a job for it, so counting
          // only 'health_connect' and gating on Android is still correct
          // today.
          [pendingDeleteCount, healthConnectEnabled] = await Promise.all([
            HealthSyncJobRepository.findAllJobsForProvider(db, 'health_connect').then((jobs) => jobs.length),
            getSetting(db, 'healthConnect.enabled').then((v) => v ?? false),
          ]);
        } catch (error) {
          // The delete itself already succeeded — a failure to count what's
          // left over must not be reported as "could not delete". Settings >
          // Health Connect can still be checked directly.
          logError('Checking remaining Health Connect deletions after deleteAllActivities failed', error);
        }
      }

      // §10.6 "Health Connect が未接続の場合": "進行バーを出したまま止めない。
      // 止まっている理由を状態として示す" — don't claim work is actively in
      // flight when Health Connect is off and nothing can actually be sent
      // right now.
      let title: string;
      let message: string;
      if (pendingDeleteCount === 0) {
        title = 'All data deleted';
        message = 'Every activity has been permanently deleted.';
      } else if (!isHealthConnectBuildEnabled()) {
        // §9.11/§25.1 レビュー指摘（2026-09-21・4回目）: ビルド種別の分岐を
        // healthConnectEnabled（ランタイム状態、`reconcileHealthConnectBuildFlag`
        // が起動時に false へ是正するはず）より先に置く——その是正が何らかの
        // 理由で失敗していても（`DatabaseContext.tsx` は try/catch で握って
        // 起動を継続させる設計のため、失敗しても気づかれにくい）、到達不能な
        // 「Settings › Health Connect で再接続」を案内することが無いように
        // する。without-health-connect ビルドでは Settings › Health Connect
        // 自体が到達不能（`app/settings/health-connect.tsx` がリダイレクトする）
        // ので、そこへ案内しない。これらのジョブは permission が無い以上この
        // ビルドでは永久に送信できない——with-health-connect ビルドへ更新
        // された場合にのみ再開する（`services/ActivityService.ts` の
        // `reconcileHealthConnectBuildFlag` doc comment参照）。
        title = 'Deleted from this device';
        message = `Every activity has been deleted from this device. This version of the app can't sync ${pendingDeleteCount} pending Health Connect deletion${pendingDeleteCount > 1 ? 's' : ''} — they'll be sent automatically if this device gets an update with Health Connect support.`;
      } else if (healthConnectEnabled) {
        title = 'Deleted from this device';
        message = `Every activity has been deleted from this device. ${pendingDeleteCount} deletion${pendingDeleteCount > 1 ? 's are' : ' is'} still being sent to Health Connect — check progress anytime in Settings › Health Connect.`;
      } else {
        title = 'Deleted from this device';
        message = `Every activity has been deleted from this device. Health Connect has ${pendingDeleteCount} deletion${pendingDeleteCount > 1 ? 's' : ''} waiting — reconnect in Settings › Health Connect to resume.`;
      }

      Alert.alert(title, message, [
        {
          text: 'OK',
          onPress: () => {
            if (mountedRef.current) router.back();
          },
        },
      ]);
    } catch (error) {
      logError('deleteAllActivities failed', error);
      if (mountedRef.current) setStep('confirm');
      Alert.alert('Could not delete', 'Please try again.');
    } finally {
      deletingRef.current = false;
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
                Records already sent to Health Connect will be deleted there too, over time. If you close Solo + Us
                before that finishes, deletion pauses and picks up again the next time you open the app. If you
                uninstall Solo + Us before it finishes, those records will remain in Health Connect.
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
