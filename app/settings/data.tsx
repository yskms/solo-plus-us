/**
 * UI/UX §17 Screen 07 DATA section / §20 Screen 10 — Export, plus the
 * §13.3 Import flow the mockup doesn't draw but §25's `ImportPreview` /
 * `DestructiveConfirm` components (and the "12,431 件を読み込みます / 現在
 * の 8,902 件は置き換えられます" preview copy) describe. "Delete Data" (the
 * third DATA row in §17's mockup, §10.6) is intentionally not here yet —
 * out of scope for this round (see README).
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
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import { buildExportPayload, serializeExportFile, serializeExportCsv } from '../../services/ExportService';
import { shareExportFile } from '../../services/ExportSharingService';
import { performSafetyExport } from '../../services/SafetyExportService';
import { validateExportFile } from '../../services/importValidation';
import { performReplaceImport, performAppendImport } from '../../services/ImportService';
import * as SyncCoordinator from '../../services/SyncCoordinator';
import { countAllActivities } from '../../repositories/ActivityRepository';
import { SafetyExportFailedError } from '../../lib/errors';
import { logError } from '../../lib/log';
import type { ExportFileV1 } from '../../types/Export';

type Step =
  | { kind: 'menu' }
  | { kind: 'modeChoice'; file: ExportFileV1; currentCount: number }
  | { kind: 'confirmReplace'; file: ExportFileV1; currentCount: number }
  | { kind: 'busy'; label: string };

function describeValidationErrors(errors: { path: string; message: string }[]): string {
  const shown = errors.slice(0, 5).map((e) => `${e.path || '(file)'}: ${e.message}`);
  const more = errors.length > shown.length ? `\n…and ${errors.length - shown.length} more` : '';
  return `This file doesn't look like a Solo + Us backup:\n${shown.join('\n')}${more}`;
}

function describeSafetyExportError(error: unknown): string {
  if (error instanceof SafetyExportFailedError) return error.message;
  return 'Could not create a safety backup. Please try again.';
}

/** §12.4: "共有先で平文になることを画面上で明示する" — shown on the Export section itself, before either button is tapped. */
const EXPORT_PLAINTEXT_NOTICE =
  "These files are not encrypted. Anyone with access to them can read everything in them — share and store them carefully.";

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
function safetyExportLocationNotice(): string {
  return Platform.OS === 'android'
    ? "Before replacing anything, you'll be asked to choose a folder to save a safety backup of your current data."
    : "Before replacing anything, a safety backup of your current data will be saved in Solo + Us's private storage on this device. It isn't visible in the Files app, but — unlike the app's own database — it's included in this device's iCloud/iTunes backup as an unencrypted file for as long as it remains on this device.";
}

function safetyExportLocationShortNotice(): string {
  return Platform.OS === 'android'
    ? 'A safety backup of your previous data was saved to the folder you chose.'
    : "A safety backup of your previous data was saved in this app's private storage (included in this device's iCloud/iTunes backup).";
}

export default function DataSettingsScreen() {
  const { colors } = useTheme();
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
      Alert.alert('Could not export', 'Please try again.');
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
      Alert.alert('Could not open file picker', 'Please try again.');
      return;
    }
    if (picked.canceled || picked.assets.length === 0) return;

    setStep({ kind: 'busy', label: 'Checking backup file…' });
    try {
      const raw = await new File(picked.assets[0].uri).text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        setStep({ kind: 'menu' });
        Alert.alert('Could not read file', 'This file is not valid JSON.');
        return;
      }
      const validation = validateExportFile(parsed);
      if (!validation.valid) {
        setStep({ kind: 'menu' });
        Alert.alert("This file doesn't look like a backup", describeValidationErrors(validation.errors));
        return;
      }
      const currentCount = (await countAllActivities(db)).total;
      setStep({ kind: 'modeChoice', file: validation.file, currentCount });
    } catch (error) {
      logError('Reading/validating import file failed', error);
      setStep({ kind: 'menu' });
      Alert.alert('Could not read file', 'Please try again.');
    }
  };

  const handleAppendImport = async (file: ExportFileV1) => {
    setStep({ kind: 'busy', label: 'Adding new records…' });
    try {
      const result = await performAppendImport(db, file);
      bump();
      setStep({ kind: 'menu' });
      Alert.alert(
        'Import complete',
        `${result.importedCount} new activities added.${result.skippedCount > 0 ? ` ${result.skippedCount} already existed and were skipped.` : ''}`,
      );
    } catch (error) {
      logError('performAppendImport failed', error);
      setStep({ kind: 'menu' });
      Alert.alert('Could not import', 'Please try again.');
    }
  };

  const handleConfirmReplace = async (file: ExportFileV1) => {
    // §13.3 step 1: a verified safety backup of the *current* (about to be
    // destroyed) data must succeed before anything is wiped. Cancelling or
    // failing this must not proceed to the replace below.
    setStep({ kind: 'busy', label: 'Creating a safety backup…' });
    let currentPayload: ExportFileV1;
    try {
      currentPayload = await buildExportPayload(db);
      await performSafetyExport(currentPayload);
    } catch (error) {
      logError('performSafetyExport failed', error);
      setStep({ kind: 'menu' });
      Alert.alert('Could not replace data', describeSafetyExportError(error));
      return;
    }

    setStep({ kind: 'busy', label: 'Replacing your data…' });
    try {
      // §9.12: this is the one call site that runs performReplaceImport
      // against the *live* app DB — must go through SyncCoordinator so it
      // can't race SyncWorker (see ImportService.performReplaceImport's
      // doc comment for why the wrapping lives here, not in that function).
      const result = await SyncCoordinator.runExclusive(() => performReplaceImport(db, file));
      bump();
      setStep({ kind: 'menu' });
      Alert.alert('Import complete', `${result.importedCount} activities restored. ${safetyExportLocationShortNotice()}`);
    } catch (error) {
      logError('performReplaceImport failed', error);
      setStep({ kind: 'menu' });
      Alert.alert('Could not replace data', `${safetyExportLocationShortNotice()} Please try again.`);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {step.kind === 'menu' && (
          <>
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>EXPORT</Text>
              <Text style={[styles.caption, { color: colors.textTertiary }]}>
                Export everything you&apos;ve recorded in Solo + Us.
              </Text>
              <Text style={[styles.caption, { color: colors.textTertiary }]}>{EXPORT_PLAINTEXT_NOTICE}</Text>
              <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Pressable
                  onPress={() => handleExport('json')}
                  disabled={exporting !== null}
                  style={[styles.optionRow, { opacity: exporting !== null ? 0.6 : 1 }]}
                  accessibilityRole="button"
                >
                  <View>
                    <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>Export JSON</Text>
                    <Text style={[styles.optionSubLabel, { color: colors.textTertiary }]}>Complete backup</Text>
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
                    <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>Export CSV</Text>
                    <Text style={[styles.optionSubLabel, { color: colors.textTertiary }]}>For spreadsheets and analysis</Text>
                  </View>
                  {exporting === 'csv' && <ActivityIndicator color={colors.textSecondary} />}
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>IMPORT</Text>
              <Text style={[styles.caption, { color: colors.textTertiary }]}>
                Restore from a Solo + Us JSON backup.
              </Text>
              <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Pressable onPress={handleImportPick} style={styles.optionRow} accessibilityRole="button">
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>Import from a backup</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}

        {step.kind === 'modeChoice' && (
          <View style={styles.section}>
            <Text style={[styles.headline, { color: colors.textPrimary }]}>
              {step.file.activities.length} activities found in this backup.
            </Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>
              You currently have {step.currentCount} activities recorded on this device.
            </Text>
            <View style={styles.actions}>
              <Pressable
                onPress={() => handleAppendImport(step.file)}
                style={[styles.button, { backgroundColor: colors.solo }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.background }]}>Add only new records</Text>
              </Pressable>
              <Pressable
                onPress={() => setStep({ kind: 'confirmReplace', file: step.file, currentCount: step.currentCount })}
                style={[styles.button, styles.secondaryButton, { borderColor: colors.destructive }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.destructive }]}>Replace all data</Text>
              </Pressable>
              <Pressable
                onPress={() => setStep({ kind: 'menu' })}
                style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.textPrimary }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        )}

        {step.kind === 'confirmReplace' && (
          <View style={styles.section}>
            <Text style={[styles.headline, { color: colors.textPrimary }]}>
              {step.file.activities.length} activities will be imported.
            </Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>
              Your current {step.currentCount} activities will be permanently replaced.
            </Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>{safetyExportLocationNotice()}</Text>
            <View style={styles.actions}>
              <Pressable
                onPress={() => handleConfirmReplace(step.file)}
                style={[styles.button, { backgroundColor: colors.destructive }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.background }]}>Replace all data</Text>
              </Pressable>
              <Pressable
                onPress={() => setStep({ kind: 'modeChoice', file: step.file, currentCount: step.currentCount })}
                style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, { color: colors.textPrimary }]}>Cancel</Text>
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
