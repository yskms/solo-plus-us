import { sanitizeImportedSettings, validateExportFile } from '../importValidation';
import { CURRENT_EXPORT_VERSION } from '../../types/Export';
import { EXPORTABLE_SETTING_KEYS, STATIC_DEFAULTS } from '../../types/Settings';

function validActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: '8f14e45f-ceea-4d0e-b44e-1b2c3d4e5f60',
    context: 'solo',
    occurredAtUtc: '2026-09-14T14:42:00Z',
    occurredLocalDate: '2026-09-14',
    occurredLocalTime: '23:42',
    timezoneOffsetMinutes: 540,
    timezoneId: 'Asia/Tokyo',
    orgasm: true,
    ejaculation: null,
    protectionUsed: null,
    durationSeconds: null,
    moodBefore: null,
    moodAfter: null,
    note: null,
    syncVersion: 1,
    createdAt: '2026-09-14T14:42:03Z',
    updatedAt: '2026-09-14T14:42:03Z',
    ...overrides,
  };
}

function validFile(activities: unknown[] = [validActivity()]) {
  return {
    version: CURRENT_EXPORT_VERSION,
    exportedAt: '2026-09-16T14:20:00Z',
    settings: { 'activityDetails.orgasm': true, 'preferences.firstDayOfWeek': 'monday' },
    activities,
  };
}

describe('validateExportFile — happy path', () => {
  it('accepts a well-formed file with one activity', () => {
    const result = validateExportFile(validFile());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.activityCount).toBe(1);
      expect(result.file.activities[0].id).toBe('8f14e45f-ceea-4d0e-b44e-1b2c3d4e5f60');
    }
  });

  it('accepts zero activities (an empty but well-formed backup)', () => {
    const result = validateExportFile(validFile([]));
    expect(result.valid).toBe(true);
  });

  it('accepts a null timezoneId (offset-only, e.g. re-imported legacy data)', () => {
    const result = validateExportFile(validFile([validActivity({ timezoneId: null })]));
    expect(result.valid).toBe(true);
  });
});

describe('validateExportFile — root-level', () => {
  it('rejects a non-object root', () => {
    expect(validateExportFile('not an object').valid).toBe(false);
    expect(validateExportFile(null).valid).toBe(false);
    expect(validateExportFile([1, 2, 3]).valid).toBe(false);
  });

  it('rejects an unsupported version (too new)', () => {
    const result = validateExportFile(validFile()) as { valid: true; file: unknown };
    const tampered = { ...(result as never as { file: Record<string, unknown> }).file, version: 2 };
    const outcome = validateExportFile(tampered);
    expect(outcome.valid).toBe(false);
  });

  it('rejects a missing version', () => {
    const file = validFile();
    delete (file as Record<string, unknown>).version;
    expect(validateExportFile(file).valid).toBe(false);
  });

  it('rejects when activities is not an array', () => {
    const file = validFile();
    (file as Record<string, unknown>).activities = { not: 'an array' };
    expect(validateExportFile(file).valid).toBe(false);
  });
});

describe('validateExportFile — §D-23 key presence (missing key ≠ null)', () => {
  it('rejects an activity missing a required key entirely', () => {
    const activity = validActivity();
    delete (activity as Record<string, unknown>).ejaculation;
    const result = validateExportFile(validFile([activity]));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === 'activities[0].ejaculation')).toBe(true);
    }
  });

  it('accepts the same key present with an explicit null', () => {
    const result = validateExportFile(validFile([validActivity({ ejaculation: null })]));
    expect(result.valid).toBe(true);
  });

  it('rejects an unrecognized extra key', () => {
    const result = validateExportFile(validFile([validActivity({ extraField: 'nope' })]));
    expect(result.valid).toBe(false);
  });
});

describe('validateExportFile — §13.1 strict, all-or-nothing (one bad row fails everything)', () => {
  it('rejects the whole file when one of several activities is invalid, and reports the good ones as unaffected by the check', () => {
    const good = validActivity({ id: '11111111-1111-4111-8111-111111111111' });
    const bad = validActivity({ id: '22222222-2222-4222-8222-222222222222', context: 'both' });
    const result = validateExportFile(validFile([good, bad]));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === 'activities[1].context')).toBe(true);
    }
  });

  it('does not silently drop bad rows — it reports every error found, not just the first', () => {
    const bad = validActivity({ context: 'nope', durationSeconds: -5, moodBefore: 9 });
    const result = validateExportFile(validFile([bad]));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('validateExportFile — id rules', () => {
  it('rejects a non-UUID-v4 id', () => {
    const result = validateExportFile(validFile([validActivity({ id: 'not-a-uuid' })]));
    expect(result.valid).toBe(false);
  });

  it('rejects duplicate ids within the same file (no silent dedup, D-10)', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const result = validateExportFile(validFile([validActivity({ id }), validActivity({ id })]));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes('duplicate id'))).toBe(true);
    }
  });
});

describe('validateExportFile — §4.1 local/UTC consistency', () => {
  it('rejects a tampered local date that no longer matches occurredAtUtc + offset', () => {
    const result = validateExportFile(validFile([validActivity({ occurredLocalDate: '2026-01-01' })]));
    expect(result.valid).toBe(false);
  });
});

describe('validateExportFile — field ranges', () => {
  it.each([
    ['durationSeconds', 0],
    ['durationSeconds', 86_401],
    ['durationSeconds', 1.5],
    ['moodBefore', 0],
    ['moodAfter', 6],
    ['syncVersion', 0],
    ['timezoneOffsetMinutes', 841],
    ['timezoneOffsetMinutes', -841],
  ])('rejects out-of-range %s = %p', (field, value) => {
    const result = validateExportFile(validFile([validActivity({ [field]: value })]));
    expect(result.valid).toBe(false);
  });

  it('rejects updatedAt before createdAt', () => {
    const result = validateExportFile(
      validFile([validActivity({ createdAt: '2026-09-14T14:42:03Z', updatedAt: '2026-09-14T14:42:02Z' })]),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a note over 2000 characters', () => {
    const result = validateExportFile(validFile([validActivity({ note: 'x'.repeat(2001) })]));
    expect(result.valid).toBe(false);
  });
});

describe('sanitizeImportedSettings — §13.3 lenient (bad values dropped, never blocks import)', () => {
  it('keeps only allowlisted, well-typed keys', () => {
    const sanitized = sanitizeImportedSettings({
      'activityDetails.orgasm': true,
      'preferences.firstDayOfWeek': 'monday',
      'healthConnect.enabled': true, // not in the allowlist — must be dropped
      'preferences.appearance': 'not-a-real-value', // bad enum value — must be dropped
    });
    expect(sanitized).toEqual({
      'activityDetails.orgasm': true,
      'preferences.firstDayOfWeek': 'monday',
    });
  });

  it('returns {} for a missing or malformed settings block, without throwing', () => {
    expect(sanitizeImportedSettings(undefined)).toEqual({});
    expect(sanitizeImportedSettings(null)).toEqual({});
    expect(sanitizeImportedSettings('nope')).toEqual({});
  });

  /**
   * Regression guard: `isSettingValueValid` (private to importValidation.ts)
   * switches on `SettingKey` with no exhaustiveness check from the
   * compiler (its `default: return false` swallows an unhandled case
   * instead of a type error), so adding a key to `EXPORTABLE_SETTING_KEYS`
   * without also adding a case there silently drops that setting on every
   * import/restore — exactly what happened for `preferences.language`
   * (caught only by code review, not by `tsc`/`jest`, since a dropped key
   * looks identical to "wasn't in the file"). This test would have failed
   * for it: a known-valid value for every exportable key must round-trip
   * through `sanitizeImportedSettings` unchanged.
   *
   * `toStrictEqual`, not `toEqual` (round 2 review fix): `toEqual` treats
   * an `undefined`-valued property as equivalent to the property being
   * absent, so if a *future* key were added to `EXPORTABLE_SETTING_KEYS`
   * without also adding it here (`validValuesByKey[key]` silently
   * `undefined`) *and* without a case in `isSettingValueValid`, this test
   * would still pass — `raw` becomes `{ [key]: undefined }`, the sanitizer
   * drops it to `{}`, and `toEqual({}, { [key]: undefined })` is true,
   * defeating the whole point of this guard. `toStrictEqual` tells the
   * two apart. The explicit `toBeDefined()` below is redundant with that
   * (belt-and-suspenders) but gives a clearer failure message pointing at
   * *this test* needing an update, rather than a confusing equality diff.
   */
  it('recognizes a known-valid value for every key in EXPORTABLE_SETTING_KEYS', () => {
    const validValuesByKey: Record<string, unknown> = {
      ...STATIC_DEFAULTS,
      'preferences.firstDayOfWeek': 'monday',
      'preferences.timeFormat': '24h',
    };
    for (const key of EXPORTABLE_SETTING_KEYS) {
      expect(validValuesByKey[key]).toBeDefined();
      const raw = { [key]: validValuesByKey[key] };
      expect(sanitizeImportedSettings(raw)).toStrictEqual(raw);
    }
  });
});
