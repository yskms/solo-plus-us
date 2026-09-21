/**
 * Whether the device has a usable App Lock authentication method
 * (biometric or passcode) enrolled. Shared by app/settings/app-lock.tsx
 * (refuse to enable App Lock without it) and app/onboarding/privacy.tsx
 * (skip the App Lock guidance Alert without it) — kept in one place so a
 * future change to this condition (e.g. also checking
 * `isEnrolledAsync()`) can't update one call site and miss the other.
 */
import * as LocalAuthentication from 'expo-local-authentication';

export async function hasDeviceAuthEnrolled(): Promise<boolean> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return level !== LocalAuthentication.SecurityLevel.NONE;
}
