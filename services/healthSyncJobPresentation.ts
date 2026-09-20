/**
 * 基本設計 v0.11 §9.6/§10.4 — Settings > Health Connect の「未同期の変更」
 * 一覧で、1件のジョブをどう見せるか（文言・破棄の確認文の要否）を決める
 * 純粋関数。`services/syncJobPlanner.ts` と同じ理由で分離している——DB
 * アクセス無しで、§9.6 の表（次のコメント参照）を網羅的にテストするため。
 *
 * 判定は必ずこの優先順位で行う（`§9.6`「破棄の文言は operation ごとに
 * 変える」表そのもの）：
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
