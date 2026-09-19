import {
  hasZeroSeconds,
  isValidOccurredAtUtc,
  addSecondsIso,
  buildOccurredAtFields,
  clampTo,
  clampToNow,
  deriveLocalDateTime,
  formatUtcIso,
  getDeviceTimeZoneId,
  isLocalDateTimeConsistent,
  isValidLocalDate,
  isValidLocalTime,
  isValidUtcIso,
  nowAsZonedDigits,
  nowUtcIso,
  parseStrictUtcIso,
  resolveOccurredAtEdit,
  resolveOffsetMinutesForZone,
  sameMinute,
  truncateToMinute,
  zonedComponentsToUtc,
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

describe('hasZeroSeconds / isValidOccurredAtUtc (§4.2 occurred_at_utc invariant)', () => {
  it('accepts an instant with :00 seconds', () => {
    expect(hasZeroSeconds('2026-09-14T14:42:00Z')).toBe(true);
    expect(isValidOccurredAtUtc('2026-09-14T14:42:00Z')).toBe(true);
  });

  it('rejects a well-formed instant whose seconds are not zero', () => {
    expect(hasZeroSeconds('2026-09-14T14:42:37Z')).toBe(false);
    expect(isValidOccurredAtUtc('2026-09-14T14:42:37Z')).toBe(false);
  });

  it('isValidOccurredAtUtc still rejects malformed strings entirely', () => {
    expect(isValidOccurredAtUtc('not-a-date')).toBe(false);
    expect(isValidOccurredAtUtc(123)).toBe(false);
  });
});

describe('sameMinute', () => {
  it('treats two instants in the same minute as equal, ignoring seconds', () => {
    expect(sameMinute(new Date('2026-09-14T14:42:00Z'), new Date('2026-09-14T14:42:59Z'))).toBe(true);
  });

  it('treats instants a minute apart as different', () => {
    expect(sameMinute(new Date('2026-09-14T14:42:00Z'), new Date('2026-09-14T14:43:00Z'))).toBe(false);
  });
});

describe('clampToNow', () => {
  it('passes through a date at or before now unchanged', () => {
    const past = new Date(Date.now() - 60_000);
    expect(clampToNow(past)).toBe(past);
  });

  it('clamps a future date down to now', () => {
    const future = new Date(Date.now() + 60_000);
    const clamped = clampToNow(future);
    expect(clamped.getTime()).toBeLessThan(future.getTime());
    expect(clamped.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('clampTo (generic upper bound — clampToNow is clampTo(date, new Date()))', () => {
  it('passes through a date at or before max unchanged', () => {
    const max = new Date('2026-01-01T00:00:00Z');
    const before = new Date('2025-12-31T00:00:00Z');
    expect(clampTo(before, max)).toBe(before);
  });

  it('clamps a date past max down to max', () => {
    const max = new Date('2026-01-01T00:00:00Z');
    const after = new Date('2026-06-01T00:00:00Z');
    expect(clampTo(after, max)).toBe(max);
  });
});

describe('nowAsZonedDigits (D-50 review finding #1, 3rd round — the date/time picker\'s own future guard)', () => {
  it("returns a digit carrier reflecting the wall clock in the given zone at a given instant", () => {
    // 2026-09-10T05:00:00Z is 2026-09-10 14:00 JST.
    const digits = nowAsZonedDigits('Asia/Tokyo', new Date('2026-09-10T05:00:00Z'));
    expect(digits.getFullYear()).toBe(2026);
    expect(digits.getMonth()).toBe(8);
    expect(digits.getDate()).toBe(10);
    expect(digits.getHours()).toBe(14);
    expect(digits.getMinutes()).toBe(0);
  });

  it('can read a wall clock that is on a different calendar day than the reference instant\'s UTC date', () => {
    // 2026-09-19T20:00:00Z is 2026-09-20 05:00 JST — a day later than the UTC date.
    const digits = nowAsZonedDigits('Asia/Tokyo', new Date('2026-09-19T20:00:00Z'));
    expect(digits.getDate()).toBe(20);
    expect(digits.getHours()).toBe(5);
  });
});

describe('zonedComponentsToUtc (inverse of resolveOffsetMinutesForZone)', () => {
  it('converts JST wall-clock digits to the correct UTC instant', () => {
    // 2026-09-10 14:00 JST (+540, no DST) => 2026-09-10 05:00 UTC
    expect(formatUtcIso(zonedComponentsToUtc(2026, 8, 10, 14, 0, 'Asia/Tokyo'))).toBe('2026-09-10T05:00:00Z');
  });

  it('converts US Eastern wall-clock digits correctly on either side of a DST transition', () => {
    expect(formatUtcIso(zonedComponentsToUtc(2026, 0, 15, 9, 0, 'America/New_York'))).toBe('2026-01-15T14:00:00Z'); // EST, UTC-5
    expect(formatUtcIso(zonedComponentsToUtc(2026, 6, 15, 9, 0, 'America/New_York'))).toBe('2026-07-15T13:00:00Z'); // EDT, UTC-4
  });

  it('round-trips with deriveLocalDateTime for an arbitrary zone', () => {
    const utc = zonedComponentsToUtc(2026, 8, 10, 14, 5, 'Asia/Tokyo');
    const offset = resolveOffsetMinutesForZone('Asia/Tokyo', utc);
    expect(deriveLocalDateTime(utc, offset)).toEqual({ localDate: '2026-09-10', localTime: '14:05' });
  });
});

describe('resolveOccurredAtEdit (D-50 Activity Detail post-hoc edit, review findings #1/#2, two rounds)', () => {
  // `pickedLocalDigits` below is always built via the local `Date`
  // constructor (never by parsing a UTC ISO string) — that's what makes
  // it a "digit carrier" rather than a real instant, matching exactly how
  // `app/activity/[id].tsx`'s picker produces it. Using an ISO-string
  // `Date` here instead would make these tests silently depend on
  // whatever zone the test happens to run in.

  it('returns no patch when the picker was never opened', () => {
    expect(resolveOccurredAtEdit('2026-09-10T05:00:00Z', 'Asia/Tokyo', null)).toEqual({});
  });

  it('returns no patch when the picked digits resolve back to the same minute as what is already recorded', () => {
    // 2026-09-10T05:00:00Z is 2026-09-10 14:00 in Asia/Tokyo.
    const pickedSameValue = new Date(2026, 8, 10, 14, 0);
    expect(resolveOccurredAtEdit('2026-09-10T05:00:00Z', 'Asia/Tokyo', pickedSameValue)).toEqual({});
  });

  it("resolves the picked wall-clock digits in the record's OWN timezoneId, not the device's current one (review finding #1)", () => {
    // Pick a zone guaranteed to differ (in offset, at this instant) from
    // wherever this test happens to run — otherwise a regression to
    // "always use the device's current zone" could accidentally pass just
    // because the two happen to match on this particular machine.
    const deviceZone = getDeviceTimeZoneId();
    const referenceInstant = new Date('2026-09-10T05:00:00Z');
    const deviceOffset = resolveOffsetMinutesForZone(deviceZone, referenceInstant);
    const recordedZone = deviceOffset === 540 ? 'America/Los_Angeles' : 'Asia/Tokyo';
    const recordedOffset = resolveOffsetMinutesForZone(recordedZone, referenceInstant);
    expect(recordedOffset).not.toBe(deviceOffset);

    // The original recorded instant, expressed as `recordedZone`'s own wall clock.
    const { localDate, localTime } = deriveLocalDateTime(referenceInstant, recordedOffset);
    const [y, m, d] = localDate.split('-').map(Number);
    const [hh, mm] = localTime.split(':').map(Number);

    // The picker shows exactly those digits (device-zone digit carrier), nudged 5 minutes later.
    const pickedDigits = new Date(y, m - 1, d, hh, mm + 5);
    const patch = resolveOccurredAtEdit(formatUtcIso(referenceInstant), recordedZone, pickedDigits);

    expect(patch.timezoneId).toBe(recordedZone);
    expect(patch.timezoneOffsetMinutes).toBe(recordedOffset);
    expect(patch.occurredAtUtc).toBe(addSecondsIso(formatUtcIso(referenceInstant), 5 * 60));
  });

  it("falls back to the device's current zone only when the record has no timezoneId on file", () => {
    const patch = resolveOccurredAtEdit('2026-09-10T05:00:00Z', null, new Date(2026, 8, 10, 14, 5));
    expect(patch.timezoneId).toBe(getDeviceTimeZoneId());
  });

  it('clamps a future picked instant to now before computing the patch', () => {
    const original = '2020-01-01T00:00:00Z'; // clearly not "now", so clamping is distinguishable from a no-op
    const farFutureDigits = new Date(2099, 0, 1, 0, 0); // any zone resolves this to a real future instant
    const patch = resolveOccurredAtEdit(original, 'Asia/Tokyo', farFutureDigits);
    expect(patch.occurredAtUtc).toBeDefined();
    expect(parseStrictUtcIso(patch.occurredAtUtc!).getTime()).toBeLessThanOrEqual(Date.now());
  });
});
