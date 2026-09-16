/**
 * UI/UX §7 "Empty State" — no "Start your streak" language, ever
 * (§19 Judgment-free / §27 UI原則).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/theme';

export function EmptyState() {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.textSecondary }]}>No activities recorded yet.</Text>
      <Text style={[styles.subtitle, { color: colors.textTertiary }]}>Your history starts with your first entry.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 32, alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '500' },
  subtitle: { fontSize: 13, marginTop: 6, textAlign: 'center' },
});
