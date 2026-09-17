/**
 * UI/UX §19 — human-readable text for `expo-local-authentication`'s
 * failure codes. Kept separate from `components/LockScreen.tsx` so it's
 * unit-testable without the native module itself (only the *type* is
 * imported here, which Jest never needs to resolve at runtime).
 */
import type { LocalAuthenticationError } from 'expo-local-authentication';

/** `null` for cases not worth narrating (the person just dismissed the prompt) — a retry control alone is enough there. */
export function describeAuthError(error: LocalAuthenticationError | null): string | null {
  switch (error) {
    case null:
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
    case 'user_fallback':
      return null;
    case 'lockout':
      return 'Too many attempts. Try again later, or use your device passcode.';
    default:
      return 'Authentication failed. Tap to try again.';
  }
}
