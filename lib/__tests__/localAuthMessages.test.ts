import i18n from '../i18n';
import { describeAuthError } from '../localAuthMessages';

const en = i18n.getFixedT('en');
const ja = i18n.getFixedT('ja');

describe('describeAuthError', () => {
  it('returns null for cases not worth narrating', () => {
    expect(describeAuthError(en, null)).toBeNull();
    expect(describeAuthError(en, 'user_cancel')).toBeNull();
    expect(describeAuthError(en, 'app_cancel')).toBeNull();
    expect(describeAuthError(en, 'system_cancel')).toBeNull();
    expect(describeAuthError(en, 'user_fallback')).toBeNull();
  });

  it('gives a specific message for lockout', () => {
    expect(describeAuthError(en, 'lockout')).toMatch(/too many attempts/i);
  });

  it('falls back to a generic retry message for other errors', () => {
    expect(describeAuthError(en, 'authentication_failed')).toMatch(/tap to try again/i);
    expect(describeAuthError(en, 'unable_to_process')).toMatch(/tap to try again/i);
  });

  it('translates to Japanese', () => {
    expect(describeAuthError(ja, 'lockout')).toContain('試行回数');
    expect(describeAuthError(ja, 'authentication_failed')).toContain('タップして再試行');
  });
});
