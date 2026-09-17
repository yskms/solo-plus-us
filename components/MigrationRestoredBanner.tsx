/**
 * §7.2 "起動を継続してエラーを表示する". Shown when `openAndMigrate` had to
 * restore from the pre-migration backup — the app is usable, but running
 * on an older schema than this build expects, so it says so rather than
 * looking like nothing happened. Unreachable today (v1 is the only
 * migration); this exists so v2+ doesn't ship without it.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../constants/theme';
import { useMigrationRestoredNotice } from '../contexts/DatabaseContext';

export function MigrationRestoredBanner() {
  const restored = useMigrationRestoredNotice();
  const { colors } = useTheme();

  if (!restored) return null;

  return (
    <SafeAreaView edges={['top']} style={[styles.banner, { backgroundColor: colors.destructive }]}>
      <Text style={styles.text}>
        A recent update to Solo + Us couldn&apos;t be applied. Your existing records are safe, but the app is
        running an older version of its data format until this is fixed.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 16, paddingVertical: 10 },
  text: { color: '#FFFFFF', fontSize: 12, lineHeight: 17 },
});
