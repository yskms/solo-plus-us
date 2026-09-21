/**
 * UI/UX §17 ABOUT — "About Solo + Us". Static, no persisted state. Wording
 * draws only from already-decided product facts (要件定義書 §3.1/§3.2's
 * concept/principles, §19.1's privacy basics) — nothing here should drift
 * into Insight-style judgment language (要件定義書 §16 forbids exactly the
 * kind of "better sexual health" framing this screen could easily slip
 * into if rewritten casually).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing } from '../../constants/theme';

const PRINCIPLES = [
  { title: 'Judgment-free', body: "Solo + Us doesn't rate your activity as high, low, good, or bad." },
  { title: 'No streak pressure', body: "There's no streak counter and nothing to keep up." },
  { title: 'Low friction', body: "Recording a moment takes one tap — pick a type, and it's logged with the current time." },
  { title: 'Privacy first', body: 'Your data is sensitive, so it stays on this device by default.' },
  { title: 'Long-term data', body: "Built for keeping records over years, not just building a short-term habit." },
];

/**
 * §19.1's basics, plus two exceptions to "stays on this device" that a
 * reader of only this screen could otherwise miss (2026-09-21 review):
 * Health Connect sync writes a subset of a record outside the app's own
 * encrypted storage, and Export files are plaintext by design (§12.4/§13.3
 * — see `app/settings/health-connect.tsx`/`app/settings/data.tsx` for the
 * screens that state this at the point of action; this is only a summary).
 */
const PRIVACY_FACTS = [
  'No account required',
  'Your activity data is encrypted and stored on this device',
  "We don't run a server that receives your activity data",
  'If you turn on Health Connect sync, the date/time and whether protection was used are also written there',
  'Files you export are not encrypted',
  'Your data is never used for advertising',
  'No analytics or crash reporting SDKs in this version',
];

export default function AboutScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.tagline, { color: colors.textPrimary }]}>Personal Sexual Wellness Log</Text>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>
          Solo + Us is a private, judgment-free way to keep track of your activity over the long term.
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>PRINCIPLES</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {PRINCIPLES.map((item, index) => (
            <View
              key={item.title}
              style={[styles.principleRow, { borderColor: colors.border }, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth }]}
            >
              <Text style={[styles.principleTitle, { color: colors.textPrimary }]}>{item.title}</Text>
              <Text style={[styles.principleBody, { color: colors.textSecondary }]}>{item.body}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>PRIVACY</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {PRIVACY_FACTS.map((fact, index) => (
            <View
              key={fact}
              style={[styles.factRow, { borderColor: colors.border }, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth }]}
            >
              <Text style={[styles.factText, { color: colors.textPrimary }]}>{fact}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm },
  tagline: { fontSize: 17, fontWeight: '700', paddingHorizontal: spacing.xs },
  intro: { fontSize: 14, lineHeight: 20, paddingHorizontal: spacing.xs, marginBottom: spacing.xs },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing.xs },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  principleRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  principleTitle: { fontSize: 15, fontWeight: '600' },
  principleBody: { fontSize: 13, lineHeight: 18 },
  factRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  factText: { fontSize: 14 },
});
