/**
 * 基本設計 v0.11 §8.2 (D-06) — the database encryption key.
 *
 * Generated once, stored in Keychain/Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
 * (D-07: never synced to another device via iCloud Keychain — the DB it
 * unlocks never leaves this device either).
 *
 * Deliberately NOT stored with `requireAuthentication: true`. That option
 * ties the value to the device's current biometric enrollment; adding or
 * changing a fingerprint/face can invalidate it, which would make the DB
 * permanently unreadable for a legitimate owner. App Lock (screen gating)
 * and the DB key (data readability) are kept independent — see
 * `services/AppLockService` (Phase 3) — this file only ever touches the key.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { DatabaseKeyUnavailableError } from '../lib/errors';

const KEY_STORAGE_KEY = 'solo-plus-us.db-encryption-key.v1';
const KEY_BYTES = 32;

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function generateKeyHex(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(KEY_BYTES);
  return bytesToHex(bytes);
}

/**
 * Returns the database encryption key, generating and persisting a new one
 * only when it's actually safe to do so.
 *
 * `dbFileExists` must reflect whether the DB file is *already on disk* —
 * checked by the caller (`connection.ts`), before this runs. Without that
 * check, a transient SecureStore read failure (or a genuine lost key) on a
 * device that already has an encrypted DB would silently generate and
 * persist a *replacement* key, overwriting any trace of the real one and
 * making the existing DB permanently unreadable — while looking, from the
 * next launch onward, exactly like a healthy first launch (§8.5). That
 * failure mode is exactly what Recovery (§8.8, Phase 3) exists to handle
 * deliberately, not what a plain retry should paper over.
 *
 * @throws DatabaseKeyUnavailableError if `dbFileExists` is true and no key
 *   is readable — the caller must route this to Recovery, not retry.
 */
export async function getOrCreateDatabaseKey(dbFileExists: boolean): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_STORAGE_KEY, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (existing) {
    return existing;
  }

  if (dbFileExists) {
    throw new DatabaseKeyUnavailableError();
  }

  const generated = await generateKeyHex();
  await SecureStore.setItemAsync(KEY_STORAGE_KEY, generated, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return generated;
}

/**
 * Only for the Recovery bootstrap (§8.8/D-26): generates a *new*, distinct
 * key for the fresh temporary database, without touching the existing
 * (unreadable) key yet. The caller replaces the stored key only after the
 * new DB has been verified (D-38 — never destroy the old key before the
 * switch is confirmed).
 */
export async function generateNewDatabaseKey(): Promise<string> {
  return generateKeyHex();
}

/** Recovery bootstrap step, after the new DB is confirmed working (D-38). */
export async function replaceStoredDatabaseKey(newKeyHex: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_STORAGE_KEY, newKeyHex, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/** True if a key has ever been created on this device. Used to distinguish first launch from a recovery scenario. */
export async function hasExistingDatabaseKey(): Promise<boolean> {
  const existing = await SecureStore.getItemAsync(KEY_STORAGE_KEY, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return existing != null;
}
