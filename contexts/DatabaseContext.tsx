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
import { useTranslation } from 'react-i18next';
import { getDatabase, wasRestoredFromFailedMigration } from '../database/connection';
import { clearAllClaims } from '../repositories/HealthSyncJobRepository';
import { hasSeenPrivacyIntro } from '../lib/onboarding';
import { ensureLocaleDefaultsPersisted } from '../services/SettingsRepository';
import { reconcileHealthConnectBuildFlag } from '../services/ActivityService';
import {
  DatabaseCorruptOrWrongKeyError,
  DatabaseKeyUnavailableError,
  MigrationRestoreFailedError,
  SchemaTooNewError,
} from '../lib/errors';
import { logError } from '../lib/log';
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
  const { t } = useTranslation();
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
      // §9.11/§25.1 レビュー指摘: without-health-connect ビルドへの入れ替え後も
      // healthConnect.enabled が true のまま残っていないか是正する（詳細は
      // `services/ActivityService.ts` の doc comment参照）。DB 自体は正常に
      // 開けているので、この是正だけが失敗しても「DB が開けない」画面
      // （Recovery）に倒すべきではない——最悪でも「HC が有効なままの
      // without ビルド」に留まるだけで、次回起動時に再試行される
      // （3回目のレビュー指摘、2026-09-21）。
      try {
        await reconcileHealthConnectBuildFlag(db);
      } catch (error) {
        logError('reconcileHealthConnectBuildFlag failed', error);
      }
      const needsOnboarding = !(await hasSeenPrivacyIntro(db));
      // §7.2 "起動を継続してエラーを表示する": a failed migration that fell
      // back to the pre-migration schema still returns a usable `db` —
      // this is how that gets surfaced instead of looking indistinguishable
      // from a fully healthy open.
      const migrationRestored = wasRestoredFromFailedMigration();
      if (!cancelledRef.current) setState({ status: 'ready', db, needsOnboarding, migrationRestored });
    } catch (error) {
      // §7.2 exists specifically so a DB-open failure is never silent —
      // logged here too (not just rendered) since this is the one path in
      // the app where nothing else logs it: `getDatabase()`'s own callers
      // upstream of this provider don't wrap it in a try/catch of their
      // own (found in review — this call was previously the only place
      // the error surfaced, via its raw `message` on screen; see the
      // render branch below for why that alone is no longer enough now
      // that most error types show a translated, non-`message` detail).
      logError('DatabaseProvider.attemptOpen failed', error);
      if (!cancelledRef.current) setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    attemptOpen();
  }, [attemptOpen]);

  if (state.status === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>{t('common.loading')}</Text>
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
    const isSchemaTooNew = state.error instanceof SchemaTooNewError;
    const headline = isMigrationRestoreFailure
      ? t('databaseContext.migrationRestoreFailedHeadline')
      : t('databaseContext.couldNotOpenHeadline');
    const detail =
      state.error instanceof SchemaTooNewError
        ? t('databaseContext.schemaTooNewDetail', { current: state.error.currentVersion, max: state.error.maxKnownVersion })
        : isMigrationRestoreFailure
          ? t('databaseContext.migrationRestoreFailedDetail')
          : t('databaseContext.unknownErrorDetail');
    // Only the truly-unclassified case (neither of the two known types
    // above) loses real diagnostic content by switching to a translated,
    // fixed message — `logError` doesn't include `error.message` in
    // release builds either (§8.7, `lib/log.ts`), so without this, an
    // unrecognized failure here would leave *no* surviving detail
    // anywhere, for a screen whose whole point is not hiding what went
    // wrong (found in review). Deliberately left English/untechnical-
    // looking rather than run through `t()` — it's the raw exception
    // message, not authored UI copy (same reasoning as the untranslated
    // `services/importValidation.ts` field messages).
    const technicalDetail =
      !isSchemaTooNew && !isMigrationRestoreFailure ? String((state.error as Error)?.message ?? state.error) : null;
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingHorizontal: 24 }]}>
        <Text style={{ color: colors.textPrimary, fontSize: 16, textAlign: 'center' }}>{headline}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 8 }}>{detail}</Text>
        {technicalDetail && (
          <Text style={{ color: colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 12 }}>
            {technicalDetail}
          </Text>
        )}
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
