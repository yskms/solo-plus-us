/**
 * 基本設計 v0.11 §9.12 — 破壊的操作（置換復元・全Activity削除・
 * Health Connect切断・DB Migration・Recovery・アプリ内データ初期化）と
 * SyncWorker を排他する、プロセス内 mutex。v1 はフォアグラウンド単一
 * runtime（§6.2/D-36）なのでモジュールレベルの状態で十分——`class` では
 * なく、このプロジェクトの他のモジュール（`lib/screenMask.ts` 等）と同じ
 * 「関数 + モジュール状態」のスタイルに合わせている。
 *
 * ## cancel不可を前提にした設計（D-41 確認済み）
 * Health Connect の insert/delete はいずれも cancel できない。したがって
 * `suspend()` は「新しい claim を止める」だけでなく「現在 in-flight の
 * 外部呼び出しの完了を待つ」ところまでが責務——タイムアウトで待つのを
 * やめても、ネイティブ側の処理は止まらないため、待つのをやめた瞬間に
 * mutex を解放すると防ぎたかった競合が再発する（§9.12）。
 *
 * ## 実装していないもの（意図的、Known gap）
 * §9.12 は「タイムアウトは UI の待機を打ち切るためだけに使う」「外部
 * Promise が未 settle の間、in-flight のまま扱う（呼び出し側が諦めても
 * 裏で待ち続け、実際に settle してから通常状態へ戻す）」という、破壊的
 * 操作の「同期の完了を待っています…［キャンセル］」UI を前提にした挙動を
 * 定義している。現時点ではこの `suspend()` を呼ぶどの既存呼び出し元
 * （後述）も「実行中に待機を打ち切れる」画面を持たない
 * （`app/settings/data.tsx` の busy 状態にキャンセルボタンが無いことを
 * 確認済み）ため、このファイルは `suspend()` を単純な（打ち切り不可の）
 * await として実装している。**「待機を打ち切れる」UI を実際に作るときは、
 * その打ち切りが裏側の待機自体を諦めずに済むよう、この関数を拡張する
 * こと**（`suspend()` を呼んだまま await を諦めても `suspended` は
 * `resume()` が呼ばれるまで true のまま——中途半端に normal 状態へ
 * 戻ることはない、という現状の安全側の性質は保ったまま拡張できる）。
 *
 * ## 排他の対象範囲（§9.12「対象となる操作」）とこの実装での扱い
 * - **置換復元（§13.3）→ 実際に `runExclusive` で配線した**
 *   （`services/ImportService.performReplaceImport`）。通常のアプリ操作中
 *   （DB 接続が生きている状態）に実行されるため、SyncWorker と実際に
 *   競合しうる唯一の既存呼び出し元。
 * - **DB Migration の開始（§7）・Recovery の開始（§8.8）/アプリ内データの
 *   初期化は `runExclusive` で包んでいない——意図的。** どちらも
 *   `database/connection.ts` の DB 接続確立シーケンス自体の一部
 *   （`runMigrations`）か、DB 接続が確立できていない間だけ表示される
 *   `components/RecoveryScreen.tsx`（`contexts/DatabaseContext.tsx` が
 *   接続失敗時にのみ描画。`RecoveryService.restoreFromBackup`/
 *   `resetAndStartOver` はここ経由でしか呼ばれない）からしか呼ばれない。
 *   SyncWorker は生きた DB 接続を前提にするため、これらの操作が走る間は
 *   構造上そもそも起動しえない——`runExclusive` で包んでも常に
 *   no-op になるだけでなく、`database/` 層から `services/
 *   SyncCoordinator` への依存を作ることにもなる（このプロジェクトの
 *   layering: `database/` は `services/` に依存しない）。将来 DB
 *   Migration やアプリ内データの初期化が「生きた接続に対して」実行される
 *   経路が追加された場合は、この前提が崩れるため再検討すること。
 * - **全Activity削除（§10.6）・Health Connect の切断処理（§10.5）は
 *   Settings UI 自体がまだ無いため配線先が無い**——実装時は必ず
 *   `runExclusive` 経由にすること（Repository/Service から直接
 *   `health_sync_jobs` を全削除しない、§9.12 の明記事項）
 */

let suspended = false;
let inFlightExternalCall: Promise<unknown> | null = null;

/** `services/SyncWorker` がこれで claim 前・claim 直後に確認する。 */
export function isSuspended(): boolean {
  return suspended;
}

/**
 * `services/SyncWorker` が実際に外部（Health Connect）呼び出しを行う際、
 * これで包む。`suspend()` が待つ対象をここで登録する——呼ばなければ
 * `suspend()` は「何も in-flight ではない」と判断してしまう。
 *
 * **ネイティブ呼び出しだけでなく、その結果を確定させる finalize の DB
 * 書き込み（§9.5.1）まで含めて包むこと。** 外部呼び出しの完了だけを
 * 追跡対象にすると、`suspend()` がそこで待つのをやめてしまい、finalize
 * の `db.transaction` と破壊的操作側の `db.transaction` が同じ接続上で
 * ほぼ同時に始まりうる——integration test で実際に "cannot start a
 * transaction within a transaction" として顕在化した。§9.12 が防ぎたい
 * のは「外部呼び出しの結果を Coordinator が知らないうちに破壊的操作が
 * 割り込むこと」であり、それは finalize が終わるまで解消しない。
 */
export async function trackExternalCall<T>(call: () => Promise<T>): Promise<T> {
  const promise = call();
  inFlightExternalCall = promise;
  try {
    return await promise;
  } finally {
    if (inFlightExternalCall === promise) {
      inFlightExternalCall = null;
    }
  }
}

/**
 * 破壊的操作の開始。新しい claim を止め（`isSuspended()` を true にする）、
 * 現在 in-flight の外部呼び出しがあればその完了を待つ。結果（成功/失敗）
 * には関心がない——settle した事実だけが必要（§9.5.1 により、成功の事実は
 * 呼び出し元とは独立に SyncWorker 自身がすでに記録している）。
 */
export async function suspend(): Promise<void> {
  suspended = true;
  if (inFlightExternalCall) {
    await inFlightExternalCall.catch(() => {});
  }
}

/** ワーカーを再開する（新しい claim を許可する）。 */
export function resume(): void {
  suspended = false;
}

/**
 * 破壊的操作を Coordinator 経由で実行するヘルパー。`suspend()` →
 * `operation()` → `resume()` を必ずセットで行う（`operation` が例外を
 * 投げても `resume()` は実行される）。**破壊的操作は必ずこれ経由で
 * 実行すること**（§9.12）。
 */
export async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  await suspend();
  try {
    return await operation();
  } finally {
    resume();
  }
}

/** テスト専用：モジュール状態をリセットする。 */
export function __resetSyncCoordinatorForTests(): void {
  suspended = false;
  inFlightExternalCall = null;
}
