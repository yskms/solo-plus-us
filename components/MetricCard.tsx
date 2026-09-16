import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/theme';

export function MetricCard({ value, label, color }: { value: number | string; label: string; color?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <Text style={[styles.value, { color: color ?? colors.textPrimary }]}>{value}</Text>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', minWidth: 72 },
  value: { fontSize: 32, fontWeight: '700' },
  label: { fontSize: 13, marginTop: 2 },
});
