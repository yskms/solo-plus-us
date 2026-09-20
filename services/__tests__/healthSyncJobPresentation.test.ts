import { describeJobAction } from '../healthSyncJobPresentation';
import type { JobOperation, SyncErrorCode } from '../../types/HealthSync';

describe('describeJobAction (§9.6 の破棄文言テーブル)', () => {
  it.each<[JobOperation]>([['create'], ['update'], ['recreate']])(
    'operation=%s は "Not synced to Health Connect" / "Don\'t sync" と確認文を返す',
    (operation) => {
      const copy = describeJobAction({ operation, lastErrorCode: null });
      expect(copy.statusText).toBe('Not synced to Health Connect');
      expect(copy.discardLabel).toBe("Don't sync");
      expect(copy.discardConfirm).toEqual({
        title: "Don't sync this record?",
        message: 'Solo + Us and Health Connect will no longer match.',
      });
    },
  );

  it('operation=delete は "Deletion not applied" / "Stop retrying" と確認文を返す', () => {
    const copy = describeJobAction({ operation: 'delete', lastErrorCode: null });
    expect(copy.statusText).toBe('Deletion not applied');
    expect(copy.discardLabel).toBe('Stop retrying');
    expect(copy.discardConfirm).toEqual({
      title: 'Stop retrying this deletion?',
      message: 'This record may remain in Health Connect.',
    });
  });

  it.each<[JobOperation]>([['create'], ['update'], ['recreate'], ['delete']])(
    'lastErrorCode=LOCAL_ACTIVITY_NOT_FOUND は operation=%s によらず内部不整合の文言（確認文なし）を優先する',
    (operation) => {
      const copy = describeJobAction({ operation, lastErrorCode: 'LOCAL_ACTIVITY_NOT_FOUND' });
      expect(copy.statusText).toBe('Sync error');
      expect(copy.discardLabel).toBe('Dismiss this error');
      expect(copy.discardConfirm).toBeNull();
    },
  );

  it.each<[SyncErrorCode]>([['PERMISSION_DENIED'], ['UNAVAILABLE'], ['NOT_FOUND'], ['RATE_LIMITED'], ['UNKNOWN']])(
    'lastErrorCode=%s（内部不整合以外）は通常の operation 別分岐を使う',
    (lastErrorCode) => {
      const copy = describeJobAction({ operation: 'update', lastErrorCode });
      expect(copy.statusText).toBe('Not synced to Health Connect');
      expect(copy.discardConfirm).not.toBeNull();
    },
  );

  it('retryLabel はどのケースでも共通', () => {
    expect(describeJobAction({ operation: 'delete', lastErrorCode: null }).retryLabel).toBe('Retry now');
    expect(describeJobAction({ operation: 'create', lastErrorCode: null }).retryLabel).toBe('Retry now');
    expect(describeJobAction({ operation: 'create', lastErrorCode: 'LOCAL_ACTIVITY_NOT_FOUND' }).retryLabel).toBe(
      'Retry now',
    );
  });
});
