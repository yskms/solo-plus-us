/**
 * UI/UX §17 Screen 07 DATA section / §20 Screen 10 — Export, plus the
 * §13.3 Import flow the mockup doesn't draw but §25's `ImportPreview` /
 * `DestructiveConfirm` components (and the "12,431 件を読み込みます / 現在
 * の 8,902 件は置き換えられます" preview copy) describe. "Delete Data" (the
 * third DATA row in §17's mockup, §10.6) is its own screen,
 * `app/settings/delete-data.tsx` — a single destructive action with
 * nothing to share with this file's Export/Import step-machine.
 *
 * One file, not three routes, mirroring `components/RecoveryScreen.tsx`'s
 * step-state approach: Import is a multi-step flow (pick → validate →
 * mode choice → [safety export] → confirm → run) that doesn't map
 * cleanly onto §26's single suggested `data.tsx` route without an inline
 * state machine.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import { buildExportPayload, serializeExportFile, serializeExportCsv } from '../../services/ExportService';
import { shareExportFile } from '../../services/ExportSharingService';
import { performSafetyExport } from '../../services/SafetyExportService';
import { validateExportFile } from '../../services/importValidation';
import { performReplaceImport, performAppendImport } from '../../services/ImportService';
import { queueResync } from '../../services/HealthSyncResyncService';
import { getSetting } from '../../services/SettingsRepository';
import * as SyncCoordinator from '../../services/SyncCoordinator';
import { countAllActivities } from '../../repositories/ActivityRepository';
import { SafetyExportFailedError } from '../../lib/errors';
import { logError } from '../../lib/log';
import type { ExportFileV1 } from '../../types/Export';

type Step =
  | { kind: 'menu' }
  | { kind: 'modeChoice'; file: ExportFileV1; currentCount: number }
  | { kind: 'confirmReplace'; file: ExportFileV1; currentCount: number }
  | { kind: 'offerResync'; importedCount: number }
  | { kind: 'busy'; label: string };

/**
 * The per-field messages themselves (from `services/importValidation.ts`)
 * stay English/untranslated — they're schema-violation detail aimed at
 * whoever is debugging a malformed/hand-edited backup file, closer to a
 * technical log line than normal UI copy (design decision, see the i18n
 * design-decision record). Only the surrounding "here's what's wrong"
 * chrome is translated.
 */
function describeValidationErrors(t: TFunction, errors: { path: string; message: string }[]): string {
  const shown = errors.slice(0, 5).map((e) => `${e.path || '(file)'}: ${e.message}`);
  const more = errors.length > shown.length ? t('settings.data.andNMore', { count: errors.length - shown.length }) : '';
  return t('settings.data.notABackup', { errors: shown.join('\n'), more });
}

function describeSafetyExportError(t: TFunction, error: unknown): string {
  if (error instanceof SafetyExportFailedError) {
    switch (error.reason.kind) {
      case 'no-location-chosen':
        return t('settings.data.safetyExportError.noLocationChosen');
      case 'write-failed':
        return t('settings.data.safetyExportError.writeFailed');
      case 'read-back-failed':
        return t('settings.data.safetyExportError.readBackFailed');
      case 'verification-mismatch':
        return t('settings.data.safetyExportError.verificationMismatch', {
          expected: error.reason.expectedCount,
          actual: error.reason.actualCount === -1 ? t('settings.data.safetyExportError.noneFound') : error.reason.actualCount,
        });
    }
  }
  return t('settings.data.safetyExportError.generic');
}

/**
 * §13.3/D-27's safety-export step, shown before the person commits to a
 * replace — they need to know *where* the verified copy of their current
 * data is going, not just that one will exist. Platform-specific because
 * the mechanism genuinely differs (services/SafetyExportService.ts,
 * 設計判断記録 D-27 追記): Android lets the person choose a folder; iOS has
 * no SDK equivalent, so it writes to the app's own private storage
 * instead, which carries a real trade-off worth surfacing (included in
 * the device's iCloud/iTunes backup as an unencrypted file).
 */
function safetyExportLocationNotice(t: TFunction): string {
  return Platform.OS === 'android'
    ? t('settings.data.safetyExportLocationNotice.android')
    : t('settings.data.safetyExportLocationNotice.ios');
}

function safetyExportLocationShortNotice(t: TFunction): string {
  return Platform.OS === 'android'
    ? t('settings.data.safetyExportLocationShortNotice.android')
    : t('settings.data.safetyExportLocationShortNotice.ios');
}

export default function DataSettingsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const db = useDatabase();
  const { bump } = useDataRevision();
  const [step, setStep] = useState<Step>({ kind: 'menu' });
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);

  const handleExport = async (format: 'json' | 'csv') => {
    setExporting(format);
    try {
      const payload = await buildExportPayload(db);
      // A UTF-8 BOM prefix so Excel (which otherwise guesses the system
      // codepage for CSV) renders Japanese notes correctly instead of
      // mojibake — added only for the shared file, not serializeExportCsv's
      // own return value, which stays plain CSV text.
      const UTF8_BOM = String.fromCharCode(0xfeff); // built from a codepoint, not an invisible literal character in source
      const contents = format === 'json' ? serializeExportFile(payload) : `${UTF8_BOM}${serializeExportCsv(payload)}`;
      const fileName = format === 'json' ? 'solo-plus-us-export.json' : 'solo-plus-us-export.csv';
      const mimeType = format === 'json' ? 'application/json' : 'text/csv';
      const uti = format === 'json' ? 'public.json' : 'public.comma-separated-values-text';
      await shareExportFile(fileName, contents, mimeType, uti);
    } catch (error) {
      logError(`Export (${format}) failed`, error);
      Alert.alert(t('settings.data.couldNotExport'), t('common.pleaseTryAgain'));
    } finally {
      setExporting(null);
    }
  };

  const handleImportPick = async () => {
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      // Not narrowed to 'application/json' — different file providers
      // report a JSON backup's MIME type inconsistently (some as
      // application/octet-stream), which could hide a person's own
      // backup from the picker. validateExportFile below does the real
      // content check regardless of what got picked.
      picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    } catch (error) {
      logError('DocumentPicker.getDocumentAsync failed', error);
      Alert.alert(t('settings.data.couldNotOpenFilePicker'), t('common.pleaseTryAgain'));
      return;
    }
    if (picked.canceled || picked.assets.length === 0) return;

    setStep({ kind: 'busy', label: t('settings.data.checkingBackupFile') });
    try {
      const raw = await new File(picked.assets[0].uri).text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        setStep({ kind: 'menu' });
        Alert.alert(t('settings.data.couldNotReadFile'), t('settings.data.notValidJson'));
        return;
      }
      const validation = validateExportFile(parsed);
      if (!validation.valid) {
        setStep({ kind: 'menu' });
        Alert.alert(t('settings.data.doesntLookLikeBackup'), describeValidationErrors(t, validation.errors));
        return;
      }
      const currentCount = (await countAllActivities(db)).total;
      setStep({ kind: 'modeChoice', file: validation.file, currentCount });
    } catch (error) {
      logError('Reading/validating import file failed', error);
      setStep({ kind: 'menu' });
      Alert.alert(t('settings.data.couldNotReadFile'), t('common.pleaseTryAgain'));
    }
  };

  const handleAppendImport = async (file: ExportFileV1) => {
    setStep({ kind: 'busy', label: t('settings.data.addingNewRecords') });
    try {
      const result = await performAppendImport(db, file);
      bump();
      setStep({ kind: 'menu' });
      const added = t('settings.data.appendImportAdded', { count: result.importedCount });
      const skipped = result.skippedCount > 0 ? t('settings.data.appendImportSkipped', { count: result.skippedCount }) : '';
      Alert.alert(t('settings.data.importCompleteTitle'), `${added}${skipped}`);
    } catch (error) {
      logError('performAppendImport failed', error);
      setStep({ kind: 'menu' });
      Alert.alert(t('settings.data.couldNotImport'), t('common.pleaseTryAgain'));
    }
  };

  const handleConfirmReplace = async (file: ExportFileV1) => {
    // §13.3 step 1: a verified safety backup of the *current* (about to be
    // destroyed) data must succeed before anything is wiped. Cancelling or
    // failing this must not proceed to the replace below.
    setStep({ kind: 'busy', label: t('settings.data.creatingSafetyBackup') });
    let currentPayload: ExportFileV1;
    try {
      currentPayload = await buildExportPayload(db);
      await performSafetyExport(currentPayload);
    } catch (error) {
      logError('performSafetyExport failed', error);
      setStep({ kind: 'menu' });
      Alert.alert(t('settings.data.couldNotReplaceData'), describeSafetyExportError(t, error));
      return;
    }

    setStep({ kind: 'busy', label: t('settings.data.replacingYourData') });
    let result: { importedCount: number };
    try {
      // §9.12: this is the one call site that runs performReplaceImport
      // against the *live* app DB — must go through SyncCoordinator so it
      // can't race SyncWorker (see ImportService.performReplaceImport's
      // doc comment for why the wrapping lives here, not in that function).
      result = await SyncCoordinator.runExclusive(() => performReplaceImport(db, file));
    } catch (error) {
      logError('performReplaceImport failed', error);
      setStep({ kind: 'menu' });
      Alert.alert(
        t('settings.data.couldNotReplaceData'),
        `${safetyExportLocationShortNotice(t)} ${t('common.pleaseTryAgain')}`,
      );
      return;
    }
    bump();

    // §13.1/§13.6: re-sync to Health Connect is opt-in only — the replace
    // above never queues sync jobs itself (exportImport.integration.test.ts
    // "does not re-queue sync jobs"). `healthConnect.enabled` is
    // DEVICE_OWNED (types/Settings.ts) and performReplaceImport never
    // touches it, so it's safe to read straight after the replace.
    let hcEnabled = false;
    try {
      hcEnabled = (await getSetting(db, 'healthConnect.enabled')) ?? false;
    } catch (error) {
      // Reading this alone failing must not be reported as "could not
      // replace data" — the replace itself already succeeded. Falling back
      // to not offering the resync screen is the safe default — this no
      // longer loses the opportunity permanently, since Settings > Health
      // Connect also has a "Sync everything to Health Connect" action
      // (queueResync's other entry point) that reaches the
      // exact same state.
      logError('Reading healthConnect.enabled after replace import failed', error);
    }

    if (hcEnabled) {
      setStep({ kind: 'offerResync', importedCount: result.importedCount });
    } else {
      setStep({ kind: 'menu' });
      Alert.alert(
        t('settings.data.importCompleteTitle'),
        t('settings.data.replaceImportResult', { count: result.importedCount, notice: safetyExportLocationShortNotice(t) }),
      );
    }
  };

  const handleOfferResync = async (shouldSync: boolean, importedCount: number) => {
    if (!shouldSync) {
      setStep({ kind: 'menu' });
      return;
    }
    setStep({ kind: 'busy', label: t('settings.data.queuingHealthConnectSync') });
    try {
      await queueResync(db);
      // Nudge SyncWorkerLoop's existing DataRevision trigger so the newly
      // queued jobs get a chance to drain without waiting for its 10s
      // periodic tick (same reasoning as health-connect.tsx's handleRetry).
      bump();
      setStep({ kind: 'menu' });
      Alert.alert(t('settings.data.importCompleteTitle'), t('settings.data.healthConnectSyncQueued'));
    } catch (error) {
      logError('queueResync failed', error);
      setStep({ kind: 'offerResync', importedCount });
      Alert.alert(t('settings.data.couldNotQueueHealthConnectSync'), t('common.pleaseTryAgain'));
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {step.kind === 'menu' && (
          <>
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.data.exportSectionLabel')}</Text>
              <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.data.exportCaption')}</Text>
              {/* §12.4: "共有先で平文になることを画面上で明示する" — shown here, before either export button is tapped. */}
              <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.data.exportPlaintextNotice')}</Text>
              <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Pressable
                  onPress={() => handleExport('json')}
                  disabled={exporting !== null}
                  style={[styles.optionRow, { opacity: exporting !== null ? 0.6 : 1 }]}
                  accessibilityRole="button"
                >
                  <View>
                    <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>{t('settings.data.exportJson')}</Text>
                    <Text style={[styles.optionSubLabel, { color: colors.textTertiary }]}>{t('settings.data.exportJsonSubLabel')}</Text>
                  </View>
                  {exporting === 'json' && <ActivityIndicator color={colors.textSecondary} />}
                </Pressable>
                <Pressable
                  onPress={() => handleExport('csv')}
                  disabled={exporting !== null}
                  style={[
                    styles.optionRow,
                    { opacity: exporting !== null ? 0.6 : 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  ]}
                  accessibilityRole="button"
                >
                  <View>
                    <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>{t('settings.data.exportCsv')}</Text>
                    <Text style={[styles.optionSubLabel, { color: colors.textTertiary }]}>{t('settings.data.exportCsvSubLabel')}</Text>
                  </View>
                  {exporting === 'csv' && <ActivityIndicator color={colors.textSecondary} />}
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.data.importSectionLabel')}</Text>
              <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.data.importCaption')}</Text>
              <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Pressable onPress={handleImportPick} style={styles.optionRow} accessibilityRole="button">
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>{t('settings.data.importFromBackup')}</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}

        {step.kind === 'modeChoice' && (
          <View style={styles.section}>
            <Text style={[styles.headline, { color: colors.textPrimary }]}>
              {t('settings.data.foundInBackup', { count: step.file.activities.length })}
            </Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>
              {t('settings.data.currentlyHave', { count: step.currentCount })}
            </Text>
            <View style={styles.actions}>
              <Pressable
                onPress={() => handleAppendImport(step.file)}
                style={[styles.button, { backgroundColor: colors.solo }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.background }]}>{t('settings.data.addOnlyNewRecords')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setStep({ kind: 'confirmReplace', file: step.file, currentCount: step.currentCount })}
                style={[styles.button, styles.secondaryButton, { borderColor: colors.destructive }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.destructive }]}>{t('settings.data.replaceAllData')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setStep({ kind: 'menu' })}
                style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.textPrimary }]}>{t('common.cancel')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {step.kind === 'confirmReplace' && (
          <View style={styles.section}>
            <Text style={[styles.headline, { color: colors.textPrimary }]}>
              {t('settings.data.willBeImported', { count: step.file.activities.length })}
            </Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>
              {t('settings.data.willBeReplaced', { count: step.currentCount })}
            </Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>{safetyExportLocationNotice(t)}</Text>
            <View style={styles.actions}>
              <Pressable
                onPress={() => handleConfirmReplace(step.file)}
                style={[styles.button, { backgroundColor: colors.destructive }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.background }]}>{t('settings.data.replaceAllData')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setStep({ kind: 'modeChoice', file: step.file, currentCount: step.currentCount })}
                style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.textPrimary }]}>{t('common.cancel')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {step.kind === 'offerResync' && (
          <View style={styles.section}>
            <Text style={[styles.headline, { color: colors.textPrimary }]}>
              {t('settings.data.activitiesRestored', { count: step.importedCount })}
            </Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>{safetyExportLocationShortNotice(t)}</Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.data.offerResyncExplanation1')}</Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.data.offerResyncExplanation2')}</Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.data.offerResyncExplanation3')}</Text>
            <View style={styles.actions}>
              <Pressable
                onPress={() => handleOfferResync(true, step.importedCount)}
                style={[styles.button, { backgroundColor: colors.solo }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.background }]}>{t('settings.data.syncToHealthConnect')}</Text>
              </Pressable>
              <Pressable
                onPress={() => handleOfferResync(false, step.importedCount)}
                style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.textPrimary }]}>{t('settings.data.notNow')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {step.kind === 'busy' && (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={[styles.caption, { color: colors.textSecondary }]}>{step.label}</Text>
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
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing.xs },
  caption: { fontSize: 12, paddingHorizontal: spacing.xs, lineHeight: 17 },
  headline: { fontSize: 16, fontWeight: '600', paddingHorizontal: spacing.xs },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: minTouchTarget,
    paddingVertical: spacing.sm,
  },
  optionLabel: { fontSize: 15, fontWeight: '500' },
  optionSubLabel: { fontSize: 12, marginTop: 2 },
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
