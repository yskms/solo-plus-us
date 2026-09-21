import i18n from '../i18n';
import { averageIntervalDays, formatAverageIntervalDays } from '../statistics';

const en = i18n.getFixedT('en');
const ja = i18n.getFixedT('ja');

describe('averageIntervalDays', () => {
  it('returns null for 0 records', () => {
    expect(averageIntervalDays(0, '2026-09-14T00:00:00Z', '2026-09-14T00:00:00Z')).toBeNull();
  });

  it('returns null for exactly 1 record (§14: fewer than 2 -> —)', () => {
    expect(averageIntervalDays(1, '2026-09-14T00:00:00Z', '2026-09-14T00:00:00Z')).toBeNull();
  });

  it('computes (newest - oldest) / (count - 1) in days for 2 records', () => {
    // 4 days apart, count - 1 = 1 -> 4 days
    expect(averageIntervalDays(2, '2026-09-10T00:00:00Z', '2026-09-14T00:00:00Z')).toBeCloseTo(4);
  });

  it('divides by (count - 1), not count, for more than 2 records', () => {
    // 10 days apart across 5 records -> 4 intervals -> 2.5 days average
    expect(averageIntervalDays(5, '2026-09-01T00:00:00Z', '2026-09-11T00:00:00Z')).toBeCloseTo(2.5);
  });

  it('computes a real UTC time difference, not a calendar-day difference', () => {
    // 12 hours apart -> 0.5 days
    expect(averageIntervalDays(2, '2026-09-14T00:00:00Z', '2026-09-14T12:00:00Z')).toBeCloseTo(0.5);
  });
});

describe('formatAverageIntervalDays', () => {
  it('renders "—" for null (not enough data)', () => {
    expect(formatAverageIntervalDays(en, null)).toBe('—');
  });

  it('renders one decimal place with a "days" suffix', () => {
    expect(formatAverageIntervalDays(en, 3.14159)).toBe('3.1 days');
  });

  it('renders a whole number with one decimal place', () => {
    expect(formatAverageIntervalDays(en, 4)).toBe('4.0 days');
  });

  it('uses singular "day" only when the rounded value is exactly 1.0', () => {
    expect(formatAverageIntervalDays(en, 1)).toBe('1.0 day');
    expect(formatAverageIntervalDays(en, 1.04)).toBe('1.0 day'); // rounds to 1.0
    expect(formatAverageIntervalDays(en, 1.2)).toBe('1.2 days');
  });

  it('switches to hours below 1 day even when rounding days would reach 1.0', () => {
    // 0.96 days = ~23 hours: still < 1 day raw, so hours, not "1.0 day"
    expect(formatAverageIntervalDays(en, 0.96)).toBe('23.0 hours');
  });

  it('switches to hours below 1 day, rather than showing "0.x days"', () => {
    // 3 hours: below 1 day, at or above 1 hour, so hours (not days, not minutes)
    expect(formatAverageIntervalDays(en, 3 / 24)).toBe('3.0 hours');
  });

  it('uses singular "hour" only when the rounded value is exactly 1.0', () => {
    expect(formatAverageIntervalDays(en, 1 / 24)).toBe('1.0 hour');
    expect(formatAverageIntervalDays(en, 2 / 24)).toBe('2.0 hours');
  });

  it('switches to minutes below 1 hour even when rounding hours would reach 1.0', () => {
    // 0.96 hours = ~57.6 minutes: still < 1 hour raw, so minutes, not "1.0 hour"
    expect(formatAverageIntervalDays(en, 0.96 / 24)).toBe('57.6 minutes');
  });

  it('switches to minutes below 1 hour, rather than showing "0.0 hours"', () => {
    // 2 records 1 minute apart -> 0.0 hours would misread as simultaneous
    expect(formatAverageIntervalDays(en, 1 / 24 / 60)).toBe('1.0 minute');
    expect(formatAverageIntervalDays(en, 5 / 24 / 60)).toBe('5.0 minutes');
  });

  it('has no singular/plural split in Japanese', () => {
    expect(formatAverageIntervalDays(ja, 1)).toBe('1.0日');
    expect(formatAverageIntervalDays(ja, 1 / 24)).toBe('1.0時間');
    expect(formatAverageIntervalDays(ja, 1 / 24 / 60)).toBe('1.0分');
  });
});
