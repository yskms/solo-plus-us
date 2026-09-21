/**
 * §7.2 "起動を継続してエラーを表示する". Shown when `openAndMigrate` had to
 * restore from the pre-migration backup — the app is usable, but running
 * on an older schema than this build expects, so it says so rather than
 * looking like nothing happened. Unreachable today (v1 is the only
 * migration); this exists so v2+ doesn't ship without it.
 *
 * This banner alone is not the full fix for that state — see the
 * "Undecided design gap" comment above `wasRestoredFromFailedMigration`
 * in `database/connection.ts` for what's still missing (a read-only mode
 * while the schema mismatch persists) before v2 ships.
 *
 * Layout note (unverified — nothing renders this today): placed above
 * `<Stack>` in `app/_layout.tsx` with its own `SafeAreaView edges={['top']}`.
 * On a screen that also has a header (e.g. Activity Detail), the header's
 * own safe-area handling could double up with this banner's, adding extra
 * top space. Check on a real device once a v2 migration can actually
 * trigger this banner — no point guessing at RN Navigation header/inset
 * interaction without seeing it render.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../constants/theme';
import { useMigrationRestoredNotice } from '../contexts/DatabaseContext';

export function MigrationRestoredBanner() {
  const restored = useMigrationRestoredNotice();
  const { colors } = useTheme();
  const { t } = useTranslation();

  if (!restored) return null;

  return (
    <SafeAreaView edges={['top']} style={[styles.banner, { backgroundColor: colors.destructive }]}>
      <Text style={styles.text}>{t('migrationRestoredBanner.message')}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 16, paddingVertical: 10 },
  text: { color: '#FFFFFF', fontSize: 12, lineHeight: 17 },
});
