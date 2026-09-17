# Solo + Us

> Your intimate life, over time.

Solo / Partnered な性的活動を長期間記録し、自分自身の変化を振り返るための Private Wellness アプリ。

評価しない・急かさない・端末内に留める。NoFap アプリでも Sex Diary でもなく、
**Personal Health Data の一種として淡々と記録し続けられること**を中心価値とする。

## ステータス

設計文書は **v0.11** で確定済み。**Phase 1**（暗号化 DB → Migration runner → スキーマ →
Repository → Quick Record → Undo → 履歴 → Export/Import の往復）はクローズ済み。
現在は **Phase 2**（Calendar）に着手中。詳細は下記「Phase 1 実装状況」「Phase 2 実装状況」を参照。

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
- **日時編集 UI**：過去日時への記録・編集（§12/§4.4）は未実装。ネイティブの日時ピッカーを追加する前に
  まず SQLCipher 配線を実機で確認したかったため、意図的に後回し
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

`phase1/foundation` ブランチで継続。基本設計 §18 の Phase 2 は「Calendar → 月次統計 →
Activity Detail（詳細項目）」だが、月次統計（Today の THIS MONTH 集計）と Activity Detail の
詳細項目編集（Orgasm/Ejaculation/Protection/Duration/Mood/Notes）は Phase 1 の時点で既に実装済み
だったため、Phase 2 で新規に着手したのは **Calendar 画面**（UI/UX §13）のみ。

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

月グリッドの各日はドット（色のみ）で活動件数を示すが、§3「Solo/Partnered の判別を色だけに依存
しない」というルールに対し、各セルに `accessibilityLabel`（例:「Sep 14, 1 solo」）を付与し、
タップすると同じ情報がラベル付きの一覧（`ActivityBadge`）として即座に表示されるため、色のみに
依存する情報伝達にはなっていないと判断した。

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

### Known gaps

- **実機での見た目の確認が未実施**：iOS は Xcode/Swift ツールチェーン問題（上記参照）でブロック中。
  Android はエミュレータ未セットアップ（AVD 未作成）で、かつこの Mac の空き容量が 6.4GB と、以前
  iOS シミュレータのダウンロードをブロックした容量不足と同水準。月グリッドのレイアウト・ドットの
  視認性・日別一覧のスクロール挙動は、いずれかのビルド経路が開通してから確認する
- **日時編集 UI**：§4.4/§11.4「過去日時への記録・編集」は引き続き未実装（Phase 1 の Known gaps を参照）。
  ネイティブの日時ピッカーもネイティブモジュールのため、同じ実機ビルド問題の影響を受けうる
