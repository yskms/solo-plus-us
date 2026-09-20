/**
 * 基本設計 v0.11 §9.5–§9.7 — claim/finalize ループ本体。DB プリミティブ
 * （claim・revision チェック・finalize の各SQL）は Phase 1 で
 * `repositories/HealthSyncJobRepository` / `HealthSyncRepository` として
 * 実装済み。ここではそれらを §9.5 の手続きの順序で組み立てる。
 *
 * `services/SyncCoordinator`（§9.12）とは協調する——新しい claim の抑制と
 * 外部呼び出しの追跡はこのファイルの責務だが、「いつ `drainDueJobs` を
 * 呼ぶか」（AppState 監視・定期実行）自体は知らない。`lib/screenMask.ts`
 * が純粋関数と AppState 配線を分離しているのと同じ構造で、その配線は
 * 別モジュール（今後実装）が担う。
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
import * as SyncCoordinator from './SyncCoordinator';
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
  | { status: 'suspended' } // §9.12: a destructive operation is running/starting
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
  sentSyncVersion: number,
  externalRecordId: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const activity = await ActivityRepository.findActivityById(tx, job.activityId);
    if (activity) {
      await HealthSyncRepository.upsertMapping(tx, { activityId: job.activityId, provider, externalRecordId });

      if (activity.syncVersion !== sentSyncVersion) {
        // §9.5.1「create送信中に編集→mappingは作られる→ジョブは残り、大きい
        // sync_versionで送り直す」。planForEditは既存ジョブのrevisionに触れ
        // ないため（§9.3、送信時に最新値を読む前提）、送信中に挟まった編集
        // はrevisionでは検出できない——実際に送ったsyncVersionと現在値を
        // 比較する必要がある。ジョブは削除せず、claimだけ外して即再送可能にする。
        const released = await HealthSyncJobRepository.releaseClaimForResend(tx, job.id, job.revision, nowUtcIso());
        if (!released) {
          logError('SyncWorker: job disappeared during finalize despite Activity still existing (internal inconsistency, §9.5.4)', {
            jobId: job.id,
            provider,
          });
        }
        return;
      }

      const deleted = await HealthSyncJobRepository.deleteJobIfRevisionMatches(tx, job.id, job.revision);
      if (!deleted) {
        // syncVersionが不変ということは編集は挟まっておらず、Activityも
        // 存在する（削除でreplaceされてもいない）——この状態でrevisionが
        // 不一致になる経路は無いはずの内部不整合。
        logError('SyncWorker: job disappeared or was replaced unexpectedly during finalize (internal inconsistency, §9.5.4)', {
          jobId: job.id,
          provider,
        });
      }
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

/**
 * §9.6: 失敗時はバックオフ（attempts が上限を超えたら手動待ち =
 * `not_before: null`）。「上限（10）を超えた」の境界は文言上厳密には
 * `attempts > 10`（11回目の失敗で手動待ち）とも読めるが、「上限は10」を
 * 「自動試行は10回まで」と解釈し、10回目の失敗（`attempts === 10`、claim時
 * 加算済み）で手動待ちへ切り替える方を採用した。バックオフ表自体が8段
 * （attempts 8以降は24hで頭打ち）なので実質的な差は小さい。
 */
async function finalizeFailure(db: Transactor, job: HealthSyncJobRow, errorCode: SyncErrorCode): Promise<void> {
  const notBefore = job.attempts >= MAX_AUTOMATIC_ATTEMPTS ? null : addSecondsIso(nowUtcIso(), backoffSeconds(job.attempts));
  await HealthSyncJobRepository.markJobFailed(db, job.id, job.revision, { errorCode, notBefore });
}

/**
 * §9.5 の1サイクル：claim → (create/update/recreateのみ) Activity 存在確認
 * → 外部呼び出し → 確定。呼び出し前に provider が有効かは呼び出し側
 * （`drainDueJobs`）が確認済みという前提（§9.5 step0）。
 *
 * §9.12: 破壊的操作の `suspend()` と2箇所で協調する——(1) claim 前の確認は
 * 単なる最適化（無駄な claim を避けるだけ）、(2) 外部呼び出し直前の確認が
 * 実際に競合を防いでいる本体。(1)と(2)の間には await を挟まない
 * （Activity 存在確認は挟むが、それは DB 読み取りであり Coordinator が
 * 気にする「外部呼び出し」ではない）ので、(2)の直後に同期的に
 * `SyncCoordinator.trackExternalCall` へ入るところまでは、途中で
 * `suspend()` が割り込む余地が無い——JS の実行モデル上、await を挟まない
 * 区間は割り込まれない。
 */
export async function processNextDueJob(db: Transactor, provider: Provider): Promise<ProcessJobResult> {
  if (SyncCoordinator.isSuspended()) return { status: 'suspended' }; // (1) 無駄な claim を避ける最適化

  const claimResult = await HealthSyncJobRepository.claimNextDueJob(db, provider);
  if (claimResult === HealthSyncJobRepository.LOST_CLAIM_RACE) return { status: 'lost-claim-race' };
  if (!claimResult) return { status: 'no-due-job' };
  const job = claimResult;

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

  if (SyncCoordinator.isSuspended()) {
    // (2) 実際に競合を防ぐ本体。ここで claim を持ったまま外部呼び出しへ
    // 進むと、直後に破壊的操作が実行されて §9.12 が防ぎたい競合が起きる。
    // 「失敗」ではないので markJobFailed ではなく releaseClaimForResend
    // （attempts はそのまま——外部へは一度も到達していない）。
    await HealthSyncJobRepository.releaseClaimForResend(db, job.id, job.revision, nowUtcIso());
    return { status: 'suspended' };
  }

  // §9.12: trackExternalCall はネイティブ呼び出しだけでなく finalize まで
  // 包む。suspend() が「外部呼び出しの完了」だけを待って finalize の DB
  // 書き込みを待たないと、finalize の db.transaction と破壊的操作の
  // db.transaction が同じ接続上でほぼ同時に始まりうる——テストで実際に
  // 「cannot start a transaction within a transaction」として顕在化した。
  await SyncCoordinator.trackExternalCall(async () => {
    const result = await callProvider(provider, job, activity);
    if (result.ok) {
      if (job.operation === 'delete') {
        await finalizeDeleteSuccess(db, job);
      } else {
        // activity は非null（delete以外はstep3で存在確認済み）— 実際に送信したsyncVersionのスナップショット。
        await finalizeUpsertSuccess(db, provider, job, activity!.syncVersion, result.externalRecordId);
      }
    } else {
      await finalizeFailure(db, job, result.errorCode);
    }
  });

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
    let ready: boolean;
    try {
      ready = await HealthConnectService.ensureInitialized();
    } catch (error) {
      // 未インストール等で initialize() 自体が reject するケース。個々の
      // ジョブを claim して failure に追い込みバックオフを消費させるより、
      // ここで諦める方が安全（呼び出し側に未処理rejectionを伝播させない）。
      logError('SyncWorker: HealthConnectService.ensureInitialized() rejected', error);
      ready = false;
    }
    if (!ready) {
      return { processedCount: 0 };
    }
  }

  let processedCount = 0;
  let consecutiveLostRaces = 0;
  for (;;) {
    const result = await processNextDueJob(db, provider);
    if (result.status === 'no-due-job' || result.status === 'suspended') break;

    if (result.status === 'lost-claim-race') {
      // このプロセス内では今のところ起こらないはずだが（v1はフォアグラウンド
      // 単一runtime、§6.2/D-36）、起きても諦めずに次の due なジョブへ進む
      // ——ただし無進捗のまま回り続けるビジーループは避ける。上限は
      // 「同時に何本のトリガから drainDueJobs が呼ばれうるか」の見積もり
      // ではなく、単に「これ以上粘っても意味が薄くなる」ための安全弁
      // （次の drainDueJobs 呼び出しで続きを処理すればよい）。
      consecutiveLostRaces++;
      if (consecutiveLostRaces >= 5) break;
      continue;
    }
    consecutiveLostRaces = 0;

    if (result.status === 'processed') processedCount++;
  }
  return { processedCount };
}
