/**
 * UI/UX §17 Screen 07 — Settings. Only the sections that actually have a
 * working destination are listed here; a row is added only once its
 * destination is built — never a "Coming soon" placeholder (no dead
 * links, per this project's standing rule — see the App Lock scoping note
 * in README's Phase 3 section). TRACKING's "Activity Details" row
 * (§6.3/Screen 07a) links to `settings/activity-details.tsx`. DATA is a
 * single "Export &
 * Import" row rather than §17's separate Export/Import/Delete rows —
 * `settings/data.tsx` covers Export and Import; Delete (§10.6) isn't built
 * yet, so the mockup's three-row split isn't followed literally (see
 * README). "Hide App Preview" (§18 画面マスク) links to an informational
 * screen, not a toggle — see `lib/screenMask.ts`. "Block Screenshots" is a
 * real opt-in toggle (default off), added 2026-09-18 when always-on
 * screenshot blocking was reversed to opt-in — see CLAUDE.md's「スクリーン
 * ショットに関する方針」and `lib/screenMask.ts`. HEALTH's "Health Connect"
 * row (§18 Screen 08) covers ON/OFF and the unsynced-changes retry/discard
 * flow (§9.6/§10.4/§10.5) — see `settings/health-connect.tsx`'s doc comment
 * for its intentional deviations from the §18 mockup. That section is
 * `Platform.OS === 'android'`-only (レビュー指摘) — Health Connect itself is
 * Android-only (§9.11) and the iOS counterpart (`healthkit` provider) isn't
 * implemented, so on iOS there is nothing this row could actually do; showing
 * it there would open a screen whose every action (`HealthConnectService.
 * isAvailable()`/`ensureInitialized()`/etc., all backed by a Proxy that
 * throws on iOS — see `node_modules/react-native-health-connect/lib/
 * commonjs/index.js`'s `moduleProxy`) fails, matching this file's own rule
 * of not showing rows for things that don't work here.
 *
 * ABOUT's "Privacy Policy" row is intentionally still missing (2026-09-21):
 * §17's mockup lists it, but there is no hosted policy URL yet — the user
 * has decided it will link out to an externally-hosted page (not be drafted
 * or embedded in-app) once that URL exists. Add the row when the URL is
 * available; don't add it with a placeholder URL — when it's added, it
 * belongs in the same `SettingsGroup` as "About Solo + Us"/"Version" (§17's
 * mockup shows all three as one card, which is why `Row` supports a
 * non-navigable `value` variant rather than splitting "Version" into its
 * own group). "Version" reads `Application.nativeApplicationVersion`
 * (falling back to `app.json`'s `expo.version` only where the native module
 * returns `null`, e.g. web) rather than importing `app.json` directly —
 * a raw `app.json` import reflects the JS bundle's build-time value, which
 * can drift from what's actually installed (an OTA-updated bundle, or a
 * future `app.config.js`/EAS `remote`/`autoIncrement` version source) —
 * see 2026-09-21 review.
 */
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import appConfig from '../../app.json';

interface Row {
  label: string;
  /** Omitted for a non-navigable info row (e.g. "Version") — no chevron, no press handler, matching §17's mockup where that row has no `>`. */
  onPress?: () => void;
  /** Present only for a non-navigable row; rendered where the chevron would otherwise go. */
  value?: string;
}

/** Dividers are derived from position (`index > 0`), not passed per-row — a row added between two others can't silently end up missing one. */
function SettingsGroup({ rows }: { rows: Row[] }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {rows.map((row, index) => {
        const border = [{ borderColor: colors.border }, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth }];
        if (!row.onPress) {
          return (
            <View
              key={row.label}
              style={[styles.row, ...border]}
              accessible
              accessibilityLabel={row.value !== undefined ? `${row.label}, ${row.value}` : row.label}
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{row.label}</Text>
              {row.value !== undefined && <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{row.value}</Text>}
            </View>
          );
        }
        return (
          <Pressable
            key={row.label}
            onPress={row.onPress}
            style={({ pressed }) => [styles.row, ...border, { opacity: pressed ? 0.6 : 1 }]}
            accessibilityRole="button"
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{row.label}</Text>
            <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const appVersion = Application.nativeApplicationVersion ?? appConfig.expo.version;

export default function SettingsIndexScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>PRIVACY</Text>
        <SettingsGroup
          rows={[
            { label: 'App Lock', onPress: () => router.push('/settings/app-lock') },
            { label: 'Hide App Preview', onPress: () => router.push('/settings/hide-app-preview') },
            { label: 'Block Screenshots', onPress: () => router.push('/settings/block-screenshots') },
          ]}
        />

        {Platform.OS === 'android' && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>HEALTH</Text>
            <SettingsGroup rows={[{ label: 'Health Connect', onPress: () => router.push('/settings/health-connect') }]} />
          </>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>DATA</Text>
        <SettingsGroup rows={[{ label: 'Export & Import', onPress: () => router.push('/settings/data') }]} />

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>TRACKING</Text>
        <SettingsGroup rows={[{ label: 'Activity Details', onPress: () => router.push('/settings/activity-details') }]} />

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>PREFERENCES</Text>
        <SettingsGroup
          rows={[
            { label: 'First Day of Week', onPress: () => router.push('/settings/first-day-of-week') },
            { label: 'Time Format', onPress: () => router.push('/settings/time-format') },
            { label: 'Appearance', onPress: () => router.push('/settings/appearance') },
          ]}
        />

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>ABOUT</Text>
        <SettingsGroup
          rows={[
            { label: 'About Solo + Us', onPress: () => router.push('/settings/about') },
            { label: 'Version', value: appVersion },
          ]}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing.xs },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: minTouchTarget,
  },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowValue: { fontSize: 15 },
  chevron: { fontSize: 18 },
});
