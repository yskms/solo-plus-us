/**
 * UI/UX §19 — human-readable text for `expo-local-authentication`'s
 * failure codes. Kept separate from `components/LockScreen.tsx` so it's
 * unit-testable without the native module itself (only the *type* is
 * imported here, which Jest never needs to resolve at runtime).
 */
import type { TFunction } from 'i18next';
import type { LocalAuthenticationError } from 'expo-local-authentication';

/** `null` for cases not worth narrating (the person just dismissed the prompt) — a retry control alone is enough there. */
export function describeAuthError(t: TFunction, error: LocalAuthenticationError | null): string | null {
  switch (error) {
    case null:
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
    case 'user_fallback':
      return null;
    case 'lockout':
      return t('lockScreen.lockoutError');
    default:
      return t('lockScreen.genericError');
  }
}
