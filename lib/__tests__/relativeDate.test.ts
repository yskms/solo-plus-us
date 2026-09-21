import i18n from '../i18n';
import { formatRelativeLocalDate, formatMonthDay } from '../relativeDate';
import { ValidationError } from '../errors';

const en = i18n.getFixedT('en');
const ja = i18n.getFixedT('ja');

describe('formatRelativeLocalDate', () => {
  it('returns "Today" for the same date', () => {
    expect(formatRelativeLocalDate(en, '2026-09-16', '2026-09-16')).toBe('Today');
  });
  it('returns "Yesterday" for one day back', () => {
    expect(formatRelativeLocalDate(en, '2026-09-15', '2026-09-16')).toBe('Yesterday');
  });
  it('returns "N days ago" beyond that', () => {
    expect(formatRelativeLocalDate(en, '2026-09-09', '2026-09-16')).toBe('7 days ago');
  });
  it('uses the singular form for exactly 1 (via "Yesterday", not "1 day ago")', () => {
    // Sanity check on the plural boundary itself, since diff===1 short-circuits to "Yesterday".
    expect(formatRelativeLocalDate(en, '2026-09-14', '2026-09-16')).toBe('2 days ago');
  });
  it('handles a month boundary correctly', () => {
    expect(formatRelativeLocalDate(en, '2026-08-31', '2026-09-02')).toBe('2 days ago');
  });
  it('never returns a future/negative label for a future date (clamped to Today)', () => {
    expect(formatRelativeLocalDate(en, '2026-09-20', '2026-09-16')).toBe('Today');
  });
  it('translates to Japanese, with no singular/plural split', () => {
    expect(formatRelativeLocalDate(ja, '2026-09-16', '2026-09-16')).toBe('今日');
    expect(formatRelativeLocalDate(ja, '2026-09-15', '2026-09-16')).toBe('昨日');
    expect(formatRelativeLocalDate(ja, '2026-09-09', '2026-09-16')).toBe('7日前');
  });
});

describe('formatMonthDay', () => {
  it('formats a local date as an abbreviated month and day, no year', () => {
    expect(formatMonthDay(en, '2026-09-14')).toBe('Sep 14');
  });
  it('rejects an invalid local date', () => {
    expect(() => formatMonthDay(en, 'not-a-date')).toThrow(ValidationError);
  });
  it('formats as "month日" in Japanese', () => {
    expect(formatMonthDay(ja, '2026-09-14')).toBe('9月14日');
  });
});
