/** 基本設計 §18 Phase 2. Not built yet — see README "Known gaps". */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../constants/theme';

export default function InsightsScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.text, { color: colors.textSecondary }]}>Insights are coming in a later phase.</Text>
      <Text style={[styles.subtext, { color: colors.textTertiary }]}>Your activities are being recorded — this view will show them once it's built.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { fontSize: 15, fontWeight: '500', textAlign: 'center' },
  subtext: { fontSize: 13, textAlign: 'center', marginTop: 8 },
});
