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
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DB } from '@op-engineering/op-sqlite';
import { StyleSheet, Text, View } from 'react-native';
import { getDatabase, wasRestoredFromFailedMigration } from '../database/connection';
import { clearAllClaims } from '../repositories/HealthSyncJobRepository';
import { hasSeenPrivacyIntro } from '../lib/onboarding';
import { ensureLocaleDefaultsPersisted } from '../services/SettingsRepository';
import { DatabaseCorruptOrWrongKeyError, DatabaseKeyUnavailableError, MigrationRestoreFailedError } from '../lib/errors';
import { useTheme } from '../constants/theme';
import { RecoveryScreen } from '../components/RecoveryScreen';

type DatabaseState =
  | { status: 'loading' }
  | { status: 'ready'; db: DB; needsOnboarding: boolean; migrationRestored: boolean }
  | { status: 'error'; error: unknown };

const DatabaseContext = createContext<DatabaseState | null>(null);

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DatabaseState>({ status: 'loading' });
  const { colors } = useTheme();
  // Guards both the initial mount attempt and any later retry (from
  // RecoveryScreen) against setting state after this provider itself has
  // unmounted — unlikely (it wraps the whole app) but cheap to guard.
  const cancelledRef = useRef(false);
  useEffect(() => () => {
    cancelledRef.current = true;
  }, []);

  const attemptOpen = useCallback(async () => {
    setState({ status: 'loading' });
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
      if (!cancelledRef.current) setState({ status: 'ready', db, needsOnboarding, migrationRestored });
    } catch (error) {
      if (!cancelledRef.current) setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    attemptOpen();
  }, [attemptOpen]);

  if (state.status === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>Loading…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    // §8.5/§8.8 (D-26): the two known, actionable "can't decrypt" error
    // types get the full Recovery screen (retry, restore from backup, or
    // delete and start over), reached *before* AppLockProvider ever
    // mounts (§21 "App Lock を経ずに到達する": whether App Lock should
    // apply lives in the encrypted DB, unreadable here). Both are
    // "records unreachable" from the person's side even though they fail
    // at different points internally (no key read at all, vs. a key that
    // was read but doesn't decrypt this file) — §8.5's "復号できない"
    // covers both. Other error types (a downgrade, a v2+ migration+
    // restore double failure, ...) keep the plain fallback below —
    // Recovery's bootstrap doesn't help with those, and retrying the same
    // way wouldn't either.
    if (state.error instanceof DatabaseKeyUnavailableError || state.error instanceof DatabaseCorruptOrWrongKeyError) {
      return <RecoveryScreen onRecovered={attemptOpen} />;
    }

    // Deliberately plain fallback so any other decrypt/open failure never
    // renders a blank screen or a native crash. Known error types get a
    // headline that names what's actually true, rather than one generic
    // message for every cause. `MigrationRestoreFailedError` specifically
    // means a v2+ migration failed *and* the fallback restore also
    // failed — unlike `wasRestoredFromFailedMigration()` (migration
    // failed but restore succeeded, app keeps running on the old schema),
    // this is the case where neither succeeded and `getDatabase()` never
    // returned a `db` at all.
    const isMigrationRestoreFailure = state.error instanceof MigrationRestoreFailedError;
    const headline = isMigrationRestoreFailure
      ? 'Solo + Us couldn’t update its database, and couldn’t undo the attempt either.'
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
