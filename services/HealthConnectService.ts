/**
 * 基本設計 v0.11 §9.4/§9.7/§9.9/§9.11・設計判断記録 D-04/D-19/D-20/D-41 —
 * `react-native-health-connect`（v4.1.3、`connect-client:1.1.0` 固定）への
 * 唯一の入口。`services/SyncWorker` はこのモジュール経由でのみ Health
 * Connect を呼ぶ（ネイティブ呼び出しを直接importしない）。
 *
 * このファイルが担うのは「1件の Activity を Health Connect の状態に
 * 合わせる」ことだけで、§9.5 の claim/finalize ループや DB 更新は
 * `services/SyncWorker` の責務。
 *
 * ## cancel不可（D-41 確認済み）
 * insert/delete はいずれも cancel できない（ネイティブ側で
 * `CoroutineScope(Dispatchers.IO).launch` に投げっぱなしで `Job` を
 * 保持しない）。したがってこのファイルは意図的に `Promise.race()` による
 * タイムアウトを実装しない——タイムアウトさせても呼び出しは裏で継続する
 * ため、待つのをやめる判断は呼び出し側（将来の SyncCoordinator、§9.12）の
 * 責務であり、ここでは「resolve/reject をそのまま伝える」だけに徹する。
 *
 * ## エラー分類の根拠
 * `node_modules/react-native-health-connect/android/.../ExceptionsUtils.kt`
 * の `rejectWithException` が例外クラスを固定のcode文字列にマップして
 * `promise.reject(code, message, exception)` する（React Native の
 * Promise reject 規約により、JS 側では `error.code` としてそのまま届く）。
 * ここでの分類はそのcode文字列一覧に基づく——推測ではなくソースで確認済み。
 * `RATE_LIMITED`/`NOT_FOUND` に対応するcodeは存在しない（後述）ため、
 * 現状は実質使われない分類として残している。
 *
 * ## 削除の「存在しない」を特別扱いしない理由（§9.7 確認結果）
 * Android 14+ は `deleteRecordsByUuids` が0件一致でもエラーにならない
 * （実装レベルで確認済み・設計判断記録 D-20）。Android 9〜13 は
 * ライブラリのエラーcodeから「存在しない」を他のエラーと識別できない
 * （`ExceptionsUtils.kt` に該当のcodeが無い）。したがって
 * `deleteRecordAndroid`/`recreateActivity` は分岐を持たず、
 * resolve=成功・reject=失敗（呼び出し側でリトライ）という単一の処理のみ
 * を行う。「NOT_FOUND を成功として扱う」（§9.3.1）は、Android 14+ では
 * 単に reject 自体が起きないことで自動的に満たされ、Android 9〜13 では
 * 識別できないため保守的に「delete 失敗時は create へ進まない」側に倒れる
 * （recreate の「削除がそれ以外のエラーなら作成しない」と整合する）。
 */
import {
  deleteRecordsByUuids,
  getSdkStatus,
  initialize,
  insertRecords,
  requestPermission,
  SdkAvailabilityStatus,
  ProtectionUsed,
  type SexualActivityRecord,
} from 'react-native-health-connect';
import type { Activity } from '../types/Activity';
import type { SyncErrorCode } from '../types/HealthSync';

const RECORD_TYPE = 'SexualActivity' as const;
const WRITE_PERMISSION = { accessType: 'write' as const, recordType: RECORD_TYPE };

export type HealthConnectResult =
  | { ok: true; externalRecordId: string | null }
  | { ok: false; errorCode: SyncErrorCode };

/** §9.9: Solo + Us の3値 → Health Connect の3値。「未記録」を UNPROTECTED に潰さない（§5.3）。 */
function toProtectionUsed(protectionUsed: boolean | null): number {
  if (protectionUsed === true) return ProtectionUsed.PROTECTED;
  if (protectionUsed === false) return ProtectionUsed.UNPROTECTED;
  return ProtectionUsed.UNKNOWN;
}

/** §9.9: 送るのは時刻と避妊具使用の有無だけ。§9.4: clientRecordId/clientRecordVersion で冪等化。 */
function toRecord(activity: Pick<Activity, 'id' | 'occurredAtUtc' | 'protectionUsed' | 'syncVersion'>): SexualActivityRecord {
  return {
    recordType: RECORD_TYPE,
    time: activity.occurredAtUtc,
    protectionUsed: toProtectionUsed(activity.protectionUsed),
    metadata: {
      clientRecordId: activity.id,
      clientRecordVersion: activity.syncVersion,
    },
  };
}

/** ExceptionsUtils.kt の code 一覧に基づく分類。ここに無い code は UNKNOWN 扱い（安全側 — リトライ対象）。 */
function classifyError(error: unknown): SyncErrorCode {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case 'PERMISSION_ERROR':
      return 'PERMISSION_DENIED';
    case 'SERVICE_UNAVAILABLE':
    case 'SDK_VERSION_ERROR':
    case 'CLIENT_NOT_INITIALIZED':
      return 'UNAVAILABLE';
    default:
      // IO_EXCEPTION / ARGUMENT_VALIDATION_ERROR / UNDERLYING_ERROR /
      // UNKNOWN_ERROR / 未知の code はすべてここに集約し、§9.6 の通常の
      // リトライ・バックオフに委ねる（D-41 の「未調査事項」— Binder切断等
      // での失敗もこの経路に入りうる）。
      return 'UNKNOWN';
  }
}

/** Health Connect が端末で使えるか（インストール状況・SDKバージョン）。§9.5.4 の provider 有効確認とは別軸。 */
export async function isAvailable(): Promise<boolean> {
  const status = await getSdkStatus();
  return status === SdkAvailabilityStatus.SDK_AVAILABLE;
}

/** SyncWorker のループ開始前に一度呼ぶ想定。失敗時は呼び出し側が UNAVAILABLE として扱う。 */
export async function ensureInitialized(): Promise<boolean> {
  return initialize();
}

/**
 * WRITE_SEXUAL_ACTIVITY のみを要求する。READ は要求しない
 * （D-20/§9.7・D-12：削除の存在確認のために審査面積を増やさない）。
 * 拒否された場合は例外を投げず、返り値に含まれないだけ（ライブラリの
 * 挙動——`requestPermission` は許可された権限一覧を返す）。
 */
export async function requestWritePermission(): Promise<boolean> {
  const granted = await requestPermission([WRITE_PERMISSION]);
  return granted.some((p) => p.accessType === 'write' && p.recordType === RECORD_TYPE);
}

/** §9.3 の create/update ジョブ（合流済み・同一処理）。同じ clientRecordId への再 insert は clientRecordVersion が大きい方が優先される（§9.4）ので upsert として振る舞う。 */
export async function upsertActivity(
  activity: Pick<Activity, 'id' | 'occurredAtUtc' | 'protectionUsed' | 'syncVersion'>,
): Promise<HealthConnectResult> {
  try {
    await insertRecords([toRecord(activity)]);
    // health_connect は clientRecordId でアドレッシングするため external_record_id は null で良い（§5.4）。
    return { ok: true, externalRecordId: null };
  } catch (error) {
    return { ok: false, errorCode: classifyError(error) };
  }
}

/** §9.7 の delete ジョブ。clientRecordId（= activityId）でアドレッシングする（§9.4）。 */
export async function deleteActivityRecord(activityId: string): Promise<HealthConnectResult> {
  try {
    await deleteRecordsByUuids(RECORD_TYPE, [], [activityId]);
    return { ok: true, externalRecordId: null };
  } catch (error) {
    return { ok: false, errorCode: classifyError(error) };
  }
}

/**
 * §9.3.1 の recreate 操作。delete → insert の2段階だが、外側（SyncWorker）
 * からは1回の呼び出しに見える——「delete 済み」という永続状態を持たない
 * （§9.3.1「状態遷移」）ため、delete が失敗したら insert せずここで
 * 失敗を返し、次回リトライは必ず delete からやり直す。
 */
export async function recreateActivity(
  activity: Pick<Activity, 'id' | 'occurredAtUtc' | 'protectionUsed' | 'syncVersion'>,
): Promise<HealthConnectResult> {
  const deleted = await deleteActivityRecord(activity.id);
  if (!deleted.ok) return deleted;
  return upsertActivity(activity);
}
