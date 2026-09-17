import { formatLocalTime } from '../timeFormat';
import { ValidationError } from '../errors';

describe('formatLocalTime', () => {
  it('formats 24h as-is', () => {
    expect(formatLocalTime('23:42', '24h')).toBe('23:42');
    expect(formatLocalTime('00:05', '24h')).toBe('00:05');
  });

  it('formats midnight and noon correctly in 12h', () => {
    expect(formatLocalTime('00:00', '12h')).toBe('12:00 AM');
    expect(formatLocalTime('12:00', '12h')).toBe('12:00 PM');
  });

  it('formats a PM time in 12h', () => {
    expect(formatLocalTime('23:42', '12h')).toBe('11:42 PM');
  });

  it('formats an AM time in 12h', () => {
    expect(formatLocalTime('05:07', '12h')).toBe('5:07 AM');
  });

  it('rejects an invalid local time', () => {
    expect(() => formatLocalTime('25:00', '24h')).toThrow(ValidationError);
    expect(() => formatLocalTime('not-a-time', '12h')).toThrow(ValidationError);
  });
});
