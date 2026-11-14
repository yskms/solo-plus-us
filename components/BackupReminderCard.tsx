/**
 * D-58 - the Home card that says "records do not move to a new phone by
 * themselves, export before you switch". Shown rarely (about every half year,
 * see `lib/backupReminder.ts`), and it is a card in the screen, not an
 * `Alert.alert`.
 *
 * Why not an Alert: `Alert.alert` is a system dialog that draws above App
 * Lock's overlay and cannot be dismissed from code (see `contexts/AppLock.tsx`,
 * `isLocked`). A cold start is locked, and Home is already mounted under the
 * overlay, so an Alert opened on mount would appear on top of the lock screen.
 * This card is an ordinary View in the tree, so the overlay covers it like the
 * rest of Home. Do not turn it into an Alert or a React Native `<Modal>`
 * (also a separate window) to make it "more noticeable".
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';

interface Props {
  onOpenExport: () => void;
  onDismiss: () => void;
}

export function BackupReminderCard({ onOpenExport, onDismiss }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityRole="summary">
      <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
        {t('today.backupReminder.title')}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{t('today.backupReminder.body')}</Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onOpenExport}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
          accessibilityRole="button"
        >
          <Text style={[styles.primaryLabel, { color: colors.solo }]}>{t('today.backupReminder.openExport')}</Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryLabel, { color: colors.textSecondary }]}>{t('today.backupReminder.dismiss')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.sm },
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  action: { minHeight: minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.xs },
  primaryLabel: { fontSize: 15, fontWeight: '600' },
  secondaryLabel: { fontSize: 15 },
});
