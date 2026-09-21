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
 * `runExclusive` は「新しい claim を止める」だけでなく「現在 in-flight の
 * 外部呼び出しの完了を待つ」ところまでが責務——タイムアウトで待つのを
 * やめても、ネイティブ側の処理は止まらないため、待つのをやめた瞬間に
 * mutex を解放すると防ぎたかった競合が再発する（§9.12）。
 *
 * ## 実装していないもの（意図的、Known gap）
 * §9.12 は「タイムアウトは UI の待機を打ち切るためだけに使う」「外部
 * Promise が未 settle の間、in-flight のまま扱う（呼び出し側が諦めても
 * 裏で待ち続け、実際に settle してから通常状態へ戻す）」という、破壊的
 * 操作の「同期の完了を待っています…［キャンセル］」UI を前提にした挙動を
 * 定義している。現時点ではこの `runExclusive` を呼ぶどの既存呼び出し元
 * （後述）も「実行中に待機を打ち切れる」画面を持たない
 * （`app/settings/data.tsx` の busy 状態にキャンセルボタンが無いことを
 * 確認済み）ため、このファイルはタイムアウトによる打ち切りを実装して
 * いない。**「待機を打ち切れる」UI を実際に作るときは、その打ち切りが
 * 裏側の待機自体を諦めずに済むよう拡張すること。**
 *
 * **直列化キュー（下記）導入により、この未実装の影響範囲が広がっている
 * 点に注意（2回目のレビューで指摘）：** ネイティブ呼び出しが永久に
 * settle しない場合、以前は「その破壊的操作1件がハングする」だけだったが、
 * 直列化キューが詰まることで**以降のすべての `runExclusive` 呼び出しが
 * 実行不能になる**（`isSuspended()` も true のまま固定される）。逃げ道は
 * §9.12 が元々想定している通りアプリの再起動のみ——タイムアウトを実装する
 * 際は、この「キュー全体が詰まる」影響範囲もあわせて解消すること。
 *
 * ## 直列化（レビュー2回目で指摘）
 * `runExclusive` の呼び出しは内部の FIFO キューで直列化する——2つの
 * 破壊的操作が重なった場合、先に終わった方の後始末が後発の実行中の
 * 抑止を解除してしまう、という事故を防ぐ。**このキューは同じ呼び出し
 * スタック内でのネスト（同期的な入れ子呼び出し）には対応できない**
 * （自分自身の順番を待つ形になり、デッドロックする）。ネストが起きない
 * ことは呼び出し側の責務——`services/ImportService.performReplaceImport`
 * が意図的に Coordinator を意識しないのはこのため（下記「対象範囲」参照）。
 *
 * `isSuspended()` は `runExclusive` が呼ばれた**瞬間**（キューで自分の順番
 * を待っている間も含む）から、その呼び出しが完全に終わるまで同期的に
 * true を保つ——カウンタ（`suspendingCount`）で管理する。3回目のレビューで
 * 「`suspended = true` が `.then()` の中（＝最低1 microtask 後）でしか
 * 立たず、その間 `isSuspended()` が false のままになる」窓が実際に
 * production 経路（`runExclusive`）で再現することが指摘され、修正した
 * （`suspend`/`resume` を直接公開していた旧実装の性質——同期的に true に
 * なる——をテストは検証していたが、`runExclusive` 自身はその性質を
 * 持っていなかった。同じ不変条件を守りたいなら、実際の入口を検証する
 * 必要がある）。
 *
 * ## 排他の対象範囲（§9.12「対象となる操作」）とこの実装での扱い
 * - **置換復元（§13.3）→ 呼び出し元（生きたアプリ DB に対する場合のみ）
 *   で配線する**：`app/settings/data.tsx` の `handleConfirmReplace` が
 *   `SyncCoordinator.runExclusive(() => performReplaceImport(db, file))`
 *   として呼ぶ。`ImportService.performReplaceImport` 自身は
 *   **意図的に Coordinator を一切知らない**——`services/
 *   RecoveryService.restoreFromBackup`（§8.8）が同じ関数を一時 DB
 *   （`tempDb`、アプリ本体の DB 接続とは別物）に対して呼ぶため、
 *   `performReplaceImport` 側で無条件に `runExclusive` するとこの経路が
 *   （無関係な DB に対してだけとはいえ）グローバルな Coordinator 状態を
 *   動かしてしまい、実際の破壊的操作と紛れて直列化キューに入り込む
 *   （最悪、同一スタック内でのネストで自己デッドロックしうる）。
 *   「どの DB に対する操作か」を知っているのは呼び出し元だけなので、
 *   Coordinator を通すかどうかも呼び出し元が決める。
 * - **DB Migration の開始（§7）・Recovery の開始（§8.8）/アプリ内データの
 *   初期化は `runExclusive` で包んでいない——意図的。** どちらも
 *   `database/connection.ts` の DB 接続確立シーケンス自体の一部
 *   （`runMigrations`）か、DB 接続が確立できていない間だけ表示される
 *   `components/RecoveryScreen.tsx`（`contexts/DatabaseContext.tsx` が
 *   接続失敗時にのみ描画）からしか呼ばれない。SyncWorker は生きた DB
 *   接続を前提にするため、これらの操作が走る間は構造上そもそも起動
 *   しえない——`runExclusive` で包んでも常に no-op になるだけでなく、
 *   `database/` 層から `services/SyncCoordinator` への依存を作ることにも
 *   なる（このプロジェクトの layering: `database/` は `services/` に
 *   依存しない）。将来これらが「生きた接続に対して」実行される経路が
 *   追加された場合は、この前提が崩れるため再検討すること。
 * - **Health Connect の切断処理（§10.5）は `app/settings/health-connect.tsx`
 *   の `disconnect` が配線する**：`SyncCoordinator.runExclusive(() =>
 *   setSetting(db, 'healthConnect.enabled', false))` として呼ぶ——`data.tsx`
 *   の置換復元と同じ形。渡すコールバックは `setSetting` 一発のみで、
 *   内側から drain 相当の処理は呼ばない（ネストするとデッドロックする、
 *   上記「直列化」節参照）。
 * - **全Activity削除（§10.6）は `app/settings/delete-data.tsx` の
 *   `handleDelete` が配線する**：`SyncCoordinator.runExclusive(() =>
 *   ActivityService.deleteAllActivities(db))` として呼ぶ——切断処理と同じ
 *   形。渡すコールバックは `deleteAllActivities` 一発のみで、内側から
 *   drain 相当の処理は呼ばない（ネストするとデッドロックする、上記
 *   「直列化」節参照）。
 */

/** `isSuspended()` を導出する。0 = 通常状態、>0 = 破壊的操作が1件以上「呼ばれてから完全に終わるまで」の区間にある。 */
let suspendingCount = 0;
const inFlightSyncCycles = new Set<Promise<unknown>>();
/** `runExclusive` 呼び出しを直列化する FIFO キュー。「対象範囲」節参照——同一スタック内のネストはこれでは解決しない。 */
let exclusiveQueue: Promise<void> = Promise.resolve();

/** `services/SyncWorker` がこれで claim 前に確認する。 */
export function isSuspended(): boolean {
  return suspendingCount > 0;
}

/**
 * `services/SyncWorker` の claim から確定（finalize）までの1サイクルを
 * これで包む。`runExclusive` が待つ対象をここに登録する——呼ばなければ
 * 「何も in-flight ではない」と誤判断される。
 *
 * **ネイティブ呼び出しだけでなく、その結果を確定させる finalize の DB
 * 書き込み（§9.5.1）、さらに claim 自体まで含めて包むこと。** 外部呼び出し
 * の完了だけを追跡対象にすると、(a) finalize の `db.transaction` と
 * 破壊的操作側の `db.transaction` が同じ接続上でほぼ同時に始まりうる
 * （最初の実装で integration test が "cannot start a transaction within a
 * transaction" として検出）、(b) claim 自体（`claimNextDueJob` の
 * UPDATE）が破壊的操作のトランザクションに巻き込まれ、破壊的操作が
 * ROLLBACK した場合に claim だけが永久に残ってしまう（2回目のレビューで
 * 指摘・`services/SyncWorker.ts` の `processNextDueJob` 参照）。名前が
 * 「外部呼び出し」だけを指すように読めるため、実態（claim〜finalize の
 * 1サイクル全体）に合わせて `trackSyncCycle` と命名している。
 *
 * 複数の呼び出しが同時に in-flight になりうる（今は単一ループだが、
 * 将来 AppState 配線で複数トリガから呼ばれるようになれば現実的に発生
 * する）ため `Set` で保持し、`runExclusive` は現在保持している**すべて**の
 * 完了を待つ。
 */
export async function trackSyncCycle<T>(cycle: () => Promise<T>): Promise<T> {
  const promise = cycle();
  inFlightSyncCycles.add(promise);
  try {
    return await promise;
  } finally {
    inFlightSyncCycles.delete(promise);
  }
}

/**
 * 現在 in-flight のすべての claim〜finalize サイクルの完了を待つ。結果
 * （成功/失敗）には関心がない——settle した事実だけが必要（§9.5.1 により、
 * 成功の事実は呼び出し元とは独立に SyncWorker 自身がすでに記録している）。
 *
 * スナップショットを取ってから待つ——`isSuspended()` が true の間は
 * `services/SyncWorker` 側が新しい claim を止めるので新規登録は本来
 * 起きないはずだが、万一登録され続けても無限に待ち続けない。
 * `isSuspended()` が `runExclusive` 呼び出しの瞬間から同期的に true になる
 * （下記）ため、このスナップショットより後に新規登録されることは無い
 * ——スナップショット自体は非同期（`.then()` の中）で取るが、取りこぼしは
 * 構造的に起きない。
 */
async function waitForInFlightSyncCycles(): Promise<void> {
  const snapshot = Array.from(inFlightSyncCycles);
  await Promise.allSettled(snapshot);
}

/**
 * 破壊的操作を Coordinator 経由で実行する。**破壊的操作は必ずこれ経由で
 * 実行すること**（§9.12）——`suspendingCount` を直接は公開しない
 * （呼び出し側が対応する減算を呼び忘れる／例外パスで飛ばす事故を防ぐ。
 * テストからは `__testHooks` 経由でのみ触れる）。
 *
 * `suspendingCount` は関数の**先頭で同期的に**加算し、`finally` で
 * 同期的に減算する——`isSuspended()` が「呼ばれてから完全に終わるまで」
 * 一貫して true になる（3回目のレビューで指摘・修正。以前はキューの
 * `.then()` の中で加算しており、呼び出し直後の数 microtask だけ
 * `isSuspended()` が false のままになる窓があった）。
 *
 * 内部の FIFO キューで直列化するため、2つの `runExclusive` が重なっても
 * 後始末（キュー解放）が互いを踏みつけない。**同一呼び出しスタック内で
 * ネストしてはならない**（デッドロックする、上記コメント参照）。
 */
export async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  suspendingCount++;
  try {
    const myTurn = exclusiveQueue.then(async () => {
      await waitForInFlightSyncCycles();
      return operation();
    });
    // 次の呼び出しは、このtry/finallyの結果（成功/失敗）に関わらず自分の番を待てるようにする。
    exclusiveQueue = myTurn.then(
      () => undefined,
      () => undefined,
    );
    return await myTurn;
  } finally {
    suspendingCount--;
  }
}

/** テスト専用：モジュール状態をリセットする。 */
export function __resetSyncCoordinatorForTests(): void {
  suspendingCount = 0;
  inFlightSyncCycles.clear();
  exclusiveQueue = Promise.resolve();
}

/** テスト専用：`runExclusive` を経由しない直接呼び出しでしか検証できない性質（部分的な suspend など）のためだけに公開する。本番コードから使わないこと。 */
export const __testHooks = {
  async suspend(): Promise<void> {
    suspendingCount++;
    await waitForInFlightSyncCycles();
  },
  resume(): void {
    suspendingCount = Math.max(0, suspendingCount - 1);
  },
};
