import { formatCalendarDateTime, formatLocalTime } from '../timeFormat';
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

describe('formatCalendarDateTime', () => {
  it('formats a month/day/year with the time appended', () => {
    expect(formatCalendarDateTime(2026, 8, 14, '23:42', '24h')).toBe('Sep 14, 2026 · 23:42');
  });

  it('uses a 0-indexed month, like Date#getMonth', () => {
    expect(formatCalendarDateTime(2026, 0, 1, '00:05', '24h')).toBe('Jan 1, 2026 · 00:05');
    expect(formatCalendarDateTime(2026, 11, 31, '00:05', '24h')).toBe('Dec 31, 2026 · 00:05');
  });

  it('respects the 12h/24h time format', () => {
    expect(formatCalendarDateTime(2026, 8, 14, '23:42', '12h')).toBe('Sep 14, 2026 · 11:42 PM');
  });
});
