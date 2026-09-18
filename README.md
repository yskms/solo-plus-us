# Solo + Us

> Your intimate life, over time.

Solo / Partnered な性的活動を長期間記録し、自分自身の変化を振り返るための Private Wellness アプリ。

評価しない・急かさない・端末内に留める。NoFap アプリでも Sex Diary でもなく、
**Personal Health Data の一種として淡々と記録し続けられること**を中心価値とする。

## ステータス

設計文書は **v0.11** で確定済み。**Phase 1**（暗号化 DB → Migration runner → スキーマ →
Repository → Quick Record → Undo → 履歴 → Export/Import の往復）・**Phase 2**（Calendar）は
クローズ済み。**Phase 3**（Insights → App Lock → Recovery 画面 → Export/Import の UI →
画面マスク → 日時編集 UI。基本設計 §18 の元の順序から Export/Import の UI を画面マスク・
日時編集 UI より前に繰り上げ——Recovery の「バックアップから復元する」が、利用者が事前に
Export していなければ実際には使えないため）のうち Insights・App Lock・Recovery 画面・
Export/Import の UI・画面マスクはクローズ済み、**日時編集 UI は実装済み・実機ビルド未検証**
（`@react-native-community/datetimepicker` はネイティブモジュールのため、現在の開発ビルドに
組み込むには再ビルドが必要）。詳細は下記の各「実装状況」を参照。

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
- **日時編集 UI**：Phase 3 で実装済み（下記「Phase 3 実装状況」参照）
- **Settings 画面一式**：Activity Details カスタマイズ・Health Connect は未実装のまま
  （Phase 3/4 の残り）。App Lock・Data（Export/Import UI）は Phase 3 で実装済み（下記参照）
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
| `contexts/AppLock.tsx` | `AppLockProvider`：`AppState` でバックグラウンド/フォアグラウンド遷移を監視し、`appLock.enabled`/`timing`（Phase 1 で追加済みの設定）に従ってロック画面を表示。DB 暗号鍵の可読性とは完全に独立（§8.3）——ロック中も DB 接続自体は保持されたまま、UI の描画だけを止める。認証試行そのものもここに集約（`attemptUnlock`）し、端末に認証手段が無くなった場合は `appLock.enabled` を自動 OFF にする。ロック時に `Keyboard.dismiss()` を呼び、`isLocked()`（同期的な point-in-time チェック）を context 経由で公開（7回目参照） |
| `components/LockScreen.tsx` | ロック画面（ブランドマーク・🔒・「Unlock with device authentication」、失敗理由の表示）。認証試行自体は `AppLockProvider` 側が持ち、ここは表示専用 |
| `components/LoadErrorOverlay.tsx` | App Lock 設定の読み込みに失敗した場合のエラー表示 + 再試行 |
| `app/settings/index.tsx` | Settings 画面（App Lock 行のみ） |
| `app/settings/app-lock.tsx` | Use App Lock トグル、LOCK タイミング選択（Immediately/After 1 minute/After 5 minutes）。ON にする前に `getEnrolledLevelAsync()` で端末に認証手段が無い場合は拒否。OFF にする際も認証を要求 |
| `app/(tabs)/index.tsx` | Today の右上に ⚙ アイコンを追加（§7 モックアップ通り）、`/settings` への導線 |
| `app/_layout.tsx` | `AppLockProvider` を `RecordFeedbackProvider` の内側・`Stack` の外側に配線。ロック中も `children`（`Stack` 全体）はマウントしたまま、オーバーレイで覆う形（下記「レビューで見つかり、修正したもの」#3 参照）。`record` 画面は `presentation: 'modal'` を使わない（6回目参照） |
| `app/activity/[id].tsx` | 削除確認 `Alert` の「Delete」`onPress` の先頭で `isLocked()` を確認し、ロック中は何もしない（7回目参照。`Alert` はシステムダイアログでロック画面より上に表示されるため） |

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

#### レビューで見つかり、修正したもの（5回目）

4回目の3箇所とも、「完了した」と判断する合図が実際のネイティブの完了より早く、
方針は正しいが実装が伴っていなかった。

1. **【高】`pathname` はモーダルを閉じ始めた時点で変わるので、完了の合図にならない**：
   `pathname`（React Navigation の state 由来）は `router.dismiss()` の直後に更新される
   一方、ネイティブスタックは閉じるアニメーションの間 `record` を描画し続ける。そのため
   `pathname !== '/record'` は次の描画ですぐ成り立ち、`setLocked(true)` が閉じている
   途中で呼ばれてしまい、4回目の#1で直したはずの問題が実質的に残っていた。`pathname`
   ではなく `record.tsx` 自身のマウント/アンマウント（ネイティブスタックは閉じる
   アニメーションが終わってからアンマウントする）を合図にするよう変更。
   `registerRecordScreenMounted`/`Unmounted` を `AppLockProvider` から公開し、
   `record.tsx` が自身のマウント effect から呼ぶ形にした
2. **【中】「一瞬見える隙間」を塞ぐはずの背景色が、実際には中身を隠していなかった**：
   `children` を包む親 `View` に付けた背景色は子の後ろに描かれるため、中身はそのまま
   見えていた。`children` の後ろにある通常の `View`（兄弟要素、`absoluteFill`）を
   条件付きで重ねる形に変更（親の背景色ではなく、後から描画される兄弟要素にした）
3. **【中】iOS では effect が先に動き、`onDismiss` が空振りしていた**：
   `showingOverlay` が `false` になった直後に動く effect が、`onDismiss` より先に
   `flushPendingAlert()` を呼んでいた（`flushPendingAlert` は最初に呼ばれた方が
   お知らせを出す作りのため）。結果、iOS でも常に effect 側が先に呼ばれ、4回目で
   追加した `onDismiss` が実質使われていなかった。effect 側の呼び出しを
   `Platform.OS === 'android'` に限定し、iOS は `onDismiss` のみに一本化

3件とも「実機での確認でしか最終判断できない」種類の修正のため、
Known gaps の実機確認項目に含めたまま、この単独の指摘は実機確認が済むまで
未解決（要検証）として扱う。

#### レビューで見つかり、修正したもの（6回目）：根本原因ごと除去

5回目までの3ラウンドは、いずれも「ロック中も `record.tsx` のネイティブモーダルが
ロック画面より上に残る（or ロック画面自体が出ない）」問題に対し、"何らかの合図で
ネイティブの遷移完了を検知してから動く" という方針で対処してきた。ところが
`onDismiss`・`pathname`・`record.tsx` のマウント/アンマウントと、3ラウンド連続で
「この合図はネイティブの完了より後に来るはず」という前提に頼り、うち2回は前提が
外れていた（`pathname` は state 更新時点、`onDismiss` は effect に先を越されて
いた）。3回目の前提（マウント/アンマウントは閉じるアニメーション後）もコードの
読み合わせだけでは確認できず、同じ種類の見落としを繰り返すおそれが指摘された。

**対応**：合図を探すのをやめ、問題の原因（`record.tsx` が root とは別のネイティブ
階層に描画される `presentation: 'modal'` であること）自体を無くした。UI/UX §8 は
Add Activity の画面を「Bottom Sheet **または** Modal」と明記しており、ネイティブ
モーダルは必須ではない。`app/_layout.tsx` の `record` から `presentation: 'modal'`
を外し、他の画面と同じ既定の `card`（root と同じネイティブスタック内の push）に
変更した。これにより、

- `record` が root の外に別階層を持たなくなり、「表示中の画面があると2つ目を
  表示できない」という衝突自体が起きなくなる
- ロック画面側も `Modal` にする必要がなくなり、`children` の後ろに重ねる通常の
  `View`（絶対配置の兄弟要素）だけで確実に覆える
- `awaitingModalDismiss`・`registerRecordScreenMounted`/`Unmounted`・3秒の
  タイムアウト・`onDismiss` と Android 用 effect の使い分けが、すべて不要になった
  （`contexts/AppLock.tsx` から削除。`app/record.tsx` の mount/unmount 連携も削除）
- `Alert.alert` も、競合するネイティブ遷移が無くなったため、他の画面と同様
  その場で直接呼ぶ形に戻した（`pendingAlertRef` の退避が不要になった）
- Android のハードウェア戻るボタンは、`Modal` の `onRequestClose` が無くなった
  代わりに `BackHandler` でロック中は無視するよう追加した（新規に必要になった対応）

App Lock の実装の中で最も壊れやすく、実機でしか確かめようがなかった部分（ネイティブ
モーダルの遷移完了検知）をまるごと除去した形になる。記録画面はボタン2つだけの
シンプルな画面のため、見た目の変化はほぼ無い（スライドの方向が変わる程度）。

#### レビューで見つかり、修正したもの（7回目）

ネイティブのモーダルは無くなったが、同じく「root の外」に出るものが2つ残っていた。

1. **【低〜中】ロック中も、開いていた削除確認ダイアログを操作できる**：
   `Alert.alert` はシステムダイアログとして、アプリの画面より常に上に表示される
   （`record.tsx` の旧モーダルと同じ「root の外」の問題だが、RN には Alert を
   コードから閉じる API が無いため、閉じて回避する手段が無い）。Activity Detail で
   削除確認ダイアログ（`confirmDelete`）を開いたままバックグラウンドへ行き、戻って
   ロックがかかっても、ダイアログはロック画面の上に残ったまま「Delete」を押せる
   状態だった——認証なしで記録を削除できる経路。`AppLockProvider` に
   `isLocked()`（その場で読む同期的なチェック。`enabled && locked` を毎レンダー
   ミラーする ref 経由）を追加し、「Delete」の `onPress` の先頭で確認して
   ロック中なら何もしないよう修正。他の `Alert` は操作を伴わないお知らせのみのため、
   対象はこの削除確認だけ（`style: 'destructive'` を検索して確認）
2. **【低】ロックしてもキーボードが残り、見えない入力欄に入力できる**：
   Activity Detail でメモ入力中にロックがかかっても、キーボードは別のネイティブ
   レイヤーのため、ロック画面の上に残ったままフォーカスも外れず、見えないメモ欄に
   文字を打てる状態だった（予測変換候補に入力中の内容が表示される可能性もある）。
   `setLocked(true)` の箇所で `Keyboard.dismiss()` を呼ぶよう修正

これで App Lock のコード側で残る指摘は無く、あとは実機での確認項目のみになる。
あわせて、`isLockedRef` を `setLocked(true)` と同時に直接更新するよう1行追加した
（任意の補足対応。`useRef` は毎レンダー更新のため、`setLocked(true)` から次の描画
までのごく短い間だけ `isLocked()` が古い値を返しうる隙間があった。実害はほぼ無いが、
コストが小さいため対応した）。

#### Known gaps

- **実機での動作確認が未実施**（App Lock）：Phase 1/2 と同じ制約に加え、生体認証・
  端末パスコードの実機テストがそもそも必要。これまでのレビューで「コードの読み合わせ
  だけでは判断できない」とされた項目を確認する。

  | # | 確認する操作 | 期待する結果 |
  |---|---|---|
  | 1 | 生体認証を無効にした端末でロックを解除する（iOS / Android） | 端末のパスコードで解除できる（§24 の受け入れ基準） |
  | 2 | App Lock を ON にした後、端末のパスコードと生体認証をすべて外す | 自動で OFF になり、お知らせが表示される |
  | 3 | 「Immediately」で Face ID による解除（iOS） | 解除した直後に再ロックされない |
  | 4 | 「Immediately」で端末 PIN による解除（Android。PIN 入力は別の画面） | 解除した直後に再ロックされない |
  | 5 | 「Immediately」で App Lock を OFF にする（Android の PIN 入力） | 二重に認証を求められない |
  | 6 | 削除の確認ダイアログを開いたままロックし、「Delete」を押す | 削除されない |
  | 7 | メモを入力中にロックして、解除する | キーボードが閉じ、入力中の内容が残っている |
  | 8 | ロック中に Android の戻るボタンを押す | ロック画面が閉じない |
  | 9 | 記録画面を開いたままロックする | 他の画面と同じくロック画面で覆われる |
- **画面マスク（Recent Apps でのマスク）は未実装**：基本設計 §18 で App Lock の次の
  sub-item として明示的に分けられているため、今回は含めていない。ロック画面自体は
  実装したが、OS の Recent Apps スイッチャーに表示されるスナップショットに直前の
  画面内容が写り込む可能性は、この機能が入るまで残る（`inactive` への対応もここに含む）
- **オンボーディング後の App Lock 案内は未実装**：UI/UX §6「Continue後、必要なら
  App Lock 設定を案内する」は今回のスコープに含めていない
- **Settings の他セクション**：Health Connect・Data（Export/Import/Delete）・
  Activity Details・Preferences・About は未着手（上記「スコープの判断」参照）

### Recovery 画面

`phase3/recovery` ブランチ。基本設計 §18 の Phase 3 順序に従い、App Lock の次に着手。
「DB ファイルは存在するが暗号鍵が読み出せない」状態（端末移行・OS バックアップ復元等で
現実に起こりうる、§8.5）に対する専用画面と、§8.8 の Recovery bootstrap（通常の
Import フローとは独立した、9 ステップの安全な切り替え手順）を実装。

#### 実装済み

| 層 | 内容 |
|---|---|
| `database/connection.ts` | `getDbDirectory`/`getDbFile`/`getWalSiblings`/`deleteIfExists`/`getRecoveryOldFile`/`moveDbFileWithWalSiblings`/`deleteDbFileWithWalSiblings` を export（`RecoveryService` が直接ファイル操作するため）。`openAndMigrateFreshAt(fileName, key)` を追加——任意のファイル名で新規 DB を開き最新スキーマまで migrate する（既存データが無いため backup/restore 分岐は不要、Recovery の一時 DB 専用）。`looksLikeDecryptFailure` で「file is not a database」相当のエラーを検知し `DatabaseCorruptOrWrongKeyError` に変換。`recoverInterruptedRecoveryIfNeeded`（export）/`discardStaleRecoveryOldIfPresent`（内部）を `getDatabase()` の起動シーケンスに追加——`recoverInterruptedRestoreIfNeeded`（migration backup 用）と同じ場所で、Recovery bootstrap の中断も検知する（2回目のレビュー参照） |
| `database/key.ts` | `deleteStoredDatabaseKey` を追加（「削除してやり直す」経路専用） |
| `lib/errors.ts` | `RecoveryImportInvalidError`（バックアップファイルの検証失敗、per-field のエラー一覧を保持）、`RecoveryVerificationFailedError`（import 後の件数検証失敗）、`DatabaseCorruptOrWrongKeyError`（鍵はあるが復号できない場合、下記レビュー参照）を追加 |
| `services/RecoveryService.ts` | `restoreFromBackup`：§8.8 の9ステップ（①旧接続を閉じる→②新しい鍵+一時DB→③一時DBへimport→④閉じて開き直し件数確認→⑤旧DBを退避→⑥一時DBを正式な位置へ→⑦開き直して確認→⑧新しい鍵を確定→⑨旧DBを破棄）をそのまま実装。**8まで旧DB・旧鍵に一切触れない**——失敗時は常に旧DBが手つかずで残る。実行開始時に `recoverGenuineOldDbForRetry`（`dbFile` の存在に関係なく `recovery-old` を優先——`restoreFromBackup` 到達時は今の `dbFile` が必ず開けなかった後、という前提の上で安全。`connection.ts` の `getDatabase()` 起動パス専用の `recoverInterruptedRecoveryIfNeeded` とは別物、3回目のレビュー参照）を呼び、前回の中断/失敗から復帰してから始める。`markPrivacyIntroSeen` は手順③の一時DBに対して呼ぶ（2回目のレビュー参照）。`resetAndStartOver`：DBファイル削除のみで次回起動時に新規鍵が生成される（`getOrCreateDatabaseKey` の既存ロジックによる） |
| `components/RecoveryScreen.tsx` | UI/UX §21 のモックアップ通り。「バックアップから復元する」（`expo-document-picker` でJSONを選択）/「データを削除してやり直す」（確認ステップを挟む）に加え「Try again」（下記レビュー参照） |
| `contexts/DatabaseContext.tsx` | `DatabaseKeyUnavailableError`/`DatabaseCorruptOrWrongKeyError` の場合に `RecoveryScreen` を表示するよう分岐（他のエラー種別は従来通りの簡易フォールバック）。`AppLockProvider` より前段（`children` の外）で表示されるため、§21「App Lock を経ずに到達する」を自然に満たす。開くロジックを `attemptOpen` として切り出し、Recovery 成功後に呼び直せるようにした |
| `app.json` | `expo-document-picker` を plugins に追加（`expo config --json` で解決を確認。実際の効果は `ios.usesIcloudStorage` 未設定のため現状 no-op だが、素のまま prebuild すると警告が出るため登録） |

#### レビューで見つかり、修正したもの

§8.8 の中心にある保証「将来復号できる可能性がある限り、旧 DB をこちらから消さない」が、
1回の実行の中でしか成り立っておらず、再試行を挟むと破られる経路が2つあった（優先度：高）。

1. **【高】手順6〜8の間で失敗・中断してから再試行すると、保存しておいた旧DBを削除して
   しまう**：手順7の検証に失敗した場合や、手順6〜8の間でアプリが強制終了された場合、
   `dbFile` の位置には鍵未確定の新しいDBが、`recovery-old` には本物の旧DBが残る。この
   状態で再度「Restore from a backup」を選ぶと、手順5の `deleteIfExists(oldAsideFile)`
   が本物の旧DBを削除し、代わりに鍵の無い新しいDBを退避させてしまっていた——「手順8まで
   旧DBに触れない」という保証は1回の実行内でしか成立していなかった。`restoreFromBackup`
   の先頭で `recoverGenuineOldDbIfNeeded` を呼び、`recovery-old` が既に存在する場合は
   それを本物の旧DBとして `dbFile` の位置へ戻してから開始するよう修正
2. **【高】旧DBを退避するとき、-wal/-shm を削除していた**：`journal_mode=WAL` では、
   確定済みでもまだ本体に書き戻されていないデータが `-wal` 側に残りうる（Phase 1 の
   §7.2 と同じ性質）。これを消すと保存した旧DBが不完全なコピーになる。加えて、
   `File#moveSync` が呼び出したインスタンス自身の `uri` を移動先へ更新するため、
   移動後に `getWalSiblings(dbFile)` を呼ぶと移動後のパスに対する（存在しない）
   sibling を計算してしまい、実質的に何も処理されない状態だった。`moveDbFileWithWalSiblings`
   を用意し、移動前に source/destination 両方の sibling パスを確定させてから、
   本体と `-wal`/`-shm` をまとめて移動するよう修正
3. **【中】一時的に鍵を読めなかっただけの場合でも、削除か置き換えしか選べない**：
   `DatabaseKeyUnavailableError` は「鍵が本当に無くなった」場合だけでなく、
   `getOrCreateDatabaseKey` 側で想定していた「SecureStore がその瞬間だけ null を
   返した」一時的な失敗でも発生しうる。選択肢に「Try again」（`onRecovered` を
   そのまま呼ぶ）を、2つの破壊的な選択肢より前に追加
4. **【中】鍵はあるのに復号できない場合、Recovery 画面に進めない**：Recovery 画面を
   表示するのは `DatabaseKeyUnavailableError` の場合のみだったため、鍵は読めるが
   ファイル破損等で復号できない場合（SQLite の「file is not a database」相当の
   エラー）は通常のエラー画面のままだった。§8.5 の「復号できない」はこの場合も含む。
   `connection.ts` に `looksLikeDecryptFailure`（エラーメッセージのヒューリスティック
   検知、実機未検証）を追加し `DatabaseCorruptOrWrongKeyError` としてラップ、
   `DatabaseContext` 側でも `RecoveryScreen` へ分岐するよう修正

低優先度の2件も修正：復元後に `markPrivacyIntroSeen` を呼び、Privacy Introduction が
再表示されないようにした。`describeError` を、`RecoveryImportInvalidError`/
`RecoveryVerificationFailedError`（いずれも作成者側で制御された文言）以外は
定型文にするよう変更（生のファイルパスや SQL を含みうる `error.message` をそのまま
表示しないため）。

#### レビューで見つかり、修正したもの（2回目）

1回目の修正は「Recovery を再度実行したとき」の再試行だけを直しており、**通常の
起動**（Recovery を経由しない、普段のアプリ起動）が `recovery-old` の存在を
考慮していなかったため、Phase 1 で一度塞いだ「空の DB に見える」問題が
Recovery 側で再発する経路が残っていた。

1. **【高】手順5〜6の間で中断すると、次回の起動で空のDBが作られ、後で書いた記録が
   消える**：手順5（旧DBを `recovery-old` へ退避）の直後、手順6（一時DBを正式な
   位置へ移動）の前でアプリが強制終了されると、`dbFile` が存在せず `recovery-old`
   だけが残る。この状態で（Recovery を経由せず）普通に再起動すると、
   `getDatabase()` は `recovery-old` の存在を知らないため `dbFile` が無いことを
   単純に「初回起動」と解釈し、新しい鍵で空の DB を作ってしまう——記録が全て
   消えたように見え、さらにそこへ新しく記録を書いた後で Recovery を再実行すると、
   `recovery-old` を本物とみなすロジックがその新しい DB を「失敗した試行の残骸」
   として削除してしまう（2件目の指摘と合わせて2重の損失）
2. **【中】手順8〜9の間で中断すると、古い `recovery-old` が残り続け、次回の
   Recovery が正常なDBを消してしまう**：手順8（新しい鍵の確定）の後、手順9
   （旧DBの破棄）の前で中断すると、`dbFile` は既に正しい新しいDB・鍵で問題なく
   開けるが、`recovery-old` は削除されずに残る。この状態のまま何ヶ月も普通に
   使われた後、別の理由で Recovery が再度発生すると、1回目の修正で追加した
   「`recovery-old` があれば本物として復元する」ロジックが、**実際には使われ続けて
   いる正常な現在のDBを、古い `recovery-old` で上書きして壊してしまう**

1・2はどちらも `database/connection.ts` の `recoverInterruptedRestoreIfNeeded`
（migration backup 用）と同じ場所——`getDatabase()` が鍵の有無を確認する前——に
`recovery-old` の状態確認を追加することでまとめて解決できる、との指摘を受けて
対応：
`recoverInterruptedRecoveryIfNeeded`（`dbFile` が存在せず `recovery-old` が
存在する場合、鍵の判定より前に `recovery-old` を `dbFile` の位置へ戻す——手順5を
巻き戻すことで手順7の検証がやり直され、Recovery 画面が正しい状態から再表示される）
と `discardStaleRecoveryOldIfPresent`（`getDatabase()` が実際に DB を開けた
**成功時のみ**、残っている `recovery-old` は完了済み Recovery の後始末忘れだと
確定できるため削除する）を `connection.ts` に追加し、`getDatabase()` の起動
シーケンスに組み込んだ。`RecoveryService.ts` 側の `recoverGenuineOldDbIfNeeded`
（`dbFile` の存在に関係なく常に `recovery-old` を優先する実装だった）は、この
`recoverInterruptedRecoveryIfNeeded` を import して使う形に統合——「`dbFile` が
存在する場合は触らない」という narrower な前提に揃えたことで、指摘2のシナリオ
（`dbFile` が正常な現在のDB）でも誤って上書きしなくなった

3. **【低〜中】復元が完了した後にオンボーディングの記録で失敗すると、「復元でき
   なかった」と表示される**：`markPrivacyIntroSeen(finalDb)` が手順9より後
   （全9ステップ完了後）に呼ばれていたため、これが失敗すると実際には復元が完全に
   成功していても `restoreFromBackup` 全体が例外を投げ、UI には失敗として表示
   されてしまう。加えてその場合 `finalDb` が閉じられないまま残っていた。
   `markPrivacyIntroSeen` の呼び出しを手順③（一時DBへの import 直後、まだ
   `tempDb` が開いている間）へ移動——既存の try/catch（失敗時は一時ファイルを
   破棄してやり直すだけで安全）にそのまま乗る形にした。`finalDb` は手順7の検証
   直後に成功・失敗どちらの経路でも必ず閉じるよう修正

いずれもネイティブのファイル操作（`File#moveSync`/`delete`）を伴うため、Jest では
検証できない。実機での確認項目に「手順5〜6の間でアプリを強制終了し、（Recovery を
経由せず）普通に再起動する」「手順8〜9の間でアプリを強制終了し、普通に再起動する」
を追加した（下記 Known gaps 参照）。

#### レビューで見つかり、修正したもの（3回目）

2回目の修正で `RecoveryService.ts` 側の再試行チェックを `connection.ts` の
`recoverInterruptedRecoveryIfNeeded`（「`dbFile` があれば何もしない」という narrower
な前提）に統合したことで、1回目のレビューで直したはずの経路が退行していた。

- **【高】手順7で失敗した後に復元をやり直すと、必ず失敗し、旧DBを削除する選択肢しか
  残らない**：手順7の検証失敗はアプリの中断ではなく通常の失敗経路だが、その時点では
  `dbFile` に鍵未確定の新しいDBが、`recovery-old` に本物の旧DBが残る——`dbFile` が
  存在するケースであり、統合後の `recoverInterruptedRecoveryIfNeeded` は何もしない。
  再試行の手順5で `moveDbFileWithWalSiblings` が既に埋まっている
  移動先（`recovery-old`）へ移動しようとして例外になり、以後何度やり直しても同じ
  ところで失敗し続け、「Delete and start over」（本物の旧DBごと削除）しか選べなく
  なっていた

指摘を受けて、3箇所の役割を明確に分離：

| 呼び出す場所 | `recovery-old` があるときの処理 |
|---|---|
| `getDatabase`（鍵の判定の前） | `dbFile` が無ければ戻す（手順5〜6の中断） |
| `getDatabase`（正常に開けた後） | 古いものとして削除（手順8〜9の中断） |
| `restoreFromBackup` の最初 | `dbFile` があっても、それを削除して `recovery-old` を戻す（手順6〜8の中断、手順7の通常の失敗） |

`restoreFromBackup` に到達するのは今の `dbFile` を開けなかったときだけであり、かつ
`recovery-old` が残っているならそれは `discardStaleRecoveryOldIfPresent`（正常に
開けた時点で削除される）をすり抜けていない、つまり必ず本物の旧DB——という2点から、
`dbFile` の存在有無に関係なく常に `recovery-old` を優先して良いと判断できる。
`services/RecoveryService.ts` に `recoverGenuineOldDbForRetry`（`dbFile` を無条件に
削除してから `recovery-old` を戻す）を復活させ、`restoreFromBackup` の先頭で
これを呼ぶよう変更。`connection.ts` 側の `recoverInterruptedRecoveryIfNeeded` は
`getDatabase()` 専用のまま変更していない（`dbFile` が存在する場合に無条件で
破棄するのは、まだ開いていないだけの正常なDBを壊しうるため、起動パスでは安全ではない）。

これでこの回避不能だった行き止まりは解消。実機での確認項目に「手順7で失敗させた後、
すぐにもう一度復元する」を追加した。

3回目のレビューで、上記の経路はすべて正しく直っていることが確認された
（手順5の本体のみ移動した瞬間の中断、手順6〜8の間の中断、手順8自体での例外も
含め、`recoverInterruptedRecoveryIfNeeded`/`discardStaleRecoveryOldIfPresent`/
`recoverGenuineOldDbForRetry` の3者で状態がすべて戻ることを個別に追い直して
確認済み）。加えて任意の補足として、**手順9（`deleteDbFileWithWalSiblings(oldAsideFile)`）
が例外を投げると、手順8まで完全に成功しているのに「Could not restore backup」と
表示されてしまう**点を指摘され、対応：手順9を try/catch で囲み、失敗しても
ログのみでそのまま復元成功として返すよう修正した——残った `recovery-old` は
次回 DB を正常に開いた時点で `discardStaleRecoveryOldIfPresent` が削除するため、
安全に握りつぶせる。

#### テスト

`RecoveryService.ts`/`RecoveryScreen.tsx` は op-sqlite・expo-file-system・expo-document-picker
（すべてネイティブ）に依存するため Jest では検証できない——`connection.ts` と同じ制約。
9ステップの分岐が単純な順次処理（複雑な条件分岐を持つ純粋関数として切り出せる部分が無い）
なため、今回は純粋関数の抽出はしていない。既存の `services/importValidation.ts`
（バックアップ JSON の検証）・`services/ImportService.ts`（`performReplaceImport`）は
Phase 1 で実装・テスト済みのものをそのまま再利用しており、そちらのテストは引き続き有効。

#### Known gaps

- **実機での動作確認が未実施**：§8.8 の9ステップ全体（特に④⑦の件数検証、⑤⑥のファイル
  移動、`-wal`/`-shm` を含めた移動）は実機でしか確認できない。`expo-document-picker`
  での JSON 選択・読み込みも同様。特に以下を優先して確認する：
  - **手順5〜6の間でアプリを強制終了し、（Recovery を経由せず）普通に再起動する**
    （`recoverInterruptedRecoveryIfNeeded` が `recovery-old` を `dbFile` の位置へ
    戻し、Recovery 画面が再表示されること。空の DB が作られないこと）
  - **手順8〜9の間でアプリを強制終了し、普通に再起動する**（`dbFile` が正常に開け、
    `discardStaleRecoveryOldIfPresent` が残っている `recovery-old` を削除すること）
  - **手順7の直前でアプリを強制終了し、再び Recovery を実行する**
    （`recoverGenuineOldDbForRetry` が正しく本物の旧DBを `dbFile` の位置へ戻すこと）
  - **手順7で（アプリの中断ではなく）検証失敗させた後、すぐにもう一度復元する**
    （3回目のレビューで見つかった経路。`recoverGenuineOldDbForRetry` が、鍵未確定の
    新しいDBを破棄して本物の旧DBを正しく `dbFile` の位置へ戻すこと）
- **`looksLikeDecryptFailure` のヒューリスティックは未検証**：op-sqlite/SQLCipher が
  鍵不一致・ファイル破損時に実際にどんなメッセージを出すかは実機でしか確認できない。
  「not a database」に一致しない場合、`DatabaseCorruptOrWrongKeyError` に変換されず
  通常のエラー画面のままになる
- **セーフティ Export の例外は未実装**：§8.8「Recovery 時はセーフティ Export を実施
  できない（元 DB を復号できないため）」の例外自体は該当しない（Recovery はそもそも
  セーフティ Export を呼び出さない）ため対応不要だが、§13.3 の通常の破壊的操作前
  セーフティ Export 自体がまだ実装されていない（Export/Import の UI は未着手の
  sub-item）
- **同一実行内での自動ロールバックは無い**：④（一時DB検証）より後、⑦（正式DB検証）で
  失敗した場合、旧DBは `oldAsideFile` に手つかずで残る。**次回の Recovery 再試行
  （`restoreFromBackup` の先頭の `recoverGenuineOldDbForRetry`）または、⑤〜⑥の間の
  中断に限っては次回の起動（`getDatabase()` の `recoverInterruptedRecoveryIfNeeded`）
  でも自動的に旧DBを正しい位置へ戻す**ため再試行は安全だが、同じ実行の中で即座に
  戻す処理や、UI からの「元に戻す」導線は無い

### Export/Import の UI

`phase3/export-import` ブランチ。基本設計 §18 の元の Phase 3 順序は Recovery 画面の次が
画面マスクだが、Recovery の「バックアップから復元する」は利用者が事前に Export していな
ければ実際には使えず、D-07（OS バックアップから DB ディレクトリを除外している以上、
Export が唯一の正式な復旧手段）とも合わせ、Export/Import の UI を画面マスク・日時編集
UI より先に繰り上げて着手（上記「Recovery 画面」の指摘・レビューで確認）。§12（Export）・
§13（Import/strict restore）に対応。「Delete Data」（§10.6、UI/UX §17 の DATA セクション
3行目）は基本設計 §18 の Phase 3 に明記された項目ではないため、今回のスコープには含めて
いない（下記 Known gaps 参照）。

#### 実装済み

| 層 | 内容 |
|---|---|
| `services/ExportService.ts` | 既存の `buildExportPayload`/`serializeExportFile`（JSON、Phase 1 実装済み）に加え `serializeExportCsv` を追加（§12.3）。列は `id,context,occurredLocalDate,occurredLocalTime,occurredAtUtc,timezoneOffsetMinutes,timezoneId,orgasm,ejaculation,protectionUsed,durationSeconds,moodBefore,moodAfter,note` の順で固定。CSV は復元対象外（§12.1）のため `syncVersion`/`createdAt`/`updatedAt` は含めない。カンマ・ダブルクォート・改行を含む値は RFC 4180 準拠でクォート |
| `services/ImportService.ts` | 既存の `performReplaceImport`（置換復元、Phase 1 実装済み）に加え `performAppendImport` を追加（§13.3「追加のみ」）。`id` が未存在の Activity だけを挿入し、既存行・設定には一切触れない（`settings` は完全に無視——置換復元と違い「追加のみモードでは無視する」という§13.3の規定どおり） |
| `services/SafetyExportService.ts`（新規） | §13.3 の「置換復元の手順 1」——置換の前に必ず検証済みバックアップを作る。Android は `expo-file-system/legacy` の `StorageAccessFramework`（ユーザーに保存先を選ばせ、書き込み後に読み直して件数を検証）。iOS には SAF 相当の標準 API が無いため（`StorageAccessFramework` は型定義上 Android 専用と明記）、アプリの `Paths.document` 直下に検証付きで書き込む（`database/connection.ts` の `getDbDirectory()` とは別の場所——DB はそこから意図的に除外されている。Documents は現状 iCloud/iTunes バックアップに含まれる。将来 iOS 側の DB バックアップ除外が実装されたとき、除外範囲が Documents 全体に広がらないことが前提——詳細はファイル内コメント参照）。検証（書き込んだ件数の読み直し確認）に失敗、またはユーザーが保存先選択をキャンセルした場合は `SafetyExportFailedError` を投げ、呼び出し側は置換を開始しない |
| `services/ExportSharingService.ts`（新規） | 通常の Export（§12.4、共有シート——保存先の検証は不要）。`Paths.cache` に一時ファイルを書き、`expo-sharing` で共有し、共有後に削除する |
| `lib/errors.ts` | `SafetyExportFailedError` を追加 |
| `app/settings/data.tsx`（新規） | UI/UX §20 Screen 10（Export：JSON/CSV ボタン）＋ §13.3 の Import フロー（`ImportPreview`/`DestructiveConfirm` 相当、モックアップには無いが §25 のコンポーネント一覧と件数プレビューの文言例から実装）。ステップは `menu → modeChoice → confirmReplace/busy`——`RecoveryScreen.tsx` と同じ、ステップ状態を1ファイルで持つ構成。「追加のみ」はセーフティ Export 不要（非破壊的なため）で直接実行、「すべて置換」は確認画面を挟んでからセーフティ Export → 置換の順で実行。Import 完了後は `useDataRevision().bump()` を呼び、他画面（Today/Calendar 等）に変更を伝える |
| `app/settings/index.tsx`/`app/_layout.tsx` | DATA セクションに「Export & Import」の1行を追加（UI/UX §17 の Export/Import/Delete の3行ではなく1行——Delete が無いため）。ルートタイトルは "Data" |

#### レビューで見つかり、修正したもの

セーフティ Export・CSV・置換復元の正しさ自体は確認された。「利用者に事実を伝える」
部分の抜けが優先度：中で2件見つかった。

1. **【中】セーフティ Export の保存先が利用者に伝わらない（iOS でより重要）**：
   `performSafetyExport` が返す `location` を呼び出し側が捨てており、完了後の通知にも
   失敗時の通知にも保存先が出ていなかった。Android はユーザー自身が選んだ場所なので
   まだ探せるが、iOS はそもそも選べない（Documents 直下に自動で書く）ため、平文の
   JSON がどこにできたのか画面上で確認する手段が一つも無かった。§13.3 が求めるのは
   「あることを確認できるバックアップ」であり、位置を伝えない実装ではこの目的を
   満たさない。確認画面（`confirmReplace`）に事前の通知、完了後・失敗時の通知にも
   同じ事実を追加した。あわせて、iOS の代替実装が iCloud/iTunes バックアップへ平文
   コピーを上げてしまう点（D-07 の脅威モデルとの緊張関係）も画面上で明示するよう
   にした。設計上の逸脱でもあるため、設計判断記録 D-27 に追記として残した
2. **【中】Export 画面に「共有先では平文になる」旨の明示がない（§12.4）**：EXPORT
   セクションの説明文に、書き出したファイルが暗号化されていない旨の一文を追加した

優先度：低の指摘も併せて対応：
- **CSV の数式インジェクション**：`note` が `=`/`+`/`-`/`@` で始まると Excel/Sheets が
  数式として解釈しうる（OWASP CSV injection）。`csvField` で先頭に `'` を付けて無害化
- **UTF-8 BOM**：Excel で日本語の note が文字化けしないよう、CSV 共有時のみ（
  `serializeExportCsv` 自体の戻り値には含めない）`﻿` を先頭に付与
- **セーフティ Export ファイル名を固定 → タイムスタンプ付きに変更**：iOS は固定名だと
  前回のコピーを上書きし、Android は SAF が自動リネームするため、プラットフォーム間で
  挙動が揃っていなかった。両方ともタイムスタンプ付きファイル名にし、履歴が残るように
  した（削除する導線は無いままだが、上書きで唯一のセーフティコピーを失うよりは安全）
- **Import のファイル選択の絞り込みを緩和**：`type: 'application/json'` だと提供元に
  よっては `.json` が `application/octet-stream` 扱いになり選べないことがあるため、
  `type: '*/*'` に変更（検証は `validateExportFile` が確実に行う）

優先度：低のうち対応しなかったもの（設計判断記録へ記録のみ）：
- **§13.3 の手順順序からの逸脱**：設計は「セーフティ Export → 検証 → プレビュー」だが、
  実装は「検証 → プレビュー → 確認 →（置換選択時のみ）セーフティ Export」。無効な
  ファイルや「追加のみ」選択のために保存先選択を求めずに済むため、この順序の方が
  妥当と判断し、その理由を設計判断記録 D-27 に追記した
- **Import 後の Health Connect 再同期（§13.6/D-34）は Phase 4 の項目**（下記 Known gaps
  に明記）

#### レビューで見つかり、修正したもの（2回目）

前回の修正内容（保存先の通知・平文の明示・タイムスタンプ化・ファイル選択の緩和）は
いずれも意図どおりと確認された。CSV の数式インジェクション対策自体に副作用が
見つかった。

1. **【中】`timezoneOffsetMinutes` が負の値のとき CSV の数値が壊れる**：数式
   インジェクション対策（先頭が `=+-@` なら `'` を付与）を全列に一律適用していたが、
   「他の列がこれらの文字で始まることはない」という前提が誤りだった——
   `timezoneOffsetMinutes` は UTC より西側のタイムゾーンで負の値になる（ロサンゼルス
   は -480 など）。`String(-480)` は `"-480"` で先頭が `-` に一致するため、CSV には
   `'-480` と出力され、表計算では数値ではなく文字列として扱われてしまい、§12.3 の
   目的（表計算での分析）がこの列で成立しなくなっていた。テストが UTC 実行のため
   オフセット 0 でこの経路を通っておらず、見落としていた。`csvField` を
   `typeof value === 'string'` の場合のみ対策を適用するよう修正——数値列
   （`timezoneOffsetMinutes` 等）は対象外になり、`note` を含む文字列列は従来どおり
   保護される。負のオフセット（`America/Los_Angeles`、冬時間で -480）のケースを
   テストに追加

任意の補足も対応：CSV 共有時に付与する UTF-8 BOM が、テンプレート文字列の先頭に
U+FEFF の実文字として直接埋め込まれていた（エディタ・差分では見えない）。
`String.fromCharCode(0xfeff)` から組み立てる形に変更し、意図が読み取れるようにした。

#### テスト

`services/ExportService.ts` の `serializeExportCsv`（純粋関数）と `services/ImportService.ts` の
`performAppendImport` は既存の `test/__tests__/exportImport.integration.test.ts`（better-sqlite3
統合テスト）に追加：追加のみモードが既存行・設定に触れないこと、同じファイルの2回目の
Import が全件スキップされること、CSV のヘッダー順序とエスケープ（カンマ・クォート・改行）
を検証。`services/SafetyExportService.ts`・`services/ExportSharingService.ts`・
`app/settings/data.tsx` は op-sqlite 以外にも expo-file-system（`/legacy` の
StorageAccessFramework 含む）・expo-sharing・expo-document-picker に依存するため Jest では
検証できない——`RecoveryService.ts` と同じ制約。

#### Known gaps

- **実機での動作確認が未実施**：特に以下を優先して確認する：
  - **Android のセーフティ Export**：`StorageAccessFramework.requestDirectoryPermissionsAsync`
    でのディレクトリ選択、`createFileAsync`/`writeAsStringAsync`/`readAsStringAsync` の実際の
    挙動（ファイル名の拡張子付与、既存ファイルとの衝突時の挙動など）
  - **iOS のセーフティ Export**：`Paths.document` への `File#write`/`text()` の実際の挙動
    （`write()` が明示的な `create()` なしで新規ファイルを作成できるかを含む、未検証）
  - **共有シート**：JSON/CSV の共有・保存が両 OS で正しい MIME type/UTI で認識されること
  - Import のファイル選択（`expo-document-picker`、JSON の読み込み）も同様
- **iOS の DB バックアップ除外が未実装な間の一時的な整合**：セーフティ Export を
  `Paths.document` 直下に書く設計は、「DB は除外・Documents の他の場所は除外されない」
  という前提に依存する。§8.6 の iOS 側実装（`NSURLIsExcludedFromBackupKey`）が実装され、
  かつその除外範囲が Documents 全体に広がった場合、この安全性の前提が崩れる——実装時に
  `services/SafetyExportService.ts` を再確認する必要がある
- **Delete Data（§10.6）は未実装**：UI/UX §17 の DATA セクションの3行目。基本設計 §18 の
  Phase 3 に明記された項目ではないため今回のスコープに含めていない
- **Export schema の Migration（§13.2）は未実装**：現行 export version が 1 のみで、
  古いバージョンが存在しないため。v2 を出す時点で `migrateExportV1ToV2` 等を追加する必要
  がある（`services/importValidation.ts` は現状 `version !== CURRENT_EXPORT_VERSION` を
  一律拒否している）
- **セーフティ Export 失敗時のリトライ導線が無い**：セーフティ Export が失敗すると
  `menu` ステップへ戻るのみで、同じ確認画面へワンタップで戻る導線は無い（Cancel から
  やり直す形になる）
- **セーフティ Export ファイルを削除する導線が無い**：タイムスタンプ付きで毎回新しい
  ファイルとして残るため（上記レビュー参照）、Delete Data（未実装）が無い現状では
  蓄積し続ける。iOS は Files アプリにも公開していない（`UIFileSharingEnabled` 未設定）
  ため、アプリ内から削除する仕組みが無い限り利用者自身も消せない
- **Import 後の Health Connect 再同期は未実装**（§13.6/D-34「recreate」）：Phase 4 の
  項目なので今は問題ないが、置換復元は `health_sync` の対応関係を全削除するため、
  Phase 4 で Health Connect を実装する際に必ず対応が必要になる箇所として残しておく
- **暗号化された Export（パスフレーズ付き）は v1.1 で検討**（§12.4 に明記、既知の対象外）

### 画面マスク

`phase3/screen-mask` ブランチ。基本設計 §18 の Phase 3 順序に従い、Export/Import の UI の次に
着手。要件定義書 §21 Discreet Mode「Recent Apps 画面のマスク」（v1.0 必須、●）。App Lock の
レビュー時に「`inactive` は画面マスクの担当」と切り分けていた項目（`contexts/AppLock.tsx` の
AppState リスナーのコメント参照）。

**常時オン、設定不可、スクリーンショットも iOS で意図的にブロック**（設計判断記録 D-47、
画面マスク実装時に追記）：App Lock 自体の enabled/disabled のような端末所有者の好みの設定
ではなく、§8 の DB 暗号化・§8.6 のバックアップ除外と同じ、判断の余地のない OS レベルの
露出対策として扱う。UI/UX §17 のモックアップにある「Hide App Preview >」の行は、App Lock の
「UNLOCK WITH」行と同じ「情報のみ、トグルではない」扱いにした。

#### 実装済み

| 層 | 内容 |
|---|---|
| `expo-screen-capture`（新規依存） | `preventScreenCaptureAsync()`（両 OS）でスクリーンショット・画面収録をブロック。Android は**これ単体で** Recent Apps のサムネイルも空白化される（`FLAG_SECURE`）。`enableAppSwitcherProtectionAsync(0.99)`（iOS のみ、ぼかし強度は既定の 0.5 でも最大の 1.0 でもなく `0.99`——2回目のレビュー参照）で App Switcher・バックグラウンド・割り込み時のぼかしオーバーレイをネイティブ側に任せる。`app.plugin.js` を持たないため `app.json` の `plugins` への追加は不要（`expo config --json` で確認済み） |
| `plugins/withoutScreenCaptureDetectionPermissions.js`（新規） | `expo-screen-capture` が autolinking で持ち込む、使っていないスクリーンショット「検知」機能専用の Android パーミッション（`READ_EXTERNAL_STORAGE`/`READ_MEDIA_IMAGES`/`DETECT_SCREEN_CAPTURE`）を `tools:node="remove"` で除去する（2回目のレビュー参照）。`expo prebuild --platform android` を実際に実行し、生成された `android/app/src/main/AndroidManifest.xml` に `tools:node="remove"` の3エントリが正しく出力されることを確認済み——ただし Gradle のマニフェストマージ後の最終結果（実際に除去されるか）は実機ビルドでしか確認できない |
| `lib/screenMask.ts`（新規） | `attemptScreenMask()`：`isAvailableAsync()` → `preventScreenCaptureAsync()` →（iOS のみ）`enableAppSwitcherProtectionAsync(0.99)` の順で試み、実際に確認できた結果（成功／失敗とその理由）を返す。**自前でメモ化する**（2回目のレビューで発見した理由により必須——下記参照）。`useScreenMask(ready)` はこれを `app/_layout.tsx` の `RootLayout` で `loaded` を待ってから呼ぶ（`DatabaseProvider`/`AppLockProvider` より外側だが、フォント読み込み完了・スプラッシュ非表示直前まで遅らせる——下記レビュー参照）。Android に限り `AppState` が `active` に戻るたびに新しい key で `preventScreenCaptureAsync` を再呼び出しする（Activity 再生成対策、下記レビュー参照） |
| `app/settings/hide-app-preview.tsx`（新規） | `attemptScreenMask()`（メモ化済みのため安全に呼べる）を呼び、実際に確認できた結果だけを表示する。「常時オン」を伝える情報のみの画面（`app-lock.tsx` の「UNLOCK WITH」行と同じパターン）だが、確認していない事実を断言はしない |
| `app/settings/index.tsx`/`app/_layout.tsx` | PRIVACY セクションに「Hide App Preview」の行を追加。`SettingsGroup` コンポーネントに切り出し、区切り線は `index > 0` から導出する（呼び出し側が `divider` を渡し忘れて区切り線が抜ける、という回帰を防ぐ——2回目のレビュー参照） |

#### レビューで見つかり、修正したもの（1回目）

1. **【中】保護が有効になっていなくても、画面は「常時オン」と断言していた**：
   `useScreenMask` は失敗をログに出すだけで結果をどこにも持たず、`hide-app-preview.tsx`
   は確認していない事実を断言していた。`isAvailableAsync()` が false の端末、iOS の
   バージョンによる制限（型定義の注記どおり、12 未満は画面収録のみ・13 未満は
   スクリーンショットがブロックされない）、`preventScreenCaptureAsync`/
   `enableAppSwitcherProtectionAsync` 自体の reject など、実際に失敗しうる経路が
   複数あった。`attemptScreenMask()` として結果を返す関数に切り出し、設定画面は
   これを呼んで結果を表示するよう修正——失敗時は「この端末では有効にできませんでした」
   と理由付きで伝える
2. **【低〜中】ぼかしの強さが既定の 0.5 のままだった**：隠したいのは "THIS MONTH 12" や
   "Sep 14 Solo" のような短い文字列で、中程度のぼかしでは判読できる可能性がある。
   （その後2回目のレビューで `1.0` 自体にも問題があると判明——下記参照）
3. **【低】常時オン・トグル無しの判断と、iOS でのスクリーンショットブロックの判断が
   設計判断記録に無かった**：前者は要件定義書の「実装する」「●」を根拠にした判断、
   後者は要件定義書 §21 が求めているのは Recent Apps マスクのみで、スクリーンショット
   ブロック自体はどの設計文書にも記載が無く、しかも iOS では
   `enableAppSwitcherProtectionAsync()` だけでマスクが成立する（`preventScreenCaptureAsync()`
   を呼ばなければスクリーンショットは撮れる）ため、Android と違って「分離できない
   副作用」ではなく**独立した選択**だった。両方を設計判断記録 D-47 に追記した
4. CLAUDE.md をコミット（レビューとは別件、ユーザーからの指示）

#### レビューで見つかり、修正したもの（2回目）

`node_modules/expo-screen-capture` の JS・ネイティブ実装（Kotlin/Swift）まで直接確認した
レビュー。1回目の修正で導入した「設定画面から `attemptScreenMask()` を再度呼んで確認する」
という設計自体が、SDK の実装により成立していなかった。

1. **【高】新規依存により Android マニフェストに写真読み取り系パーミッションが増える**：
   `expo-screen-capture` が使っていないスクリーンショット「検知」機能
   （`addScreenshotListener` 等）のために `READ_EXTERNAL_STORAGE`/`READ_MEDIA_IMAGES`/
   `DETECT_SCREEN_CAPTURE` を autolinking で持ち込む。§8 の姿勢・
   `plugins/withAndroidNoBackup.js` の方針と整合しない。`plugins/withoutScreenCaptureDetectionPermissions.js`
   を追加し `tools:node="remove"` で除去。ネイティブ側の `ScreenshotEventEmitter`
   （API 34 未満で無条件に生成される `ContentObserver`）自体はパッチできないため、
   万一発火した場合の無害なログ出力は既知の制限として設計判断記録 D-47 に残した
2. **【高】「確認できた結果だけを表示する」が実際には成立していなかった**：3つの原因が
   あった。(a) `expo-screen-capture` の JS 実装は `key` を `await` の前に `Set` へ追加し
   失敗時にロールバックしないため、reject 後の再呼び出しはネイティブへ到達せず即座に
   成功を返す——「再実行して確認する」という前提が崩れていた。(b) iOS の
   `preventScreenshots()` は `keyWindow` が無いと無言で何もせず、それでも promise は
   成功として resolve される——resolve は保護成立の証明にならない。(c) `isAvailableAsync()`
   はネイティブ関数の存在確認のみで、コメントで挙げていた「iOS 13 未満」を検出する
   わけではなかった（実態と合っていないコメントだった）。対応：`attemptScreenMask()`
   を自前でメモ化し、ネイティブ呼び出し自体をプロセス内で一度しか行わないようにした
   （再試行ではなく、最初の一度きりの試行結果を共有する）。`useScreenMask()` の呼び出しを
   `RootLayout` の `loaded`（フォント読み込み完了・スプラッシュ非表示直前）まで遅らせ、
   (b) の窓を狭めた。誤りだったコメント（iOS 13 未満の検出）は削除し、「resolve は
   実機での確認を意味しない」ことをコード・README・設計判断記録 D-47 に明記した
3. **【中】iOS のぼかしは別の native ViewController（共有シート・ファイルピッカー・
   Alert）の外側にしか載らない**：`contexts/AppLock.tsx` が `presentation: 'modal'` を
   避けている理由とまったく同じ構造の制約。パッチや回避は行わず、既知の制限として
   設計判断記録 D-47 と Known gaps に明記した
4. **【中】失敗時・Activity 再生成時の再適用が無かった**：Android の `FLAG_SECURE` は
   `currentActivity.window` 単位のため、`configChanges` で吸収されない構成変更で
   Activity が再生成されると保護が失われる。`useScreenMask()` に Android 専用の
   `AppState` リスナーを追加し、`active` に戻るたびに新しい key で
   `preventScreenCaptureAsync` を呼び直すよう修正（`attemptScreenMask()` 自身の
   メモ化は意図的にバイパスする——目的が異なるため）
5. **【中】`blurIntensity = 1.0` は実機確認が必須と判明**：ネイティブ実装
   （`AnimatedBlurEffectView.swift`）は `UIViewPropertyAnimator.fractionComplete` に
   この値をそのまま渡しており、厳密に `1.0` を入れるとアニメーターが「完了」状態に
   遷移し、意図した見た目のまま留まらない可能性があることが知られている（iOS の
   よくある回避策）。`0.99` に変更。実機確認が必要な点に変わりはない（Known gaps 参照）
6. **【低】その他まとめて対応**：
   - `hide-app-preview.tsx` の ✓/! に `accessibilityLabel` を追加（スクリーンリーダーで
     状態が伝わっていなかった）
   - 文面の重複（"...on this device: ...on this device."）を解消
   - `SettingsRow` の `divider` prop（呼び出し側が渡し忘れると区切り線が抜ける）を
     `SettingsGroup` + `index > 0` の導出に置き換え
   - 「both underlying native calls are idempotent」という不正確なコメントを修正
     （`enableAppSwitcherProtectionAsync` は呼ぶたびに無条件で observer を追加登録し、
     dedupe が無い——メモ化により実際には一度しか呼ばれないため実害は無いが、関数自体は
     冪等ではない）
   - `jest.mock('expo-screen-capture')` で `attemptScreenMask()` の分岐と理由文言を
     テストできるとの指摘を受け、`lib/__tests__/screenMask.test.ts` を追加（8件）
   - Web（`isAvailableAsync()` が常に false）は対象外の判断として Known gaps に明記
     （このアプリの中核である op-sqlite・expo-local-authentication 自体が web で動作
     しないため、実質的に到達しない経路）

#### レビューで見つかり、修正したもの（3回目）

1回目・2回目の判断（メモ化で再試行を諦める、iOS のぼかしは別 VC を覆えないので回避せず
記録に残す）は妥当と確認された。新たに1件（高）と、2回目の修正に伴う残課題が見つかった。

1. **【高】新規 plugin の READ_EXTERNAL_STORAGE 除去が expo-file-system の宣言も
   消してしまう**：`plugins/withoutScreenCaptureDetectionPermissions.js` は
   `READ_EXTERNAL_STORAGE` を「`expo-screen-capture` だけが持ち込むもの」として
   除去していたが、`expo-file-system`（`android/src/main/AndroidManifest.xml`）も
   同じ `android.permission.READ_EXTERNAL_STORAGE`（maxSdk 32）を宣言していた。
   `uses-permission` のマージキーは `android:name` のみのため、`tools:node="remove"`
   は属性を問わずマッチし、`expo-file-system` 側の宣言も道連れにする——実際に
   `expo prebuild --platform android` した生成マニフェストで、同じパーミッションに
   対する `tools:replace` 付きの宣言と `tools:node="remove"` が並ぶ自己矛盾した状態を
   確認した。`READ_EXTERNAL_STORAGE` を `PERMISSIONS_TO_REMOVE` から外した——
   `android:maxSdkVersion="32"` 付きのため Android 13+ では要求されず、ストア表示上の
   実害も小さい。`READ_MEDIA_IMAGES`/`DETECT_SCREEN_CAPTURE` は `expo-screen-capture`
   のみが宣言しており、この衝突は無い（生成マニフェストで確認済み）。再度
   `expo prebuild` を実行し、衝突が解消されたことを確認した
2. **【中】Android 再適用の残課題、4点とも文書化**：
   - `activeTags` が `active` 復帰のたびに増え続ける一方通行であること
     （`allowScreenCaptureAsync` を一度も呼ばない現在の設計では実害は無いが、
     将来「一時的に許可」が必要になった際に必ず踏む）
   - iOS へこの再適用ロジックを広げてはならない理由を「不要」から「有害」に
     強化——`preventScreenshots()`（`ScreenCaptureModule.swift`）を2回目以降呼ぶと、
     `originalParent` が「本来の親」ではなく「前回作った `UITextField` のレイヤ」で
     上書きされ、復元不能なレイヤ階層になることをコードで確認した
   - Activity 再生成後、`AppState` リスナーが発火してネイティブ呼び出しが着地する
     までの窓は `FLAG_SECURE` が外れていること（JS からは詰められない制約）
   - `attemptScreenMask()` がメモ化されているため、この再適用が後から失敗しても
     `hide-app-preview.tsx` の表示（✓）には一切反映されないこと
   いずれも `lib/screenMask.ts` のコメントと設計判断記録 D-47 に明記した
3. **【低】その他まとめて対応**：
   - `plugins/withoutScreenCaptureDetectionPermissions.js` を冪等にした（既存の
     remove エントリがあれば追加しない——`android/` を残したまま `--clean` 無しで
     `expo prebuild` を再実行しても重複しない）
   - `lib/__tests__/screenMask.test.ts` に `useScreenMask` 自体のテストを追加
     （`react-test-renderer` を新規 devDependency として導入——Android では
     `AppState.addEventListener`/`remove` が呼ばれること、iOS では一切呼ばれない
     こと、`ready` が false の間は何もしないこと。既存8件と合わせて13件）。
     `handleAppStateChangeForReapply` を独立した関数として切り出し、`active` 以外を
     無視すること・毎回新しい key を使うことも直接テストした
   - `loaded` のタイミングに関するコード内コメントの言い回しを README に揃えた
     （「スプラッシュ非表示後」ではなく「非表示直前」——`_layout.tsx` の実際の
     effect 登録順序に合わせた表現。挙動上の問題は無い）

#### テスト

`expo-screen-capture` 自体（実際のネイティブ呼び出し）は Jest では検証できない——
`connection.ts`・`RecoveryService.ts` と同じ制約。`attemptScreenMask()` の分岐、
`handleAppStateChangeForReapply`、`useScreenMask`（Android/iOS でのプラットフォーム分岐、
`ready` ゲート、`AppState` の購読・unmount 時の unsubscribe）は
`jest.mock('expo-screen-capture')` + `react-test-renderer` で検証済み
（`lib/__tests__/screenMask.test.ts`、13件）。

#### Known gaps

- **実機での動作確認が未実施**：この項目は特にコードレビューだけでは確認しきれない
  ——iOS の `enableAppSwitcherProtectionAsync(0.99)` のぼかし表示（強度が実際に強い
  ぼかしとして残ること）、Android の `preventScreenCaptureAsync()` による Recent Apps
  サムネイルの空白化、両 OS でのスクリーンショット・画面収録のブロック、Android の
  Activity 再生成後の再適用は、実機でしか確認できない
- **`plugins/withoutScreenCaptureDetectionPermissions.js` の Gradle マニフェストマージ
  後の最終結果は確認済み**（実機ビルド不要、EAS のビルド枠も使わない）：
  `cd android && ./gradlew :app:processDebugMainManifest` を実行し、
  `android/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml`
  を確認した。`READ_EXTERNAL_STORAGE`（`maxSdkVersion="32"` 付き、`expo-file-system` 由来）
  は単独で残り、`READ_MEDIA_IMAGES`/`DETECT_SCREEN_CAPTURE` は最終マニフェストから
  完全に消えている——3回目のレビューで指摘された衝突の修正が実際に機能することを
  ローカルビルドで確認した。`android/app/build/` はビルド成果物（gitignore 対象）
- **スクリーンショットブロックと Recent Apps マスクが Android で分離できない**：
  要求されているのは「バックグラウンド移行時のマスク」だが、Android では
  `preventScreenCaptureAsync()` が唯一の関連 API であり、これがスクリーンショット
  自体のブロックも兼ねる。両者を分離する設定は無いため、意図した副次的保護として
  受け入れている（設計判断記録 D-47 参照）
- **`resolve` は実機での確認を意味しない**：`preventScreenCaptureAsync`/
  `enableAppSwitcherProtectionAsync` が例外を投げずに resolve しても、実際に保護が
  有効になった証明にはならない（iOS の `keyWindow` タイミング問題など）。
  `attemptScreenMask()` の `{ active: true }` は「明示的な失敗を検出しなかった」ことを
  意味するにとどまる（設計判断記録 D-47 参照）
- **iOS のぼかしは別の native ViewController の外側にしか載らない**：共有シート・
  ファイルピッカー・システムの Alert 表示中に App Switcher スナップショットが撮られる
  場合、それらはぼかしの対象外になる。`contexts/AppLock.tsx` の `presentation: 'modal'`
  を避けている理由と同じ構造の制約で、パッチや回避は行わない（設計判断記録 D-47 参照）
- **Web は対象外**：`expo-screen-capture` は web で `isAvailableAsync()` が常に false を
  返すため `hide-app-preview.tsx` は赤い「!」を表示するが、op-sqlite・
  expo-local-authentication 自体が web で動作せずこの画面まで到達できないため、
  実質的に問題にならない想定——明示的な web 対応は行っていない
- **Android の `activeTags` が一方通行で増え続ける**：`allowScreenCaptureAsync` を
  一度も呼ばない現在の設計（常時オン）では実害は無いが、将来「一時的に許可する」
  機能が必要になった場合、この `Set` は空にならないため `allowScreenCaptureAsync`
  がネイティブへ到達しなくなる（設計判断記録 D-47 参照）
- **Activity 再生成後の再適用には着地までの窓がある**：新しい Activity が描画されて
  から `AppState` リスナーが発火し非同期のネイティブ呼び出しが着地するまで、
  `FLAG_SECURE` は外れたまま。JS からは詰められない制約
- **再適用の失敗は設定画面に反映されない**：`attemptScreenMask()` がメモ化されている
  ため、`hide-app-preview.tsx` が表示するのは起動時一度きりの結果。Activity 再生成後の
  再適用が失敗しても `logError` に残るだけで画面表示（✓ のまま）には反映されない

#### レビューで見つかり、修正したもの（4回目）

【高】は解消確認のみで、残りは全て低優先度。

- **再適用 key がミリ秒精度で衝突しうる**：`screen-mask-reapply-${Date.now()}` は同一
  ミリ秒内に `active` が2回発火すると同じ key になり、2回目が SDK 側の `activeTags`
  で短絡してネイティブに到達しなくなる——まさにこの仕組みを避けるために新しい key を
  使っている箇所なので、本末転倒になる。モノトニックなカウンタを付与し
  （`${Date.now()}-${counter++}`）、テストも「2つの key が実際に異なること」を
  アサートするよう強化した（以前は文字列パターンの一致しか見ていなかった）
- **JSDoc が2つ連なって `handleAppStateChangeForReapply` に付き、`useScreenMask` 自身には
  無かった**：関数切り出し時の取り残し。`useScreenMask` 用のコメントを正しい位置へ移動
- **`react-test-renderer` のバージョン指定・非推奨の扱い**：`^19.2.3` を `19.2.3`
  （`react`/`react-dom` と同じ固定バージョン）に変更。React 19 で公式に非推奨である旨と、
  `@testing-library/react-native` より依存が軽いという導入判断の理由をテストファイルの
  冒頭コメントに残した
- **テストの強化**：`toHaveBeenCalledWith('change', expect.any(Function))` を
  `handleAppStateChangeForReapply` そのものを渡す形に変更（インラインの別関数へ
  差し替わる回帰を拾えるように）。「`ready` が false の間は何もしない」テストに
  `AppState.addEventListener` 未呼び出しの確認も追加（`attemptScreenMask` 側だけでなく
  購読自体もゲートされていることを固定）

#### レビューで見つかり、修正したもの（5回目）：Android 14+ 実機での起動時クラッシュ

`phase3/screen-mask` マージ後、初めて Android 実機（Pixel 11、API 34+）でアプリを起動して
判明した問題。それまでの確認は `./gradlew processDebugMainManifest` によるマニフェスト
マージ結果の確認のみで、実際にアプリを起動しての確認はしていなかった（上記「実機での動作
確認が未実施」参照）。Known gaps に留めていた項目が、実際に起動を阻む形で顕在化した。

1. **【重大】起動直後にクラッシュする**：`node_modules/expo-screen-capture/android/.../
   ScreenCaptureModule.kt` の `OnCreate` が、Android 14+ では無条件に
   `currentActivity.registerScreenCaptureCallback(...)` を呼ぶ。このメソッドは内部で
   `android.permission.DETECT_SCREEN_CAPTURE` を要求するが、
   `plugins/withoutScreenCaptureDetectionPermissions.js` が意図的にこの権限を
   マニフェストから除去している（この app は「検知」機能を使わないため——同ファイルの
   doc comment 参照）。権限が無い状態でこの OS API を呼ぶと `SecurityException`
   （`Permission Denial: registerScreenCaptureObserver ... requires
   android.permission.DETECT_SCREEN_CAPTURE`）が投げられ、例外が一切捕まえられていない
   ため JS 側まで伝播し、`[runtime not ready]` のまま起動できない。`patch-package`
   （新規 devDependency、`postinstall` に追加）で `registerCallback()`／`OnDestroy` の
   `unregisterScreenCaptureCallback` 呼び出しを `try/catch` で包み、例外時はログのみに
   留めるよう修正——`ScreenShotEventEmitter.kt`（API 34 未満のフォールバック経路）が
   権限不足をログのみで扱っているのと同じ方針
2. **【重大】単純な `try/catch (SecurityException)` だけでは直らなかった**：1個目の
   例外を捕まえた直後、`OnActivityEntersForeground` の `registerCallback()` 再試行が
   `IllegalStateException`（`"Capture observer already registered with the activity"`）
   を投げて再クラッシュした——`SecurityException` を投げた1回目の呼び出しが、権限チェックで
   弾かれる前に OS 内部の登録簿には登録済みにしていたらしく、2回目以降は「既に登録済み」
   エラーになる。`catch (error: SecurityException)` を `catch (error: Exception)` に
   広げ、原因の型を問わず「ログのみ、クラッシュしない」方針を徹底した
3. **【重大】この2つのパッチが node_modules の `.kt` を直接編集しても一切効かなかった**：
   `expo-screen-capture` の `expo-module.config.json` に
   `android.publication`（`repository: "local-maven-repo"`）という設定があり、これが
   Expo Modules Autolinking に「ソースからビルドせず、npm パッケージに同梱された
   プリコンパイル済み `.aar`（`node_modules/expo-screen-capture/local-maven-repo/...`）を
   `host.exp.exponent:expo.modules.screencapture:57.0.3` という Maven 座標から解決する」
   よう指示していた（`./gradlew :app:dependencies` で実際にこの座標が使われていることを
   確認）。`android/src/main/java/...` を編集しても、Gradle がそのソースを一切コンパイル
   しない（`:expo-screen-capture:compileDebugKotlin` 相当のタスク自体が存在しない）ため
   無反応だった——Gradle のキャッシュ問題ではなく、そもそもソースを使っていなかったことが
   原因。`expo-module.config.json` の `publication` ブロックを除去するパッチを追加し、
   ソースから通常どおりビルドされるようにした。この事実確認だけで、キャッシュ無効化
   （`--no-build-cache`）・Gradle デーモン再起動・`--rerun-tasks` による完全再ビルド
   （31分43秒）を順に試す遠回りをした

**恒久対応**：`patches/expo-screen-capture+57.0.3.patch`（`package.json` の `postinstall`
で自動適用）として `main` に取り込んだ。`npm install` のたびに自動適用されるため、
`node_modules` を再生成しても消えない。将来 `expo-screen-capture` を SDK アップグレードで
更新する際は、この OS 側の不具合が本家で直っていないか確認し、直っていればパッチを削除する。

#### Known gaps（更新）

- **`Log.e` が起動のたびに（最低2回）出る**：上記修正はクラッシュを止めるだけで、
  `registerCallback()` 自体は `OnCreate` と `OnActivityEntersForeground` のたびに
  再試行され、そのたびに同じ権限エラーがログに出る（`isRegistered` は最初の
  `SecurityException` で `true` にならないため）。無害だが冗長——将来的には
  `Build.VERSION.SDK_INT >= UPSIDE_DOWN_CAKE` の分岐自体をスキップする（この app は
  この権限を要求しない設計なので、そもそも呼ばない）方がクリーンだが、今回は
  「クラッシュを止める」ことを優先し、呼び出し自体の抑制はスコープ外にした
- **実機での他の画面マスク動作（FLAG_SECURE・スクリーンショットブロック・ぼかし）は
  今回未確認**：起動できることの確認が主目的だったため、Recent Apps でのマスク自体の
  見た目は別途確認が必要

### 日時編集 UI

`phase3/datetime-edit` ブランチ。基本設計 §18 の Phase 3 順序に従い、画面マスクの次
（Phase 3 の最終項目）に着手。§11.4「過去
日時への記録」：「Add Activity の「Just now」から日時変更に入る。オフセットの決定規則は §4.4
に従う」。§4.4（DST を跨ぐ過去記録のオフセット計算）・`lib/datetime.ts` の
`resolveOffsetMinutesForZone`/`buildOccurredAtFields` は Phase 1 から実装・テスト済みで、
`services/ActivityService.ts` の `recordActivity` も任意の `instantUtc`/`timezoneId` を
既に受け付けていた（`app/record.tsx` が常に `new Date()` しか渡していなかっただけ）。当初の
スコープは UI 側のみで新規ロジックは追加していなかったが、2回目のレビューを受けて
`clampToNow`/`sameMinute` を `lib/datetime.ts` の純粋関数として切り出した（下記「実装済み」
「レビューで見つかり、修正したもの（2回目）」参照）——それ以外の計算ロジック（オフセット・
分単位丸め）は Phase 1 のまま変更していない。

#### スコープの判断：日時を編集できるのは記録前（Add Activity）のみ

UI/UX §27・基本設計 §4.4 の見出しはどちらも「過去日時への**記録・編集**」という文言を使って
おり、字面だけを見ると記録済み Activity の事後編集も含むように読める。ただし UI/UX §27 の
Phase 3 行自体に「§8『Just now』からの日時変更入口」という括弧書きの限定があり、§11.4 本文も
「Add Activity の『Just now』から日時変更に入る」としか書いていない——「編集」という語は
Add Activity 画面内で日時候補を選び直す操作を指しており、記録済み Activity
（`app/activity/[id].tsx`、Activity Detail 画面）の日時を事後に変更する UI を指すとは
読めない。そのため本 Phase では Add Activity 側のみを実装し、Activity Detail の DATE & TIME
は引き続き表示専用のまま据え置いた。事後編集を別途求めるなら、UI/UX §27 の当該行の括弧書きを
先に見直すか、設計判断記録に新規項目として起票する必要がある（今回はレビューで指摘を受け、
「仕様に記載が無い」という誤った説明を上記のとおり修正した）。

#### 実装済み

| 層 | 内容 |
|---|---|
| `@react-native-community/datetimepicker`（新規依存） | `expo install` で追加。`app.json` の `plugins` に自動追加された（config plugin 自体は追加の設定不要） |
| `lib/timeFormat.ts` | `formatCalendarDateTime`（新規）：「Mon D, YYYY · time」表示の共通化。`app/activity/[id].tsx` の `formatDateTime`（保存済みの `occurredLocalDate`/`occurredLocalTime` 文字列が入力）と `app/record.tsx` のピッカー表示（生の `Date` オブジェクトが入力）の両方が同じ月名配列と組み立てロジックを個別に持っていた重複を解消 |
| `app/record.tsx` | UI/UX §8 のモックアップ通り「Just now（現在値）」と「Change date & time（操作）」の2行に分離。iOS は `mode="datetime"` の spinner を、画面内に絶対配置した素の `View`（RN の `<Modal>` は使わない）で下から重ねて表示。Android は `mode="datetime"` の単一コントロールが無いため、`DateTimePickerAndroid.open()` で date → time の順に2つのネイティブダイアログを連鎖させる（公式に推奨されている命令的 API）。`useAppLockActions().isLocked()` を picker を開く前・Android の時刻選択確定時・iOS の Done 確定時の3か所で再チェックし、ロック中に選んだ値が適用されないようにした。ピッカーを開いただけで何も変更せず確定した場合は、選ばれた瞬間の時刻に固定せず「Just now」（またはそれまでの値）のまま維持する（`sameMinute` による分単位の未変更判定）。変更後は「Use now instead」で `null`（＝記録時に現在時刻を使う）へ戻せる。Solo/Partnered をタップするだけの既定フローの操作数は変わらない（§11.1 の2アクション以内を維持） |
| `contexts/AppLock.tsx` | 既存の「`record.tsx` はネイティブの modal presentation を使わない」という設計原則のドキュメントコメントに、今回の日時ピッカーがどう従っているか（iOS はこの原則どおり同じ view tree 内に留める／Android はネイティブダイアログを `AppState` で明示的に閉じる、その理由）を追記（2回目のレビュー後の内容に更新済み） |
| `lib/datetime.ts`（2回目のレビュー後に追加） | `clampToNow`（未来日時を現在時刻でクランプ）・`sameMinute`（分単位の同一性判定）。当初 `app/record.tsx` にローカル関数として置いていたが、テストできる場所に切り出した |

`services/ActivityService.ts` の変更は無し（既存の `instantUtc`/`timezoneId` 引数をそのまま
使うだけで済んだ）。`lib/datetime.ts` は上記 `clampToNow`/`sameMinute` の追加のみで、
既存の `resolveOffsetMinutesForZone`/`buildOccurredAtFields` 等は変更していない。

#### レビューで見つかり、修正したもの（1回目）

1. **【中〜高】Android で未来の日時を記録できた**：`maximumDate` は日付ダイアログにしか
   効かず、続く時刻ダイアログには効かない。「今日」の日付を選んだうえで現在時刻より後の
   時刻を選ぶと、そのまま未来の日時として保存されていた。`clampToNow` を導入し、日付＋時刻を
   合成した結果を現在時刻でクランプするよう修正（`record()` 内の最終防衛としても同じ関数を
   適用）
2. **【中】ピッカーが App Lock の画面より上に出てしまう可能性**：`contexts/AppLock.tsx` の
   ドキュメントコメントが明記している「`record.tsx` はネイティブの modal presentation を
   使わない（ロック中のオーバーレイが覆えない、別レイヤーになるため）」という原則に、
   追加した RN `<Modal>`（iOS）とネイティブダイアログ（Android）がどちらも反していた。
   iOS 側は `<Modal>` をやめ、画面内に絶対配置した素の `View` に置き換え——`record.tsx` 自体が
   通常の `card` 表示で App Lock のオーバーレイに覆われる対象である以上、ピッカーも同じ
   view tree に留めればオーバーレイが自動的に覆う。Android は当初「このライブラリに
   non-dialog モードが無いため回避不能」として許容する例外にしたが、これは2回目のレビューで
   誤りと判明——詳細は下記「2回目」参照
3. **【中】「記録済み Activity の日時編集は仕様に記載が無い」という説明が事実と異なっていた**：
   UI/UX §27・基本設計 §4.4 の見出しはどちらも「記録・編集」という語を使っている。上記
   「スコープの判断」を、仕様の文言を正しく引用したうえで判断理由を書き直す形に修正した
4. **【中】実機ビルドで未検証のまま Phase 3 を「クローズ済み」としていた**：
   `@react-native-community/datetimepicker` はネイティブモジュールで、現在の開発ビルドには
   まだリンクされていない（ビルドし直すまで `record` 画面を開くとクラッシュしうる）。ステータス
   の記載を「実装済み・実機確認待ち」に戻した（下記 Known gaps、README 冒頭「ステータス」参照）
5. **【低】ピッカーを開いただけで（何も操作しなくても）時刻が固定される**：開いた瞬間の
   値のまま Done/確定すると、それが「Just now」として固定保存されてしまい、実際に記録する
   までの間ずれた時刻になっていた。`sameMinute` で「開いたときの値から変わっていないか」を
   判定し、変わっていなければ元の値（`null` を含む）を維持するよう修正
6. **【低】DST の切り替わりで存在しない時刻を選べる（Android）**：`setHours` で日付と時刻を
   合成しているため、夏時間が始まる日の存在しない時刻を選ぶと JS が自動でずらす。現在の
   開発・テスト環境（UTC、DST 無し）では起きないため、既知の制限として `openAndroidPicker`
   にコメントを残すに留めた（要件定義書に「主要ユーザーは日本のタイムゾーン」という記載は
   無く、2回目のレビューでその前提の根拠が無いと指摘されたため、コメントの表現も修正した）
7. **【低】日付フォーマット処理が2か所で重複していた**：`app/record.tsx` と
   `app/activity/[id].tsx` がそれぞれ独自に月名配列と組み立てロジックを持っていた。
   `lib/timeFormat.ts` の `formatCalendarDateTime` に切り出し、両方から呼ぶよう修正
8. **【低】設定読み込みにエラー処理が無かった**：`getSetting(...).then(setTimeFormat)` に
   `.catch` が無く、失敗すると未処理の rejection になっていた。他画面と同じく
   `logError` を伴う `.catch` を追加
9. **【低】「Use now instead」のタップ領域・アクセシビリティ**：`minTouchTarget` を
   満たしておらず `accessibilityRole` も無かった。`minHeight: minTouchTarget` と
   `accessibilityRole="button"`/`accessibilityLabel` を追加
10. **【低】UI/UX §8 のモックアップと表示構成が違っていた**：モックは「Just now」と
    「Change date & time」を2行に分けているが、実装は1行に結合していた。モック通り2行に
    分離した

#### レビューで見つかり、修正したもの（2回目）

コードは変更せず指摘のみを受けるレビュー（1回目の修正10件はすべて反映確認済み）。

1. **【中】Android のネイティブダイアログを「回避不能な例外」として許容していたのは誤り**：
   `@react-native-community/datetimepicker` には `DateTimePickerAndroid.dismiss(mode)` が
   あり、コードから明示的に閉じられる。`AppLock.tsx`/README の「ライブラリの制約上、
   ネイティブダイアログという別ウィンドウが一瞬見え得ることは避けられない」という説明は
   不正確だった。また `isLocked()` の再チェックが時刻ダイアログの `onChange` にしか
   無かったため、ロック中に日付ダイアログで確定すると、ロック画面の上にさらに時刻
   ダイアログが開く経路も残っていた。`record.tsx` に `AppState` リスナーを追加し、
   `active` から外れた瞬間に `DateTimePickerAndroid.dismiss('date')`/`dismiss('time')`
   （Android）・`setIosPickerVisible(false)`（iOS）でピッカーを閉じるよう修正。日付
   ダイアログの `onChange` にも `isLocked()` チェックを追加した。`AppLock.tsx` の
   コメントと README（上記レビュー #2）を実態に合わせて修正した
2. **【中】main へ直接コミットする前にブランチを分けるべき**：
   `@react-native-community/datetimepicker` は現在の開発ビルドにリンクされておらず、
   RN 0.86 の New Architecture 下では特に、`record.tsx` を開いた時点で失敗しうる——日時を
   変更しない通常の記録（Just now）まで含め、アプリの中心機能が壊れるおそれがある。
   画面マスクのとき（`phase3/screen-mask`）と同じ手順に合わせ、`phase3/datetime-edit`
   ブランチで作業し、再ビルド・実機確認を経てから `main` にマージする方針にした
3. **【低】iOS のピッカー表示中、下の画面が VoiceOver で操作できてしまう**：`<Modal>` を
   やめたことで、VoiceOver のフォーカスが下の Solo/Partnered ボタンにも移れるように
   なっていた（確定前の `pendingInstant` ではなく、それまでの `customInstant` で記録されて
   しまう）。ピッカーのシート側の `View` に `accessibilityViewIsModal` を追加した
4. **【低】未来時刻を選ぶと黙って現在時刻に丸められる**：`clampToNow` 自体は正しく動作して
   おり、レビューでも「仕様上は問題ない」との判断。実機確認時にこの挙動（無言の丸め）を
   許容するかどうかを判断する、という形でそのまま残した
5. **【低】ドキュメント・テストの細部**：`AppLock.tsx` の追記部分にあった `*` の無い空行
   （JSDoc の書式崩れ）を修正。「主要ユーザーは日本のタイムゾーン」という根拠の無い前提を
   上記レビュー #6 のとおり修正。`clampToNow`/`sameMinute` を `app/record.tsx` から
   `lib/datetime.ts` の純粋関数に移し、`lib/timeFormat.ts` の `formatCalendarDateTime` と
   合わせてユニットテストを追加（下記「テスト」参照）。1回目のレビュー記録冒頭の
   「コードは変更せず指摘のみを受けるレビュー。」という書き方も分かりにくかったため、
   見出しに「（1回目）」と付けるだけの形に直した

#### レビューで見つかり、修正したもの（3回目）

2回目の修正5件（dismiss での明示クローズ、日付ダイアログの isLocked チェック、ブランチ分離、
VoiceOver、ドキュメント/テストの整理）はいずれも意図どおりと確認された。コードは変更せず、
このセクション自体の記述漏れのみ3件見つかった。

1. **【低】上記「実装済み」「テスト」の記述が2回目の修正内容を反映していなかった**：
   「今回のスコープは UI 側のみ：新規のロジックは追加していない」「`lib/datetime.ts` の変更は
   無し」「UI のみの変更のため新規テストは追加していない」がいずれも、2回目のレビューで
   `clampToNow`/`sameMinute` を `lib/datetime.ts` に切り出しテストを追加した事実と矛盾していた。
   上記「実装済み」に `lib/datetime.ts` の行を追加し、該当する文言を修正した
2. **【低】DST コメントの「テスト環境（UTC）」という記述に根拠が無かった**：
   `package.json` の Jest 設定にも他の箇所にも `TZ` の指定は無く、実行マシンのタイムゾーンで
   動く。「DST のあるタイムゾーンで実機検証していない」という、確認できる事実だけを書く
   表現に修正した（`openAndroidPicker` のコメント、README 上記レビュー #6）
3. **【任意】`DateTimePickerAndroid.dismiss()` の Promise が未処理だった**：通常は reject
   しないが、未処理の rejection を避けるため `.catch(logError)` を追加した

#### テスト

UI 自体（`app/record.tsx` の JSX・ネイティブダイアログの連鎖・`AppState` 連携）はコンポーネント
テストが無いためカバーしていないが、2回目のレビューを受けて `clampToNow`/`sameMinute` を
`lib/datetime.ts` の純粋関数に切り出し、`lib/__tests__/datetime.test.ts` にテストを追加
（分単位の同一性判定、未来日時のクランプ）。`lib/timeFormat.ts` の `formatCalendarDateTime`
（月名・0始まりの月インデックス・12h/24h）も `lib/__tests__/timeFormat.test.ts` に追加。
既存の `resolveOffsetMinutesForZone`/`buildOccurredAtFields` の DST 境界テストは今回変更して
いない計算ロジックを引き続きカバーしている。`tsc --noEmit`・Jest スイート（210件）は全て
通過を確認済み。

#### Known gaps

- **実機ビルド・実機での動作確認が未実施**：`@react-native-community/datetimepicker` は
  ネイティブモジュールのため、現在の開発ビルドに組み込むには再ビルドが必要（未実施）。
  `phase3/datetime-edit` ブランチで再ビルド・実機確認してから `main` にマージする（上記
  2回目レビュー #2 参照）。特に、iOS の spinner・Android の連鎖ダイアログの実際の見た目・
  操作感、`AppState` での dismiss が実機で確実に効くこと、Android の画面マスク
  （`FLAG_SECURE`）がダイアログの別ウィンドウにも効くかどうかは、実機/シミュレータでのみ
  確認できる（Phase 1/2/3 の他項目と同じ制約）
- **タイムゾーン選択 UI は無い**（§4.4 既知の制限、Phase 1 から変更なし）：旅行先の
  出来事を帰国後に入力すると、常に現在地（デバイスの現在の IANA タイムゾーン）のオフセットが
  適用される
- **記録済み Activity の日時編集は範囲外**：上記「スコープの判断」参照。`app/activity/[id].tsx`
  の DATE & TIME は引き続き表示専用
- **Android の DST ギャップ（存在しない時刻）は未対応**：上記レビュー #6 参照。既知の制限として
  コメントに残すのみ
- **未来時刻を選ぶと無言で現在時刻に丸められる**：上記2回目レビュー #4 参照。仕様上は問題ないと
  判断済みだが、実機確認時に許容するか再判断する
