/**
 * 基本設計 v0.11 §9.6/§10.4/§18 — Settings > Health Connect
 * （`app/settings/health-connect.tsx`）の表示を決める純粋関数群。
 * `services/syncJobPlanner.ts` と同じ理由で分離している——DB/RN アクセス
 * 無しで網羅的にテストするため。2種類のロジックが同居する：
 *
 * - `describeJobAction`：「未同期の変更」一覧で、1件のジョブをどう見せるか
 *   （文言・破棄の確認文の要否）。§9.6 の表（次のコメント参照）
 * - `connectionStatus`/`CONNECTION_STATUS_LABEL`/`RETRY_BLOCKED_CAPTION`：
 *   画面ヘッダーの接続ステータス（§18）と、それに応じて Retry now を
 *   無効化する理由の文言
 *
 * `describeJobAction` の判定は必ずこの優先順位で行う（`§9.6`「破棄の文言は
 * operation ごとに変える」表そのもの）：
 *
 * | 優先 | 条件                                              | 破棄の操作名           | 確認文 |
 * |---|-----------------------------------------------------|------------------------|--------|
 * | 1 | `lastErrorCode === 'LOCAL_ACTIVITY_NOT_FOUND'`（内部不整合、§9.5.3） | この同期エラーを破棄   | なし   |
 * | 2 | `operation === 'delete'`                             | この削除の再試行を停止 | この記録は Health Connect 上に残る可能性があります |
 * | 3 | それ以外（create/update/recreate）                    | この記録を Health Connect へ同期しない | Solo + Us と Health Connect の内容が一致しなくなります |
 *
 * 優先1を先に見る理由：内部不整合は `operation` が create/update/recreate
 * のいずれであっても起こりうる（Activity 自体が消えている）ため、
 * `operation` 分岐より先に判定しないと通常の確認文が出てしまう。
 */
import type { HealthSyncJobRow } from '../types/HealthSync';

export interface JobActionCopy {
  /** claim されていない場合のステータス行文言（§10.4 のモック文言）。 */
  statusText: string;
  /**
   * 「今すぐ再試行」ラベル。内部不整合（§9.5.3）は `null`——claim 時の
   * 事前チェックで Activity が無いと判定された、決定論的に再現するだけの
   * 状態のため、再試行しても claim → 同じチェック → `markJobInternalInconsistency`
   * を毎回繰り返すだけ（`services/SyncWorker.ts` の該当分岐参照）。破棄しか
   * 意味のあるアクションが無い（§9.6 の表も内部不整合には破棄しか挙げていない）。
   */
  retryLabel: string | null;
  /** operation ごとに変わる破棄ボタンのラベル。 */
  discardLabel: string;
  /** 破棄前に出す確認ダイアログの文言。内部不整合のみ `null`（確認文なし、§9.6）。 */
  discardConfirm: { title: string; message: string } | null;
}

const RETRY_LABEL = 'Retry now';

export function describeJobAction(job: Pick<HealthSyncJobRow, 'operation' | 'lastErrorCode'>): JobActionCopy {
  if (job.lastErrorCode === 'LOCAL_ACTIVITY_NOT_FOUND') {
    return {
      statusText: 'Sync error',
      retryLabel: null,
      discardLabel: 'Dismiss this error',
      discardConfirm: null,
    };
  }

  if (job.operation === 'delete') {
    return {
      statusText: 'Deletion not applied',
      retryLabel: RETRY_LABEL,
      discardLabel: 'Stop retrying',
      discardConfirm: {
        title: 'Stop retrying this deletion?',
        message: 'This record may remain in Health Connect.',
      },
    };
  }

  // create / update / recreate
  return {
    statusText: 'Not synced to Health Connect',
    retryLabel: RETRY_LABEL,
    discardLabel: "Don't sync",
    discardConfirm: {
      title: "Don't sync this record?",
      message: 'Solo + Us and Health Connect will no longer match.',
    },
  };
}

export type ConnectionStatus = 'connected' | 'not-connected' | 'unavailable' | 'permission-revoked';

/**
 * Settings > Health Connect のヘッダーに出す接続ステータス（§18）。
 * `enabled` を最優先で見る（OFF なら他の軸を見るまでもない）。
 * `available`/`hasPermission` は §9.5.4 が言う「OS側の権限取消は claim 後の
 * 失敗として現れる」を、ヘッダー表示でも早めに拾うためのもの——どちらも
 * 「Connected と誤表示しない」ための追加チェックで、ジョブの実際の成否は
 * 依然として SyncWorker の finalize が正。
 */
export function connectionStatus(enabled: boolean, available: boolean, hasPermission: boolean): ConnectionStatus {
  if (!enabled) return 'not-connected';
  if (!available) return 'unavailable';
  if (!hasPermission) return 'permission-revoked';
  return 'connected';
}

export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  'not-connected': 'Not connected',
  unavailable: "Health Connect isn't installed",
  'permission-revoked': 'Permission needed',
};

/**
 * §10.4 の Unsynced changes 見出し下に出す、Retry now が無効な理由
 * （`connected` では表示しない——呼び出し側は `status !== 'connected'` の
 * ときだけ参照する）。
 */
export const RETRY_BLOCKED_CAPTION: Record<ConnectionStatus, string> = {
  connected: '',
  'not-connected': 'Turn on Sync to Health Connect to retry these.',
  unavailable: "Health Connect isn't installed. Install it to retry these.",
  'permission-revoked': 'Health Connect permission is needed to retry these.',
};
