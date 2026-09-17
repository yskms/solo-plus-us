/**
 * §8.7 — Activity content must never reach device logs, including in
 * release builds. `console.error` itself still writes to logcat/os_log
 * regardless of `__DEV__`, so the gate has to be in what we pass it, not
 * whether we call it.
 */
import { logError } from '../log';
import { ValidationError } from '../errors';

describe('logError', () => {
  const originalDev = (global as { __DEV__?: boolean }).__DEV__;
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
    (global as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('in dev, logs the full error for debugging', () => {
    (global as { __DEV__?: boolean }).__DEV__ = true;
    const error = new Error('occurredAtUtc must have :00 seconds: 2026-09-14T14:42:37Z');
    logError('updateActivity failed', error);
    expect(spy).toHaveBeenCalledWith('updateActivity failed', error);
  });

  it('in release, never lets the error message (which may contain Activity-derived values) reach the log', () => {
    (global as { __DEV__?: boolean }).__DEV__ = false;
    const error = new ValidationError('occurredAtUtc must have :00 seconds: 2026-09-14T14:42:37Z');
    logError('updateActivity failed', error);

    const loggedText = spy.mock.calls.flat().join(' ');
    expect(loggedText).not.toContain('2026-09-14');
    expect(loggedText).toContain('updateActivity failed');
    expect(loggedText).toContain('ValidationError'); // the error's name is still useful for triage
  });

  it('in release, handles a thrown non-Error value without crashing or leaking it', () => {
    (global as { __DEV__?: boolean }).__DEV__ = false;
    logError('recordActivity failed', 'some raw string that should not be logged verbatim');

    const loggedText = spy.mock.calls.flat().join(' ');
    expect(loggedText).not.toContain('some raw string');
    expect(loggedText).toContain('UnknownError');
  });
});
