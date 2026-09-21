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
 *
 * **実測（2026-09-21、Pixel 3 / Android 12、Health Connect
 * v2026.08.06.00）**：存在しない `clientRecordId` への delete は実際に
 * reject される——`{code: "UNDERLYING_ERROR", message: "Request contains
 * invalid UID."}`（`classifyError` の default 分岐で `UNKNOWN` になる）。
 * **`message` 文字列に依存して「これは存在しないだけだから成功扱いにする」
 * という特別扱いを追加しないこと。** `UNDERLYING_ERROR` は Binder 切断等
 * 他の原因でも返りうる code であり、`message` はライブラリ／Health
 * Connect アプリのバージョンが変われば変わりうる非契約な文字列のため、
 * これに依存する分岐は静かに壊れる。詳細は設計判断記録 D-20 の確認結果を
 * 参照。
 *
 * この reject は `recreateActivity` の内部 delete でも同様に起こる——
 * §13.6（Import 後の再同期）の主要ユースケース（機種変更・復旧）では
 * 復元先の Health Connect に対象レコードが1件も存在しないため、Android
 * 9〜13 では delete が確実に reject される。`recreateActivity` は
 * `UNKNOWN` 分類（この「存在しない」ケースが実際に分類される先）に限り
 * insert へ進む——`PERMISSION_DENIED`/`UNAVAILABLE` は従来通り即失敗の
 * まま。安全性の根拠は本ファイル下部の `recreateActivity` の doc comment
 * と設計判断記録 D-34「2026-09-21 追記」参照。
 */
import {
  deleteRecordsByUuids,
  getGrantedPermissions,
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
import { logError } from '../lib/log';

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

/**
 * Settings 画面の接続ステータス表示用（§18）——`requestWritePermission` と
 * 違い、ダイアログを出さず「既に許可されているか」だけを問う。OS 側で
 * 権限が取り消された場合、それ自体は claim 後の失敗として現れる（§9.5.4）
 * が、Settings のヘッダーが `enabled && isAvailable()` だけを見ていると
 * 「Connected」のまま固定されてしまうため、これで補強する。
 */
export async function hasWritePermission(): Promise<boolean> {
  const granted = await getGrantedPermissions();
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
 * （§9.3.1「状態遷移」）ため、次回リトライは必ず delete からやり直す。
 *
 * **2026-09-21 改訂（外部レビューを受けての決定、設計判断記録 D-34 参照）：
 * delete が `UNKNOWN` 分類で失敗した場合は insert へ進む。**
 * `PERMISSION_DENIED`/`UNAVAILABLE` は従来通り即座に失敗を返す——これらは
 * insert を試みても同じ理由で失敗するだけで、進む意味が無い。
 *
 * 当初の設計（delete が失敗したら常に insert しない）は、§13.6 の主要
 * ユースケース（機種変更・復旧）では復元先の Health Connect に対象
 * レコードが1件も存在しないため、Android 9〜13（D-20 実測どおり delete
 * が reject される）で recreate が全件恒久的に失敗する結果になっていた。
 *
 * 二重レコードを作らないという安全性は、health_connect が clientRecordId
 * でアドレッシングすること（§9.4）に由来する——insert は常に同じ
 * clientRecordId（`toRecord` 参照）を使うため、delete が失敗していても
 * insert は新規レコードを作らず upsert として振る舞う（version の大小は
 * HC 側が自動的に処理する）。唯一の理論的リスクは、delete が「存在しない」
 * 以外の一過性の理由で失敗し、かつ対象が実際により高い
 * clientRecordVersion で存在している場合に insert が黙って無視され、
 * ジョブが誤って成功扱いになることだが、これは通常の `update` ジョブでも
 * 起こりうる既知のリスクと同種であり、「常に安全（副作用のある永続状態を
 * 持たない）」という D-34 の性質は変わらない。
 */
export async function recreateActivity(
  activity: Pick<Activity, 'id' | 'occurredAtUtc' | 'protectionUsed' | 'syncVersion'>,
): Promise<HealthConnectResult> {
  const deleted = await deleteActivityRecord(activity.id);
  if (!deleted.ok) {
    if (deleted.errorCode !== 'UNKNOWN') return deleted;
    // Activity の内容は含めない（§8.7）。`deleted.errorCode` は常に
    // 'UNKNOWN'（直前の if で確定済み）なのでログには含めない——
    // リリースビルドでは `lib/log.ts` の `logError` が
    // `error instanceof Error` でない値を落とす（name だけになる）ため、
    // 第2引数に情報を持たせても実質伝わらない。このログ自体は DEV
    // ビルド向けの診断用（この分岐に実際に入ることは、Android 9〜13 で
    // 「外部レコードが不在の recreate」が正常に機能していることの証拠）。
    logError('HealthConnectService: recreateActivity delete failed as UNKNOWN — proceeding to insert anyway (clientRecordId upsert is idempotent, §9.4)', undefined);
  }
  return upsertActivity(activity);
}
