import { describeAuthError } from '../localAuthMessages';

describe('describeAuthError', () => {
  it('returns null for cases not worth narrating', () => {
    expect(describeAuthError(null)).toBeNull();
    expect(describeAuthError('user_cancel')).toBeNull();
    expect(describeAuthError('app_cancel')).toBeNull();
    expect(describeAuthError('system_cancel')).toBeNull();
    expect(describeAuthError('user_fallback')).toBeNull();
  });

  it('gives a specific message for lockout', () => {
    expect(describeAuthError('lockout')).toMatch(/too many attempts/i);
  });

  it('falls back to a generic retry message for other errors', () => {
    expect(describeAuthError('authentication_failed')).toMatch(/tap to try again/i);
    expect(describeAuthError('unable_to_process')).toMatch(/tap to try again/i);
  });
});
