import i18n from '../i18n';
import { formatCalendarDateTime, formatLocalTime } from '../timeFormat';
import { ValidationError } from '../errors';

const en = i18n.getFixedT('en');
const ja = i18n.getFixedT('ja');

describe('formatLocalTime', () => {
  it('formats 24h as-is', () => {
    expect(formatLocalTime(en, '23:42', '24h')).toBe('23:42');
    expect(formatLocalTime(en, '00:05', '24h')).toBe('00:05');
  });

  it('formats midnight and noon correctly in 12h', () => {
    expect(formatLocalTime(en, '00:00', '12h')).toBe('12:00 AM');
    expect(formatLocalTime(en, '12:00', '12h')).toBe('12:00 PM');
  });

  it('formats a PM time in 12h', () => {
    expect(formatLocalTime(en, '23:42', '12h')).toBe('11:42 PM');
  });

  it('formats an AM time in 12h', () => {
    expect(formatLocalTime(en, '05:07', '12h')).toBe('5:07 AM');
  });

  it('rejects an invalid local time', () => {
    expect(() => formatLocalTime(en, '25:00', '24h')).toThrow(ValidationError);
    expect(() => formatLocalTime(en, 'not-a-time', '12h')).toThrow(ValidationError);
  });

  it('puts the period before the time in Japanese, and translates AM/PM', () => {
    expect(formatLocalTime(ja, '23:42', '12h')).toBe('午後11:42');
    expect(formatLocalTime(ja, '05:07', '12h')).toBe('午前5:07');
  });
});

describe('formatCalendarDateTime', () => {
  it('formats a month/day/year with the time appended', () => {
    expect(formatCalendarDateTime(en, 2026, 8, 14, '23:42', '24h')).toBe('Sep 14, 2026 · 23:42');
  });

  it('uses a 0-indexed month, like Date#getMonth', () => {
    expect(formatCalendarDateTime(en, 2026, 0, 1, '00:05', '24h')).toBe('Jan 1, 2026 · 00:05');
    expect(formatCalendarDateTime(en, 2026, 11, 31, '00:05', '24h')).toBe('Dec 31, 2026 · 00:05');
  });

  it('respects the 12h/24h time format', () => {
    expect(formatCalendarDateTime(en, 2026, 8, 14, '23:42', '12h')).toBe('Sep 14, 2026 · 11:42 PM');
  });

  it('orders year-month-day and appends 日 in Japanese', () => {
    expect(formatCalendarDateTime(ja, 2026, 8, 14, '23:42', '24h')).toBe('2026年9月14日 23:42');
  });
});
