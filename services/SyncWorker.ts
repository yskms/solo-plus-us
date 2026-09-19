/**
 * 基本設計 v0.11 §9.5–§9.7 — claim/finalize ループ本体。DB プリミティブ
 * （claim・revision チェック・finalize の各SQL）は Phase 1 で
 * `repositories/HealthSyncJobRepository` / `HealthSyncRepository` として
 * 実装済み。ここではそれらを §9.5 の手続きの順序で組み立てる。
 *
 * **このファイルは「いつ呼ぶか」を知らない。** `drainDueJobs` は呼ばれた
 * 時点で due なジョブを処理し尽くすだけの関数で、AppState 監視・定期実行・
 * 破壊的操作との排他（§9.12 SyncCoordinator）は含まない——それらは
 * 別モジュール（今後実装）が `drainDueJobs` を「いつ・どのくらいの頻度で」
 * 呼ぶかを決める形で積む。`lib/screenMask.ts` が純粋関数とAppState配線を
 * 分離しているのと同じ構造。
 *
 * provider は引数で受け取るが、実際に呼べる external call は
 * `health_connect` のみ（`healthkit` は未実装）。
 */
import { addSecondsIso, nowUtcIso } from '../lib/datetime';
import { logError } from '../lib/log';
import * as ActivityRepository from '../repositories/ActivityRepository';
import * as HealthSyncJobRepository from '../repositories/HealthSyncJobRepository';
import * as HealthSyncRepository from '../repositories/HealthSyncRepository';
import * as HealthConnectService from './HealthConnectService';
import { getActiveProviders } from './ActivityService';
import type { Transactor } from '../database/SqlExecutor';
import type { HealthConnectResult } from './HealthConnectService';
import type { Activity } from '../types/Activity';
import type { HealthSyncJobRow, Provider, SyncErrorCode } from '../types/HealthSync';

/** §9.6: 指数バックオフ（5s, 15s, 1m, 5m, 15m, 1h, 6h, 24h）。attempts は claim 時に加算済みなので1始まり。 */
const BACKOFF_SECONDS_BY_ATTEMPT = [5, 15, 60, 300, 900, 3600, 21600, 86400];
/** §9.6: 上限到達で手動再試行待ち（`not_before = NULL`）。 */
const MAX_AUTOMATIC_ATTEMPTS = 10;

function backoffSeconds(attempts: number): number {
  const index = Math.min(attempts, BACKOFF_SECONDS_BY_ATTEMPT.length) - 1;
  return BACKOFF_SECONDS_BY_ATTEMPT[index];
}

export type ProcessJobResult =
  | { status: 'no-due-job' }
  | { status: 'lost-claim-race' }
  | { status: 'processed'; jobId: string };

/** §9.4/§9.9 で外部へ送る値のみを渡す — Activity 全体を提供先に渡さない。 */
type SyncableActivityFields = Pick<Activity, 'id' | 'occurredAtUtc' | 'protectionUsed' | 'syncVersion'>;

async function callProvider(
  provider: Provider,
  job: HealthSyncJobRow,
  activity: SyncableActivityFields | null,
): Promise<HealthConnectResult> {
  // v1 が実装するのは health_connect のみ。healthkit のジョブは §9.5 step0
  // （呼び出し側の getActiveProviders）で claim 自体されないため、ここに
  // 到達するのは理論上のみ——到達したら呼び出し側のバグなので UNAVAILABLE
  // として安全側に倒す。
  if (provider !== 'health_connect') {
    return { ok: false, errorCode: 'UNAVAILABLE' };
  }
  switch (job.operation) {
    case 'create':
    case 'update':
      // §9.5 step3 が create/update/recreate では既に Activity の存在を確認済み — null はここに来ない。
      return HealthConnectService.upsertActivity(activity!);
    case 'delete':
      return HealthConnectService.deleteActivityRecord(job.activityId);
    case 'recreate':
      return HealthConnectService.recreateActivity(activity!);
  }
}

/**
 * §9.5.1: create/update/recreate の確定処理。「外部の成功」と「ジョブの
 * 完了」を分ける——Activity がまだ存在すれば mapping を必ず upsert し、
 * revision が claim 時のまま（=その間に編集/削除が割り込んでいない）なら
 * ジョブを削除する。Activity が処理中に削除されていた場合は mapping を
 * 作らず（FK RESTRICT）、代わりに §10.1 順2 で `delete` へ置換された
 * 同じジョブ行に外部 ID を書き戻す（health_connect では実質使わないが
 * §5.4 の通りジェネリックな手続きとして残す）。
 */
async function finalizeUpsertSuccess(
  db: Transactor,
  provider: Provider,
  job: HealthSyncJobRow,
  externalRecordId: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const activity = await ActivityRepository.findActivityById(tx, job.activityId);
    if (activity) {
      await HealthSyncRepository.upsertMapping(tx, { activityId: job.activityId, provider, externalRecordId });
      await HealthSyncJobRepository.deleteJobIfRevisionMatches(tx, job.id, job.revision);
      // revision不一致なら何もしない — ジョブは新しい内容のまま残り、次のdrainで再送される（意図通り）。
      return;
    }

    // 処理中に Activity が削除された（§9.5.1 else 分岐）。
    const currentJob = await HealthSyncJobRepository.findJob(tx, job.activityId, provider);
    if (currentJob && currentJob.operation === 'delete' && externalRecordId) {
      await HealthSyncJobRepository.attachExternalIdToDeleteJob(tx, currentJob.id, externalRecordId);
    }
    if (!currentJob) {
      // §9.5.4: 正常系では §9.6 の guard（claim中は手動操作不可）により
      // 起こらないはずの内部不整合。ジョブ自体はもう存在しないので復旧の
      // しようがない——ここで例外を投げてループ全体を止めると、他の due な
      // ジョブまで巻き込んで処理できなくなる（Rule 2）ため、診断ログ
      // （Activity の内容は含まない、§8.7）を残すだけに留める。この分岐に
      // 実際に入ることは「テスト失敗」として検出する（integration test 参照）。
      logError('SyncWorker: job disappeared during finalize (internal inconsistency, §9.5.4)', {
        jobId: job.id,
        provider,
      });
    }
  });
}

/** §9.7: delete ジョブの確定処理。成功なら revision 一致時のみジョブを削除するだけ——mapping は ActivityService.deleteActivity が同期削除済み。 */
async function finalizeDeleteSuccess(db: Transactor, job: HealthSyncJobRow): Promise<void> {
  await HealthSyncJobRepository.deleteJobIfRevisionMatches(db, job.id, job.revision);
}

/** §9.6: 失敗時はバックオフ（attempts が上限を超えたら手動待ち = `not_before: null`）。 */
async function finalizeFailure(db: Transactor, job: HealthSyncJobRow, errorCode: SyncErrorCode): Promise<void> {
  const notBefore = job.attempts >= MAX_AUTOMATIC_ATTEMPTS ? null : addSecondsIso(nowUtcIso(), backoffSeconds(job.attempts));
  await HealthSyncJobRepository.markJobFailed(db, job.id, job.revision, { errorCode, notBefore });
}

/**
 * §9.5 の1サイクル：claim → (create/update/recreateのみ) Activity 存在確認
 * → 外部呼び出し → 確定。呼び出し前に provider が有効かは呼び出し側
 * （`drainDueJobs`）が確認済みという前提（§9.5 step0）。
 */
export async function processNextDueJob(db: Transactor, provider: Provider): Promise<ProcessJobResult> {
  const job = await HealthSyncJobRepository.claimNextDueJob(db, provider);
  if (!job) return { status: 'no-due-job' };

  let activity: Activity | null = null;
  if (job.operation !== 'delete') {
    activity = await ActivityRepository.findActivityById(db, job.activityId);
    if (!activity) {
      // §9.5.3: 一時エラーではなく内部不整合。claim解除だけだと同じジョブを拾い続けるため
      // not_before を NULL にする。ループ全体は止めない理由は finalizeUpsertSuccess の
      // §9.5.4 分岐のコメント参照——この分岐に実際に入ることは「テスト失敗」として検出する。
      await HealthSyncJobRepository.markJobInternalInconsistency(db, job.id, job.revision);
      logError('SyncWorker: create/update/recreate job has no Activity (internal inconsistency, §9.5.3)', {
        jobId: job.id,
        operation: job.operation,
      });
      return { status: 'processed', jobId: job.id };
    }
  }

  const result = await callProvider(provider, job, activity);

  if (result.ok) {
    if (job.operation === 'delete') {
      await finalizeDeleteSuccess(db, job);
    } else {
      await finalizeUpsertSuccess(db, provider, job, result.externalRecordId);
    }
  } else {
    await finalizeFailure(db, job, result.errorCode);
  }

  return { status: 'processed', jobId: job.id };
}

export interface DrainResult {
  processedCount: number;
}

/**
 * due なジョブを processNextDueJob で1件ずつ、無くなるまで処理する。
 * §9.5 step0: provider が有効でなければ何もしない（D-45: 無効化中もジョブ
 * 自体は保持され、claim されないだけ）。health_connect が有効でも SDK が
 * 初期化できなければ（未インストール等）、個々のジョブを failure に
 * 追い込んでバックオフを消費させるより先に諦める。
 */
export async function drainDueJobs(db: Transactor, provider: Provider): Promise<DrainResult> {
  const activeProviders = await getActiveProviders(db);
  if (!activeProviders.includes(provider)) {
    return { processedCount: 0 };
  }

  if (provider === 'health_connect') {
    const ready = await HealthConnectService.ensureInitialized();
    if (!ready) {
      return { processedCount: 0 };
    }
  }

  let processedCount = 0;
  for (;;) {
    const result = await processNextDueJob(db, provider);
    if (result.status === 'no-due-job') break;
    processedCount++;
  }
  return { processedCount };
}
