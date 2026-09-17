import { shouldLockOnResume } from '../appLockTiming';

describe('shouldLockOnResume', () => {
  it('never locks when App Lock is disabled, regardless of timing/elapsed', () => {
    expect(
      shouldLockOnResume({ enabled: false, timing: 'immediately', backgroundedAtMs: 0, nowMs: 0 }),
    ).toBe(false);
    expect(
      shouldLockOnResume({ enabled: false, timing: '5m', backgroundedAtMs: null, nowMs: 999_999 }),
    ).toBe(false);
  });

  it('always locks on a cold start (backgroundedAtMs null) when enabled, regardless of timing', () => {
    expect(
      shouldLockOnResume({ enabled: true, timing: '5m', backgroundedAtMs: null, nowMs: 0 }),
    ).toBe(true);
    expect(
      shouldLockOnResume({ enabled: true, timing: 'immediately', backgroundedAtMs: null, nowMs: 0 }),
    ).toBe(true);
  });

  it('"immediately" locks as soon as any time has passed in the background', () => {
    expect(
      shouldLockOnResume({ enabled: true, timing: 'immediately', backgroundedAtMs: 1000, nowMs: 1000 }),
    ).toBe(true); // 0ms elapsed, still >= 0
    expect(
      shouldLockOnResume({ enabled: true, timing: 'immediately', backgroundedAtMs: 1000, nowMs: 5000 }),
    ).toBe(true);
  });

  it('"1m" does not lock before a minute has elapsed', () => {
    expect(
      shouldLockOnResume({ enabled: true, timing: '1m', backgroundedAtMs: 0, nowMs: 59_000 }),
    ).toBe(false);
  });

  it('"1m" locks at exactly one minute elapsed and beyond', () => {
    expect(
      shouldLockOnResume({ enabled: true, timing: '1m', backgroundedAtMs: 0, nowMs: 60_000 }),
    ).toBe(true);
    expect(
      shouldLockOnResume({ enabled: true, timing: '1m', backgroundedAtMs: 0, nowMs: 120_000 }),
    ).toBe(true);
  });

  it('"5m" does not lock before 5 minutes have elapsed', () => {
    expect(
      shouldLockOnResume({ enabled: true, timing: '5m', backgroundedAtMs: 0, nowMs: 4 * 60_000 }),
    ).toBe(false);
  });

  it('"5m" locks at exactly 5 minutes elapsed', () => {
    expect(
      shouldLockOnResume({ enabled: true, timing: '5m', backgroundedAtMs: 0, nowMs: 5 * 60_000 }),
    ).toBe(true);
  });
});
