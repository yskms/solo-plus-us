import * as Crypto from 'expo-crypto';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bytesToUuidV4(bytes: Uint8Array): string {
  // RFC 4122 §4.4: force the version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function mathRandomUuidV4Fallback(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytesToUuidV4(bytes);
}

/**
 * Generates a new Activity/job id.
 *
 * 基本設計 §35 (v0.1): Activity ID は UUID を使用する。Health Connect 側
 * clientRecordId として再利用するため（D-04）、v4 でなければならない.
 *
 * `expo-crypto`'s native module returns `undefined` under Jest (jest-expo's
 * mock doesn't implement it) instead of throwing, so this falls through a
 * chain of decreasingly-native options rather than trusting the first one
 * blindly. IDs aren't security material (D-06's actual key generation is
 * the only place that needs a real CSPRNG) — uniqueness is what matters
 * here, not unpredictability, so a `Math.random()` last resort is fine.
 */
export function generateId(): string {
  const native = Crypto.randomUUID();
  if (isUuidV4(native)) {
    return native;
  }

  try {
    const bytes = Crypto.getRandomBytes(16);
    if (bytes && bytes.length === 16) {
      return bytesToUuidV4(bytes);
    }
  } catch {
    // fall through
  }

  return mathRandomUuidV4Fallback();
}

/**
 * Strict UUID v4 check, used by the Import validator (§13.4) — DB length
 * CHECKs do not verify format (§5.1), so this is the actual gate.
 */
export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_RE.test(value);
}
