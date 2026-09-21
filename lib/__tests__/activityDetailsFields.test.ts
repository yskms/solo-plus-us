import i18n from '../i18n';
import { activityDetailFieldLabel, hasRecordedValue, isFieldVisible, ACTIVITY_DETAIL_FIELDS } from '../activityDetailsFields';

const en = i18n.getFixedT('en');
const ja = i18n.getFixedT('ja');

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

  it('treats an empty string note the same as null (not recorded)', () => {
    // The save path normalizes blank Notes to null, but Import doesn't
    // re-normalize an external JSON's `note: ""` — both must count as unset.
    expect(hasRecordedValue('note', { ...blankActivity, note: '' })).toBe(false);
    expect(hasRecordedValue('note', { ...blankActivity, note: 'hi' })).toBe(true);
  });
});

describe('activityDetailFieldLabel', () => {
  it('has a translated label for every field, in both languages', () => {
    for (const { field } of ACTIVITY_DETAIL_FIELDS) {
      expect(activityDetailFieldLabel(en, field)).toBeTruthy();
      expect(activityDetailFieldLabel(ja, field)).toBeTruthy();
    }
  });
});

describe('isFieldVisible', () => {
  it('is visible when the setting is on, regardless of recorded state', () => {
    expect(isFieldVisible('ejaculation', true, blankActivity, 'solo', new Set())).toBe(true);
  });

  it('is visible when the setting is off but a value is already recorded (§6.3 invariant)', () => {
    const activity = { ...blankActivity, ejaculation: true };
    expect(isFieldVisible('ejaculation', false, activity, 'solo', new Set())).toBe(true);
  });

  it('is hidden when the setting is off, nothing is recorded, and it was not revealed', () => {
    expect(isFieldVisible('ejaculation', false, blankActivity, 'solo', new Set())).toBe(false);
  });

  it('is visible when revealed via "Add more details" for this visit, even with the setting off', () => {
    expect(isFieldVisible('ejaculation', false, blankActivity, 'solo', new Set(['ejaculation']))).toBe(true);
  });

  it('shows Protection by default for a partnered Activity, setting off and unrecorded (Screen 04 "Partnered の場合")', () => {
    expect(isFieldVisible('protection', false, blankActivity, 'partnered', new Set())).toBe(true);
  });

  it('does not force Protection for a solo Activity — "Solo で選べないようハードゲートはしない" is additive only, not a ban', () => {
    expect(isFieldVisible('protection', false, blankActivity, 'solo', new Set())).toBe(false);
    expect(isFieldVisible('protection', false, blankActivity, 'solo', new Set(['protection']))).toBe(true);
  });

  it('does not force other fields for a partnered Activity — the Screen 04 rule is Protection-only', () => {
    expect(isFieldVisible('ejaculation', false, blankActivity, 'partnered', new Set())).toBe(false);
  });
});
