import { planForDelete, planForEdit, planForRecord, type CurrentJobState } from '../syncJobPlanner';

describe('planForRecord', () => {
  it('always inserts a create job', () => {
    expect(planForRecord()).toEqual({ action: 'insert', operation: 'create' });
  });
});

describe('planForEdit (§9.3 編集 rows)', () => {
  it.each<[CurrentJobState['operation']]>([['create'], ['update'], ['recreate']])(
    'leaves an existing %s job untouched regardless of attempts/claim',
    (operation) => {
      expect(planForEdit({ operation, attempts: 0, claimedAt: null }, false)).toEqual({ action: 'noop' });
      expect(planForEdit({ operation, attempts: 7, claimedAt: null }, true)).toEqual({ action: 'noop' });
      expect(planForEdit({ operation, attempts: 0, claimedAt: '2026-09-14T00:00:00Z' }, false)).toEqual({
        action: 'noop',
      });
    },
  );

  it('inserts update when no job exists but a mapping does (normal synced edit)', () => {
    expect(planForEdit(null, true)).toEqual({ action: 'insert', operation: 'update' });
  });

  it('inserts create when neither a job nor a mapping exists (provider activated after first record — gap fill)', () => {
    expect(planForEdit(null, false)).toEqual({ action: 'insert', operation: 'create' });
  });
});

describe('planForDelete (§10.1, job-first table)', () => {
  describe('create job', () => {
    it('順1: deletes the job outright when unattempted, unclaimed, and no mapping', () => {
      expect(planForDelete({ operation: 'create', attempts: 0, claimedAt: null }, false)).toEqual({
        action: 'delete-job',
      });
    });

    it('順2: replaces with delete when attempts > 0 (may have reached the provider)', () => {
      expect(planForDelete({ operation: 'create', attempts: 1, claimedAt: null }, false)).toEqual({
        action: 'replace',
        operation: 'delete',
      });
    });

    it('順2: replaces with delete when currently claimed, even with attempts = 0', () => {
      expect(
        planForDelete({ operation: 'create', attempts: 0, claimedAt: '2026-09-14T00:00:00Z' }, false),
      ).toEqual({ action: 'replace', operation: 'delete' });
    });

    it('順2: replaces with delete when a mapping already exists (D-32 race: external create succeeded, then edited)', () => {
      expect(planForDelete({ operation: 'create', attempts: 0, claimedAt: null }, true)).toEqual({
        action: 'replace',
        operation: 'delete',
      });
    });
  });

  it('順3: an update job is replaced with delete', () => {
    expect(planForDelete({ operation: 'update', attempts: 0, claimedAt: null }, true)).toEqual({
      action: 'replace',
      operation: 'delete',
    });
    // still replaces even with no mapping / no attempts — update jobs always imply a prior mapping existed.
    expect(planForDelete({ operation: 'update', attempts: 0, claimedAt: null }, false)).toEqual({
      action: 'replace',
      operation: 'delete',
    });
  });

  it('順4: a recreate job is replaced with delete (Import re-sync in progress)', () => {
    expect(planForDelete({ operation: 'recreate', attempts: 0, claimedAt: null }, false)).toEqual({
      action: 'replace',
      operation: 'delete',
    });
  });

  it('順5: no job but a mapping exists — insert a delete job', () => {
    expect(planForDelete(null, true)).toEqual({ action: 'insert', operation: 'delete' });
  });

  it('順6: no job and no mapping — nothing to do for this provider', () => {
    expect(planForDelete(null, false)).toEqual({ action: 'noop' });
  });
});
