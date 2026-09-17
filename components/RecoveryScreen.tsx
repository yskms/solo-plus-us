/**
 * UI/UX §21 Screen 11 — Recovery. Shown by `DatabaseContext` in place of
 * the rest of the app when the DB file can't be decrypted
 * (`DatabaseKeyUnavailableError` or `DatabaseCorruptOrWrongKeyError`,
 * §8.5). Rendered *before* `AppLockProvider` ever mounts (`DatabaseContext`'s
 * error branch replaces `children` entirely) — "App Lock を経ずに到達する":
 * whether App Lock should apply lives in the encrypted DB itself,
 * unreadable here, and there's no data yet for a lock to protect.
 *
 * 文言のルール (§21): state what happened as fact, not as the person's
 * mistake; don't hide that recovery might not be possible. The mockup
 * shows exactly the two destructive actions, but a "Try again" is added
 * ahead of them — `DatabaseKeyUnavailableError` specifically can also
 * mean a single, transient SecureStore read came back empty (see
 * `database/key.ts`'s `getOrCreateDatabaseKey`), not only a genuinely
 * lost key, and neither destructive action should be the only way out of
 * a failure that might just need retrying.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';
import { IntersectPlus } from './IntersectPlus';
import { restoreFromBackup, resetAndStartOver } from '../services/RecoveryService';
import { RecoveryImportInvalidError, RecoveryVerificationFailedError } from '../lib/errors';
import { logError } from '../lib/log';

type Step = 'choice' | 'confirmDelete' | 'busy';

function describeError(error: unknown): string {
  if (error instanceof RecoveryImportInvalidError) {
    const shown = error.validationErrors.slice(0, 5).map((e) => `${e.path || '(file)'}: ${e.message}`);
    const more = error.validationErrors.length > shown.length ? `\n…and ${error.validationErrors.length - shown.length} more` : '';
    return `This file doesn't look like a Solo + Us backup:\n${shown.join('\n')}${more}`;
  }
  if (error instanceof RecoveryVerificationFailedError) {
    // Author-controlled message (see RecoveryService), safe to show as-is.
    return error.message;
  }
  // Any other error (a native SQLite/filesystem error, ...) may embed a
  // raw file path or fragment of SQL — shown to the device's own owner
  // here, not a third party, but still not worth surfacing verbatim when
  // a plain explanation says everything they actually need to know.
  return 'Something went wrong while working with this file. Please try again.';
}

export function RecoveryScreen({ onRecovered }: { onRecovered: () => void }) {
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>('choice');

  const handleRestore = async () => {
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    } catch (error) {
      logError('DocumentPicker.getDocumentAsync failed', error);
      Alert.alert('Could not open file picker', 'Please try again.');
      return;
    }
    if (picked.canceled || picked.assets.length === 0) return;

    setStep('busy');
    try {
      const result = await restoreFromBackup(picked.assets[0].uri);
      Alert.alert('Restored', `${result.importedCount} activities restored from backup.`, [{ text: 'OK', onPress: onRecovered }]);
    } catch (error) {
      logError('RecoveryService.restoreFromBackup failed', error);
      setStep('choice');
      Alert.alert('Could not restore backup', describeError(error));
    }
  };

  const handleConfirmDelete = async () => {
    setStep('busy');
    try {
      await resetAndStartOver();
      onRecovered();
    } catch (error) {
      logError('RecoveryService.resetAndStartOver failed', error);
      setStep('choice');
      Alert.alert('Could not delete', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.center}>
        <IntersectPlus size={40} />
        <Text style={[styles.wordmark, { color: colors.textPrimary }]}>Solo + Us</Text>

        <Text style={[styles.headline, { color: colors.textPrimary }]}>
          Solo + Us couldn&apos;t unlock the records on this device.
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          This can happen after moving to a new device or restoring from a backup — the encryption key may have
          been lost.
        </Text>

        {step === 'busy' && (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={[styles.body, { color: colors.textSecondary }]}>Working…</Text>
          </View>
        )}

        {step === 'choice' && (
          <View style={styles.actions}>
            {/* Not in the UI/UX §21 mockup (which shows only the two
                destructive options) — added because `DatabaseKeyUnavailableError`
                can also mean SecureStore returned nothing for a single,
                transient read (see database/key.ts's own doc comment on
                `getOrCreateDatabaseKey`), not only a genuinely lost key.
                Without this, a transient failure would force a choice
                between two irreversible actions that were never actually
                necessary. */}
            <Pressable
              onPress={onRecovered}
              style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: colors.textPrimary }]}>Try again</Text>
            </Pressable>
            <Pressable
              onPress={handleRestore}
              style={[styles.button, { backgroundColor: colors.solo }]}
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: colors.background }]}>Restore from a backup</Text>
            </Pressable>
            <Pressable
              onPress={() => setStep('confirmDelete')}
              style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: colors.textPrimary }]}>Delete and start over</Text>
            </Pressable>
          </View>
        )}

        {step === 'confirmDelete' && (
          <View style={styles.actions}>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              This permanently deletes the records on this device. This can&apos;t be undone.
            </Text>
            <Pressable
              onPress={handleConfirmDelete}
              style={[styles.button, { backgroundColor: colors.destructive }]}
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: colors.background }]}>Delete and start over</Text>
            </Pressable>
            <Pressable
              onPress={() => setStep('choice')}
              style={[styles.button, styles.secondaryButton, { borderColor: colors.border }]}
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, { color: colors.textPrimary }]}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  wordmark: { fontSize: 22, fontWeight: '700' },
  headline: { fontSize: 16, textAlign: 'center', marginTop: spacing.lg, fontWeight: '600' },
  body: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  actions: { width: '100%', gap: spacing.sm, marginTop: spacing.lg },
  button: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  secondaryButton: { borderWidth: StyleSheet.hairlineWidth, backgroundColor: 'transparent' },
  buttonText: { fontSize: 16, fontWeight: '700' },
});
