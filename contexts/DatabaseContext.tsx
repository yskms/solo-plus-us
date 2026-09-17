/**
 * Opens the encrypted database once, at the top of the tree, and gates
 * rendering until it's ready — every screen below can call `useDatabase()`
 * and get a working connection synchronously.
 *
 * §6.2: `clearAllClaims` runs once here, right after open, before anything
 * else touches `health_sync_jobs` — the "v1 runs in a single foreground
 * runtime" assumption (D-36) means startup is the only place a stale claim
 * needs clearing.
 */
import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DB } from '@op-engineering/op-sqlite';
import { StyleSheet, Text, View } from 'react-native';
import { getDatabase, wasRestoredFromFailedMigration } from '../database/connection';
import { clearAllClaims } from '../repositories/HealthSyncJobRepository';
import { hasSeenPrivacyIntro } from '../lib/onboarding';
import { ensureLocaleDefaultsPersisted } from '../services/SettingsRepository';
import { DatabaseKeyUnavailableError } from '../lib/errors';
import { useTheme } from '../constants/theme';

type DatabaseState =
  | { status: 'loading' }
  | { status: 'ready'; db: DB; needsOnboarding: boolean; migrationRestored: boolean }
  | { status: 'error'; error: unknown };

const DatabaseContext = createContext<DatabaseState | null>(null);

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DatabaseState>({ status: 'loading' });
  const { colors } = useTheme();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await getDatabase();
        await clearAllClaims(db);
        // §5.5/D-42: resolved once, from the OS's actual settings, and
        // persisted — never re-derived from locale on every read.
        await ensureLocaleDefaultsPersisted(db);
        const needsOnboarding = !(await hasSeenPrivacyIntro(db));
        // §7.2 "起動を継続してエラーを表示する": a failed migration that fell
        // back to the pre-migration schema still returns a usable `db` —
        // this is how that gets surfaced instead of looking indistinguishable
        // from a fully healthy open.
        const migrationRestored = wasRestoredFromFailedMigration();
        if (!cancelled) setState({ status: 'ready', db, needsOnboarding, migrationRestored });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>Loading…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    // Full Recovery bootstrap (§8.5/§8.8, D-26) is Phase 3 — this is a
    // deliberately plain fallback so a decrypt/open failure never renders
    // a blank screen or a native crash, without yet offering the actual
    // restore-or-reset choice. The two known error types get a headline
    // that names what's actually true (key lost vs. downgraded), rather
    // than one generic message for every cause.
    const isKeyUnavailable = state.error instanceof DatabaseKeyUnavailableError;
    const headline = isKeyUnavailable
      ? 'Solo + Us can’t unlock the records on this device.'
      : 'Solo + Us couldn’t open its database on this device.';
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingHorizontal: 24 }]}>
        <Text style={{ color: colors.textPrimary, fontSize: 16, textAlign: 'center' }}>{headline}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
          {String((state.error as Error)?.message ?? state.error)}
        </Text>
      </View>
    );
  }

  return <DatabaseContext.Provider value={state}>{children}</DatabaseContext.Provider>;
}

function useDatabaseState(): Extract<DatabaseState, { status: 'ready' }> {
  const ctx = useContext(DatabaseContext);
  if (!ctx || ctx.status !== 'ready') {
    throw new Error('useDatabase()/useNeedsOnboarding() must be called below a ready <DatabaseProvider>.');
  }
  return ctx;
}

export function useDatabase(): DB {
  return useDatabaseState().db;
}

export function useNeedsOnboarding(): boolean {
  return useDatabaseState().needsOnboarding;
}

/** §7.2 — true only after a failed migration was restored from backup; the app is running on an older schema than this build expects. Unreachable today (v1 is the only migration), kept ready for v2+. */
export function useMigrationRestoredNotice(): boolean {
  return useDatabaseState().migrationRestored;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
