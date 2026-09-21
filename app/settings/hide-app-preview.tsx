/**
 * UI/UX §17 Screen 07 PRIVACY section — "Hide App Preview". Informational
 * only, like `app-lock.tsx`'s own "UNLOCK WITH" row: this protection has
 * no on/off switch (see `lib/screenMask.ts` — it sits at the same
 * mandatory tier as DB encryption/backup exclusion, not a preference like
 * App Lock's own enabled/disabled setting), so this screen states what's
 * always active rather than offering anything to configure.
 *
 * 2026-09-18: this screen used to also claim screenshots/screen
 * recordings are always blocked — no longer true (CLAUDE.md「スクリーン
 * ショットに関する方針」). Screenshot blocking is now `settings/
 * block-screenshots.tsx`'s opt-in toggle, except on Android below API 33
 * where the two still can't be separated (see `lib/screenMask.ts`) — the
 * copy below only asserts what's actually still unconditional here.
 *
 * Does not simply assert the protection is on — `useScreenMask()` at the
 * app root never reports whether it actually succeeded (unavailable
 * device, or the native call itself rejecting or silently no-op'ing —
 * see `lib/screenMask.ts`'s doc comment for the two confirmed ways a
 * "successful" attempt still might not mean the protection is active).
 * This screen calls the *same* `attemptScreenMask()` — memoized, so this
 * reads the one real startup outcome rather than re-invoking anything —
 * and only shows the checkmark once that attempt reported no detected
 * failure. Even then, "active: true" means exactly that: no failure was
 * detected, not that this has been confirmed on-device (README/設計判断記録
 * D-47 — this is not a claim the code below is in a position to make).
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { attemptScreenMask, type ScreenMaskResult, type ScreenMaskUnavailableReason } from '../../lib/screenMask';

/** Below API 33, Android has no OS API to separate the two (see lib/screenMask.ts) — screenshots stay blocked as a side effect there, unlike everywhere else where it's now settings/block-screenshots.tsx's opt-in. */
const ANDROID_LEGACY_FORCED_ON = Platform.OS === 'android' && Platform.Version < 33;

/** Maps `lib/screenMask.ts`'s stable reason codes to display text — kept as a switch (not a lookup object) so the translation keys are literal `t(...)` calls, covered by `npm run check-i18n` (`scripts/checkI18nKeys.js`) the same way every other call site is. */
function screenMaskReasonMessage(t: TFunction, reason: ScreenMaskUnavailableReason): string {
  switch (reason) {
    case 'blur-failed':
      return t('errors.screenMask.blurFailed');
    case 'hide-preview-failed':
      return t('errors.screenMask.hidePreviewFailed');
    case 'support-check-failed':
      return t('errors.screenMask.supportCheckFailed');
    case 'not-available':
      return t('errors.screenMask.notAvailable');
  }
}

export default function HideAppPreviewScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [result, setResult] = useState<ScreenMaskResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    attemptScreenMask().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.hideAppPreview.alwaysOn')}</Text>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.optionRow}>
              <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>{t('settings.hideAppPreview.hideAppPreview')}</Text>
              {result === null && <ActivityIndicator color={colors.textSecondary} accessibilityLabel={t('settings.hideAppPreview.checking')} />}
              {result?.active === true && (
                <Text style={[styles.checkmark, { color: colors.solo }]} accessibilityLabel={t('settings.hideAppPreview.enabled')}>
                  ✓
                </Text>
              )}
              {result?.active === false && (
                <Text style={[styles.checkmark, { color: colors.destructive }]} accessibilityLabel={t('settings.hideAppPreview.couldNotEnable')}>
                  !
                </Text>
              )}
            </View>
          </View>
          {result?.active === true && (
            <Text style={[styles.caption, { color: colors.textTertiary }]}>
              {t('settings.hideAppPreview.alwaysHidesCaption')}
              {ANDROID_LEGACY_FORCED_ON && t('settings.hideAppPreview.androidLegacySideEffect')}
            </Text>
          )}
          {result?.active === false && (
            <Text style={[styles.caption, { color: colors.destructive }]}>
              {t('settings.hideAppPreview.couldNotEnableWithReason', { reason: screenMaskReasonMessage(t, result.reason) })}
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.hideAppPreview.whatThisDoes')}</Text>
          {/* Deliberately not gated on ANDROID_LEGACY_FORCED_ON (the
              *current* device) — this is reference text describing both
              Android cases, not a statement about this specific device.
              Gating it would show an iOS reader an incomplete "Android"
              description (only the API 33+ half). */}
          <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.hideAppPreview.androidExplanation')}</Text>
          <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.hideAppPreview.iosExplanation')}</Text>
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
