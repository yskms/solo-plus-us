/**
 * UI/UX §17 Screen 07 PRIVACY section — "Hide App Preview". Informational
 * only, like `app-lock.tsx`'s own "UNLOCK WITH" row: this protection has
 * no on/off switch (see `lib/screenMask.ts` — it sits at the same
 * mandatory tier as DB encryption/backup exclusion, not a preference like
 * App Lock's own enabled/disabled setting), so this screen states what's
 * always active rather than offering anything to configure.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';

export default function HideAppPreviewScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>ALWAYS ON</Text>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.optionRow}>
              <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>Hide app preview</Text>
              <Text style={[styles.checkmark, { color: colors.solo }]}>✓</Text>
            </View>
          </View>
          <Text style={[styles.caption, { color: colors.textTertiary }]}>
            Solo + Us always hides your records from the app switcher and blocks screenshots — this can&apos;t be
            turned off.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>WHAT THIS DOES</Text>
          <Text style={[styles.caption, { color: colors.textTertiary }]}>
            On Android, the Recent Apps preview is replaced with a blank screen, and screenshots and screen
            recordings are blocked.
          </Text>
          <Text style={[styles.caption, { color: colors.textTertiary }]}>
            On iOS, the app switcher preview is blurred, and screenshots and screen recordings are blocked.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.lg },
  section: { gap: spacing.xs },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing.xs },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: minTouchTarget,
  },
  optionLabel: { fontSize: 15 },
  checkmark: { fontSize: 16, fontWeight: '700' },
  caption: { fontSize: 12, paddingHorizontal: spacing.xs, lineHeight: 17 },
});
