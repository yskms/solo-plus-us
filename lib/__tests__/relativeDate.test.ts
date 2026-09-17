import { formatRelativeLocalDate, formatMonthDay } from '../relativeDate';
import { ValidationError } from '../errors';

describe('formatRelativeLocalDate', () => {
  it('returns "Today" for the same date', () => {
    expect(formatRelativeLocalDate('2026-09-16', '2026-09-16')).toBe('Today');
  });
  it('returns "Yesterday" for one day back', () => {
    expect(formatRelativeLocalDate('2026-09-15', '2026-09-16')).toBe('Yesterday');
  });
  it('returns "N days ago" beyond that', () => {
    expect(formatRelativeLocalDate('2026-09-09', '2026-09-16')).toBe('7 days ago');
  });
  it('handles a month boundary correctly', () => {
    expect(formatRelativeLocalDate('2026-08-31', '2026-09-02')).toBe('2 days ago');
  });
  it('never returns a future/negative label for a future date (clamped to Today)', () => {
    expect(formatRelativeLocalDate('2026-09-20', '2026-09-16')).toBe('Today');
  });
});

describe('formatMonthDay', () => {
  it('formats a local date as an abbreviated month and day, no year', () => {
    expect(formatMonthDay('2026-09-14')).toBe('Sep 14');
  });
  it('rejects an invalid local date', () => {
    expect(() => formatMonthDay('not-a-date')).toThrow(ValidationError);
  });
});
