import { planForDelete, planForEdit, planForRecord, toMappingState, type CurrentJobState } from '../syncJobPlanner';
import type { SyncState } from '../../types/HealthSync';

describe('planForRecord', () => {
  it('always inserts a create job', () => {
    expect(planForRecord()).toEqual({ action: 'insert', operation: 'create' });
  });
});

describe('planForEdit (§9.3 編集 rows, D-51 の4値 mappingState)', () => {
  it.each<[CurrentJobState['operation']]>([['create'], ['update'], ['recreate']])(
    'leaves an existing %s job untouched regardless of attempts/claim/mappingState',
    (operation) => {
      expect(planForEdit({ operation, attempts: 0, claimedAt: null }, 'none')).toEqual({ action: 'noop' });
      expect(planForEdit({ operation, attempts: 7, claimedAt: null }, 'synced')).toEqual({ action: 'noop' });
      expect(planForEdit({ operation, attempts: 0, claimedAt: '2026-09-14T00:00:00Z' }, 'uncertain')).toEqual({
        action: 'noop',
      });
      expect(planForEdit({ operation, attempts: 0, claimedAt: null }, 'declined')).toEqual({ action: 'noop' });
    },
  );

  it('inserts update when no job exists and mappingState is synced (normal synced edit)', () => {
    expect(planForEdit(null, 'synced')).toEqual({ action: 'insert', operation: 'update' });
  });

  it("inserts update when no job exists and mappingState is uncertain — not an opt-out, so an edit is exactly the moment to try again (D-51)", () => {
    expect(planForEdit(null, 'uncertain')).toEqual({ action: 'insert', operation: 'update' });
  });

  it('does nothing when mappingState is declined — D-35\'s explicit "don\'t sync this" must not be silently overridden by an unrelated edit (D-51)', () => {
    expect(planForEdit(null, 'declined')).toEqual({ action: 'noop' });
  });

  it('does nothing when neither a job nor a mapping exists (mappingState "none") — no backfill-on-edit (avoids racing a stale D-34 create)', () => {
    expect(planForEdit(null, 'none')).toEqual({ action: 'noop' });
  });
});

describe('planForDelete (§10.1, job-first table, D-51 の4値 mappingState)', () => {
  describe('create job', () => {
    it('順1: deletes the job outright when unattempted, unclaimed, and mappingState is none', () => {
      expect(planForDelete({ operation: 'create', attempts: 0, claimedAt: null }, 'none')).toEqual({
        action: 'delete-job',
      });
    });

    it('順1: also deletes the job outright when mappingState is declined (definitely never reached the provider)', () => {
      expect(planForDelete({ operation: 'create', attempts: 0, claimedAt: null }, 'declined')).toEqual({
        action: 'delete-job',
      });
    });

    it('順2: replaces with delete when attempts > 0 (may have reached the provider)', () => {
      expect(planForDelete({ operation: 'create', attempts: 1, claimedAt: null }, 'none')).toEqual({
        action: 'replace',
        operation: 'delete',
      });
    });

    it('順2: replaces with delete when currently claimed, even with attempts = 0', () => {
      expect(
        planForDelete({ operation: 'create', attempts: 0, claimedAt: '2026-09-14T00:00:00Z' }, 'none'),
      ).toEqual({ action: 'replace', operation: 'delete' });
    });

    it('順2: replaces with delete when mappingState is synced (D-32 race: external create succeeded, then edited)', () => {
      expect(planForDelete({ operation: 'create', attempts: 0, claimedAt: null }, 'synced')).toEqual({
        action: 'replace',
        operation: 'delete',
      });
    });

    it('順2: replaces with delete when mappingState is uncertain (D-51: may have reached the provider, same as synced)', () => {
      expect(planForDelete({ operation: 'create', attempts: 0, claimedAt: null }, 'uncertain')).toEqual({
        action: 'replace',
        operation: 'delete',
      });
    });
  });

  it('順3: an update job is replaced with delete', () => {
    expect(planForDelete({ operation: 'update', attempts: 0, claimedAt: null }, 'synced')).toEqual({
      action: 'replace',
      operation: 'delete',
    });
    // still replaces even with mappingState 'none' / no attempts — update jobs always imply a prior mapping existed.
    expect(planForDelete({ operation: 'update', attempts: 0, claimedAt: null }, 'none')).toEqual({
      action: 'replace',
      operation: 'delete',
    });
  });

  it('順4: a recreate job is replaced with delete (Import re-sync in progress)', () => {
    expect(planForDelete({ operation: 'recreate', attempts: 0, claimedAt: null }, 'none')).toEqual({
      action: 'replace',
      operation: 'delete',
    });
  });

  it('順5: no job, mappingState synced — insert a delete job', () => {
    expect(planForDelete(null, 'synced')).toEqual({ action: 'insert', operation: 'delete' });
  });

  it('順5: no job, mappingState uncertain — insert a delete job too (D-51: the whole reason uncertain exists is to keep this defensive cleanup)', () => {
    expect(planForDelete(null, 'uncertain')).toEqual({ action: 'insert', operation: 'delete' });
  });

  it('順6: no job, mappingState none — nothing to do for this provider', () => {
    expect(planForDelete(null, 'none')).toEqual({ action: 'noop' });
  });

  it('順6: no job, mappingState declined — nothing to do (definitely never reached the provider, same as none)', () => {
    expect(planForDelete(null, 'declined')).toEqual({ action: 'noop' });
  });
});

describe('toMappingState', () => {
  it('is "none" when there is no mapping row', () => {
    expect(toMappingState(null)).toBe('none');
  });

  it.each<[SyncState]>([['synced'], ['uncertain'], ['declined']])('passes through the row\'s own syncState (%s)', (syncState) => {
    expect(
      toMappingState({ activityId: 'a', provider: 'health_connect', externalRecordId: null, syncState, lastSyncedAt: null }),
    ).toBe(syncState);
  });
});
