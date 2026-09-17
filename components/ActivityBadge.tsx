/**
 * UI/UX §3: "Solo/Partneredの判別を色だけに依存しないこと" — always a
 * colored dot *plus* the text label, never the dot alone.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/theme';
import { contextLabel } from '../lib/labels';
import type { ActivityContext } from '../types/Activity';

export function ActivityBadge({ context }: { context: ActivityContext }) {
  const { colors } = useTheme();
  const dotColor = context === 'solo' ? colors.solo : colors.partneredStrong;

  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.label, { color: colors.textPrimary }]}>{contextLabel(context)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 15, fontWeight: '500' },
});
