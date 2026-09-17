# Solo + Us

> Your intimate life, over time.

Solo / Partnered な性的活動を長期間記録し、自分自身の変化を振り返るための Private Wellness アプリ。

評価しない・急かさない・端末内に留める。NoFap アプリでも Sex Diary でもなく、
**Personal Health Data の一種として淡々と記録し続けられること**を中心価値とする。

## ステータス

設計文書は **v0.11** で確定済み。**Phase 1**（暗号化 DB → Migration runner → スキーマ →
Repository → Quick Record → Undo → 履歴 → Export/Import の往復）・**Phase 2**（Calendar）は
クローズ済み。**Phase 3**（Insights → App Lock → Recovery 画面 → 画面マスク →
日時編集 UI → Export/Import の UI）のうち Insights はクローズ済み、現在は App Lock に
着手中。詳細は下記の各「実装状況」を参照。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [設計判断記録 v0.11](docs/Solo%20+%20Us_設計判断記録%20v0.11.md) | **確定した設計判断（決定・理由・却下した案）。矛盾時はこれを優先する** |
| [要件定義書 v0.11](docs/Solo%20+%20Us_要件定義書%20v0.11.md) | プロダクト思想・記録項目・セキュリティ要件・MVP 範囲 |
| [基本設計 v0.11](docs/Solo%20+%20Us_基本設計%20v0.11.md) | 技術構成・データモデル・スキーマ・暗号化・同期設計・Import/Export |
| [UI/UX Specification v0.11](docs/Solo%20+%20Us_UI-UX%20Specification%20v0.11.md) | ブランド・カラートークン・画面仕様・文言ルール・A11y 受け入れ基準 |

**文書の優先順位：設計判断記録 > 各設計文書の本文 > 図版。**
`docs/old/` は検討履歴であり仕様ではない。

## 想定スタック

React Native + Expo Router（prebuild / dev client）  
`@op-engineering/op-sqlite`（SQLCipher で暗号化）  
Android: Health Connect

## 設計原則

1. Activity の保存は常にローカル DB を最優先する
2. 外部 API 障害で Activity を失わない
3. Solo / Partnered の区別を外部 Health 仕様に依存させない
4. 過去データとの互換性を最優先する
5. Activity 記録の操作数を増やさない
6. 不正状態は制約で塞ぐより、構造上表現できないようにする
7. 復元手段を機能ではなく安全性の一部として扱う
8. 利用者の属性を推測しない。必要な項目は本人が選ぶ

## 実装着手の前提条件

DB を触るコードを書く前に確定が必要なもの（すべて DB ファイル形式かドライバ選定を決めるため）。

- [x] Activity の分類軸 — `context`（`solo` / `partnered`）
- [x] 日時列の構成と精度 — UTC 正本 + ローカル非正規化列、分単位
- [x] 同期テーブルの分割 — `health_sync` / `health_sync_jobs`
- [x] 暗号化とドライバ選定 — SQLCipher / op-sqlite
- [x] schema version と Migration 方針
- [x] Outcome の分離（orgasm / ejaculation / protection）と統計非昇格
- [x] 同期ワーカーの楽観的並行制御（revision / claim）
- [x] 同期確定処理の3分岐と `recreate` 操作
- [x] アプリ設定の保存先（暗号化 DB 内の `app_settings`）
- [ ] Health Connect ラッパーが `clientRecordId` と `clientRecordVersion` を露出しているか
- [ ] 削除時の「存在しない」を他のエラーと識別できるか

未確定の2件は Health Connect ラッパーの調査項目で、**満たせない場合は HC 同期の v1.0 投入を見送る**。
DB 設計には影響しないため Phase 1 は着手できる。

## Phase 1 実装状況

`phase1/foundation` ブランチ。135 件のテストが通り、`tsc --noEmit` はエラーなし。

### ビルド構成

- Expo Router（`tabs` テンプレート）+ TypeScript
- `@op-engineering/op-sqlite`（`package.json` の `"op-sqlite": {"sqlcipher": true}` で SQLCipher 有効化。
  `pod install` で `OpenSSL-Universal` が解決されることを確認済み — SQLCipher 配線は実機ビルド一歩手前まで検証済み）
- Android は `plugins/withAndroidNoBackup.js`（自作 config plugin）で `allowBackup="false"` /
  `fullBackupContent="false"` に加えて **`android:dataExtractionRules`**（Android 12+ の
  device-to-device 転送を個別に無効化する XML リソースを自動生成）を注入。`expo prebuild --platform
  android` で生成される AndroidManifest.xml とリソースファイル双方で反映を確認済み（D-07 Android 側）
- `expo-localization` を追加。`preferences.firstDayOfWeek`/`timeFormat` の既定値は OS の実際のカレンダー
  設定（`getCalendars()`）から解決する（Hermes の `Intl.Locale` 実装状況に依存しない）
- `expo prebuild`（iOS / Android とも）・`pod install` は実行・成功済み。`[OP-SQLITE] using SQLCipher`
  → `OpenSSL-Universal` 解決までログで確認済み
- **iOS シミュレータでの起動は Xcode のツールチェーンでブロック中**：宛先解決の問題（ディスク容量
  不足・iOS シミュレータランタイム未導入）はユーザー協力のもと解消したが、`ExpoModulesJSI`
  （Expo SDK 57 の基盤モジュール）が `Package.swift` で **Swift tools version 6.2.0** を要求する一方、
  この Mac の Xcode 16.2 は Swift 6.0.3 まで。ユーザーの判断でアップデートは保留中。
  実機（iPhone 8 等）でも同じコンパイル段階で同じエラーになるため回避不可。Android 側の実機 /
  エミュレータ起動も未実施

### 実装済み

| 層 | 内容 |
|---|---|
| `database/` | `schema.ts`（v1 DDL）、`key.ts`（SecureStore 鍵管理、D-06。DB ファイルの有無を鍵生成前に確認し、既存 DB に対する鍵の誤生成を防止）、`connection.ts`（PRAGMA・§7.2 バックアップ付き migration 起動。失敗時は必ず接続を閉じ、復元時は `-wal`/`-shm` ごと削除して再オープン。復元が起きたことを `wasRestoredFromFailedMigration()` で通知）、`migrations/`（runner + 初期 migration + ダウングレード検出） |
| `repositories/` | `ActivityRepository` / `HealthSyncRepository` / `HealthSyncJobRepository`。§9.5 の claim/finalize、§10.1 の削除分岐を含む |
| `services/` | `syncJobPlanner`（§9.3/§10.1 を純粋関数化）、`ActivityService`（record/update/delete/undo の transaction 統括）、`SettingsRepository`、`ExportService`（読み出しをトランザクションで一貫させる） / `ImportService`（JSON schema v1、strict restore） |
| `lib/` | `datetime.ts`（UTC 固定長表記、DST を考慮した offset 解決、`occurredAtUtc` の秒 `:00` 不変条件）、`id.ts`（UUID v4）、`relativeDate.ts`、`log.ts`（§8.7: リリースビルドでは `error.name` のみ出力） |
| `contexts/` | `DatabaseContext`（鍵喪失/スキーマ不整合を区別した見出しを表示、migration 復元の通知を提供）、`DataRevision`（画面遷移を伴わない Undo でも Today を再読込させる）、`RecordFeedback`（Undo 失敗時に Alert で通知） |
| UI | Onboarding（Privacy Intro）、Today（月次集計・直近履歴・FAB、Undo 後に再読込）、Add Activity（Solo/Partnered 即記録・失敗時にアラート）、Undo Snackbar、`MigrationRestoredBanner`、Activity Detail（編集・削除・失敗時にアラート、duration の丸め誤差による黙った改変を防止、1分未満の実秒数を注記表示） |

### テスト

`better-sqlite3` を devDependency として使い、**実際の SQLite に対して**スキーマの CHECK/FK 制約、
`ActivityService` の同期ジョブ分岐（§9.3/§10.1 の全パターン）、Export → Import の全件往復
（基本設計 §13.5 の完成条件そのもの）、`attachExternalIdToDeleteJob` の revision 非依存の挙動、
`occurredAtUtc` の秒 `:00` 不変条件、鍵喪失時の分岐を検証している（`test/support/sqliteTestDb.ts`）。
SQLCipher 固有の挙動（`VACUUM INTO` の暗号化・実際の復元フロー）そのものは対象外（別の SQLite
バインディングかつ native module 依存のため、引き続き実機検証が必要）。

```
lib/__tests__/                    datetime, relativeDate, log（§8.7 リリースビルドでのログ抑制）
database/__tests__/               key（鍵の有無 × DB ファイルの有無の分岐）
database/migrations/__tests__/    runner のシーケンス・バックアップ呼び出し・ダウングレード検出
services/__tests__/               syncJobPlanner, importValidation
test/__tests__/                   schema・ActivityRepository・ActivityService・HealthSyncJobRepository・
                                   Export/Import（better-sqlite3 統合）
```

### 直近のレビューで見つかり、修正したもの

1. **Android 12+ の端末間転送**（D-07 違反）：`allowBackup=false` だけでは D2D 転送を防げないため、
   `dataExtractionRules` で明示的に無効化
2. **鍵の誤生成**：DB ファイルが既にあるのに鍵が読めない場合、新しい鍵を生成せず
   `DatabaseKeyUnavailableError` を投げるよう変更（既存 DB の鍵を上書きする事故を防止）
3. **Migration 復元の安全性とダウングレード検出**：復元前に接続を閉じ `-wal`/`-shm` も削除。
   `user_version` が既知の最大 migration より新しい場合は開かずエラーにする（§7.1）
4. **Undo 後に Today が更新されない**：`DataRevisionContext` を追加し、画面遷移なしの Undo でも
   再読込されるようにした。Undo 失敗時にエラーを飲み込まないよう修正
5. **詳細画面の duration が黙って壊れる**：分単位への丸め往復で 20 秒→null、90 秒→120 秒に
   化けていたのを、未編集フィールドは元の値をそのまま保持するよう修正
6. `ensureLocaleDefaultsPersisted` を起動時に呼び出すよう配線。`Intl.Locale` 依存をやめ
   `expo-localization` に変更
7. `occurredAtUtc` の秒が `:00` であることを Repository と Import の両方で検証するよう追加
8. `VACUUM INTO` の出力が万一平文だった場合に検知して失敗させる安全弁を追加（実機での最終確認は
   引き続き必要）
9. `attachExternalIdIfRevisionMatches` の revision 一致条件が、想定シナリオでは常に失敗する
   設計になっていたのを、状態（`operation='delete' AND external_record_id IS NULL`）で判定するよう修正
10. `planForEdit` の「ジョブもマッピングも無ければ create を挿入する」補完処理が、D-35 で明示的に
    同期を拒否した記録を再度同期してしまう等の問題があったため削除。この場合の正しい挙動
    （バックフィルするか）は Phase 4 の設計判断として保留
11. 記録・保存・削除・オンボーディングの各操作にエラー処理を追加。`getDatabase()` は失敗を
    永続化せず、次回呼び出しで再試行できるよう修正

### さらに次のレビューで見つかり、修正したもの

12. **復元後、古いスキーマの DB を正常な DB として返していた**：§7.2 は「復元して起動を継続し
    **エラーを表示する**」だが、エラー表示部分が抜けていた。`wasRestoredFromFailedMigration()` を
    追加し、`DatabaseContext`/`MigrationRestoredBanner` で通知するよう修正（v1 のみの現状では
    到達しないが、v2 を出す前に必要な配線）
13. **起動失敗時に接続を閉じていない**：ダウングレード検出・復号失敗・平文検知など、復元以外の
    失敗経路で `db.close()` を呼んでいなかった。`getDatabase()` の再試行のたびに接続が増える
    状態だったため、失敗時は必ず閉じてから例外を投げるよう修正
14. **Undo 失敗が利用者に見えない**：Snackbar を消して `console.error` するだけで、利用者からは
    成功時と区別がつかなかった。他の操作と同様に Alert を出すよう修正
15. **エラーメッセージがそのままログに出る**：`ValidationError` 等のメッセージには入力値
    （`occurredAtUtc` の値など）が含まれるため、§8.7 に反する。`lib/log.ts` を追加し、
    リリースビルドでは `error.name` のみを出力するよう統一
16. **1分未満の duration が「0」と表示される**：保存時のデータ破壊は既に修正済みだが、表示は
    丸めたままで「未記録」と誤読されうる状態だった。未編集時は実際の秒数を注記として表示
17. **設計への申し送り追加**：D-35 で「同期しない」と破棄した `create` ジョブ（`attempts > 0`）は、
    ジョブ・mapping とも消えるため、後で Activity を削除しても外部への削除は queue されない。
    #10 と同種の「declined/uncertain な同期状態」概念が必要で、Phase 4 の設計判断として
    `discardJob` のコメントに記録（コード修正はせず、安全側の現状維持）

### 3回目のレビューで見つかったもの

18. **`openAndMigrate` の catch で接続を二重に閉じうる**：`restoreBackup` フック内で `db.close()`
    した後 `restoreMigrationBackup()` が例外を投げると、`restoredFromBackup` が false のまま
    catch に入り、同じ接続をもう一度 `close()` していた。2 回目の close が例外を投げると本来の
    原因が上書きされて消える。`dbClosed` フラグで二重 close を防ぎ、close 自体の例外は握り潰して
    元のエラーを必ず残すよう修正。あわせて、復元後の再オープン（`openConnection`→`applyPragmas`）
    が失敗した場合にその接続を閉じていなかった漏れも修正
19. **90 秒のように「60 の倍数でない」duration に注記が出ていなかった**：条件が
    `durationSeconds < 60` だったため、90 秒は注記なしで「2」と表示されていた。
    `durationSeconds % 60 !== 0` に変更し、丸めで値が変わりうるケース全てで注記を出すよう修正
20. **【設計への申し送り】復元後もアプリが通常どおり書き込みを続ける**：`wasRestoredFromFailedMigration()`
    のバナーで §7.2 の「エラーを表示する」は満たしたが、その後も書き込み系の操作は普通に動き続ける。
    v2 で列を追加した場合、その列を前提にした INSERT が復元後の古いスキーマに対して毎回失敗し、
    「Your existing records are safe」というバナーの文言と実際の挙動（記録できない）が食い違う
    状態になりうる。**最初の v2 migration を作る前に、設計書で「復元状態では書き込みを止め、
    読み取り/Export のみ許可する」等の方針を決める必要がある**。`database/connection.ts` の
    `wasRestoredFromFailedMigration` 直上にコメントとして記録（コード修正はせず、決定待ち）
21. **【実機確認待ち】`MigrationRestoredBanner` の表示位置**：`<Stack>` の外側で独自に
    `SafeAreaView edges={['top']}` を使っているため、ヘッダー付き画面（Activity Detail 等）では
    上端の安全領域確保が二重になる可能性がある。現状は到達しない経路のため、v2 migration の
    検証時に実機で確認する

### 4回目のレビューで見つかったもの

22. **Migration 復元の途中失敗がデータ消失に見える**：`restoreMigrationBackup()` が「先に
    `dbFile` を削除し、その後 `backup` をコピーする」順序だったため、コピーが途中で失敗すると
    `dbFile` と `backup` のどちらも存在しない瞬間が残りうる。次回起動時にこれを「新規インストール」
    と誤認し、鍵はそのままに空の DB を新規作成してしまう——利用者からは記録が全て消えたように
    見える。`backup` を一時ファイルへコピー→`dbFile` 削除→一時ファイルを `moveSync` で
    `dbFile` へ、という順序に変更し、失敗しうる「まるごとコピー」を `dbFile` 削除より前に
    完了させることでこの空白を無くした。あわせて、途中で強制終了された場合に備え、
    `getDatabase()` の最初（鍵の有無を尋ねる前）に `recoverInterruptedRestoreIfNeeded()` を追加し、
    `dbFile` が無く `backup` が残っている状態を新規インストールと区別して復元を完了させる
23. **Migration 失敗時、復元自体も失敗すると元のエラーが消える**：`restoreBackup()` フック内で
    例外が発生すると、その例外がそのまま上に伝播し、本来投げるはずだった migration 失敗の
    原因が握り潰されていた。`restoreBackup()` の呼び出しを try/catch で囲み、失敗時は
    `migrationError`（元の migration 失敗）と `restoreError`（復元自体の失敗）の両方を
    フィールドに持つ `MigrationRestoreFailedError`（`lib/errors.ts`）を投げるよう修正。
    v2 以降で両方の失敗が重なった場合のデバッグ時に両方の原因を確認できる

いずれも v2 以降の migration が失敗した場合にしか到達しない経路だが、`connection.ts` /
`migrations/index.ts` を触っているうちに合わせて対処。#22 は `connection.ts` 内の
ファイル操作のみのため Jest では検証不可（既知の制約、下記参照）、#23 は
`database/migrations/__tests__/index.test.ts` にテストを追加して検証済み。

### 5回目のレビューで見つかったもの

24. **【高】#22 の修正自体に、コピー未完了のまま次の処理へ進むバグがあった**：
    `expo-file-system` の `File.copy()` は `Promise<void>` を返す非同期メソッドだが（同期版は
    `copySync()`）、`restoreMigrationBackup()` は同期関数で `backup.copy(temp)` を await せずに
    呼んでいたため、コピーの完了を待たずに `dbFile` の削除・一時ファイルの move・`backup` の削除まで
    進んでしまっていた。最悪の場合、壊れた DB だけが残りバックアップも消える、#22 で防ごうとした
    「消えて見える」よりも実際に悪いデータ消失になりうる不具合。`tsc` は Promise を待たずに捨てても
    型エラーにしないため検出できなかった。`backup.copySync(temp)` に置き換えて修正。この関数を
    移動元の `restoreMigrationBackup()` 導入時（#22）から潜在していた既存バグで、直前のレビューでも
    見落としていたもの
25. **【低】cause の実機（Hermes）対応が未確認**：#23 で使った `new Error(msg, { cause })` の
    第2引数を Hermes が実機でサポートしているかは未確認（この Mac の Xcode/Swift 環境では実機ビルド
    自体ができないため検証不可）。未対応の場合 cause は黙って捨てられ、両方のエラー情報が失われる。
    `MigrationRestoreFailedError`（`lib/errors.ts`）という専用クラスに変更し、
    `migrationError`/`restoreError` を通常のプロパティとして保持するよう修正。実行環境に依存しなくなり、
    `DatabaseContext` 側でもこの状態を専用の見出しで判別できるようにした
26. **【低】「DB とバックアップが両方ある」場合のコメントが実態と一部違う**：
    `recoverInterruptedRestoreIfNeeded()` の該当コメントは「復元は終わり、後片付けだけが残った」
    場合のみを説明していたが、migration 実行中（`restoreMigrationBackup` に入る前）にアプリが
    強制終了された場合も同じ状態になりうる。各 migration が個別トランザクションのため、
    どちらの場合も `backup` を消してよい（DB の整合性は保たれ、次回起動時に現在の `user_version` から
    再開する）ことに変わりはないが、将来トランザクション外のステップを持つ migration を書く際に
    誤った前提にならないよう、両方のケースを正確にコメントへ書き直した

#24 は v2 を待たずすぐ直す必要があると指摘された高優先度の修正（copy → copySync のみで完結）。
#25 の副作用として `contexts/DatabaseContext.tsx` にも `MigrationRestoreFailedError` 用の
見出し分岐を追加。レビューでは合わせて ESLint の `@typescript-eslint/no-floating-promises` 導入も
提案されたが、本プロジェクトには ESLint 設定自体がまだ無く、新規導入は今回のバグ修正とは別スコープの
作業のため見送り、Known gaps に記録するに留めた。

### Known gaps（意図的に未実装）

- **【v2 migration の前に決定必須】復元状態での書き込み方針**：#20 参照。バナーで通知はするが、
  書き込み操作自体は止めていない。最初の v2 migration を作る前に、設計書で読み取り専用モード等の
  方針を決めること
- **iOS のバックアップ除外**（D-07 の後半）：Android の `allowBackup=false` + `dataExtractionRules` は
  実装済みだが、iOS の `NSURLIsExcludedFromBackupKey` は expo-file-system の API に無く、小さな
  ネイティブモジュールが要る。未実装（DB は現状 Documents 配下に置かれ、iOS 側は iCloud/iTunes
  バックアップに含まれる）。**この状態で TestFlight 等の外部配布はしないこと**
- **iOS の DB 配置**：Documents ではなく Library/Application Support の方が用途に適しているという
  指摘は妥当だが、expo-file-system に対応する高レベル API が無く、プラットフォーム間で安全に
  パスを組み立てる手段が未確認のため、バックアップ除外の実装と合わせて Phase 3 で対応する
- **日時編集 UI**：過去日時への記録・編集（§11.4/§4.4）は未実装。ネイティブの日時ピッカーを追加する前に
  まず SQLCipher 配線を実機で確認したかったため、意図的に後回し。基本設計 §18 の Phase 1〜4 に
  明記が無かったため Phase 2 レビューで指摘され、**Phase 3 に割り当てる**ことを決定（App Lock /
  Recovery 画面 / 画面マスク / Export・Import UI と並行）。実機ビルドが通ることが前提
- **Settings 画面一式**：Activity Details カスタマイズ、App Lock、Health Connect、Data(Export/Import UI)
  はいずれも Phase 3。`ExportService`/`ImportService` は実装・テスト済みだが、呼び出す UI がまだ無い
- **Insights**：プレースホルダーのみ（Phase 3。合計・内訳・平均間隔、§14 の統計定義）
- **Health Connect 同期の実行部分**：`HealthConnectService` / `SyncWorker` は未実装（Phase 4）。
  ジョブのキューイング自体（`ActivityService` → `health_sync_jobs`）は実装・テスト済みで、
  `healthConnect.enabled` が既定 `false` のため実際には空のまま動く
- **App Lock / Recovery 画面**：DB を開けなかった場合、`DatabaseContext` は鍵喪失かどうかで見出しを
  出し分ける簡易画面を出すのみ。§8.8 の Recovery bootstrap（別鍵での一時 DB 作成・検証・差し替え）は
  未実装
- **`connection.ts` の実機検証**：`@op-engineering/op-sqlite` の import 自体が Jest の変換対象外
  （ESM 構文で SyntaxError）のため、`connection.ts` は一切ユニットテストできない。`VACUUM INTO`
  によるバックアップの暗号化確認、復元フローのファイル操作、失敗時に確実に `db.close()` される
  ことの確認、`wasRestoredFromFailedMigration()` の通知が実際に画面へ届くことは、実機（または
  シミュレータ）でのみ確認できる
- **実機 / シミュレータでの起動確認**：`pod install` の成功までは確認済み。Xcode の Swift
  ツールチェーンが古く（上記参照）、`expo run:ios` によるビルド・起動は未実施。Android 側の
  実機 / エミュレータ起動、Gradle ビルド（SQLCipher 分岐の実行）も未実施
- **ESLint 未導入**：レビューで `@typescript-eslint/no-floating-promises` の導入を提案された
  （#24 のような、await し忘れた Promise を `tsc` は検出しないため）。妥当な指摘だが、本プロジェクトは
  ESLint 設定自体が無く、導入するとリポジトリ全体に対する既存コードの棚卸しが別途必要になるため、
  今回のバグ修正とは別スコープとして見送った。特に `connection.ts` のように native module 依存で
  Jest 検証ができないファイルほど、この種の静的チェックの価値が高い

## Phase 2 実装状況

`phase2/calendar` ブランチ（`phase1/foundation` からの派生。`phase1/foundation` は `main` にマージ
済み）。基本設計 §18 の Phase 2 は「Calendar → 月次統計 → Activity Detail（詳細項目）」だが、
月次統計（Today の THIS MONTH 集計）と Activity Detail の詳細項目編集（Orgasm/Ejaculation/
Protection/Duration/Mood/Notes）は Phase 1 の時点で既に実装済みだったため、Phase 2 で新規に
着手したのは **Calendar 画面**（UI/UX §13）のみ。

### 実装済み

| 層 | 内容 |
|---|---|
| `lib/calendarGrid.ts` | 月グリッドの純粋関数（週の開始曜日・月またぎ・閏年を考慮した日数計算）。DB/native 依存なしで単体テスト可能 |
| `lib/timeFormat.ts` | `preferences.timeFormat`（12h/24h）に従った時刻表示。Activity Detail の日時表示もこれに合わせて修正（従来は 12h 固定だった） |
| `lib/relativeDate.ts` | `formatMonthDay`（"Sep 14" 形式）を追加。`ActivityRow` にあった同等のプライベート実装を置き換え |
| `app/(tabs)/calendar.tsx` | 月表示グリッド・前月/次月ナビゲーション・日別ドット（§13「同日複数」の1-2件個別ドット/3件以上まとめ表示ルールに準拠）・日付タップで一覧表示・Activity Detail への遷移 |

`findActivitiesByDateRange`（Phase 1 で実装済み）をそのまま利用し、月内の Activity を1回のクエリで
取得してクライアント側で日付ごとにグルーピングする方式とした。新規の Repository/Service 関数は
追加していない。

### アクセシビリティ上の判断

月グリッドの各日の活動ドットは、Solo を塗りつぶし・Partnered を輪郭のみ（中抜き）にして、
色だけでなく**形**でも区別する（§24 A3「色覚に依存せず識別できる」、§13「色＋activity indicator
で識別」）。当初は色分けのみ＋各セルの `accessibilityLabel` で済ませていたが、ラベルはスクリーン
リーダー利用者にしか届かず、色覚特性のある晴眼の利用者は日ごとにタップしないと区別できないという
レビュー指摘を受けて修正した。3件以上をまとめた「● 3」は特定の活動の context を主張する表示では
ないため、この区別ルールの対象外とした（§13 の "● 3" 表記そのままの簡略化）。

今日の日付・選択中の日は、色に加えて太字（今日）・枠線（選択中、`accessibilityState.selected` も
付与）で示し、同様に色だけに依存しないようにしている。

### テスト

```
lib/__tests__/calendarGrid.test.ts   月グリッドの境界値（週開始・月末パディング・閏年・年またぎ）
lib/__tests__/timeFormat.test.ts     12h/24h 変換（0時・12時の境界を含む）
lib/__tests__/relativeDate.test.ts   formatMonthDay を追加
```

`app/(tabs)/calendar.tsx` 自体（React コンポーネント）はユニットテスト対象外——このプロジェクトに
コンポーネントテスト基盤（React Native Testing Library 等）がまだ無いため。ロジックを極力
`lib/calendarGrid.ts`/`lib/timeFormat.ts` に切り出すことで、画面側は「取得したデータを並べるだけ」
に留めている。

### レビューで見つかり、修正したもの（1回目）

1. **【中】月を素早く切り替えると古い月の結果で表示が上書きされる**：`reload` は表示中の月に
   依存する非同期処理で、切り替えを待たずに次の月へ移ると、後から解決した古い月の問い合わせが
   新しい月のデータを上書きしうる状態だった。さらに `visible` が変わるたびに `reload` の
   identity も変わり、`useFocusEffect` と別の `useEffect` の両方が反応して月切り替え1回につき
   問い合わせが2回走る構造になっており、競合が起きやすくなっていた。問い合わせごとに連番の
   id を持たせ、より新しい呼び出しが始まっていたら結果を捨てるよう修正。あわせて別々だった
   2つの effect を1つの `useFocusEffect` に統合し、月切り替えのたびに二重に問い合わせが
   走らないようにした
2. **【中】ドットが色のみで Solo/Partnered を区別しており A3 の受け入れ基準と不整合**：
   上記「アクセシビリティ上の判断」参照。塗りつぶし/輪郭の形の区別に修正
3. **【中】選択中の日の視認性とアクセシビリティ状態**：ライトテーマで選択時の背景色 `surface`
   （#FFFFFF）と画面背景 `background`（#F8F7FA）がほぼ同じで見分けにくかったため、背景の塗り
   ではなく枠線（`colors.solo`）に変更。`accessibilityState={{ selected }}` も追加。今日の
   日付も色だけでなく太字で示すよう修正
4. **【低】設定読み込み前にグリッドが月曜始まりで一瞬描画され、後で並び替わる**：
   `firstDayOfWeek` の初期値を `'monday'` という推測値ではなく `null`（未取得）にし、
   実際の設定が読み込まれるまで曜日ヘッダーとグリッド自体を描画しないよう修正

### レビューで見つかり、修正したもの（2回目）

1回目の修正自体から新たに生まれた問題が中心。

1. **【中】Partnered の中抜きドットがライトテーマでほとんど見えない**：#2（1回目）で形による
   区別に直した際、コントラスト比を確認していなかった。`colors.partnered`（`#F4A699`）は
   `colors.background`（`#F8F7FA`）に対して約 1.8:1 しかなく、WCAG 1.4.11 の図形要素基準
   3:1 を下回る。中抜き（輪郭のみ）はこの比率がそのまま見た目に直結するため、以前の塗りつぶし
   よりむしろ見えにくくなっていた。`colors.solo` は同条件で約 4.6:1 あるため、**中抜きにする
   context を Solo 側に入れ替え**、Partnered は塗りつぶしのまま残した（ダークテーマは双方とも
   問題なし）
2. **【中】「● 3」以上のまとめ表示が Solo/Partnered のどちらかの単独ドットと同じ形に見える**：
   3件以上をまとめた表示がただの塗りつぶし丸だったため、色の区別がつきにくい利用者には
   「その context が3件」のように誤読されうる状態だった。ドット自体をやめ、件数の文字のみを
   表示するよう修正（内訳を主張しない表示であることが形からも明確になる）
3. **【中】初回読み込みに失敗すると、エラー表示も出ないまま空白になる**：#4（1回目）の修正で
   `firstDayOfWeek` が読めるまでグリッドを描画しない形にしたが、読み込み自体が失敗した場合に
   `firstDayOfWeek` が `null` のまま残り、グリッドもエラーメッセージも出ない状態になっていた。
   また読み込み中は `byDate` が空のままのため、選択中の日の一覧に一瞬「記録なし」の
   EmptyState が表示されてから実際のデータに切り替わる問題もあった。`loading`/`ready`/`error`
   の3状態を持たせ、読み込み中・失敗時はグリッドと日別一覧の代わりに状態を示すメッセージを
   表示するよう修正
4. **【低】Phase 3 への割り当てが README にしか反映されていなかった**：基本設計 §18・UI/UX §27
   の開発順序表にも「日時編集 UI」を Phase 3 として追記し、設計文書の優先順位
   （設計判断記録 > 各設計文書の本文 > README）どおり正本を更新した
5. **【低】Today 画面に Calendar で直した二重 effect のパターンが残っていた**：`useFocusEffect`
   と別の `useEffect([revision, reload])` の両方を持っていたため、マウント時に読み込みが2回
   走っていた（競合は起きないが Calendar の1回目修正と矛盾するパターン）。Calendar と同じ、
   単一の `useFocusEffect` に `revision` を依存配列で含める形に統一

### レビューで見つかり、修正したもの（3回目）

1回目の「形を入れ替えれば解決する」という判断が誤りだった、という指摘。

1. **【中】Partnered の色は塗りつぶしにしてもコントラスト基準を満たさず、他画面にも波及していた**：
   WCAG 1.4.11 の 3:1 は図形と背景の差そのものへの基準であり、塗りつぶしか中抜きかは関係ない。
   `#F4A699` は `background`（#F8F7FA）に対して約1.83:1、`surface`（#FFFFFF）に対して約1.95:1
   しかなく、2回目の「中抜きにする側を入れ替える」修正だけでは実際には解決していなかった。
   同じ `colors.partnered` は `app/(tabs)/index.tsx` の Today 月次件数（32px 太字、WCAG 1.4.3
   の大きな文字 3:1 も未達）、`ActivityBadge`、`record.tsx` の選択ドットでも使われており、
   Calendar 固有ではなく色トークン自体の問題だった。`constants/theme.ts` に
   `partneredStrong`（Light: `#92635B`、`background`/`surface` に対しそれぞれ約4.73:1/5.05:1）
   を追加し、文字色・小さな図形要素としての用途をこちらに切り替えた。`partnered` はブランドの
   面の色・装飾用途（`IntersectPlus` 等）として残置。UI/UX §3 のカラートークン表・Semantic
   usage にも追記した（ブランドマーク `IntersectPlus` は WCAG のロゴ除外に該当するため対象外）

### Known gaps

- **実機での見た目の確認が未実施**：iOS は Xcode/Swift ツールチェーン問題（上記参照）でブロック中。
  Android はエミュレータ未セットアップ（AVD 未作成）で、かつこの Mac の空き容量が 6.4GB と、以前
  iOS シミュレータのダウンロードをブロックした容量不足と同水準。月グリッドのレイアウト・ドットの
  視認性・日別一覧のスクロール挙動、および §24 A1「最大 Dynamic Type でも要素が切れない」・
  幅 320dp での表示は、いずれかのビルド経路が開通してから確認する
- **【Phase 3 申し送り】`solo` と `partneredStrong` は明るさがほぼ同じ（約 1.02:1）**：
  3回目レビューで判明。色相のみの違いになっており、色覚特性がある場合やグレースケール表示では
  ほぼ区別がつかない。現状の使用箇所（Calendar のドットの形・テキストラベル併記）では実害がないが、
  **Insights（Phase 3）で Solo/Partnered を色分けしたグラフ（棒グラフ等）を作る際は、模様や
  ラベルなど色以外の手段を併用するか、明るさが十分に異なるグラフ専用の配色を別途用意すること**
  （UI/UX §24 A3「色に頼らない識別」・A4「グラフと同じ情報をテキストでも取得できる」に関わる）

## Phase 3 実装状況

`phase3/insights` ブランチ。まず Insights 画面（UI/UX §14）から着手。

### スコープの判断：Insights は v1.0 分のみ、集計期間は全期間で確定

要件定義書 §25 の MVP 表は元々 Insights を2行に分けており、「All Time」の文字は
v1.1 側の行にあった。

```
Insights（合計・内訳・平均間隔）         v1.0 ●
Insights（年次・曜日・時間帯・All Time） v1.1
```

v1.0 の行自体には集計期間が明記されておらず、実装当初は全期間（All Time）で作った
ため、この表と食い違っていた（レビューで指摘）。ユーザーと相談のうえ、**全期間を
v1.0 として確定し、MVP 表を修正**した（「All Time」を v1.0 側の行に移動）。

```
Insights（合計・内訳・平均間隔、全期間）           v1.0 ●
Insights（期間セレクタ・月次棒グラフ・曜日・時間帯） v1.1
```

UI/UX §14/§15 のモックアップ（期間セレクタ・月次棒グラフ・最頻曜日・最頻時間帯）は
両方の機能を1画面に描いているが、期間セレクタ本体（Month/Year トグル）・月次棒グラフ・
最頻曜日/最頻時間帯は v1.1 のまま。Today の「THIS MONTH」（当月のみ）とは異なり、
Insights は全期間を対象にする点が新規価値になる。画面には「All time」であることを
明示するキャプションを追加した（期間セレクタが無いため、UI/UX §14 モックの年選択
ドロップダウンだけを見て「今年の合計」と誤解されないように）。

### 実装済み

| 層 | 内容 |
|---|---|
| `repositories/ActivityRepository.ts` | `countAllActivities`（日付範囲なしの全件集計）、`getActivityTimeSpan`（`MIN`/`MAX(occurred_at_utc)`）を追加 |
| `services/StatisticsService.ts` | `getInsightsSnapshot`：件数と時間範囲を1つのトランザクションで読み、平均間隔まで計算して返す（`ExportService.buildExportPayload` と同じ理由——2つの別々の読み取りの間に記録・削除が入ると、件数と最古/最新の時刻が別時点の値になり平均間隔がずれる） |
| `lib/statistics.ts` | `averageIntervalDays`（§14「(最新−最古)÷(件数−1)の実時間差、2件未満は null」の純粋関数）、`formatAverageIntervalDays`（§14 表示規則「空欄にせず—を出す」。1日未満は時間単位で表示し、丸めた値がちょうど 1.0 のときだけ単数形にする） |
| `app/(tabs)/insights.tsx` | TOTAL ACTIVITIES（全期間の合計・Solo/Partnered 内訳）・YOUR PATTERNS（平均間隔）・「All time」キャプション。Calendar と同じ `loading`/`ready`/`error` の3状態、単一 `useFocusEffect` パターンを最初から採用 |

### テスト

```
lib/__tests__/statistics.test.ts                 averageIntervalDays（0/1/2件以上、(count-1)で割ること、実時間差）、
                                                  formatAverageIntervalDays（時間/日の切り替え、単数/複数形の境界）
test/__tests__/activityRepository.integration.test.ts  countAllActivities/getActivityTimeSpan を追加（既存ファイルに追加）
```

### レビューで見つかり、修正したもの（1回目）

1. **【中】実装した「全期間」が MVP 表では v1.1 に分類されていた**：上記「スコープの判断」参照。
   ユーザーと相談のうえ全期間を v1.0 として確定し、要件定義書 §25 の MVP 表を修正した
2. **【中】画面に集計期間が表示されていなかった**：「TOTAL ACTIVITIES」の見出しだけでは
   全期間の集計であることが分からず、UI/UX §14 モックの年選択ドロップダウンと合わせて
   「今年の合計」と誤解されうる状態だった。「All time」キャプションを画面に追加
3. **【低】件数と時間範囲を別々のトランザクションなしの読み取りで取得していた**：
   `countAllActivities` と `getActivityTimeSpan` を `Promise.all` で並行に読んでおり、
   間に記録・削除が入ると平均間隔が一時的にずれる状態だった。`ExportService` と同じ
   理由で、`StatisticsService.getInsightsSnapshot` が1つのトランザクション内で両方を
   読むよう修正
4. **【低】1日未満の間隔が「0.0 days」と表示されていた**：記録が30分差でも「0.0 days」
   となり同時刻の記録のように読めた。1日未満は時間単位（例: 「0.5 hours」）で表示する
   よう修正。あわせて「1.0 days」のような不自然な複数形も、丸めた値がちょうど 1.0 の
   ときだけ単数形（「1.0 day」/「1.0 hour」）になるよう修正

### レビューで見つかり、修正したもの（2回目）

1回目の「全期間を v1.0 として確定」が要件定義書 §25 にしか反映されておらず、正本の
優先順位（設計判断記録 > 各設計文書の本文）に反する食い違いが残っていた、という指摘。

1. **【中】設計判断記録・UI/UX 仕様に「All Time は v1.1」が残っていた**：
   設計判断記録 D-13、UI/UX §27 Phase 4 の該当行が要件定義書 §25 の修正と食い違っていた。
   両方とも「All Time」を v1.0 側に修正。あわせて UI/UX §15（Period Selector 本体・
   Month/Year 切り替え・年ごとの OVER TIME 内訳）は v1.1 のままであり、v1.0 の全期間
   合計（§14 TOTAL ACTIVITIES）とは別物であることを §15 に明記した
2. **【低】1時間未満の間隔が「0.0 hours」と表示される**：記録が1分差でも「0.0 hours」と
   なり、1回目に直した「0.0 days」と同じ問題が1段階下に残っていた。`occurred_at_utc` が
   分単位精度（§4.2）であることに合わせ、1時間未満は分単位（例: 「1.0 minute」）で
   表示するよう修正

### Known gaps

- **Insights の v1.1 分**：期間セレクタ（Month/Year トグル）・月次棒グラフ・最頻曜日・
  最頻時間帯は要件定義書 §25 で v1.1 と明記されているため未着手
- **実機での見た目の確認が未実施**：Phase 1/2 と同じ制約（iOS は Xcode/Swift、Android は
  エミュレータ未セットアップ・ディスク容量不足）が引き続き残っている

### App Lock

`phase3/app-lock` ブランチ。基本設計 §18 の Phase 3 順序（Insights → App Lock → Recovery
画面 → 画面マスク → 日時編集 UI → Export/Import の UI）に従い、Insights の次に着手。

#### スコープの判断：Settings 画面は App Lock 分のみ先に作る

UI/UX §17 の Settings 画面は PRIVACY/HEALTH/DATA/TRACKING/PREFERENCES/ABOUT の6セクション
から成るが、App Lock 以外はまだどれも実装されていない。ユーザーと相談のうえ、
**Settings 画面全体を先にスキャフォールドせず、App Lock 行だけを先に作る**ことにした。
他のセクション（Health Connect・Data・Activity Details・Preferences・About）は、
それぞれの Phase 3/4 の sub-item に着手するときに1行ずつ追加していく。「Coming soon」の
プレースホルダー行は作らない（デッドリンクを残さない）。

#### 実装済み

| 層 | 内容 |
|---|---|
| `lib/appLockTiming.ts` | `shouldLockOnResume`：バックグラウンド復帰時にロックすべきかどうかの純粋関数。コールドスタート（`backgroundedAtMs === null`）は常にロック扱い |
| `lib/localAuthMessages.ts` | `describeAuthError`：`expo-local-authentication` の失敗コードを人が読める文言に変換する純粋関数（lockout のみ具体的な文言、cancel 系は非表示） |
| `contexts/AppLock.tsx` | `AppLockProvider`：`AppState` でバックグラウンド/フォアグラウンド遷移を監視し、`appLock.enabled`/`timing`（Phase 1 で追加済みの設定）に従ってロック画面を表示。DB 暗号鍵の可読性とは完全に独立（§8.3）——ロック中も DB 接続自体は保持されたまま、UI の描画だけを止める。認証試行そのものもここに集約（`attemptUnlock`）し、端末に認証手段が無くなった場合は `appLock.enabled` を自動 OFF にする |
| `components/LockScreen.tsx` | ロック画面（ブランドマーク・🔒・「Unlock with device authentication」、失敗理由の表示）。認証試行自体は `AppLockProvider` 側が持ち、ここは表示専用 |
| `components/LoadErrorOverlay.tsx` | App Lock 設定の読み込みに失敗した場合のエラー表示 + 再試行 |
| `app/settings/index.tsx` | Settings 画面（App Lock 行のみ） |
| `app/settings/app-lock.tsx` | Use App Lock トグル、LOCK タイミング選択（Immediately/After 1 minute/After 5 minutes）。ON にする前に `getEnrolledLevelAsync()` で端末に認証手段が無い場合は拒否。OFF にする際も認証を要求 |
| `app/(tabs)/index.tsx` | Today の右上に ⚙ アイコンを追加（§7 モックアップ通り）、`/settings` への導線 |
| `app/_layout.tsx` | `AppLockProvider` を `RecordFeedbackProvider` の内側・`Stack` の外側に配線。ロック中も `children`（`Stack` 全体）はマウントしたまま、オーバーレイで覆う形（下記「レビューで見つかり、修正したもの」#3 参照） |

#### テスト

```
lib/__tests__/appLockTiming.test.ts     shouldLockOnResume（無効時は常に false、コールドスタートは常に true、
                                         immediately/1m/5m の境界値）
lib/__tests__/localAuthMessages.test.ts describeAuthError（lockout の専用文言、cancel系は非表示、その他は汎用文言）
```

`contexts/AppLock.tsx`・`components/LockScreen.tsx` 自体は `AppState`/`expo-local-authentication`
（ネイティブ）依存のため Jest では検証できない——判定ロジックを `lib/appLockTiming.ts`/
`lib/localAuthMessages.ts` に純粋関数として切り出すことで、そこだけはテスト可能にした。

#### レビューで見つかり、修正したもの（1回目）

利用者が自分の記録に二度と入れなくなる経路が2つ見つかった（優先度：高）。

1. **【高】端末の認証をすべて外すと永久に開けなくなる**：App Lock を ON にする時点でしか
   認証手段の有無を確認していなかった。ON にした後で端末のパスコード・生体認証を
   すべて外すと `authenticateAsync` が常に失敗し、独自 PIN も無い設計（D-08）のため
   二度と解除できず、唯一の脱出手段（アプリ削除）は DB ごと全データを失う。ロック画面
   表示のたびに `getEnrolledLevelAsync()` を確認し、`SecurityLevel.NONE` なら
   App Lock を自動的に OFF にしてロックを解除するよう修正（`disableAppLockDueToNoEnrollment`）。
   D-08 の想定漏れとして設計判断記録に追記した
2. **【高】認証ダイアログの表示自体がロックを再度かけ直すおそれがある**：iOS の Face ID
   ダイアログは `active → inactive → active`、Android の端末パスコード画面は別 Activity
   になるため、認証中に `AppState` が変化しうる。これを「バックグラウンドに行った」と
   誤認すると、認証成功の直後に再ロックし、ロック画面のたびに認証ダイアログが自動で
   出て同じことを繰り返す無限ループになりうる。認証試行中は `AppState` の変化を無視する
   フラグ（`authenticatingRef`、React state ではなく ref——リスナーが同期的に参照するため）
   を追加し、あわせて `inactive` 単体（Control Center 等）ではタイマーを開始しないよう
   修正（`background` のみを対象に）。`inactive` への対応は別項目の「画面マスク」に譲る
3. **【中】ロックのたびに画面の状態と編集中の内容が消える**：ロック中は `children` の
   代わりに `LockScreen` を返していたため、`Stack` 以下が毎回アンマウントされ、
   Activity Detail でメモ入力中に一瞬他のアプリへ切り替えただけで入力中の内容が失われる
   状態だった。`children` は常時マウントしたまま、`LockScreen` を最前面にオーバーレイする
   形に変更。オーバーレイ表示中は `pointerEvents="none"` でタッチを止め、
   `accessibilityElementsHidden`/`importantForAccessibility="no-hide-descendants"` で
   スクリーンリーダーからも隠す
4. **【中】設定の読み込みに失敗すると画面全体が真っ白なまま**：初回の
   `refreshAppLockSettings()` に catch が無く、失敗すると `null` を描画し続けていた
   （Calendar で直したのと同じ種類の問題）。`loading`/`ready`/`error` の3状態にし、
   失敗時は再試行ボタン付きのエラー表示（`LoadErrorOverlay`）を出すよう修正
5. **【低】App Lock の OFF に認証が要らなかった**：設計書に明記が無いため判断が必要
   だったが、ON にする操作と対称になるよう、OFF にする際も `authenticateAsync` を
   要求するよう修正
6. **【低】ロック画面の解除ボタンのアクセシビリティ情報が無く、失敗理由も伝えていなかった**：
   `accessibilityRole`/`accessibilityLabel` を追加。`lib/localAuthMessages.ts` の
   `describeAuthError` で lockout 等の失敗理由をロック画面に表示するよう修正

#### レビューで見つかり、修正したもの（2回目）

1回目の修正自体から生まれた抜けが中心。

1. **【中〜高】ネイティブのモーダル画面がロック画面より上に表示されるおそれ**：
   `app/record.tsx` は `presentation: 'modal'` で、iOS のネイティブスタックでは root view
   とは別の階層に表示される。root に重ねる `absoluteFill` の `View` オーバーレイでは、
   記録用モーダルを開いたままバックグラウンドへ行って戻ってきた場合にモーダルの方が
   上に残り、ロック中でも記録操作ができてしまうおそれがあった。オーバーレイを React
   Native 標準の `Modal`（`transparent={false}`、Android の戻るボタンで閉じられないよう
   `onRequestClose` を no-op に）の中で描画するよう変更。ネイティブの Modal 提示は他の
   ネイティブ提示より確実に上に来る想定だが、実機未確認（Known gaps 参照）
2. **【中】設定画面での OFF 確認の認証が、再ロック防止の仕組みの対象外だった**：
   `app/settings/app-lock.tsx` が `LocalAuthentication.authenticateAsync` を直接呼んでおり、
   `AppLockProvider` の `authenticatingRef` が立たなかった。Android で端末 PIN 画面が別
   Activity として開くと一度 `background` になり、「Immediately」設定では OFF 確認の認証
   直後にロックがかかり直し、ロック画面がもう一度認証を要求する二重認証になりえた。
   `AppLockProvider` から `authenticate()` を関数として公開し（`authenticatingRef` を
   経由）、設定画面もこれを使う形に統一
3. **【中】`not_enrolled` を返されただけで App Lock を自動 OFF にしていた**：
   Android では生体認証が未登録でパスコードのみ設定されている端末でも `not_enrolled` が
   返る場合があり（ライブラリ/OS バージョン依存、実機要確認）、その場合は
   `getEnrolledLevelAsync()` が `SECRET`（パスコードあり）を返しているのに App Lock が
   誤って OFF になる状態だった。エラーコードだけで判断せず、OFF にする前に
   `getEnrolledLevelAsync()` をもう一度呼び、`NONE` のときだけ OFF にするよう修正
4. **【低】`getEnrolledLevelAsync()` 自体が例外を投げると、ロック画面に何も表示されない**：
   `catch` で `logError` するだけで `authError` を設定していなかった。汎用のエラー
   コード（`'unknown'`）を設定し、`describeAuthError` の汎用文言が出るよう修正

#### レビューで見つかり、修正したもの（3回目）

2回目で入れた `Modal` 化自体に、ロックが素通りになりうる抜けがあった。

1. **【高・実機で最優先に確認】記録用モーダルが開いていると `Modal` のロック画面が
   表示されない可能性**：RN の `Modal` は、配置された View を持つ ViewController から
   `presentViewController` を呼んで表示する。`AppLockProvider` の `Modal` は root の
   階層にあるため、表示元は root の ViewController になるが、`record`（`presentation:
   'modal'`）がネイティブモーダルとして表示中だと、その ViewController は既に別画面を
   表示中の状態にある。UIKit ではこの状態で2つ目の提示を試みても警告が出るだけで
   表示されない。結果、ロック画面が出ないままロック用モーダルは `visible: true` を
   保持し続け、下の `record` 画面はそのまま操作でき、閉じても再試行されない——
   前回の「モーダルがロック画面より上に残る」よりも保護が弱い状態だった。対策として、
   バックグラウンド復帰時に現在の pathname が `/record` であれば `router.dismiss()` で
   先に閉じてからロックするよう修正（`activity/[id]` 等、通常の push 画面は対象外——
   `record.tsx` には保持すべき下書き状態が無いことを確認したうえで、pathname を厳密に
   チェックして record 以外は触らないようにした）
2. **【低】自動 OFF のお知らせ（`Alert.alert`）が表示されない可能性**：
   `disableAppLockDueToNoEnrollment` 内の `Alert.alert` が、ロック `Modal` の非表示と
   ほぼ同時に呼ばれていた。iOS では画面の表示/非表示の遷移が重なると Alert が
   表示されないことがある。`Alert.alert` の呼び出しをその場から `pendingAlertRef` へ
   一旦退避し、`showingOverlay` が `true→false` に変わったことを検知する effect から
   呼ぶよう変更（Modal が実際に閉じてから通知するため、確実性が上がる）

#### レビューで見つかり、修正したもの（4回目）

3回目の2件とも、「表示/非表示の切り替えが完了するのを待たずに次の処理をしていた」
という同じ理由でまだ失敗しうる状態だった。

1. **【中〜高】モーダルを閉じる処理が完了する前にロック画面を表示しようとしていた**：
   `router.dismiss()` はネイティブの閉じるアニメーションを開始するだけで、完了を
   待たない。直後に `setLocked(true)` すると、`record` がまだ閉じている途中で
   ロック `Modal` の `presentViewController` が呼ばれ、3回目の#1と同じ理由（UIKit は
   遷移中の2つ目の提示を表示しない）で失敗しうる状態だった。`awaitingModalDismiss`
   状態を導入し、`pathname` が `/record` でなくなったことを effect で検知してから
   `setLocked(true)` するよう変更（3秒のタイムアウトを安全弁として追加——`dismiss()`
   が何らかの理由で解決しない場合に無期限に待ち続けないため）。待機中に Today 等の
   内容が一瞬見えることを避けるため、`children` を包む通常の `View` に
   `awaitingModalDismiss` 中も不透明な背景色を即座に重ねるようにした（ネイティブの
   提示を待たない、同一レンダー内での対処）
2. **【低】お知らせを出すタイミングが、まだ Modal が閉じ終わる前だった**：`showingOverlay`
   の変化を検知する effect は React が変更を反映した直後に動くが、ネイティブの Modal が
   実際に閉じ終わるのはその後になる。RN の `Modal` の `onDismiss`（iOS 限定、閉じ終わった
   後に呼ばれる）を使うよう変更。Android は `Modal` が ViewController の表示ではないため
   `onDismiss` を持たず、`showingOverlay` の effect のままで問題ない——`flushPendingAlert`
   は冪等なので両方から呼ばれても安全

#### Known gaps

- **実機での動作確認が未実施**：Phase 1/2 と同じ制約に加え、生体認証・端末パスコードの
  実機テストがそもそも必要（UI/UX §19 受け入れ条件「生体認証を無効にしている端末でも、
  端末パスコード等で解除できること」）。特に以下は実機でのみ最終確認できる：
  iOS Face ID ダイアログ・Android 端末パスコード画面と `AppState` の実際の遷移順序、
  **記録用モーダル（`app/record.tsx`）を開いたまま「Immediately」でロックし、
  ロック解除後に記録用モーダルを閉じる一連の流れ**、Android で `not_enrolled` が
  実際にどう返るか
- **画面マスク（Recent Apps でのマスク）は未実装**：基本設計 §18 で App Lock の次の
  sub-item として明示的に分けられているため、今回は含めていない。ロック画面自体は
  実装したが、OS の Recent Apps スイッチャーに表示されるスナップショットに直前の
  画面内容が写り込む可能性は、この機能が入るまで残る（`inactive` への対応もここに含む）
- **オンボーディング後の App Lock 案内は未実装**：UI/UX §6「Continue後、必要なら
  App Lock 設定を案内する」は今回のスコープに含めていない
- **Settings の他セクション**：Health Connect・Data（Export/Import/Delete）・
  Activity Details・Preferences・About は未着手（上記「スコープの判断」参照）
