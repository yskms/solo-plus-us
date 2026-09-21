import { hasRecordedValue, isFieldVisible, ACTIVITY_DETAIL_FIELDS } from '../activityDetailsFields';

const blankActivity = {
  orgasm: null,
  ejaculation: null,
  protectionUsed: null,
  durationSeconds: null,
  moodBefore: null,
  moodAfter: null,
  note: null,
};

describe('hasRecordedValue', () => {
  it('is false for every field on a blank Activity', () => {
    for (const { field } of ACTIVITY_DETAIL_FIELDS) {
      expect(hasRecordedValue(field, blankActivity)).toBe(false);
    }
  });

  it('treats mood as recorded if either moodBefore or moodAfter is set', () => {
    expect(hasRecordedValue('mood', { ...blankActivity, moodBefore: 3 })).toBe(true);
    expect(hasRecordedValue('mood', { ...blankActivity, moodAfter: 3 })).toBe(true);
    expect(hasRecordedValue('mood', blankActivity)).toBe(false);
  });

  it('treats false/0 as recorded, not as absent', () => {
    expect(hasRecordedValue('orgasm', { ...blankActivity, orgasm: false })).toBe(true);
    expect(hasRecordedValue('duration', { ...blankActivity, durationSeconds: 0 })).toBe(true);
  });
});

describe('isFieldVisible', () => {
  it('is visible when the setting is on, regardless of recorded state', () => {
    expect(isFieldVisible('ejaculation', true, blankActivity, new Set())).toBe(true);
  });

  it('is visible when the setting is off but a value is already recorded (§6.3 invariant)', () => {
    const activity = { ...blankActivity, ejaculation: true };
    expect(isFieldVisible('ejaculation', false, activity, new Set())).toBe(true);
  });

  it('is hidden when the setting is off, nothing is recorded, and it was not revealed', () => {
    expect(isFieldVisible('ejaculation', false, blankActivity, new Set())).toBe(false);
  });

  it('is visible when revealed via "Add more details" for this visit, even with the setting off', () => {
    expect(isFieldVisible('ejaculation', false, blankActivity, new Set(['ejaculation']))).toBe(true);
  });
});
