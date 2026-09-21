const mockGetEnrolledLevelAsync = jest.fn();

jest.mock('expo-local-authentication', () => ({
  ...jest.requireActual('expo-local-authentication'),
  getEnrolledLevelAsync: (...args: unknown[]) => mockGetEnrolledLevelAsync(...args),
}));

import { SecurityLevel } from 'expo-local-authentication';
import { hasDeviceAuthEnrolled } from '../deviceAuthEnrollment';

describe('hasDeviceAuthEnrolled', () => {
  beforeEach(() => {
    mockGetEnrolledLevelAsync.mockReset();
  });

  it('is false when nothing is enrolled', async () => {
    mockGetEnrolledLevelAsync.mockResolvedValue(SecurityLevel.NONE);
    expect(await hasDeviceAuthEnrolled()).toBe(false);
  });

  it('is true for a non-biometric passcode/pattern (SECRET)', async () => {
    mockGetEnrolledLevelAsync.mockResolvedValue(SecurityLevel.SECRET);
    expect(await hasDeviceAuthEnrolled()).toBe(true);
  });

  it('is true for biometric levels', async () => {
    mockGetEnrolledLevelAsync.mockResolvedValue(SecurityLevel.BIOMETRIC_WEAK);
    expect(await hasDeviceAuthEnrolled()).toBe(true);

    mockGetEnrolledLevelAsync.mockResolvedValue(SecurityLevel.BIOMETRIC_STRONG);
    expect(await hasDeviceAuthEnrolled()).toBe(true);
  });
});
