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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme, spacing } from '../../constants/theme';

function principles(t: TFunction): { key: string; title: string; body: string }[] {
  return [
    { key: 'judgmentFree', title: t('settings.about.principles.judgmentFree.title'), body: t('settings.about.principles.judgmentFree.body') },
    { key: 'noStreakPressure', title: t('settings.about.principles.noStreakPressure.title'), body: t('settings.about.principles.noStreakPressure.body') },
    { key: 'lowFriction', title: t('settings.about.principles.lowFriction.title'), body: t('settings.about.principles.lowFriction.body') },
    { key: 'privacyFirst', title: t('settings.about.principles.privacyFirst.title'), body: t('settings.about.principles.privacyFirst.body') },
    { key: 'longTermData', title: t('settings.about.principles.longTermData.title'), body: t('settings.about.principles.longTermData.body') },
  ];
}

/**
 * §19.1's basics, plus two exceptions to "stays on this device" that a
 * reader of only this screen could otherwise miss (2026-09-21 review):
 * Health Connect sync writes a subset of a record outside the app's own
 * encrypted storage, and Export files are plaintext by design (§12.4/§13.3
 * — see `app/settings/health-connect.tsx`/`app/settings/data.tsx` for the
 * screens that state this at the point of action; this is only a summary).
 */
function privacyFacts(t: TFunction): string[] {
  return [
    t('settings.about.privacyFacts.noAccount'),
    t('settings.about.privacyFacts.encryptedOnDevice'),
    t('settings.about.privacyFacts.noServer'),
    t('settings.about.privacyFacts.healthConnectSubset'),
    t('settings.about.privacyFacts.exportsNotEncrypted'),
    t('settings.about.privacyFacts.noAdvertising'),
    t('settings.about.privacyFacts.noAnalytics'),
  ];
}

export default function AboutScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const principleItems = principles(t);
  const factItems = privacyFacts(t);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.tagline, { color: colors.textPrimary }]}>{t('settings.about.tagline')}</Text>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>{t('settings.about.intro')}</Text>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.about.principlesSectionLabel')}</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {principleItems.map((item, index) => (
            <View
              key={item.key}
              style={[styles.principleRow, { borderColor: colors.border }, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth }]}
            >
              <Text style={[styles.principleTitle, { color: colors.textPrimary }]}>{item.title}</Text>
              <Text style={[styles.principleBody, { color: colors.textSecondary }]}>{item.body}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.index.privacy')}</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {factItems.map((fact, index) => (
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
