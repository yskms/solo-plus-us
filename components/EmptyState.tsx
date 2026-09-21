/**
 * UI/UX §7 "Empty State" — no "Start your streak" language, ever
 * (§19 Judgment-free / §27 UI原則).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../constants/theme';

export function EmptyState() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.textSecondary }]}>{t('emptyState.title')}</Text>
      <Text style={[styles.subtitle, { color: colors.textTertiary }]}>{t('emptyState.subtitle')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 32, alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '500' },
  subtitle: { fontSize: 13, marginTop: 6, textAlign: 'center' },
});
