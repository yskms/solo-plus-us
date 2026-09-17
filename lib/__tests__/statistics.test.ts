import { averageIntervalDays, formatAverageIntervalDays } from '../statistics';

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
    expect(formatAverageIntervalDays(null)).toBe('—');
  });

  it('renders one decimal place with a "days" suffix', () => {
    expect(formatAverageIntervalDays(3.14159)).toBe('3.1 days');
  });

  it('renders a whole number with one decimal place', () => {
    expect(formatAverageIntervalDays(4)).toBe('4.0 days');
  });
});
