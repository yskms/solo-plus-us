import {
  addSecondsIso,
  buildOccurredAtFields,
  deriveLocalDateTime,
  formatUtcIso,
  isLocalDateTimeConsistent,
  isValidLocalDate,
  isValidLocalTime,
  isValidUtcIso,
  nowUtcIso,
  parseStrictUtcIso,
  resolveOffsetMinutesForZone,
  truncateToMinute,
} from '../datetime';

describe('parseStrictUtcIso', () => {
  it('parses a well-formed instant', () => {
    const d = parseStrictUtcIso('2026-09-14T14:42:00Z');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8); // 0-indexed
    expect(d.getUTCDate()).toBe(14);
    expect(d.getUTCHours()).toBe(14);
    expect(d.getUTCMinutes()).toBe(42);
    expect(d.getUTCSeconds()).toBe(0);
  });

  it.each([
    'not-a-date',
    '2026-09-14 14:42:00Z', // missing T
    '2026-09-14T14:42:00', // missing Z
    '2026-9-14T14:42:00Z', // month not zero-padded
    '2026-09-14T14:42Z', // missing seconds
  ])('rejects malformed string %s', (bad) => {
    expect(() => parseStrictUtcIso(bad)).toThrow();
  });

  it.each([
    '2026-13-01T00:00:00Z', // month 13
    '2026-02-30T00:00:00Z', // Feb 30 (not a leap concern, just invalid)
    '2025-02-29T00:00:00Z', // 2025 is not a leap year
    '2026-01-01T24:00:00Z', // hour 24
    '2026-01-01T00:60:00Z', // minute 60
    '2026-01-01T00:00:60Z', // second 60
  ])('rejects out-of-range calendar value %s (no silent overflow)', (bad) => {
    expect(() => parseStrictUtcIso(bad)).toThrow();
  });

  it('accepts a real leap day', () => {
    expect(() => parseStrictUtcIso('2024-02-29T00:00:00Z')).not.toThrow();
  });
});

describe('isValidUtcIso / isValidLocalDate / isValidLocalTime', () => {
  it('is a non-throwing boolean wrapper', () => {
    expect(isValidUtcIso('2026-09-14T14:42:00Z')).toBe(true);
    expect(isValidUtcIso('garbage')).toBe(false);
    expect(isValidUtcIso(123)).toBe(false);
  });

  it('validates local date strings', () => {
    expect(isValidLocalDate('2026-09-14')).toBe(true);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2026-9-14')).toBe(false);
  });

  it('validates local time strings', () => {
    expect(isValidLocalTime('23:59')).toBe(true);
    expect(isValidLocalTime('24:00')).toBe(false);
    expect(isValidLocalTime('12:60')).toBe(false);
  });
});

describe('truncateToMinute', () => {
  it('zeroes out seconds and milliseconds', () => {
    const d = new Date(Date.UTC(2026, 8, 14, 14, 42, 37, 500));
    const t = truncateToMinute(d);
    expect(formatUtcIso(t)).toBe('2026-09-14T14:42:00Z');
  });
});

describe('deriveLocalDateTime (local = utc + offset, pure arithmetic)', () => {
  it('adds a positive offset (JST, +540) without depending on process TZ', () => {
    const utc = parseStrictUtcIso('2026-09-14T14:42:00Z');
    const { localDate, localTime } = deriveLocalDateTime(utc, 540);
    expect(localDate).toBe('2026-09-14');
    expect(localTime).toBe('23:42');
  });

  it('rolls the local date forward across midnight', () => {
    const utc = parseStrictUtcIso('2026-09-14T23:30:00Z');
    const { localDate, localTime } = deriveLocalDateTime(utc, 540); // JST
    expect(localDate).toBe('2026-09-15');
    expect(localTime).toBe('08:30');
  });

  it('rolls the local date backward for a negative offset', () => {
    const utc = parseStrictUtcIso('2026-09-14T02:00:00Z');
    const { localDate, localTime } = deriveLocalDateTime(utc, -300); // US Eastern (EST, no DST math here)
    expect(localDate).toBe('2026-09-13');
    expect(localTime).toBe('21:00');
  });
});

describe('resolveOffsetMinutesForZone (DST correctness, §4.4)', () => {
  it('returns +540 for Asia/Tokyo (no DST) regardless of date', () => {
    expect(resolveOffsetMinutesForZone('Asia/Tokyo', new Date(Date.UTC(2026, 0, 1)))).toBe(540);
    expect(resolveOffsetMinutesForZone('Asia/Tokyo', new Date(Date.UTC(2026, 6, 1)))).toBe(540);
  });

  it('returns the correct offset either side of a US DST transition', () => {
    // America/New_York: EST (UTC-5) in January, EDT (UTC-4) in July.
    const januaryOffset = resolveOffsetMinutesForZone('America/New_York', new Date(Date.UTC(2026, 0, 15)));
    const julyOffset = resolveOffsetMinutesForZone('America/New_York', new Date(Date.UTC(2026, 6, 15)));
    expect(januaryOffset).toBe(-300);
    expect(julyOffset).toBe(-240);
  });
});

describe('buildOccurredAtFields', () => {
  it('derives all four columns consistently for a fixed instant/zone', () => {
    const instant = parseStrictUtcIso('2026-09-14T14:42:30Z'); // has seconds, should be truncated
    const fields = buildOccurredAtFields(instant, 'Asia/Tokyo');
    expect(fields.occurredAtUtc).toBe('2026-09-14T14:42:00Z');
    expect(fields.timezoneOffsetMinutes).toBe(540);
    expect(fields.occurredLocalDate).toBe('2026-09-14');
    expect(fields.occurredLocalTime).toBe('23:42');
  });
});

describe('isLocalDateTimeConsistent (Import validator, §13.4)', () => {
  it('accepts a self-consistent record', () => {
    expect(
      isLocalDateTimeConsistent('2026-09-14T14:42:00Z', 540, '2026-09-14', '23:42'),
    ).toBe(true);
  });

  it('rejects a tampered local date', () => {
    expect(
      isLocalDateTimeConsistent('2026-09-14T14:42:00Z', 540, '2026-09-15', '23:42'),
    ).toBe(false);
  });

  it('rejects a tampered offset', () => {
    expect(
      isLocalDateTimeConsistent('2026-09-14T14:42:00Z', 0, '2026-09-14', '23:42'),
    ).toBe(false);
  });
});

describe('addSecondsIso', () => {
  it('adds the Undo delay (5s, D-15/D-44)', () => {
    expect(addSecondsIso('2026-09-14T14:42:00Z', 5)).toBe('2026-09-14T14:42:05Z');
  });

  it('carries over a minute/day boundary', () => {
    expect(addSecondsIso('2026-09-14T23:59:58Z', 5)).toBe('2026-09-15T00:00:03Z');
  });
});

describe('nowUtcIso', () => {
  it('produces the fixed 20-character format', () => {
    expect(nowUtcIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(nowUtcIso()).toHaveLength(20);
  });
});
