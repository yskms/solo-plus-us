import i18n from '../../lib/i18n';
import { describeJobAction, connectionStatus, connectionStatusLabel, retryBlockedCaption } from '../healthSyncJobPresentation';
import type { JobOperation, SyncErrorCode } from '../../types/HealthSync';

const en = i18n.getFixedT('en');
const ja = i18n.getFixedT('ja');

describe('describeJobAction (§9.6 の破棄文言テーブル)', () => {
  it.each<[JobOperation]>([['create'], ['update'], ['recreate']])(
    'operation=%s は "Not synced to Health Connect" / "Don\'t sync" と確認文を返す',
    (operation) => {
      const copy = describeJobAction(en, { operation, lastErrorCode: null });
      expect(copy.statusText).toBe('Not synced to Health Connect');
      expect(copy.discardLabel).toBe("Don't sync");
      expect(copy.discardConfirm).toEqual({
        title: "Don't sync this record?",
        message: 'Solo + Us and Health Connect will no longer match.',
      });
    },
  );

  it('operation=delete は "Deletion not applied" / "Stop retrying" と確認文を返す', () => {
    const copy = describeJobAction(en, { operation: 'delete', lastErrorCode: null });
    expect(copy.statusText).toBe('Deletion not applied');
    expect(copy.discardLabel).toBe('Stop retrying');
    expect(copy.discardConfirm).toEqual({
      title: 'Stop retrying this deletion?',
      message: 'This record may remain in Health Connect.',
    });
  });

  it.each<[JobOperation]>([['create'], ['update'], ['recreate'], ['delete']])(
    'lastErrorCode=LOCAL_ACTIVITY_NOT_FOUND は operation=%s によらず内部不整合の文言（確認文なし・再試行なし）を優先する',
    (operation) => {
      const copy = describeJobAction(en, { operation, lastErrorCode: 'LOCAL_ACTIVITY_NOT_FOUND' });
      expect(copy.statusText).toBe('Sync error');
      expect(copy.discardLabel).toBe('Dismiss this error');
      expect(copy.discardConfirm).toBeNull();
      // 再試行しても claim→同じ事前チェック→markJobInternalInconsistency を
      // 繰り返すだけ（Activity は永久に戻らない）なので、再試行ボタン自体を出さない。
      expect(copy.retryLabel).toBeNull();
    },
  );

  it.each<[SyncErrorCode]>([['PERMISSION_DENIED'], ['UNAVAILABLE'], ['NOT_FOUND'], ['RATE_LIMITED'], ['UNKNOWN']])(
    'lastErrorCode=%s（内部不整合以外）は通常の operation 別分岐を使う',
    (lastErrorCode) => {
      const copy = describeJobAction(en, { operation: 'update', lastErrorCode });
      expect(copy.statusText).toBe('Not synced to Health Connect');
      expect(copy.discardConfirm).not.toBeNull();
    },
  );

  it('retryLabel は内部不整合以外のどのケースでも共通', () => {
    expect(describeJobAction(en, { operation: 'delete', lastErrorCode: null }).retryLabel).toBe('Retry now');
    expect(describeJobAction(en, { operation: 'create', lastErrorCode: null }).retryLabel).toBe('Retry now');
  });

  it('日本語に翻訳される', () => {
    const copy = describeJobAction(ja, { operation: 'delete', lastErrorCode: null });
    expect(copy.statusText).toBe('削除が未反映');
    expect(copy.discardLabel).toBe('再試行を停止');
  });
});

describe('connectionStatusLabel / retryBlockedCaption', () => {
  it('has a label for every status, in both languages', () => {
    const statuses = ['connected', 'not-connected', 'unavailable', 'permission-revoked'] as const;
    for (const status of statuses) {
      expect(connectionStatusLabel(en, status)).toBeTruthy();
      expect(connectionStatusLabel(ja, status)).toBeTruthy();
    }
  });

  it('has a retry-blocked caption for every non-connected status, in both languages', () => {
    const statuses = ['not-connected', 'unavailable', 'permission-revoked'] as const;
    for (const status of statuses) {
      expect(retryBlockedCaption(en, status)).toBeTruthy();
      expect(retryBlockedCaption(ja, status)).toBeTruthy();
    }
  });
});

describe('connectionStatus（Settings ヘッダーの接続ステータス、§18）', () => {
  it('enabled=false を最優先する（available/hasPermission の値によらず not-connected）', () => {
    expect(connectionStatus(false, false, false)).toBe('not-connected');
    expect(connectionStatus(false, true, true)).toBe('not-connected');
  });

  it('enabled=true・available=false は unavailable（hasPermission の値によらない）', () => {
    expect(connectionStatus(true, false, false)).toBe('unavailable');
    expect(connectionStatus(true, false, true)).toBe('unavailable');
  });

  it('enabled=true・available=true・hasPermission=false は permission-revoked（§9.5.4：OS側で権限が取り消された場合）', () => {
    expect(connectionStatus(true, true, false)).toBe('permission-revoked');
  });

  it('enabled=true・available=true・hasPermission=true のときだけ connected', () => {
    expect(connectionStatus(true, true, true)).toBe('connected');
  });
});
