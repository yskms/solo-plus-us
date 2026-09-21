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
Export/Import の UI・画面マスクはクローズ済み、**日時編集 UI は Android 実機（Pixel 11）で
確認済み・iOS は未確認**（`expo run:ios` が Xcode 26.3 のコンパイラ不具合で実行できない
ため——CLAUDE.md 参照、日時編集 UI 固有の問題ではない）。Phase 3 の元の範囲外だが、
**表示項目のカスタマイズ（§6.3、v1.0 必須）も実装完了・Pixel 3 実機確認済み**
（下記「表示項目のカスタマイズ」参照、iOS は未確認）。
**Phase 4**（Health Connect 同期）
に着手済み——`react-native-health-connect` 導入・permission 宣言・prebuild・
`HealthConnectService.ts`/`SyncWorker.ts`/`SyncCoordinator`（§9.12 の mutex）・
AppState 配線（`contexts/SyncWorkerLoop.tsx`）・Settings 画面の Health Connect UI
（`app/settings/health-connect.tsx`）まで実装完了。**Settings UI の実機
確認は完了**（下記「Phase 4 実装状況」の「実機確認（Pixel 11、
初回/2回目/3回目）」「実機確認（Pixel 3、D-20）」参照、実機テストでのみ
再現するタイミング依存バグを2件発見・修正済み）：ON→権限→Connected・
記録/削除の自動同期・破棄・claim 中の行の無効化・Retry now の実際の
再試行・delete job が残っている状態での OFF 切断警告と再接続後の再開・
`permission-revoked` 表示・バックグラウンド/フォアグラウンド遷移・HC
未インストール環境での ON 操作時の表示（Pixel 3、非プラットフォーム
統合パス）。**Android 9〜13（D-20）の実機検証も完了**——存在しない
`clientRecordId` への delete は reject され通常のリトライ・バックオフに
乗ることを Pixel 3 実機で確認し、設計判断記録 D-20 に追記済み。**§13.6
復元後の Health Connect 再同期（`recreate`）も実装・実機確認完了**——
`services/HealthSyncResyncService.ts` と `app/settings/data.tsx` の
`offerResync` ステップ（下記「Phase 4 実装状況」ステップ7参照）。
`recreateActivity` の insert-after-delete-failure 経路を Pixel 3（D-20と
同じ Android 12）で、置換復元→`offerResync`→Sync→Settings 反映の
一連の流れを Pixel 11（Android 14+ プラットフォーム統合パス）で、
それぞれ実機確認済み。**これにより Phase 4 の実機確認タスクは完了**。
§9.11 のリリースビルド分離（`without-health-connect`/`with-health-connect`）も
実装・実機確認完了（`app.config.js`・`lib/healthConnectBuild.ts`・`eas.json`。
Pixel 3 実機で HEALTH セクションが非表示になることとクラッシュが無いことを
確認済み）。
詳細は下記の各「実装状況」を参照。

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
- [x] Health Connect ラッパーが `clientRecordId` と `clientRecordVersion` を露出しているか
- [x] 削除時の「存在しない」を成功として扱えるか（Android 14 以降のみソースで確認。9〜13 は当時未確認のため既知の制限を適用——2026-09-21 の実機確認で reject されることを確認済み。「実機確認（Pixel 3、D-20）」参照）
- [x] ネイティブ呼び出しの cancel/タイムアウト（§9.12）——全経路で cancel 不可と確認（14以降は platform API、9〜13 は androidx の AIDL が根拠）

2026-09-19、`react-native-health-connect` v4.1.3 を対象にソース読解で調査（実機/エミュレータでの
実行検証ではない）。`clientRecordId`/`clientRecordVersion`（D-04/D-19）は OS バージョンに依存せず
確認済み。削除時の「存在しない」の識別可否（D-20）は Android 14（API 34）以降のプラットフォーム
統合パスに限り「識別」ではなく「そもそもエラーにならない」ことを実装レベルで確認——Android 9〜13
（Play ストア配布の別アプリ経由 IPC、非公開実装）は未検証で、この範囲は基本設計 §9.7 の
「既知の制限として受け入れる」を適用する（ユーザー判断により追加の実機検証は現時点で行わない）。
cancel/タイムアウト（D-41）は、ラッパーに加え、経路ごとの根拠（Android 14 以降は AOSP platform
の `HealthConnectManager`、9〜13 は `androidx.health.connect` の AIDL）のいずれにも cancel を
伝える手段（`CancellationSignal` 等）が存在しないことをソースレベルで確認し、cancel 不可と
確定した。**したがって JS 側がタイムアウトで
待つのをやめても、ネイティブの insert/delete は止められず継続する**（Health Connect 側・OS 側
独自のタイムアウトの有無は未調査）。Android 14 以降は platform API 自体に cancel の契約が無いこと、
Android 9〜13 は androidx の AIDL インターフェースに cancel を渡す手段が無いことが根拠で、
2経路は根拠が別物のため一方が変わっても他方の結論は自動的には変わらない。
詳細は基本設計 §9.4/§9.7/§9.12・設計判断記録 D-04/D-20/D-41 の「確認結果」参照。
DB 設計には影響しないため Phase 1 は着手できる。**チェックは「v1.0 投入を妨げる要因なし」の意味であり、
全 OS バージョンでの実機検証完了を意味しない。**
Phase 4 に向けて残っている確認事項（見送り条件ではない）は、上記の Android 9〜13 の削除挙動の実機検証のみ
（**2026-09-21 に実施済み——下記追記および「実機確認（Pixel 3、D-20）」参照**）。
**Pixel 3（最終公式 OS が Android 12。Health Connect は Android 13 以下では Play ストア配布の別アプリの
ため、未確認の非プラットフォーム統合パス＝`HealthConnectClientImpl` 経由の AIDL 呼び出しをそのまま
実機で踏める）が検証機として使える**（2026-09-19 確認）。`HealthConnectService` 実装時（Phase 4）に
insert/delete を実機で通す一環として、存在しない `clientRecordId` の delete を1ケース追加する形で
まとめて検証する（今は着手しない）。検証時は HC アプリのバージョン・端末の OS バージョン・Google Play
システムアップデートの日付を記録すること（結果は検証時点の HC アプリ実装に依存するため）。
Pixel 3 が手元にない場合は、Play ストア入りの Android 12〜13 エミュレータでも同じ経路を通せる。

**2026-09-21 追記：上記の Android 9〜13 実機検証は Phase 4 で実施済み。**
Pixel 3（Android 12）・Health Connect v2026.08.06.00 で、存在しない
`clientRecordId` への delete が reject されることを確認した。詳細は
下記「Phase 4 実装状況」の「実機確認（Pixel 3、D-20）」・設計判断記録
D-20 参照。

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
  （Phase 3/4 の残り）。App Lock・Data（Export/Import UI）は Phase 3 で実装済み（下記参照）。
  **Activity Details カスタマイズは解消: 2026-09-21 実装——「§6.3 表示項目のカスタマイズ」参照
  （本セクション末尾）。Health Connect は Phase 4 で実装済み（下記「Phase 4 実装状況」参照）**
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
| `screens/CalendarScreen.tsx` | 月表示グリッド・前月/次月ナビゲーション・日別ドット（§13「同日複数」の1-2件個別ドット/3件以上まとめ表示ルールに準拠）・日付タップで一覧表示・Activity Detail への遷移 |

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

`screens/CalendarScreen.tsx` 自体（React コンポーネント）はユニットテスト対象外——このプロジェクトに
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
| `screens/InsightsScreen.tsx` | TOTAL ACTIVITIES（全期間の合計・Solo/Partnered 内訳）・YOUR PATTERNS（平均間隔）・「All time」キャプション。Calendar と同じ `loading`/`ready`/`error` の3状態、`isActive`（タブのアクティブ状態）と `revision` をまとめた単一 `useEffect` パターンを最初から採用（タブがスワイプ/PagerView 化された経緯は `app/(tabs)/_layout.tsx` 参照） |

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
  に明記。**解消: 2026-09-21、§13.6 実装——「Phase 4 実装状況 > ステップ7」参照**）

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
  （**解消: 2026-09-21、`phase3/delete-data` ブランチで実装——「Delete Data（§10.6）」
  の節参照**）
- **Export schema の Migration（§13.2）は未実装**：現行 export version が 1 のみで、
  古いバージョンが存在しないため。v2 を出す時点で `migrateExportV1ToV2` 等を追加する必要
  がある（`services/importValidation.ts` は現状 `version !== CURRENT_EXPORT_VERSION` を
  一律拒否している）
- **セーフティ Export 失敗時のリトライ導線が無い**：セーフティ Export が失敗すると
  `menu` ステップへ戻るのみで、同じ確認画面へワンタップで戻る導線は無い（Cancel から
  やり直す形になる）
- **セーフティ Export ファイルを削除する導線が無い**：タイムスタンプ付きで毎回新しい
  ファイルとして残るため（上記レビュー参照）蓄積し続ける。iOS は Files アプリにも
  公開していない（`UIFileSharingEnabled` 未設定）ため、アプリ内から削除する仕組みが
  無い限り利用者自身も消せない。**Delete Data（§10.6、2026-09-21実装）はこれを
  解消しない**——`activities`/`health_sync*` テーブルの中身を消すだけで、
  ディスク上のセーフティ Export ファイル自体には一切触れない別物（対象が違う）
- **Import 後の Health Connect 再同期は未実装**（§13.6/D-34「recreate」）：Phase 4 の
  項目なので今は問題ないが、置換復元は `health_sync` の対応関係を全削除するため、
  Phase 4 で Health Connect を実装する際に必ず対応が必要になる箇所として残しておく
  （**解消: 2026-09-21、§13.6 実装——「Phase 4 実装状況 > ステップ7」参照**）
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

#### スクリーンショット方針の反転（6回目、`phase3/screenshot-policy` ブランチ）

2026-09-18、ユーザーからのフィードバックで決定2（スクリーンショット・画面収録を iOS でも
常時ブロックする）を撤回した——CLAUDE.md「スクリーンショットに関する方針」・設計判断記録
D-47 の追記参照。Google Health のような同種のアプリはスクリーンショットを禁止しておらず、
本人が自分のデータをスクショしたい正当な理由（長期グラフの保存、医師への共有、バグ報告、
端末間の一時共有）を一律に奪うのは「Your intimate life belongs to you」という思想と矛盾する、
というのが理由。決定1（Recent Apps／App Switcher プレビュー非表示は常時オン）は変更なし。

新しい既定：

| 保護 | 既定 | 設定可否 |
|---|---|---|
| Recent Apps／App Switcher プレビュー非表示 | 常時オン | 不可 |
| スクリーンショット・画面収録のブロック | OFF | 可（Settings > PRIVACY > Block Screenshots） |

##### Android の技術的制約と対応

この2つを分離する OS API（`Activity.setRecentsScreenshotEnabled`）は Android 13（API 33）
以降にしか存在しない。API 33 未満では `FLAG_SECURE` しか手段が無く、Recent Apps 非表示を
有効にすると必ずスクリーンショットも道連れでブロックされる——ユーザーと相談のうえ、この
OS バージョン帯では Recent Apps 非表示を優先し、「Block Screenshots」は実質 ON 固定
（無効化不可）として受け入れた。

API 33 以降向けに、`node_modules/expo-screen-capture` へ `patch-package`
（新規 devDependency、`postinstall` に追加）で新規ネイティブ関数
`setRecentsScreenshotEnabled` を追加した（`patches/expo-screen-capture+57.0.3.patch`、
Android 14 起動時クラッシュ修正のパッチに追記する形）：`Activity
.setRecentsScreenshotEnabled(false)` を呼ぶだけで、Recent Apps のサムネイルだけを
無効化し、スクリーンショット・画面収録には一切影響しない。Kotlin 側
（`ScreenCaptureModule.kt`）・JS 側（`build/ScreenCapture.js`/`.d.ts`、コンパイル済みの
方を編集——`src/*.ts` は Metro が読まない、Android 14 クラッシュ調査で判明した教訓を
再利用）の両方にパッチを追加。

##### 実装済み

| 層 | 内容 |
|---|---|
| `types/Settings.ts`/`services/SettingsRepository.ts` | `privacy.blockScreenshots`（既定 `false`、`DEVICE_OWNED_SETTING_KEYS`——App Lock と同じ端末ローカルのセキュリティ設定、Export 対象外） |
| `lib/screenMask.ts` | 大幅に再構成。常時オン経路（`attemptScreenMask`/`useScreenMask`/`handleAppStateChangeForReapply`）は Recent Apps／App Switcher 非表示のみに専念——iOS は `enableAppSwitcherProtectionAsync` のみ、Android は API 33+ で `setRecentsScreenshotEnabledAsync(false)`、API 33 未満は従来の `preventScreenCaptureAsync`（`FLAG_SECURE`、副作用としてスクリーンショットも道連れ）。新規 `applyScreenshotBlock`/`useScreenshotBlock` がオプトイン設定を担当——有効化のたびに新しい key を発行して追跡し、無効化時に発行済みの**すべての** key を解放する（`expo-screen-capture` の `activeTags` の仕組み上、1つでも残ると二度と `allowScreenCapture()` に到達できなくなるため）。Android 未満 API 33 では常時経路が既にブロックしているため no-op |
| `contexts/ScreenshotBlock.tsx`（新規） | `privacy.blockScreenshots` の DB 読み込みと `useScreenshotBlock` への橋渡し。`AppLockProvider` と同じ「DB の値と React state を明示的に同期する」パターンだが、設定画面はすでに知っている新しい値をそのまま渡せるため DB 再読み込み（`refreshXxx`）は不要 |
| `app/settings/block-screenshots.tsx`（新規） | Settings > PRIVACY の新規行。Android API 33 未満では Switch を ON 固定・操作不可にし、理由を明示する文言を表示 |
| `app/settings/index.tsx`/`app/settings/hide-app-preview.tsx` | 新規行の追加、および「常時ブロックする」という古い説明文をバージョン別の正確な説明に修正 |
| `app/_layout.tsx` | `ScreenshotBlockProvider` を `DatabaseProvider` の内側（`AppLockProvider` の外側）に追加。`useScreenMask`（常時オン経路）は DB 不要のため従来通り `DatabaseProvider` の外側のまま |
| 設計判断記録 D-47・UI/UX §17 | 決定2の撤回を追記。UI/UX §17 のモックアップに「Block Screenshots」の行を追加 |

##### テスト

`lib/__tests__/screenMask.test.ts` を全面的に書き直し（25件）：`attemptScreenMask` の
OS・Android API レベルによる分岐（iOS は switcher のみ／Android 33+ は
`setRecentsScreenshotEnabledAsync` のみ／33 未満は `FLAG_SECURE`）、
`handleAppStateChangeForReapply` の API レベル別の再適用方式、新規
`applyScreenshotBlock`（有効化のたびの新規 key 発行、無効化時の全 key 解放、33 未満での
no-op）、`useScreenshotBlock`（`enabled` 変化での適用、Android での「有効時のみ」再適用、
iOS では購読しないこと）。`tsc --noEmit`・Jest スイート（215件）は全て通過を確認済み。

##### 実機確認（Android）

Pixel 11（API 34+、arm64-v8a）で確認。Settings > PRIVACY に「Block Screenshots」行が
既定 OFF で追加されていること、その状態で実際にスクリーンショットが撮れること
（＝分離前の「常時ブロック」ではなくなったこと）、ON にすると撮れなくなること、OFF に
戻すと再び撮れるようになること、この間 Recent Apps のサムネイルは常に非表示のままである
こと、いずれも確認済み。`setRecentsScreenshotEnabled` による分離が実機で意図どおり機能
している。Activity 再生成後の再適用（構成変更時）は今回未確認。

##### レビューで見つかり、修正したもの

コードは変更せず指摘のみを受けるレビュー。Android の設計方針自体（API 33+ で分離、
API 33 未満は Recent Apps 非表示優先）は CLAUDE.md・D-47 と一致していると確認された。

1. **【重大】`patches/expo-screen-capture+57.0.3.patch` がブランチごとに異なり、
   `fix/screen-mask-android14-registercallback`・`phase3/datetime-edit` の版には
   Gradle のビルド成果物（`.dex`・`results.bin` 等のバイナリ、181件）が混入していた**：
   実機ビルドを試した際に `node_modules/expo-screen-capture/android/build/` へ生成された
   Gradle の中間出力を、`npx patch-package expo-screen-capture` がそのまま差分として
   拾ってしまっていた（`.gitignore` は関係ない——patch-package は関知しない）。
   クリーンな `npm ci` 環境（EAS 含む）には `android/build` が存在しないため、この
   汚れたパッチが当たると不要なバイナリが書き込まれる、または適用自体が失敗する
   おそれがある（未検証）。`rm -rf node_modules/expo-screen-capture/android/{build,.gradle,.cxx}`
   で成果物を削除し、`--exclude "android/build|android/.gradle|android/.cxx"` を付けて
   再生成——170行のクリーンな内容になった。3ブランチすべてで作り直した
2. **【重大】`setRecentsScreenshotEnabled` の失敗が握りつぶされ、`attemptScreenMask()` が
   常に `{ active: true }` を返していた**：新規追加した Kotlin 側の `AsyncFunction` が
   `try/catch` で例外を `Log.e` に変換しており、JS 側の `preventScreenCaptureAsync` 同様
   reject されるべきものが、成功として resolve されていた。JS 側の
   `setRecentsScreenshotEnabledAsync` も、ネイティブ関数が無い場合に無言で `return`
   していた（他の関数は `UnavailabilityError` を投げる）。どちらも「確認できていない
   保護を表示しない」という D-47 の原則に反する後退——`preventScreenCaptureAsync` は
   元々 reject をそのまま返していた。Kotlin 側の `try/catch` を削除して例外を素通しし、
   JS 側は `UnavailabilityError` を投げるよう修正——`isRegistered`/`registerCallback`
   （画面マスクの起動時クラッシュ修正、別関数）の意図的な握り潰しとは無関係で、あちらは
   そのまま維持
3. **【中】iOS で無効化を挟まずに `applyScreenshotBlock(true)` を2回呼ぶと、ネイティブの
   レイヤー階層が壊れる**：`preventScreenshots()`（iOS）を2回連続で呼ぶと
   `originalParent` が上書きされ復元不能になる問題（ファイル冒頭のコメントに以前から
   明記）に、今回追加したテスト自身が正常系として抵触していた（本番経路では
   `useEffect([enabled])` の変化時にしか呼ばれず到達しにくいが、StrictMode の
   effect 二重実行等で将来踏みうる）。iOS では `activeScreenshotBlockKeys` が空でない
   （＝既に有効）ときは何もせず戻るガードを追加。テストも Android 側のシナリオに
   差し替え、iOS 専用に「2回目はネイティブへ到達しないこと」を確認するテストを追加した
4. **【中】ネイティブ呼び出しが失敗しても Settings の Switch が ON のまま**：
   `contexts/ScreenshotBlock.tsx` は DB への `setSetting` 成功後に `applyEnabled` を
   呼ぶだけで、その先の `applyScreenshotBlock` が失敗しても `logError` に残るだけ
   だった。`lib/screenMask.ts` の `applyScreenshotBlock` 自身の内部 `try/catch` を除去
   して例外を呼び出し元へ伝播させ（自動再適用パス側——`useScreenshotBlock` の
   Android resume・起動時の初回適用——は各呼び出し側で `catch` するよう変更）、
   `ScreenshotBlockProvider.setEnabled` が `applyScreenshotBlock` を先に `await` し、
   失敗したら DB 保存も `enabled` の更新もせずそのまま `throw` するよう修正。
   設定画面（`block-screenshots.tsx`）は `setEnabled` を呼んで失敗を検知し
   `Alert.alert` を表示する——Switch は Context の `enabled`（更新されていない）に
   直結しているため、追加のロールバック処理なしで自然に元の値へ戻る
5. **【軽微】Provider と設定画面が別々に DB を読んでいた**：4の修正と合わせて
   `contexts/ScreenshotBlock.tsx` を `enabled` の唯一の正本にし、設定画面は自前の
   `getSetting`/`setSetting` 呼び出しをやめて Context 経由に統一した
6. **【軽微】`hide-app-preview.tsx` の「WHAT THIS DOES」の説明文が、閲覧している
   端末によって内容が変わっていた**：Android の説明文が `ANDROID_LEGACY_FORCED_ON`
   （＝今動いている端末の API レベル）で分岐していたため、iOS 端末で読むと
   「Android では常に screenshots allowed」という、API 33 未満の制約を欠いた説明に
   なっていた。この参考説明は「今の端末で何が起きるか」ではなく「Android 全般で何が
   起きるか」を伝えるべき箇所のため、分岐をやめて両方のケースを常に説明するよう修正
   （デバイス依存の分岐は、チェックマーク直下の「今の端末で実際どうなっているか」の
   文言にのみ残した）
- **`patch-package` が `devDependencies` にある点**：`npm ci --omit=dev` では
  `postinstall` が走らずパッチが当たらない。EAS Build の既定設定はこれに該当しない
  ため対応不要と判断（指摘者も同意）
- **iOS・Android 13/14 の実機検証範囲**：iOS は実機ビルド自体が現状できない
  （CLAUDE.md 参照）。Android は Pixel 11 のみで確認——他の Android 13/14 端末や
  エミュレータでの `setRecentsScreenshotEnabled` の効き方の違いは未確認のまま
  Known gaps に残す

##### レビューで見つかり、修正したもの（2回目）

コードは変更せず指摘のみを受けるレビュー。1回目の修正6件（patch のクリーン化、失敗の
伝播、iOS 二重有効化ガード、設定画面のエラー表示、DB/Context の一本化、説明文の修正）は
いずれも意図どおりと確認された。「失敗を呼び出し元に伝える」という1回目の修正自体が
生んだ、新たな不整合が3件（🟡）見つかった。

1. **【中】iOS で有効化が一度失敗すると、次の有効化が無反応で「成功」扱いになっていた**：
   `applyScreenshotBlock` が `activeScreenshotBlockKeys.push(key)` を
   `preventScreenCaptureAsync(key)` の**前**に呼んでいたため、ネイティブ呼び出しが失敗
   しても key は配列に残ったままだった。次回の有効化はガード（`length > 0`）に引っかかり
   ネイティブへ到達せず即座に成功扱いになる——1回目の修正（指摘4）が防ぎたかった
   「Switch は ON なのに実際はブロックされていない」状態を、再試行の経路で再現していた。
   `push` を `await` の**後**に移動し、失敗時は key を一切追跡しないよう修正。
   「失敗後の再試行がネイティブまで届くこと」を確認するテストも追加した
2. **【中】起動時の適用が失敗しても Switch は ON のまま——コメントと動作が逆だった**：
   `contexts/ScreenshotBlock.tsx` の起動時 effect は `setEnabledState(value)` を
   `applyScreenshotBlock(true)` より**前**に呼んでいたため、適用に失敗しても
   `enabled` は `true` のままだった。コメントには「失敗時は switch off で表示される」と
   書かれていたが、実際の動作は逆——iOS には Android の resume 再適用のような回復手段が
   無いため、ON 表示のまま効いていない状態が起動のたびに続きうる。「`enabled` は DB の
   希望ではなく、実際に適用できた状態を表す」という方針に統一し、適用が成功した場合のみ
   `setEnabledState(true)` するよう修正
3. **【低】DB への保存が失敗すると、ネイティブ側の変更が元に戻らなかった**：
   `setEnabled` は `applyScreenshotBlock(next)` の成功後に `setSetting` を呼んでいるが、
   その `setSetting`自体が失敗すると、ネイティブは `next` のまま・DB は古い値のまま、
   という表示と実態がずれた状態が残っていた。`setSetting` 失敗時は
   `applyScreenshotBlock(!next)` でネイティブ側を元の状態に戻してから、元の例外を
   投げ直すよう修正（発生頻度は低いと判断しつつ対応）
4. **【軽微】`ScreenshotBlockProvider` の `useEffect(() => {...}, [db])` は `db` が
   途中で変わる場合を想定していないコメントが無かった**：現状 `DatabaseContext` の
   `db` はアプリ生存中に安定しており（§8.8 Recovery bootstrap 未実装のため、DB を
   差し替える経路自体が到達不能）、実害はまだ無いと判断——将来 Recovery bootstrap が
   実装され `db` が差し替わるようになった場合、旧 `db` に対して有効化していたブロックが
   ネイティブ側に残り得る点をコメントに明記するに留めた（指摘者も優先度低と同意）
5. **【軽微】`setRecentsScreenshotEnabledAsync` のコメントが実際の挙動と逆だった**：
   「Android 13 未満では `UnavailabilityError` を投げる」と書いていたが、実際には
   ネイティブ関数自体は全 Android バージョンに登録されており（Kotlin 側の
   `Build.VERSION.SDK_INT >= TIRAMISU` チェックが no-op にしているだけ）、
   `UnavailabilityError` が投げられるのは iOS/web（ネイティブ関数が存在しない）のみ。
   コメントを実態に合わせて修正した（`src/ScreenCapture.ts`・`build/ScreenCapture.js`・
   `build/ScreenCapture.d.ts` の3箇所）

`lib/__tests__/screenMask.test.ts` に1件追加（218件）。`tsc --noEmit`・Jest スイートは
全て通過を確認済み。`contexts/ScreenshotBlock.tsx` 自体の単体テストは追加していない
（`AppLockProvider` 等、他の Context も同様にテストなしという既存の方針に合わせ、
分岐ロジックの本体は引き続き `lib/screenMask.ts` 側でテストする）。

Pixel 11 で正常系の回帰確認済み：今回の修正はいずれも失敗時の経路のみを変更しており
（実機で意図的にネイティブ呼び出しを失敗させる手段は無いため、その分岐自体は上記の
Jest テストで検証）、Kotlin 側は無変更のため再ビルド不要——Metro のリロードのみで
確認。Block Screenshots の ON/OFF・実際のスクリーンショット許可/ブロックの切り替え・
Recent Apps サムネイルの非表示継続、いずれも1回目のレビュー後の確認と同じく問題なし。

##### レビューで見つかり、修正したもの（3回目）

A〜E の対応（2回目のレビュー）はいずれも意図どおりと確認された。A の修正自体が、
新しい問題を1件生んでいた。

1. **【中】有効化が一度失敗すると、そのセッション中は二度と無効化できなくなっていた**：
   `expo-screen-capture` 自身の `preventScreenCaptureAsync`/`allowScreenCaptureAsync`
   は内部で `activeTags` という `Set` を管理しており、**ネイティブ呼び出しの前に**
   key をこの `Set` へ追加し、失敗時にもロールバックしない（このファイル冒頭のコメントに
   常時オン経路向けとして以前から記載されていた、まさにその挙動）。2回目のレビューで
   「失敗した key は追跡しない」よう修正したが、`expo-screen-capture` 側の `activeTags`
   には失敗した key がそのまま残ってしまう——このアプリの追跡配列を空にしても、SDK 内部
   の `Set` は空にならないため、`allowScreenCaptureAsync` の `activeTags.size === 0`
   判定が成立せず、`allowScreenCapture()`（ネイティブの解除）に二度と到達しなくなる。
   具体的には「有効化 → 自動再適用が失敗（例: `MissingActivity`） → 次の再適用は成功 →
   無効化」という手順で、Switch は OFF 表示になってもスクリーンショットは
   ブロックされたまま、アプリ再起動まで戻らない。`preventScreenCaptureAsync` が失敗した
   場合、同じ key で `allowScreenCaptureAsync` を呼んで SDK 側の `Set` からも即座に
   解放するよう修正——ネイティブの `preventScreenCapture()` 自体は失敗時点ではまだ
   フラグを立てていないと考えられるため、直後の `allowScreenCapture()` 呼び出しは
   無害な空振りになる
2. 通常のモック（1回・成功/失敗を直接返すだけ）ではこの `activeTags` の状態遷移を
   再現できず、1〜2回目のレビューのテストでは検出できなかった——`activeTags` 相当の
   `Set` を自前で管理する専用モックを新設し、「失敗 → 成功 → 無効化」の手順で実際に
   ネイティブの allow に到達することを確認するテストを追加した（2件）

`lib/__tests__/screenMask.test.ts` に2件追加（220件）。`tsc --noEmit`・Jest スイートは
全て通過を確認済み。Kotlin・patch には触れていないため実機再確認は省略——Jest が通れば
十分と判断（レビューでもこの判断が示された）。

##### Known gaps

- **Activity 再生成後の再適用は未確認**：画面回転等の構成変更で Activity が再生成された
  直後に、Recent Apps 非表示・オプトインのスクリーンショットブロックのどちらも正しく
  再適用されるかは実機で確認していない
- **iOS は実機未確認**（CLAUDE.md 参照、Xcode 26.3 のコンパイラ不具合で `expo run:ios`
  自体ができない）

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

##### 追記（2026-09-19）：スコープを拡張し、Activity Detail の事後編集も実装

上記の判断は 設計判断記録 D-50 で明示的に上書きした——記録済み Activity の日時事後編集を
スコープに含める。`app/activity/[id].tsx` の DATE & TIME をタップすると、`app/record.tsx`
と同じネイティブ picker（`hooks/useNativeDateTimePicker.ts` + `components/
DateTimePickerSheet.tsx` に共通化——Android の連鎖ダイアログ／iOS の絶対配置シート）が開き、
この画面の他フィールドと同様、選んだ値は Save ボタンを押すまで DB に反映されない。日時
パッチの解決ロジックは `lib/datetime.ts` の `resolveOccurredAtEdit`（+その逆変換
`zonedComponentsToUtc`）に集約した——詳細と最終的な決定は D-50 本文参照。
`ActivityService.updateActivity` が `occurredAtUtc`/`occurredLocalDate`/`occurredLocalTime`/
`timezoneOffsetMinutes`/`timezoneId` を一括で更新できることを確認する統合テストを
`test/__tests__/activityService.integration.test.ts` に追加。UI 自体（`app/activity/
[id].tsx` の picker タップ→保存）は Pixel 11 実機で確認済み（下記「実機確認（Android）」
参照）。iOS は上記の理由で未確認のまま（Known gaps 参照）。

##### レビューで見つかり、修正したもの（1回目）

1. **【中】旅行先で編集すると、UTC 時刻と `timezoneId` が現在地のもので上書きされていた**：
   初版の `toLocalDate()` は、保存済みの現地日付・時刻（`occurredLocalDate`/
   `occurredLocalTime`）を**端末の現在のタイムゾーン**の時刻として読み直し、保存時も
   `getDeviceTimeZoneId()` でオフセットを計算し直していた。東京で記録した分をロサンゼルスで
   開いて分だけ直すと、`occurredAtUtc` が約17時間ずれ、`timezoneId` も
   `America/Los_Angeles` に変わってしまう——RECENT やカレンダーの並びが UTC 基準である以上、
   並び順まで壊れうる。`record.tsx` の「端末の現在ゾーン＝記録した瞬間のゾーン」という前提
   （新規記録だから成立する）を、事後編集にもそのまま流用したのが原因。1回目の修正では
   picker に実際の瞬間（`parseStrictUtcIso(activity.occurredAtUtc)`）を渡す形にしたが、
   これは表示の不整合という新しい問題を生んだ——2回目のレビュー参照
2. **【低〜中】一度変更したあと元の値に選び直しても「変更あり」のまま保存されていた**：
   「変更なしと確定」の判定が、記録済みの元の値ではなく直前に選んだ値
   （`customInstant`）と比較していた。変更→元に戻す、と操作すると `sync_version` が
   無意味に上がり、Health Connect 同期が有効なら不要な update ジョブまで積まれる。
   `resolveOccurredAtEdit` が、選んだ値を**記録済みの元の瞬間**と直接比較するようにした
   ことで解消した（この判定方式自体は2回目の修正後も変わっていない）
3. **【低】Android 共通化後も iOS 側の実装が2画面に重複していた**：`AppState` の
   listener・iOS シートの JSX・`pickerOverlay`/`pickerSheet` のスタイル・
   `pendingInstant`/`pickerBase`/`confirmIosPicker` が `record.tsx`/`app/activity/
   [id].tsx` にほぼ同じ形で存在し、`contexts/AppLock.tsx` が「両画面が守る」前提とする
   App Lock 対応（`<Modal>` を使わない、`AppState` 非 active で閉じる、`isLocked()` 再確認）
   が片方だけ直されて drift する危険があった。`hooks/useNativeDateTimePicker.ts`
   （state・`AppState` listener・open/confirm/cancel）と
   `components/DateTimePickerSheet.tsx`（iOS シートの JSX・スタイル）に切り出し、両画面から
   使う一つの実装にした
4. **【低】DATE & TIME をタップ可能にしたことで、スクリーンリーダーが日時を読み上げなくなって
   いた**：`accessibilityLabel="Change date and time"` が子 `Text`（実際の日時の値）の
   読み上げを上書きしてしまい、以前は自動的に読み上げられていた値が VoiceOver/TalkBack で
   読めなくなっていた（アクセシビリティの後退）。`accessibilityLabel` に表示中の日時の値
   そのものを入れ、操作の説明は `accessibilityHint` に移した
5. **【低】追加したテストが今回の新規ロジックを検証していなかった**：最初に追加した統合
   テストは、既存の `ActivityService.updateActivity` が日時 patch を受け付けることの確認に
   留まっていた（D-50 が「元々受け付けていた」と書いている部分）。日時を触っていないときは
   patch に含めない・元の値に戻したら無変更扱いにする・タイムゾーンの解決、という今回の
   新規ロジックは `resolveOccurredAtEdit` として純粋関数に切り出し、
   `lib/__tests__/datetime.test.ts` に単体テストを追加した
6. **【低】`sameMinute`/`clampToNow` の doc comment が `app/record.tsx` のみを参照した
   まま古くなっていた**：利用元が増えたことに合わせて更新した

##### レビューで見つかり、修正したもの（2回目）

1. **【中】記録時と別のタイムゾーンで編集すると、画面の表示・picker・保存値の「時刻」が
   ずれる**：1回目の修正で picker に実際の瞬間を渡すようにした結果、ネイティブ picker が
   その瞬間を**端末の現在ゾーン**で表示・編集することと衝突していた。東京 14:00 の記録を
   LA から開くと、タップ前のテキストは「14:00」（記録ゾーン）なのに picker は「前日
   22:00」（端末ゾーン）から始まり、23:00 を選んだ直後の表示は「23:00」（端末ゾーン）、
   保存して再読込すると「15:00」（記録ゾーン、UTC としては正しい）——テキストの「14:00」
   を見て「15:00 にしよう」と選んだつもりが、実際には東京時間の翌日 07:00 として保存
   される。UTC 自体は正しいが「表示だけの問題」とは言えない実害があった。修正：picker に
   渡す `Date` を「年月日・時分の数字を運ぶ入れ物」として扱う方式（初版の `toLocalDate` と
   同じ構築方法）に戻し、保存時にその数字を `activity.timezoneId` の時刻とみなして UTC に
   変換する（`lib/datetime.ts` の `zonedComponentsToUtc`、`resolveOffsetMinutesForZone` の
   逆変換）。これにより、テキスト・picker・保存後の表示のすべてが常に同じ記録ゾーンの
   時刻で揃うようになった。保存時の最終的な未来判定（`resolveOccurredAtEdit` 内の
   `clampToNow`）はゾーン解決した**後**の実際の瞬間に対して行うが、**picker 自身の
   内部の未来判定は端末の現在ゾーンと比較したままだった**——これは3回目のレビューで
   見つかった別の不具合として残った（下記「3回目」参照）
2. **【中】設計判断記録 D-50 の「決定」本文が、1回目の修正後の実装のまま更新されておらず、
   2回目の修正内容と食い違っていた**：「`timezoneId` は…常に端末の現在の IANA ゾーンを
   使う」という記述が残っていた。設計判断記録は「再議論しないための参照元」であるため、
   ここが古いままだと将来の実装者が誤った方針に戻しかねない。D-50 本文を現在の実装
   （`hooks/useNativeDateTimePicker.ts`・`components/DateTimePickerSheet.tsx`・
   `resolveOccurredAtEdit`・`zonedComponentsToUtc`）に合わせて書き直した
3. **【低】`load` の `useCallback` 依存配列に `reset`（`customInstant` を `null` に戻す
   関数）が入っていなかった**：実害はない（`reset` は安定した `setCustomInstant` を
   呼ぶだけ）が、`hooks/useNativeDateTimePicker.ts` 側で `reset` を `useCallback` で
   安定させたうえで、`load` の依存配列に追加した

##### レビューで見つかり、修正したもの（3回目）

1. **【中】記録ゾーンが端末より東にあると、picker 内部の丸め処理が正しい過去の時刻を
   無言で別の時刻に置き換える**：2回目の修正で picker には「数字の入れ物」を渡すように
   したが、その入れ物の**未来判定**（Android の連鎖ダイアログ内の丸め・両プラットフォーム
   の `maximumDate`）は直さないままだったため、依然として実際の「今」（`new Date()`）と
   比較していた。東京で記録した分を、ロサンゼルスで「今が LA の 9/19 10:00（＝東京の
   9/20 02:00）」というタイミングで編集するケース：東京の 9/20 01:00 は正しい過去の
   時刻だが、その数字を端末（LA）換算でそのまま「未来」と判定してしまい、picker 内部で
   無言で「今」の数字（LA の 9/19 10:00）に置き換わる。保存時にはそれが東京時間として
   解決され、利用者が選んでいない、何も表示されない別の時刻が保存される。修正：
   `lib/datetime.ts` に `nowAsZonedDigits(timezoneId)`（「今」を指定ゾーンの数字の入れ物
   として表す関数）と汎用の `clampTo(date, max)` を追加し、`hooks/
   useNativeDateTimePicker.ts` に `getMax` を新設（`app/record.tsx` は従来どおり
   `() => new Date()`、`app/activity/[id].tsx` は `() => nowAsZonedDigits(activity.
   timezoneId ?? getDeviceTimeZoneId())`）。`lib/androidDateTimePicker.ts`
   （`maximumDate`・連鎖後の丸め）と iOS シートの `maximumDate` の両方をこれに揃えた。
   保存時の権威ある `clampToNow`（`resolveOccurredAtEdit` 内、実際の瞬間どうしの比較）は
   変更していない——今回直したのはあくまで Save 前の picker 自身の目安
2. **【低】端末のゾーンで存在しない時刻（夏時間の切り替わりのギャップ）を読み込むと
   1時間ずれる**：`toLocalDate` が `new Date(y, m, d, hh, mm)` で数字の入れ物を組み立てる
   際、その数字が端末の現在ゾーンで夏時間の「飛び」に当たっていると（例：東京 02:30 の
   記録を、米国が夏時間入りする当日に NY の端末で開く）、JS の `Date` が黙って1時間
   繰り上げる。既存の DST ギャップの既知の制限（`lib/androidDateTimePicker.ts` 参照）と
   同種の、稀な未対応ケースとしてコメントに残すのみとした
3. **【低】`hooks/useNativeDateTimePicker.ts` の doc comment が古いままだった**：
   `getBase` の説明が「Activity Detail: the already-recorded instant」のままで、実際は
   瞬間ではなく数字の入れ物であることを反映していなかった。`getMax` の追加と合わせて
   書き直した

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

#### 実機確認（Android）

Pixel 11（API 34+、arm64-v8a）で確認。`fix/screen-mask-android14-registercallback`
（画面マスクの起動時クラッシュ修正、上記参照）を取り込んだうえでビルド・確認した。
「Just now」/「Change date & time」の2行表示、date→time の連鎖ダイアログ、未来日時が
選べないこと、未変更確定で値が固定されないこと、「Use now instead」での復帰、Solo/
Partnered の通常記録、いずれも問題なし。iOS は上記「iOS ローカルビルドがブロック中」
（CLAUDE.md 参照、Xcode 26.3 の Swift/C++ コンパイラ不具合）のため未確認のまま。

Activity Detail の DATE & TIME 編集は、Pixel 11 で日付変更 → Save → force-stop →
再起動後も永続化されることを確認済み（2026-09-21）。

#### Known gaps

- **iOS の実機/シミュレータでの動作確認が未実施**：CLAUDE.md 参照（Xcode 26.3 の
  コンパイラ不具合で `expo run:ios` 自体ができない、op-sqlite とは無関係）。iOS の
  spinner の見た目・操作感、`AppState` での dismiss が実機で確実に効くことは未確認
- **タイムゾーン選択 UI は無い**（§4.4 既知の制限、Phase 1 から変更なし）：旅行先の
  出来事を帰国後に入力すると、常に現在地（デバイスの現在の IANA タイムゾーン）のオフセットが
  適用される
- **Activity Detail の事後編集（D-50, 2026-09-19 追加）は Android 実機で確認済み、
  iOS は未確認**：Pixel 11（実機・USB接続）で `app/activity/[id].tsx` の DATE & TIME
  タップ→date→time の連鎖ダイアログ→未来日時が選べないこと（`maximumDate`）→Save→
  Today 画面（RECENT の並び替え・LAST ACTIVITY）・詳細の再読込のいずれも正しく反映
  されることを確認した（2・3回目のレビュー修正後も再確認済み）。iOS は上記「iOS
  ローカルビルドがブロック中」のため未確認のまま。**端末のタイムゾーンと記録済みの
  タイムゾーンが異なるケース**（2・3回目のレビューで修正した箇所）は、実機の言語/地域
  設定を変えずに再現するのが難しいため実機確認はしておらず、`lib/__tests__/
  datetime.test.ts` の `resolveOccurredAtEdit`/`zonedComponentsToUtc`/
  `nowAsZonedDigits` テストでのみ検証している
- **Android の DST ギャップ（存在しない時刻）は未対応**：上記レビュー #6 参照。既知の制限として
  コメントに残すのみ（`app/activity/[id].tsx` の `toLocalDate` にも同種の未対応ケースが
  あり、3回目のレビュー #2 で同じ扱いとした）
- **未来時刻を選ぶと無言で現在時刻に丸められる**：上記2回目レビュー #4 参照。実機（Android）で
  確認済み、仕様として許容する
- **TODO（v1.1 候補）：「その日」の境界（現地 00:00、§4.5）が固定で変更できない**：
  実機確認時にユーザーから指摘。記録が深夜に集中しやすいというこのアプリの性質上、
  例えば深夜1〜4時台の記録が「前日」に割り当てられることが常態化しうる。時間帯統計は
  §14 で循環ウィンドウ計算により日跨ぎに対応済みだが、**カレンダー・月次集計上の
  「その日」の割り当て自体**（`occurred_local_date` の算出基準そのもの）は現状 v1 で
  確定した設計判断（設計判断記録「その日の境界は現地 00:00」）であり、変更するには
  「区切り時刻を設定可能にする」という新しい設計判断が要る——`occurred_local_date` は
  既に保存時に確定した値であり、区切り時刻を後から変えると過去データの再計算が必要になる
  点も含めて検討が要る。今回は実装せず、次の設計判断記録レビュー時の検討事項として記録する
  のみ

### Appearance

UI/UX §17 PREFERENCES「Appearance」。ダーク/ライトの描画自体は Phase 1 から
`constants/theme.ts`（OS の `useColorScheme()` に追従）で実装済みで、DB スキーマにも
`preferences.appearance`（`'system'|'light'|'dark'`）が既にあった。未実装だったのは
Settings 画面での切替 UI のみ。

`contexts/Appearance.tsx`（`AppearanceProvider`、`useAppearanceSetting`）が
`preferences.appearance` の読み書きを担い、`constants/theme.ts` の `useTheme()` は
`'system'` 以外が選ばれていれば OS のダーク/ライト判定を上書きする。
`app/settings/appearance.tsx` が System/Light/Dark を選ぶ新画面、`app/settings/index.tsx`
に PREFERENCES セクションと Appearance 行を追加した（§17 モックの First Day of Week /
Time Format は未実装のため、他の未実装セクションと同じ理由でプレースホルダー行は置いていない）。

#### 循環インポートによるクラッシュ（実機で発見、修正済み）

初回実装では `AppearanceContext` を `contexts/Appearance.tsx` に直接定義し、
`constants/theme.ts` がそこから import していた。これが
`theme.ts → contexts/Appearance.tsx → contexts/DatabaseContext.tsx → constants/theme.ts`
という循環 import を作ってしまい、実機（Android, Pixel 11）で起動直後に
`RecoveryScreen.tsx` の `StyleSheet.create({ ... spacing.md ... })` が
`Cannot read property 'md' of undefined` で落ちた——循環の途中で読み込まれた時点では
`theme.ts` の `spacing` エクスポートがまだ未初期化だったため。
`AppearanceContext` の定義だけを依存の無い独立ファイル `constants/appearanceContext.ts`
に切り出し、`theme.ts`・`contexts/Appearance.tsx` の両方がそこから読む形にして解消した。

#### React Navigation のヘッダーがテーマに追従していなかった（実機で発見、修正済み）

`app/_layout.tsx` の `<Stack>` はヘッダー用の `screenOptions` を渡しておらず、
React Navigation のデフォルト（常にライト配色）のままだった。画面の中身は
`useTheme()` で正しくダーク表示されるため、Settings/Appearance 等のヘッダーバーだけ
白く浮いた状態になる——Phase 1 から存在した見た目の不整合だが、テーマ切替が無かった
これまでは「OS がダークならアプリ全体もダーク、ただしヘッダーだけ常に白」という状態が
常態化しており目立たなかった。Appearance 画面を Light に切り替えた直後に実機で発覚。

`<Stack>` に `headerStyle`/`headerTintColor`/`headerTitleStyle` を `useTheme()` の
`colors` から渡すよう修正。ただしこの `useTheme()` 呼び出しは `AppearanceProvider` の
**内側**の子コンポーネント（新設した `AppShell`）で行う必要がある——`RootLayout` 自身は
`AppearanceProvider` の外側（`DatabaseProvider` の子として `AppearanceProvider` を
レンダーする側）にあり、そこで直接 `useTheme()` を呼ぶと override を見つけられない
（`DatabaseProvider` 自身が `useTheme()` を呼ぶ理由と同じ制約、
`contexts/Appearance.tsx` の doc comment 参照）。

#### 画面遷移中、右端に薄い帯が残っていた（実機レビューで発見、修正済み）

上記2つの修正後も、実機で Settings 系画面をスワイプバック（または戻る）すると、
遷移の途中で右端に薄い帯（ライト/ダーク双方の理論値とも異なる中間色）が一瞬見える
問題が残っていた。原因はネイティブ側に2つあった。

1. **`android:windowBackground` に dark 版が無い**：`android/`（`expo prebuild` で
   都度生成、gitignore 対象）の `values/colors.xml` は `activityBackground`
   （`AppTheme` の `windowBackground` が参照）を `#F8F7FA`（ライト）固定で定義して
   いたが、`values-night/colors.xml` は空。`contentStyle`（各画面自身のコンテナ）は
   両方の画面のどちらの内側にも入らない、**ウィンドウそのものの背景**までは
   届かない——遷移中に両画面のどちらにも覆われていない領域はこのウィンドウ背景が
   透けて見える。`plugins/withAndroidNightColors.js`（Config Plugin、
   `withDangerousMod` で `values-night/colors.xml` を生成）を追加し、
   `constants/theme.ts` の `darkColors.background`（`#121615`）と同じ値を
   dark 版として与えた。
2. **Android の Day/Night モード自体が OS 設定に固定されたまま**：(1)を直しても、
   `AppCompatDelegate` の Day/Night モードを切り替える経路がどこにも無ければ、
   アプリ内で Dark を選んでも Android 側は「今は昼モード」のままなので (1)の
   dark 版リソースへ切り替わらない。`contexts/Appearance.tsx` に
   `Appearance.setColorScheme('light'|'dark'|'unspecified')`（React Native 0.86,
   Android 実装は `AppearanceModule.kt` 経由で
   `AppCompatDelegate.setDefaultNightMode()` を呼ぶ）を追加し、選択が変わるたびに
   ネイティブの Day/Night モード自体も切り替えるようにした。

ここまでで帯はほぼ収まったが、実機で `adb shell screenrecord` を使い
遷移中のフレームを抜き出して確認したところ、まだ薄いグレーの帯が数フレーム残って
いた。原因は `AndroidManifest.xml` の `MainActivity` が
`android:configChanges="...|uiMode|..."` を宣言していること——RN アプリでは
システムのテーマ変更で Activity が破棄・再生成される（＝ JS ランタイムが落ちる）のを
防ぐための標準的な設定だが、副作用として `AppCompatDelegate.setDefaultNightMode()`
を実行時に呼んでも、**Window 自体が生成時に確定させた背景は自動では再読込されない**。
`expo-system-ui`（インストール済み）の `SystemUI.setBackgroundColorAsync()` は
Day/Night のテーマ解決経路を経由せず、ルートビューの背景色を直接設定するため、
この再読込の欠落を回避できる。`AppShell` に `useTheme()` の `colors.background` が
変わるたびに呼ぶ `useEffect` を追加し、これで解消を確認した（`screenrecord` で
遷移を録画し `ffmpeg` でフレームを抜き出して右端の色をサンプリングし、帯が
消えたことを数値でも確認済み）。

#### ステータスバーのアイコン色が追従していなかった（実機レビューで発見、修正済み）

上記の Day/Night 切り替えだけでは、ステータスバーのアイコン色（`expo-status-bar`
が管理する、Day/Night とは別のレイヤー）は追従しない。OS がダークでアプリ内を
Light にすると、白いアイコンが白い背景に重なって読めなくなっていた。`AppShell` に
`<StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />` を追加して解消。

#### Import（置き換え復元）後に外観が更新されない問題（実機レビューで発見、修正済み）

`preferences.appearance` は `EXPORTABLE_SETTING_KEYS` に含まれるため、Import の
置き換え復元で DB 上の値が書き換わりうる。しかし `AppearanceProvider` は元々
`DataRevisionProvider` の外側（`app/_layout.tsx`）にあり、`useDataRevision()` の
`revision`（Import 完了時に `bump()` される、§9 Undo のための「何か変わった」
シグナル）を購読できず、Import 直後もアプリ再起動まで外観が古いままになる余地が
あった。Provider の入れ子順序を `DatabaseProvider > DataRevisionProvider >
AppearanceProvider > ...` に入れ替え、`AppearanceProvider` の DB 再読み込み
`useEffect` の依存配列に `revision` を追加した。

#### 実機確認（Android）

Pixel 11（API 34+、arm64-v8a）で確認。System/Light/Dark の切替、OS がダークでも
Light 選択時にアプリ全体（画面本体・ヘッダーバー・ステータスバー・画面遷移中の
ネイティブ背景とも）がライト表示に上書きされること、その逆（OS ライト・アプリ内
Dark）も同様に確認、アプリを強制終了して再起動しても選択が保持されること
（DB 永続化）を確認済み。iOS は「iOS ローカルビルドがブロック中」（CLAUDE.md 参照）
のため未確認——iOS 側は `Appearance.setColorScheme()` の実装が Android と異なる
（`overrideUserInterfaceStyle` 相当のはず）ため、Android での確認だけでは
iOS の動作を保証しない。

**`System` 選択時、OS のテーマ変更後の反映も確認**（コードレビューで「`'unspecified'`
への復帰は RN のバージョンによって不具合報告がある」と指摘され、追加で検証）：
`adb shell cmd uimode night yes/no` で OS 側のテーマを強制的に切り替え、アプリ内で
`Dark`/`Light` から `System` に戻す→即座に新しい OS テーマへ切り替わることをその場で
（アプリ再起動なし）確認。さらにアプリを強制終了して再起動しても正しい OS テーマで
起動することを、双方向（OS ライト・OS ダーク）×複数回のコールドスタートで確認。
**ただし1回だけ**、OS テーマを切り替えた直後（1秒未満）に強制終了→即再起動した
ケースで、起動時に古いテーマのまま表示される事象が発生した。原因は未特定——
`AppCompatDelegate.setDefaultNightMode()` はプロセス内メモリの状態でしかなく
（`SharedPreferences` への永続化は行っていないはず。React Native の
`AppearanceModule` 側にもそうした永続化処理は無い、コード上未確認）、レビューで
指摘の通りその線の推測は誤り。`cmd uimode` による OS 側の変更が全体に行き渡る前に
アプリのプロセスが起動した、など OS 側のタイミングに起因する可能性の方が高いが、
確認できていない（コミットや通常の操作ペースでは起きない、OS 側テーマ変更と
アプリの強制終了をほぼ同時に行った場合のみの再現）。その後の同条件での再現は取れず、
それ以降は毎回正しく起動した。実利用でこの競合が起きる可能性は低いと判断し、既知の
制限として下記に記録するに留め、追加の対策は入れていない。

#### Known gaps

- **First Day of Week / Time Format は未実装**：§17 モックには同じ PREFERENCES
  セクションにあるが、今回のスコープは Appearance のみ
- **iOS は実機/シミュレータでの動作確認が未実施**：CLAUDE.md 参照。上記の
  Day/Night・ステータスバー・ウィンドウ背景まわりの修正は Android 固有の実装を
  含むため、iOS で同じ視覚的な不整合が起きないかは未検証
- **OS テーマ変更とアプリの強制終了がほぼ同時に起きた場合の稀な競合**：上記
  「実機確認」参照。1回だけ再現し、それ以降は再現しなかった。実利用での発生可能性は
  低いと判断し、追加対策はしていない
- **起動直後、一瞬だけ OS の配色で表示される**：`AppearanceProvider` は
  `preferences.appearance` を DB から非同期に読み込むため、その読み込みが終わる
  までの間（数十 ms 程度）は初期値 `'system'` で描画される。保存されている値が
  OS の配色と異なる場合（例：OS はライトだが保存値は Dark）、起動のたびに一瞬
  OS 配色→保存値、と切り替わって見える。`contexts/ScreenshotBlock.tsx` の
  `enabled` 初期値やその他の DB 由来設定と同じ「読み込み前は無効/既定値」という
  既存パターンに合わせたもので、今回はスプラッシュを追加で引き延ばすような対応は
  していない
- **`DatabaseProvider` 自身のローディング/Recovery 画面は Appearance を見ない**：
  `contexts/Appearance.tsx` の file doc comment の通り意図的な制約——
  `AppearanceProvider` は DB 接続確立後にしかマウントできないため、DB 接続前の
  画面はこの override を原理的に見られない（OS の配色のみに従う）。ユーザーから
  見れば見た目が完全には統一されないが、許容する仕様として扱う

### 表示項目のカスタマイズ（§6.3、2026-09-21、実装完了）

要件定義書 §6.3／UI/UX Screen 07a。v1.0 必須（要件定義書 §25）で唯一
まるごと未実装だった機能。`types/Settings.ts` の `activityDetails.*` 6キー
（既定：Orgasm と Notes のみ ON）自体は Phase 1 から存在していたが、
画面コード（`app/activity/[id].tsx`）からは一切参照されておらず「設定の器
だけがある」状態だった（記録・詳細の出し分けのうち、実際に項目入力欄を
持つのは Activity Detail 画面のみ——Quick Record（`app/record.tsx`）は
§6.4「詳細項目は Quick Record では一切尋ねない」により項目入力欄自体が
無いため、出し分けの対象外）。

#### 実装内容

1. **[lib/activityDetailsFields.ts](lib/activityDetailsFields.ts)（新規）**：
   6項目の `{ field, settingKey, label }` 一覧と、可視性判定の純粋関数
   `isFieldVisible`/`hasRecordedValue` を集約。§6.3 の不変条件「記録済みの
   値は、表示項目の設定に関わらず常に表示する」を満たすため、可視性は
   設定値だけでなく `Activity` の実データ（読み込み時点のスナップショット）
   からも判定する。Mood before/after は Screen 07a のモック通り
   `activityDetails.mood` という単一キーで両方をまとめて出し分ける
2. **[app/settings/activity-details.tsx](app/settings/activity-details.tsx)（新規）**：
   6項目のトグル画面。`app/settings/block-screenshots.tsx` と同じパターン
   （`Switch` + 失敗時ロールバック）。文言は Screen 07a のルール
   （属性推定を匂わせない、既定値の理由を説明しない、OFF を「表示しない」と
   表現する）にそのまま従った
3. **`app/settings/index.tsx`**：PRIVACY/HEALTH/DATA と PREFERENCES の間に
   TRACKING セクションを追加（§17 Screen 07 のモックのセクション順）
4. **`app/activity/[id].tsx`**：6項目それぞれを `isFieldVisible` の結果で
   条件レンダリングに変更。可視性は `load()` 時点で読み込んだ `activity`
   （安定したスナップショット）から計算し、編集中のライブな入力値からは
   計算しない——そうしないと、値をクリアした瞬間にフィールド自体が消える
   という事故になる
5. **[components/AddMoreDetailsSheet.tsx](components/AddMoreDetailsSheet.tsx)
   （新規）**：§6.3「その他の項目を追加」という逃げ道。非表示中の項目を
   一覧表示し、タップした項目をその場（この記録限り、`revealed` state）
   だけ表示する。永続化しない——次にこの画面を開いたときは設定と記録済み
   値の判定に戻る。`DateTimePickerSheet` と同じ理由（App Lock オーバーレイ
   がネイティブ `<Modal>` の外側を覆えない、`contexts/AppLock.tsx` 参照）で
   素の絶対配置 `View`。ただし `DateTimePickerSheet` は iOS 専用でハード
   ウェアバックに遭遇しないのに対しこちらは Android でも出るため、
   `BackHandler`（`contexts/AppLock.tsx` と同じパターン）を明示的に登録
   ——無いと Android のバックキーでシートではなく画面自体が pop していた
   （1回目のレビューで指摘、修正済み）
6. **Screen 04「Partnered の場合」**：`isFieldVisible` は `context ===
   'partnered'` のとき Protection を常に表示する（設定・記録済みに関わらず）
   ——「Solo で選べないようハードゲートはしない」なので Solo 側は通常通り
   設定/記録済み/revealed のルールに従う。当初実装から漏れていた仕様の
   1項目（1回目のレビューで指摘、修正済み）。Health Connect が送るのは
   時刻と避妊具使用の有無のみ（Screen 08）のため、これが漏れていると
   Partnered の記録で HC 同期の実質的な中身が常に空になりやすい方向に
   効く、という実害の指摘も受けた。**「既定表示」を文字通りではなく
   「常時表示（設定で隠せない）」として実装したのは意図的な解釈**——
   設定モデルが単一 boolean のため「未設定の既定 OFF」と「明示的な OFF」
   を区別できず、文言通りの実装には tri-state 化かコンテキスト別キーが
   要る（v1 スコープ外）。理由・却下した代替案・受け入れる帰結は
   [設計判断記録 D-52](docs/Solo%20+%20Us_設計判断記録%20v0.11.md#d-52-partnered-の-protection-は既定表示ではなく常時表示として実装する)
   参照（2回目のレビューで、README だけでなく設計判断記録に残すべきと
   指摘され追加）。Settings 画面のキャプションにも「Protection is also
   always shown for partnered activities.」を追記し、OFF にしたのに
   Partnered で表示され続ける理由が利用者に伝わるようにした

#### テスト

- `lib/__tests__/activityDetailsFields.test.ts`：`hasRecordedValue`
  （false/0・空文字列を「未記録」と混同しないこと、mood が before/after
  いずれかで記録済み扱いになること）・`isFieldVisible`（設定 ON／記録済み
  ／revealed の3経路それぞれで可視になること、いずれにも該当しなければ
  非表示になること、Partnered で Protection が既定表示されること、この
  既定表示が Solo や他フィールドには波及しないこと）——11件
- 画面コンポーネント自体（`app/`）はこのプロジェクトに前例が無く
  ユニットテスト対象外——`npx tsc --noEmit` の型チェックと全テスト
  スイート（28スイート・398件）のパスのみで検証した

#### 実機確認（Pixel 3、2026-09-21）

Settings > Activity Details → TRACKING セクションの新規行から遷移でき、
6項目のトグルは既定通り Orgasm/Notes のみ ON で表示された。Ejaculation を
ON にして Activity Detail 画面を開くと Orgasm/Ejaculation/Notes のみ表示
され、Protection/Duration/Mood は非表示、「+ Add more details」が現れた。
そのシートで Protection をタップすると即座にフィールドが現れ（シート自体は
開いたまま、シートの一覧からは消える）、値を入力して保存できた。**不変
条件の検証**：保存後、Settings で Ejaculation を OFF に戻してから同じ
Activity を再度開いたところ、Ejaculation（未記録）は設定通り非表示に
戻った一方、Protection（記録済み）は設定が OFF のままでも表示され続けた
——§6.3「記録済みの値は、表示項目の設定に関わらず常に表示する」が実機で
意図通り動作することを確認した。

**2回目のレビュー指摘を受けた再検証**：Partnered で新規記録すると、
Protection が設定 OFF・未記録のまま既定表示されることを確認した。
「+ Add more details」を開いた状態でハードウェアバックキーを押すと、
画面全体ではなくシートだけが閉じることを確認した（修正前は画面が pop
していたはずの経路）。残り3項目（Ejaculation/Duration/Mood before &
after）を1つずつ「+」で追加していき、最後の1件（Mood）を追加した時点で
シートが自動的に閉じることを確認した。

#### Known gaps

- **iOS は未確認**（CLAUDE.md 参照、iOS ローカルビルドがブロック中のため
  この機能固有の問題ではない）
- **Android の TalkBack で AddMoreDetailsSheet 表示中に背後のフォームへ
  到達できないことは未確認**：`app/activity/[id].tsx` の `ScrollView` に
  `accessibilityElementsHidden`/`importantForAccessibility="no-hide-
  descendants"` を `contexts/AppLock.tsx` と同じパターンで実装したが、
  TalkBack を有効にした実機での確認はしていない
- **`AddMoreDetailsSheet` の「Mood before」「Mood after」を1行に統合して
  いるのは Screen 04「+ Add more details」の元モック（2行に分けて列挙）
  からの意図的な逸脱**：Screen 07a の設定が `activityDetails.mood` という
  単一キーで両方を一括制御する以上、シート側だけ個別に分けると「before は
  reveal 済み・after は未 reveal」という設定側には存在しない状態が生まれる
  ため、単一キーに揃えた（詳細は `lib/activityDetailsFields.ts` のコメント
  参照）
- **§10.6「全 Activity 削除」等、将来この画面に破壊的操作が増える場合の
  再検討は対象外**：本項は表示項目の出し分けのみのスコープ

### Preferences・About（表示系、2026-09-21、実装完了）

Settings 画面の「スコープの判断」（上記 App Lock の節）で先送りにしていた
残り2セクションのうち、表示系の Preferences・About に着手した。**Delete
Data（§10.6）は破壊的操作で `SyncCoordinator.runExclusive` を要する別種の
作業のため、意図的に対象外とし別タスクとして扱う**（ユーザーとの相談で
確認済み——CLAUDE.md「Health Connect 同期の排他制御」参照）。

#### 実装済み

| 層 | 内容 |
|---|---|
| `app/settings/first-day-of-week.tsx`（新規） | Monday/Sunday の選択画面。`preferences.firstDayOfWeek` は Phase 1 から存在し `screens/CalendarScreen.tsx` 等が既に参照していたが、値を変える UI が無い「設定の器だけがある」状態だった（§6.3 着手前の `activityDetails.*` と同じパターン）。`app/settings/appearance.tsx` と同じラジオ選択の見た目 |
| `app/settings/time-format.tsx`（新規） | 12-hour/24-hour の選択画面。`preferences.timeFormat` も同様に器だけの状態だった |
| `app/settings/about.tsx`（新規） | 「About Solo + Us」。要件定義書 §3.1/§3.2（コンセプト・原則）と §19.1（プライバシー基本方針）に基づく事実のみで構成——Insights 同様、評価的な文言（§16 で禁止されている「Better sexual health.」的な言い回し）を混入させないよう明記 |
| `components/SettingsOptionScreen.tsx`（新規） | 単一選択のラジオ選択画面の共通レイアウト。`appearance.tsx`/`first-day-of-week.tsx`/`time-format.tsx` の3画面目でほぼ同一実装が重複したため抽出（下記レビュー参照）。値の読み込み・永続化はデータソースが画面ごとに異なる（Appearance は Context、他2画面は `SettingsRepository` 直読み）ため各画面側に残し、本コンポーネントは表示のみを担う |
| `app/settings/index.tsx` | PREFERENCES に First Day of Week/Time Format の2行を追加。ABOUT セクションを新設し「About Solo + Us」「Version」を1つの `SettingsGroup` にまとめた（§17 モックが3行を1カードで示しているため——下記レビュー参照）。バージョンは `Application.nativeApplicationVersion`（`expo-application`）から読む——`app.json` を直接 import する案は「JSバンドルのビルド時点の値」であり実際にインストールされているネイティブバイナリのバージョンとは限らない（OTA更新等で乖離しうる）ため、レビュー指摘を受けて変更した |
| `app/_layout.tsx` | 上記3画面の `Stack.Screen` タイトルを追加 |

**「Privacy Policy」行は意図的に未実装**（§17 のモックには行タイトルの
記載があるのみで、本文の指定はどこにもない）。このアプリは Health
Connect の `WRITE_SEXUAL_ACTIVITY` 権限を使うためストア審査上も実効性の
あるポリシーが要るが、法的文言をこちらで創作して埋めるべき内容ではない
と判断し、ユーザーに確認した。**結論：外部にホストされた URL へのリンクと
して実装する方針。ただし URL は現時点で未確定**のため、プレースホルダー
URL や「Coming soon」行は作らず（本ファイルの一貫した方針——上記 App Lock
の節参照）、URL が用意でき次第この行を追加する。

#### First Day of Week/Time Format の反映先についての注意

`screens/CalendarScreen.tsx` は3タブ構成のページャの1タブであり、
Settings への画面遷移では unmount されない（`isActive` は「どのタブが
表示中か」を表すだけで、Settings 画面がその上に push されている間も
`true` のまま保持される）。そのため設定変更後にタブへ戻っただけでは
`reload` の `useEffect`（依存配列 `[isActive, reload, revision]`）は
再発火しない。両画面とも保存成功時に `useDataRevision().bump()` を呼ぶ
ことで、Calendar 側の再読み込みをトリガーする（`contexts/DataRevision.tsx`
の「画面遷移で拾われない書き込みは bump を呼ぶ」という既存規約どおり）。
**この `bump()` は Calendar タブにとって必須**——呼ばなければ設定変更が
画面に反映されるのはアプリ再起動後になる。`app/record.tsx`/`app/activity/
[id].tsx` は毎回マウント時に自前で `getSetting` するため、この2画面に
限ってはこの `bump()` が無くても正しく動くが、Calendar 側の必須性から
両画面とも呼んでいる。

**副次的な影響（2026-09-21 レビュー指摘）**：`contexts/SyncWorkerLoop.tsx`
も同じ `revision` を購読しているため、表示設定を変更するたびに Health
Connect の `drainDueJobs` が呼ばれる。`drainingRef` により直列化されて
おり実害は無い（CLAUDE.md の「drain トリガを増やす際は `SyncWorkerLoop`
の直列化を経由すること」にも、経由しているため違反しない）が、「表示
設定の変更＝同期ワーカー起動」は意図した設計ではない副作用として認識
しておく。将来 `bump()` の粒度を分ける（Activity データの変更とその他の
表示設定変更を別カウンタにする等）動機になり得る。

#### レビューで見つかり、修正したもの

1. **【中】Version が `app.json` の直 import だった**：JSバンドルのビルド
   時点の値であり、実際にインストールされているネイティブバイナリの
   バージョンとは限らない（OTA更新でバンドルだけ差し替わった場合や、
   将来 `app.config.js`/EAS の `appVersionSource: remote`/`autoIncrement`
   を導入した場合に乖離しうる）。`expo-application` の
   `nativeApplicationVersion`（`null` の場合のみ `app.json` の値へ
   フォールバック）に変更した。この変更で `expo-application`/
   `expo-constants`（Phase 1 から package.json にあるが未使用だった）が
   初めてネイティブ側でリンクされるため、Android のネイティブ再ビルドが
   必要だった（`npx expo-modules-autolinking resolve` で事前に解決対象へ
   含まれることを確認してから実行——スキーマ変更は無いためアンインストール
   は不要、CLAUDE.md 参照）
2. **【中】About の PRIVACY が Health Connect 同期・Export 平文に触れて
   いなかった**：「Your activity data stays on this device, encrypted」
   だけでは、Health Connect 同期を ON にした場合に日時・避妊具使用の
   有無が Health Connect 側（＝他アプリが読み得る場所）にも書かれること
   や、Export ファイルが平文であること（§19.2 の必須要件）が伝わらない。
   `app/settings/health-connect.tsx`/`app/settings/data.tsx` が実行画面
   側で個別に明示している事実と同じ内容を、新しい文言を創作せず2行
   追加した
3. **【低】First Day of Week/Time Format の変更が Health Connect の
   drain も起動する**：上記「反映先についての注意」に追記して対応（コード
   変更ではなく、意図した設計ではない副作用として明示するドキュメント
   対応）
4. **【低】`useFocusEffect` の非同期ロードに未マウント/再フォーカス時の
   キャンセルが無かった**：保存直後に再フォーカスが重なると、in-flight
   だった古い `getSetting` の結果が新しい保存値を上書きする余地があった。
   `contexts/Appearance.tsx` の読み込み effect が既に使っている
   `let cancelled = false` のクリーンアップパターンを2画面に追加した
5. **【低】保存失敗時のロールバックが型上 `null` を書き戻しうる**：
   `persist` の先頭に `value === null` のガードを追加し、ロールバック対象
   が常に非 `null` であることを保証した（現状 `value === null` の間は
   Loading 表示でタップ不可のため実害は無いが、型で保証されない限り将来の
   変更で壊れうる）
6. **【低】Loading 分岐の `SafeAreaView` に `edges={['bottom']}` が無い**：
   `appearance.tsx` からそのまま踏襲していた既存の見落とし。共通コンポーネント
   `SettingsOptionScreen` への抽出時に直したつもりが実際には漏れており、
   下記「2回目」で指摘・修正した
7. **【低】ABOUT が §17 モックと異なり2枚のカードに分かれていた**：
   モックは About/Privacy Policy/Version を1グループとして示している。
   `Row` に非タップの `value` バリアントを追加し、`SettingsGroup` を
   1つにまとめた（Privacy Policy 行を追加する際もこの1グループに入れれば
   よい）
8. **【低】ラジオ選択画面が3つ目の重複だった**：`appearance.tsx`/
   `first-day-of-week.tsx`/`time-format.tsx` がスタイルを含めほぼ同一
   実装だったため、`components/SettingsOptionScreen.tsx` へ抽出した
   （データの読み込み・永続化は画面ごとに異なるため残し、表示のみ共通化）
9. **【低】アクセシビリティの細部**：ラジオ行のコンテナに
   `accessibilityRole="radiogroup"` を追加（`SettingsOptionScreen` に集約）。
   Version 行は `accessibilityLabel="Version, 0.1.0"` のように1つのラベルで
   読み上げられるよう `SettingsGroup` 側で対応した
10. **【nit】`about.tsx` のアポストロフィ表記ゆれ**：カーリー（`'`）と
    直線（`'`）が混在していたのを直線に統一した

対応しなかったもの：無し（指摘10件すべて対応）。

#### レビューで見つかり、修正したもの（2回目）

1回目の対応内容自体（Version のネイティブ化、About のプライバシー追記など）は
妥当と確認された。1件、実装と本 README の記録が食い違っている状態で
コミットされていたという指摘。

1. **【要対応】上記6番が実際には直っていなかった**：README には
   「`SettingsOptionScreen` へ抽出する際に1箇所で修正した」と書いたが、
   実際のコードは Loading 分岐の `SafeAreaView` に `edges={['bottom']}` が
   付いていないままだった——コードの見た目上の変更（共通コンポーネントへの
   移動）と、修正した「つもり」の記述が伴っていなかった。`components/
   SettingsOptionScreen.tsx` の Loading 分岐に `edges={['bottom']}` を追加し、
   今度は実際に反映した
2. **【低】About の新規1行が英文法として不正**：「the date/time and
   whether protection was used **is** also written there」は複合主語に
   対し動詞が単数形だった。**are** に修正（書き込まれる内容自体——日時と
   避妊具使用の有無——は `services/HealthConnectService.ts` の実装と
   一致していることを確認済み）
3. **【低・任意】Version のフォールバックが `app.json` の直 import のまま
   だった**：`Application.nativeApplicationVersion` が優先されるため
   中①の本質は解消済みだったが、`null` になる経路（web）のためだけに
   `app.json`（plugin 設定を含む全体）が JS バンドルに取り込まれていた。
   今回のレビューで `expo-constants` も同時にネイティブリンクされたため、
   `Constants.expoConfig?.version` に置き換え、`app.json` の直 import 自体を
   削除した（さらに `undefined` の場合の最終フォールバックとして `'unknown'`
   を追加）

対応しなかったもの：無し（今回の指摘3件すべて対応）。

#### テスト

画面コンポーネント自体はこのプロジェクトに前例が無くユニットテスト対象外
（§6.3 と同様）——`npx tsc --noEmit` と全テストスイート（28スイート・
398件）のパスのみで検証した。ロジック自体（`getSetting`/`setSetting`・
`resolveLocaleDefaults`）は Phase 1 から既存のテスト対象。

#### 実機確認（Pixel 3、2026-09-21）

**当初「Pixel 11」と記録していたが誤り**：`adb devices -l` で確認したところ
接続機はモデル `Pixel_3`/デバイス `blueline`（実機確認当時の接続シリアルは
D-20/§6.3 で使っているのと同じ個体）——本項を訂正。

1回目（レビュー前の実装直後）：Settings → First Day of Week で
Sunday→Monday に変更 → 戻る操作（ハードウェアバック）で Settings・Today を
経由 → Calendar タブへ切り替えたところ、曜日ヘッダーが `M T W T F S S`
（Monday 始まり）に即座に反映されていることを確認した——`bump()` が実際に
機能していることの直接的な証拠。Time Format も選択状態が保存後に正しく
チェックマークへ反映されることを確認した。About Solo + Us は内容が
意図通り表示されることを確認した。確認後、First Day of Week は元の
値（この端末のロケール既定である Sunday）に戻した。

2回目（レビュー指摘の修正後）：Version 表示の `expo-application` 化は
ネイティブモジュールの初リンクを伴うため、`cd android && ./gradlew
installDebug` でこの端末に再インストールして確認した（スキーマ変更は
無いためアンインストール不要）。**`Application.nativeApplicationVersion`
が実際に効いていることの確認方法**：`app.json` の `version` だけを
一時的に別の値（`"9.9.9-jsonly-test"`）に書き換え、JS バンドルだけを
再読み込みさせても Settings の Version 表示が `0.1.0`（実際にビルドに
埋め込まれた値）のままで変化しないことを確認した——もし
`app.json` の直 import にフォールバックしていれば `9.9.9-jsonly-test`
に変わっていたはずで、変わらなかったことがネイティブ値を読んでいる
ことの直接的な証拠になる。確認後 `app.json` は `0.1.0` に戻した。
あわせて、ABOUT が「About Solo + Us」「Version」の1カードにまとまった
こと、Version 行の accessibility label が `"Version, 0.1.0"` になった
こと、`components/SettingsOptionScreen.tsx` へ共通化した後も Appearance/
First Day of Week/Time Format の3画面がそれぞれ変わらず動作すること、
About の追加した PRIVACY 記載（Health Connect 同期・Export 平文）が
表示されることを確認した。

#### Known gaps

- **Privacy Policy 行は未実装**：上記の通り、外部 URL が用意でき次第
  追加する
- **iOS は未確認**（CLAUDE.md 参照、iOS ローカルビルドがブロック中の
  ため）——`expo-application`/`expo-constants` は iOS 側でもまだ実機で
  リンクを確認していない（今回リンクを確認したのは Android のみ）

**Delete Data（§10.6）は別ブランチ（`phase3/delete-data`）で実装**（解消:
2026-09-21）——下記「Delete Data（§10.6）」の節参照。

### Delete Data（§10.6、2026-09-21、実装完了）

`phase3/delete-data` ブランチ。上記「Preferences・About」の節で「破壊的操作で
`SyncCoordinator.runExclusive` を要する別種の作業」として意図的に対象外とした
残件に着手した。

#### 実装済み

| 層 | 内容 |
|---|---|
| `services/ActivityService.ts` | 新規 `deleteAllActivities(db)`。既存の `deleteActivity`（§10.1/§10.2、1件削除）から抽出した `applyDeletePlan(tx, id)` は使わず、プロバイダごとに `findAllJobsForProvider`/`findAllMappingsForProvider` で既存のジョブ・マッピングだけを一括取得し、その集合にだけ `planForDelete`（判定ロジック自体は共有、`applyDeletePlan` と同じ純粋関数）を適用したうえで、`HealthSyncRepository.deleteAllMappings`/`ActivityRepository.deleteAllActivities`（Import の置換復元が使うのと同じ生の一括 DELETE）で仕上げる——基本設計 §10.6 自身の擬似コード（「1. ジョブを整理する／2. health_sync を全削除／3. activities を全削除」）に沿った形（**2巡目のレビューで、当初の「全Activityを1件ずつループ」実装から書き直した——下記「レビューで見つかり、修正したもの」参照**）。全削除の開始時に `healthConnect.lastSyncedAt`（`SYNC_DERIVED_SETTING_KEYS`、`ImportService.performReplaceImport` と同じ定数）を `null` にリセットする処理もここに追加 |
| `repositories/HealthSyncJobRepository.ts` | `insertJobsBulk` に `externalRecordId`（省略可）を追加——順5（マッピングのみ→新規 delete ジョブ）をバッチ挿入するために必要だった。既存呼び出し元（`HealthSyncResyncService.queueResync`）は省略時 `NULL` のままなので非破壊的な変更 |
| `app/settings/delete-data.tsx`（新規） | 確認画面 → 実行 の2ステップ。確認文は §17／基本設計 §10.6 双方のモック文言を統合（Android では Health Connect 反映の注意文——「アプリを閉じると一時停止・再開する」「アンインストールすると再開できない」の両方——を追加、iOS ではその段落を出さない）。実行は `SyncCoordinator.runExclusive(() => ActivityService.deleteAllActivities(db))`——`health-connect.tsx` の切断処理と同じ形。完了後 `useDataRevision().bump()` を呼び、Today/Calendar/Insights に反映する |
| `app/settings/index.tsx` | DATA セクションに「Delete Data」の行を追加（既存の「Export & Import」とは別行・別画面——Export/Import は1つのステップマシン画面を共有する理由があるが、Delete は共有する状態を持たない単発の破壊的操作のため） |
| `app/_layout.tsx` | `settings/delete-data` の `Stack.Screen` タイトルを追加 |

#### スコープの判断：§18 モックの進行表示画面（「Health Connect 12/47」）は作らない

§18 の完全なモックは、削除実行中に外部への削除件数を「12 / 47」のようにライブで
数え上げる専用の進行画面と、アプリ再起動後は「残り 35 件」に出し分ける表示を求めて
いる。今回はこれを作らなかった。

- 基本設計 §10.6 自身が「進行総数は永続化しないため、再起動後は残り件数だけを
  表示する」と明記しており、再起動後に必要なのは残り件数のクエリだけ——これは
  既存の `HealthSyncJobRepository.findAllJobsForProvider` で既に取得できる
- Settings > Health Connect の「UNSYNCED CHANGES」（§10.4、`health-connect.tsx`）が、
  件数表示・個別の retry/discard を**全削除が作った delete ジョブに対しても**
  そのまま提供する——全削除専用の別集計・別ポーリング UI を重複して作る理由が無い
- 実際、実機確認（下記）では全削除で作られた delete ジョブは数秒のうちに
  `SyncWorkerLoop` の既存 drain によって自動的に消化され、専用の進行 UI が無くても
  Health Connect 画面の「Last synced」が更新され「Everything is synced.」に戻る
  ところまで確認できた

この画面が実装するのは確認と（ローカルは即時完了する）実行の2ステップのみ——
外部への反映の可視化は既存の Health Connect 画面に委ねる。ファイル冒頭の
doc comment に同じ判断を明記した。

#### セーフティ Export は行わない（§13.3 との違い）

置換復元（§13.3）は実行前に必ずセーフティ Export を要求するが、全削除の確認文
（§17 モック）にはその記載が無く、基本設計 §10.6 もセーフティ Export を要求して
いない。実装もこれに従い、強制的なバックアップは行わない——ただし確認画面の文言に
「先に Export しておくとよい」という非強制の一文（Settings › Export & Import への
言及）を添えた。これは §17 の確認文そのものへの追加ではなく、確認文の下に別行として
表示するモック非記載の補足であり、既存の Export 導線への案内に留まる。

#### レビューで見つかり、修正したもの

ユーザーによるレビュー（コミット 80217d6 が対象、基本設計 §10.6/§9.12 と
`ImportService`/`SyncCoordinator`/`health-connect.tsx` との突き合わせ）で
6件の指摘を受けた。うち1件は仕様違反、4件は仕様との不整合・堅牢性の問題、
1件は軽微な指摘の集合だった。

1. **【要対応・仕様違反】`healthConnect.lastSyncedAt` を `null` にしていな
   かった**：基本設計 §10.6 が独立した見出し（「`lastSyncedAt` を全削除の
   開始時に `null` にする」）で明記している手順を落としていた。結果、全削除
   直後は Settings > Health Connect の「Last synced」が削除前の同期時刻の
   ままになり、その後 delete ジョブが drain されるとその時刻で上書きされる
   ため、§10.6 が防ごうとしていた「記録が0件なのに『さっき同期しました』と
   出る」状態が実機の実機確認そのもので再現していた。`ImportService.
   performReplaceImport` の先例（`SYNC_DERIVED_SETTING_KEYS` を `null` に
   リセット）と対称になる形で、`deleteAllActivities` の `db.transaction`
   内に同じ処理を追加した
2. **【仕様との不整合】完了アラートが「HC 未接続で止まっている」場合を区別
   しない**：基本設計 §10.6 は「Health Connect が未接続の場合」に独立した
   見出しを立て、「削除中」と「再接続待ち」を分けることを求めている
   （「進行バーを出したまま止めない。止まっている理由を状態として示す」）。
   以前は `pendingDeleteCount > 0` なら常に「送信中」と表示しており、HC が
   OFF のときも実際には1件も送られないのに送信中と伝えていた。
   `healthConnect.enabled` を読み、OFF の場合は「Health Connect has N
   deletions waiting — reconnect... to resume.」に文言を出し分けるようにした
   （`isAvailable()`/`hasWritePermission()` 相当のネイティブ呼び出しまでは
   行っていない——§10.6 自身が名指ししているのは接続トグルの ON/OFF であり、
   これらのネイティブ呼び出しは D-41 により cancel/timeout が無いため、削除
   自体が成功した後にこれを待って完了アラートの表示自体をブロックするリスク
   の方が大きいと判断した）
3. **【仕様との不整合】確認文に「アプリを閉じると一時停止する」旨が無かっ
   た**：基本設計 §10.6 自身の確認文（「完了までアプリを開いたままにして
   ください」）と UI/UX §17 のモック（「完了前にアプリを削除すると、Health
   Connect には残ります」）は文言が異なるが、意味しているところ（アプリを
   閉じると一時停止し再開できる／アンインストールすると永久に再開できない、
   は別の事象）は両方とも実際の制約（§6.2 バックグラウンド同期なし）を反映
   している。実装は後者（アンインストール注意）だけを含めていたため、前者
   （「閉じると一時停止・再度開くと再開」）も追加した
4. **【堅牢性】1トランザクション内で Activity 数 × プロバイダ数の逐次クエリ
   になっていた**：当初の実装は全 Activity を1件ずつループし `applyDeletePlan`
   を呼んでいたため、Health Connect を一度も使っていない Activity（順6・
   ジョブもマッピングも無い）についても無駄に2クエリ（job/mapping の
   SELECT）が発生し、件数が多いと「Deleting…」のまま数十秒かかりうる
   状態だった。基本設計 §10.6 自身の擬似コード（「1. ジョブを整理する／
   2. health_sync を全削除／3. activities を全削除」）の形に書き直し、
   プロバイダごとに実在する job/mapping（同期履歴がある Activity だけ、
   通常は全 Activity よりずっと少ない）だけを一括取得して判定し、mapping
   のみで delete ジョブが無い分（順5）は `insertJobsBulk`（`externalRecordId`
   を渡せるよう拡張）でバッチ挿入、最後に `health_sync`/`activities` を
   それぞれ1回の DELETE で一括削除するようにした。これにより支配的だった
   コスト（総 Activity 数に比例する無駄な順6判定）を解消した——`services/
   ActivityService.ts`/`repositories/HealthSyncJobRepository.ts` の doc
   comment 参照
5. **【堅牢性】busy 中に画面を離れると `router.back()` が別画面を pop する**：
   削除実行中にヘッダーの戻る／バックジェスチャでこの画面を離れると、
   `handleDelete` の Promise はコンポーネントの生死と無関係に継続し、完了
   アラート（OS レベルのダイアログ）はその時点でどの画面の上にいても表示
   される。その OK ハンドラが無条件に `router.back()` していたため、
   Settings 一覧など別の画面から余計に1段階戻ってしまう経路があった。
   `health-connect.tsx` に既にある `mountedRef` パターンを移植し、この
   画面がまだマウントされている場合のみ `router.back()` するよう変更した
6. **軽微、4件**：
   - **ボタン順序**（§17 モックは「キャンセル・削除」の順）：**対応せず**——
     このアプリの同種の確認画面（`data.tsx` の `confirmReplace`）は既に
     「破壊的操作のボタンを上・Cancel を下」で実装済みで、`delete-data.tsx`
     もそれに揃えている。モックの左右順ではなく、既存の姉妹画面との一貫性を
     優先した（doc comment に理由を明記）
   - **二重タップで `handleDelete` が2回走りうる**：`setStep('busy')` は
     非同期のため、同一フレーム内の連続タップが両方とも通り抜けうる状態
     だった。`deletingRef`（同期的なガード）を追加した
   - **iOS + `healthkit` の将来的な扱い**：`ALL_PROVIDERS` に `healthkit` が
     含まれる一方、`pendingDeleteCount` の集計は `Platform.OS === 'android'`
     固定になっている。HealthKit 未実装の現状では正しいが、実装時にはこの
     判定を「2つ目のプロバイダが有効か」ベースに直す必要がある旨を
     `delete-data.tsx` に TODO コメントとして残した
   - **テストの穴**：§10.6 が名指しで強調する「順2（`attempts > 0` の
     create、mapping 無し → 同期済みだけを対象にしない）」が
     `deleteAllActivities` 側のテストに無かった。追加した。あわせて、
     `insertJobsBulk` のバッチ経路が単一行だけでなく複数行でも正しく動く
     ことのテスト、`lastSyncedAt` が `null` にリセットされることのテスト
     （Activity が無い場合を含む）も追加した

対応しなかったもの（上記「ボタン順序」以外）：無し（指摘6件のうち5件は
コード変更、1件は既存の姉妹画面との一貫性を理由に意図的に見送り）。

#### レビューで見つかり、修正したもの（2回目）

上記5件の修正内容自体は妥当と確認された。4番（性能改善のための書き直し）に
**回帰が1件**見つかった。

1. **【要対応・回帰】順6（declined マッピング・ジョブ無し）に delete ジョブ
   を作ってしまっていた**：4番の書き直しで、順5のバッチ生成部が「ジョブ
   消込後に残ったマッピングすべて」を `operation: 'delete'` で無条件に
   積んでいた。しかし §10.1 の表は、ジョブが無いマッピングを
   `mappingState` で二分する——`synced`/`uncertain`（順5、insert）と
   `none`/`declined`（順6、noop）。`declined` は `HealthSyncManualActions.
   discardSyncJob` が作る正規の状態（D-35「この記録を Health Connect へ
   同期しない」を利用者が明示的に選んだ結果）であり、`planForDelete(null,
   'declined')` は本来 `noop` を返す。書き直し後のコードはこの分岐を
   経由せず `'delete'` を決め打ちしていたため、利用者が明示的に同期しない
   と決めた記録に対しても外部削除ジョブを積んでしまっていた——`declined`
   を巻き込んだ回帰。修正は、残ったマッピング1件ごとに
   `planForDelete(null, toMappingState(mapping))` を呼び、`action ===
   'insert'` のものだけをバッチに積む形にした（`applyDeletePlan` と
   「同じ決定ロジックだけを経由する」という doc comment の主張を、実際に
   成り立たせる形）。`declined`（job 作らない）と `uncertain`（job 作る）
   の対になるテストを2件追加し、非対称性が守られていることを確認した
2. **【軽微】ジョブループのコメントが不正確だった**：「`planForDelete` は
   `'delete-job'`/`'replace'` の2種類しか返さない」という主張は、個別削除
   （`deleteActivity`）で既に作られていた `delete` ジョブ（Activity は既に
   別の機会に削除済みだが、外部への delete がまだ未完了で outbox に残って
   いるもの）が `findAllJobsForProvider` に含まれるケースを見落としていた。
   このケース自体は `noop` に落ちて何もしない（正しい——このジョブは今回の
   全削除対象とは無関係で、そのまま drain を続けるべき）が、コメントの
   「2種類しか無い」という前提は誤り。分岐を `else` で明示し、コメントを
   実態に合わせて書き直した
3. **【軽微】doc comment の自己矛盾・記載の取り残し**：`deleteAllActivities`
   冒頭の doc comment が「`ActivityRepository.deleteAllActivities` は
   Import 専用」と書きながら、直後にその関数をまさに呼んでいて矛盾して
   いた。冒頭を「ジョブを作らない点が Import との違い」という本来の対比
   だけに絞り、`HealthSyncRepository.deleteAllMappings`／
   `ActivityRepository.deleteAllActivities` 自体の doc comment も
   呼び出し元が2つになったことを反映する内容に更新した

対応しなかったもの：無し（指摘3件すべて対応）。

#### テスト

`services/ActivityService.ts` の `deleteAllActivities` は
`test/__tests__/activityService.integration.test.ts` に追加（`deleteActivity` と
同じ better-sqlite3 統合テスト）：全件削除されること、Activity が無い場合に
no-op であること、Activity ごとに異なる §10.1 の分岐（順1: 未送信 create は
そのまま消す／順2: 送信済みかもしれない create は delete に置き換える／順5:
同期済みマッピングのみの Activity には新規 delete ジョブが残る、複数件での
バッチ挿入経路を含む／順6: declined マッピングには delete ジョブを作らない
——順5 の uncertain との対比込み）が一括適用でも個別適用と同じ結果になる
ことを検証。`healthConnect.lastSyncedAt` が `null` にリセットされること
（Activity が無い場合を含む）も検証。`app/settings/delete-data.tsx` 自体は
他の画面コンポーネントと同様ユニットテスト対象外——`npx tsc --noEmit` と
全テストスイート（28スイート・407件）のパスで検証した。

#### 実機確認（Pixel 3、2026-09-21）

Settings > Delete Data で確認画面（Android 向けの Health Connect 注意文つき）が
表示されること、Cancel で Settings へ戻ることを確認した。実際に同期済み
Activity（1件、Health Connect 接続済み・同期済みの状態）に対して Delete All Data
を実行したところ：

1. 確認直後のアラートが「Every activity has been deleted from this device. 1
   deletion is still being sent to Health Connect」と、単数形が正しく（`1
   deletion**s are**` ではなく `1 deletion**is**`）表示された
2. OK で Settings 一覧へ戻った
3. Settings > Health Connect を開くと、専用の進行 UI を一切実装していないにも
   関わらず、既存の drain が既に完了しており「UNSYNCED CHANGES: Everything is
   synced.」・「Last synced」が削除実行時刻に更新されていた——上記スコープ判断の
   前提（既存の Health Connect 画面だけで進行が可視化できる）が実機で成立する
   ことを確認した
4. Today タブは `bump()` により即座に「No activities recorded yet.」へ切り替わり、
   アプリ再起動を要さなかった

（この確認で削除した1件は、直前までの Settings 機能検証で使っていたテスト用の
記録——README の他の「実機確認」節と同じ、この端末での標準的な検証手順の一部。）

**レビュー指摘の再確認（同日、Pixel 3）**：新たに Solo の記録を1件作成し、
`SyncWorkerLoop` の drain で Health Connect への同期が完了する（「Last
synced」に時刻が入る）ことを確認したうえで、改めて Delete All Data を実行した。

- 確認画面の文言が「閉じると一時停止・再開できる」「アンインストールすると
  Health Connect に残る」の両方を含む形に更新されていることを確認した
- 完了アラートは引き続き「1 deletion is still being sent to Health Connect」
  （HC 接続中の文言）を正しく表示した
- 完了直後、Settings > Health Connect の「Last synced」は一瞬「Never」相当の
  状態を経て、数秒後に新しい時刻へ更新された——これは指摘1の再発ではなく、
  `SyncWorker.ts` の `finalizeDeleteSuccess` が「delete ジョブが実際に成功
  した時点」でも `lastSyncedAt` を更新するという、この全削除機能とは無関係の
  既存の正しい挙動（delete も「同期が成功した」という事実の一種のため）。
  トランザクションのコミット直後に `null` になっていること自体は、上記の
  単体テストで直接検証済み

**回帰（指摘1）の実機再現は断念、単体テストで代替**：実機で `declined`
状態を作るには「記録直後、`SyncWorkerLoop` がジョブを claim する前に
Settings > Health Connect から Don't sync を確定する」タイミングを取る
必要があるが、この端末の drain は数秒以内に完了するため adb 操作の往復
（dump → 座標計算 → tap）がそのレース に間に合わず、2回試みたいずれも
job が先に同期済みになった（`declined` を経由する前に `synced` へ進んで
しまった）。この経路は `db.transaction` 内のタイミングに依存しない純粋な
分岐ロジックの問題であり、上記の単体テスト（`declined`/`uncertain` の
対）で決定的に検証できているため、実機での再現には固執しなかった。

#### Known gaps

- **iOS は未確認**（CLAUDE.md 参照、iOS ローカルビルドがブロック中のため）——
  確認文の Health Connect 段落を出し分けるコード自体は書いたが、iOS 実機/
  シミュレータでの表示は未確認
- **進行表示専用画面は無い**：上記「スコープの判断」参照。既存の Health Connect
  画面（§10.4）で代替しているが、§18 モックの「12/47」ライブ進行バーそのものは
  無い
- **セーフティ Export ファイルの蓄積は未解消**：上記「Export/Import の UI」節の
  Known gaps 参照——Delete Data は Activity データを消すだけで、ディスク上の
  セーフティ Export ファイルには触れない別物
- **既存ジョブの置き換え（順2/3/4）はまだ Activity 単位のループ**：上記
  「レビューで見つかり、修正したもの」4番のバルク化は、対象を「全 Activity」
  から「その時点で実在する job/mapping（同期履歴があるものだけ）」に絞る
  ところまでで止めている。未処理ジョブ（送信待ちのバックログ）が大量に残って
  いる状態（例：`queueResync` 直後に即全削除する等）では、この部分はまだ
  件数に比例する。実運用でのバックログはこの部分よりずっと大きくなりにくい
  と判断し、完全な SQL 一括更新への書き換え（分岐ロジックを SQL に再実装する
  必要があり、間違えやすい箇所を増やすリスクがある）は見送った

## Phase 4 実装状況

基本設計 §18 の順序（clientRecordId/clientRecordVersion 確認 → 同期 → リトライ →
削除同期 → Health apps declaration 提出 → ストア申請）に従って着手。
`phase4/health-connect-foundation` ブランチ。

### ステップ1: react-native-health-connect 導入 + expo prebuild（完了）

- `react-native-health-connect@4.1.3` を追加。design doc（設計判断記録
  D-04/D-19/D-41、基本設計 §9.4）でソース読解済みのバージョンと完全一致
  （`connect-client:1.1.0` 固定依存も一致）——再検証は不要
- `app.json` の `android.permissions` に
  `android.permission.health.WRITE_SEXUAL_ACTIVITY` のみ追加。**READ 権限は
  追加していない**（D-20/§9.7：削除の存在確認のために READ 権限を追加する
  経路は採らない、D-12：審査面積を自分から増やさない）
- `expo-build-properties` で `minSdkVersion` を 24→26 に変更。Health Connect
  自体が API 26（Android 8.0）未満を対応外としているため必須の変更——
  Health Connect 機能に限らず**アプリ全体の対応 OS 範囲が変わる**（Android
  7.0/7.1 端末が対象外になる）。v1 はまだリリース前のため、この時点で対応を
  絞ることに実害はないと判断した
- [plugins/withHealthConnectPermissionsRationale.js](plugins/withHealthConnectPermissionsRationale.js)
  を新規作成。Health Connect の permission 画面から起動される rationale
  Activity（Android 13-: intent-filter 直接 / Android 14+:
  `ViewPermissionUsageActivity` activity-alias 経由）を追加する。
  **`react-native-health-connect` の README サンプルは alias の
  `targetActivity` を `.MainActivity` としているが、Android 公式ドキュメント
  （developer.android.com の Health Connect get-started）を直接確認したところ
  `.PermissionsRationaleActivity` を指すのが正しい実装だったため、公式に
  合わせた**（MainActivity に同じ intent-filter を重複させると解決が曖昧に
  なる）
- rationale 画面の内容は「Play Console に登録するプライバシーポリシーと
  同一でなければならない」（Android 公式ドキュメント）が、ホスト済みの
  プライバシーポリシーページはまだ存在しない（ストア申請は本 Phase の
  最終ステップ）。暫定的にアプリ内蔵の静的テキスト（WebView で外部 URL を
  読み込まない）で実装した。**実際のプライバシーポリシーを公開する際は、
  この画面の文言をそのポリシーと一致させること**
- MainActivity への手動編集は不要（permission delegate の登録は
  `react-native-health-connect` 同梱の Expo Module が
  `ReactActivityHandler` 経由で自動的に行う。ソースを確認し、MainActivity.kt
  に編集が入っていないことを確認済み）
- `expo prebuild -p android --clean` → `cd android && ./gradlew
  assembleDebug` で実機なしのビルド成功を確認済み（BUILD SUCCESSFUL）

### ステップ2: HealthConnectService.ts・SyncWorker.ts（完了）

- [services/HealthConnectService.ts](services/HealthConnectService.ts)：
  `react-native-health-connect` への唯一の入口。`upsertActivity`
  （create/update 合流、§9.2/§9.4）・`deleteActivityRecord`・
  `recreateActivity`（§9.3.1。**2026-09-21 改訂**：delete が `UNKNOWN`
  分類で失敗した場合は insert へ進む——「ステップ7」参照）を提供。
  送るのは `time` と `protectionUsed` のみ（§9.9）、addressing は
  `clientRecordId`（= activity.id）/`clientRecordVersion`（=
  activity.syncVersion）で行い `external_record_id` は health_connect では
  常に null（§5.4）。cancel 不可（D-41 確認済み）のため意図的に
  `Promise.race()` によるタイムアウトを実装していない——タイムアウトの
  判断は SyncCoordinator（次ステップ）の責務
- エラー分類は `node_modules/.../ExceptionsUtils.kt` の code 文字列一覧を
  ソースで確認して実装（推測なし）。`NOT_FOUND`/`RATE_LIMITED` に対応する
  code は存在しないため、削除の「存在しない」は特別扱いせず
  resolve=成功・reject=失敗の単一処理のみ（§9.7 確認結果通り）
- [services/SyncWorker.ts](services/SyncWorker.ts)：§9.5 の claim/finalize
  ループ（`processNextDueJob`）と、due なジョブを無くなるまで処理する
  `drainDueJobs`。§9.5.1（外部の成功とジョブの完了を分ける）・§9.5.3
  （内部不整合）・§9.6（バックオフ・上限到達で手動待ち）・§9.7（削除の
  単純化された確定処理）を実装。**AppState 監視・定期実行・破壊的操作との
  排他（§9.12）は含まない**——`lib/screenMask.ts` と同じく、純粋なループ本体と
  「いつ呼ぶか」の配線を分離した（配線は次の SyncCoordinator ステップで行う）
- 内部不整合（§9.5.3/§9.5.4）を検出した場合、**開発ビルドでも例外は投げない**
  よう実装した。基本設計は「開発ビルドでは assert / テスト失敗とする」と
  書いているが、文字通り実行時に throw すると `drainDueJobs` のループ全体が
  止まり、他の due なジョブまで巻き添えで処理できなくなる（Rule 2 と矛盾）。
  「テスト失敗とする」は自動テストがこの分岐を検出する形で満たし
  （`test/__tests__/syncWorker.integration.test.ts`）、実行時は `logError`
  （Activity の内容を含まない、§8.7）でジョブを進行不能マークするに留めた
- テスト：`services/__tests__/HealthConnectService.test.ts`（`react-native-
  health-connect` をモック化した単体テスト、エラー分類・値変換・recreate の
  2段階を検証）、`test/__tests__/syncWorker.integration.test.ts`
  （`HealthConnectService` をモック化し実 SQLite に対して claim/finalize の
  状態遷移を検証）
- `package.json` の `jest.collectCoverageFrom` から2ファイルの除外エントリを
  削除（実装・テストとも揃ったため）

#### レビューで見つかり、修正したもの（1回目）

- **🔴 送信中に Activity を編集すると、その編集が Health Connect へ永久に
  送られないバグ**：`finalizeUpsertSuccess` は `deleteJobIfRevisionMatches`
  だけでジョブ完了を判定していたが、`planForEdit`（Phase 1）は既存ジョブの
  `revision` に触れない設計（§9.3、ワーカーが送信時に最新値を読む前提）
  のため、外部呼び出し中に挟まった編集を revision では検出できず、
  ジョブが削除されて編集が失われていた（§9.5.1「create送信中に編集→
  ジョブは残り、大きいsync_versionで送り直す」に違反）。修正当時のテストは
  この誤った挙動をそのまま期待値として固定していた。
  `HealthSyncJobRepository.releaseClaimForResend` を新設し、送信した
  `syncVersion` と再読込した現在値を比較、異なればジョブを削除せず claim
  だけ解放して再送させるよう修正。該当テストの期待値も修正し、実際に
  再送されることまで検証するテストを追加した
- **🟠 permission rationale の intent-filter が MainActivity と
  独自 Activity の両方に登録されていた**：`app.json` に併記していた
  ライブラリ同梱の config plugin（`"react-native-health-connect"`）が
  `.MainActivity` 自身にも同じ `ACTION_SHOW_PERMISSIONS_RATIONALE`
  intent-filter を追加していたため、Android 13 以前で解決が曖昧になって
  いた。ライブラリの plugin 自体を `app.json` から外し（permission delegate
  の自動登録は Expo Modules autolinking 経由で別物のため影響なし）、
  マニフェストへの追記を自作 plugin だけに一本化。生成済みマニフェストで
  重複が消えたことを確認済み
- **🟠 rationale 画面がダークモードで読めない**：`setTextColor(Color.BLACK)`
  を固定していたが、Activity の theme（`Theme.AppCompat.DayNight`）は
  window 背景をダークにするため黒文字が埋もれる。`theme.resolveAttribute
  (android.R.attr.textColorPrimary, ...)` でテーマに追従する色を都度解決
  するよう修正
- **🟡 コメントの不整合**：存在しないファイル名
  （`withHealthConnectPermissionsRationaleActivity.kt.js`）を参照していた
  記述を削除
- **🟡 `lost-claim-race` が実際には返らず、claim 競合で drain が早期終了する
  可能性**：`claimNextDueJob` は「due なジョブが無い」と「claim 競合に
  負けた」をどちらも `null` で返していたため区別できなかった。
  `LOST_CLAIM_RACE` という区別可能な戻り値を追加し、`drainDueJobs` が
  競合時に諦めず次の due なジョブへ進めるようにした（v1 は単一 runtime
  なので現状は起きないが、`SyncCoordinator` 実装後に備えた）
- **🟡 Activity が存在する側の §9.5.4（確定時にジョブが消えている）を
  検出していなかった**：`deleteJobIfRevisionMatches`/`releaseClaimForResend`
  の戻り値（成否）を確認せず握り潰していた箇所に、失敗時の `logError` を
  追加
- **🟡 `ensureInitialized()` が reject した場合に `drainDueJobs` 自体が
  reject していた**：try/catch で包み、`processedCount: 0` を返すよう修正
- **🟡 依存バージョンの指定**：`react-native-health-connect` を
  `^4.1.3` → `4.1.3`（D-04/D-41 はこの正確なバージョンをソース読解した
  結果であり、`^` だと未検証のマイナー更新が入りうるため）、
  `expo-build-properties` を `^57.0.21` → `~57.0.21`（他の expo-* パッケージ
  と同じ規約に合わせた）
- **🟡 自動リトライ上限の境界**（`attempts >= 10` vs `> 10`）：仕様の文言
  「上限（10）を超えた」は字面上どちらにも読めるため、「自動試行は10回
  まで」という解釈を採用した理由をコードコメントに明記するに留めた
  （挙動は変更なし）

新たに追加した `HealthSyncJobRepository.releaseClaimForResend`・
`LOST_CLAIM_RACE` の判定は `test/__tests__/healthSyncJobRepository.
integration.test.ts` に、claim 競合時の drain 継続・§9.5.4 検出は
`test/__tests__/syncWorker.integration.test.ts` に追加。全20スイート・
284件パス、`assembleDebug` でビルド成功も再確認済み

### ステップ3: SyncCoordinator（完了。AppState 配線は次のステップへ持ち越し）

- [services/SyncCoordinator.ts](services/SyncCoordinator.ts)：§9.12 の
  mutex。`isSuspended()`・`trackExternalCall()`・`runExclusive()` を、
  クラスではなくこのプロジェクトの他モジュールと同じ「関数 + モジュール
  状態」のスタイルで実装。**`suspend`/`resume` は export しない**——
  破壊的操作は必ず `runExclusive` 経由（呼び忘れ・例外パスでの
  すり抜けを構造的に防ぐ。2回目のレビュー指摘、テストからは
  `__testHooks` 経由でのみアクセス）
- **cancel 不可（D-41 確認済み）を前提に、`runExclusive`/`trackExternalCall`
  はタイムアウトで打ち切れない単純な await として実装**。§9.12 が定義する
  「タイムアウトは UI の待機を打ち切るためだけに使う／外部 Promise が未
  settle の間は呼び出し側が諦めても裏で待ち続け、実際に settle してから
  通常状態へ戻す」という挙動は、現時点でこれを呼ぶどの呼び出し元にも
  「実行中に待機を打ち切れる」UI が無い（`app/settings/data.tsx` の
  busy 状態にキャンセルボタンが無いことを確認済み）ため未実装——意図的な
  Known gap として `SyncCoordinator.ts` に明記した
- `runExclusive` は内部の FIFO キューで直列化する（2回目のレビュー指摘・
  下記参照）。**このキューは同一呼び出しスタック内でのネストには対応
  できない**（デッドロックする）ため、ネストしないことは呼び出し側の
  責務——`ImportService.performReplaceImport` が Coordinator を一切
  意識しないのはこのため（後述）
- `services/SyncWorker.ts` の `processNextDueJob` を、`isSuspended()` の
  確認から `SyncCoordinator.trackExternalCall` へ同期的に入るところまでの
  間に await を挟まない形に整理。**claim（`claimNextDueJob`）自体も
  `trackExternalCall` の内側に含める**——外部呼び出し以降だけを追跡対象に
  すると、claim の awaited UPDATE が破壊的操作のトランザクションに巻き
  込まれ、破壊的操作が ROLLBACK した場合に claim だけが取り消されずに
  永久に残ってしまう（2回目のレビュー指摘。stale claim を消すのは起動時の
  `clearAllClaims` だけなので、次回起動まで残り続けるバグになりえた）。
  「一度 claim したジョブは必ず確定まで進む」という単純な性質になり、
  対称的な「suspended なら claim を差し戻す」経路（当初あった
  `releaseClaimForResend` によるロールバック的な分岐）自体が不要になった
- **`SyncCoordinator.trackExternalCall` はネイティブ呼び出し・finalize の
  DB 書き込み・claim のすべてを含めて包む**よう実装した。最初はネイティブ
  呼び出しだけを包んでいたが、finalize の `db.transaction` と破壊的操作の
  `db.transaction` が同じ接続上でほぼ同時に始まりうることが integration
  test で「cannot start a transaction within a transaction」として顕在化
  し、範囲を広げて修正した
- `inFlightExternalCall` は単一スロットではなく `Set` で保持し、`suspend`
  は現在 in-flight の**すべて**の完了を待つ（2回目のレビュー指摘。今は
  単一ループなので同時に1つしか無いが、次の AppState 配線で複数トリガに
  なると現実的に到達する）
- 連続 `lost-claim-race`（前ステップで新設）に上限（5回）を設け、
  `drainDueJobs` が無進捗のまま回り続けることを防いだ
- `DrainResult` に `stoppedReason`（`'drained' | 'suspended' |
  'provider-disabled' | 'provider-unavailable' | 'lost-race-limit'`）を
  追加——AppState 配線側が「resume 後に再 drain すべきか」を判断できる
  ようにした（2回目のレビュー指摘）
- `services/ImportService.performReplaceImport`（§13.3 置換復元）は
  **Coordinator を一切意識しない**（純粋な DB 操作。`performAppendImport`
  と同じ扱いに戻した）。`SyncCoordinator.runExclusive` で包むのは
  **呼び出し側**——`app/settings/data.tsx` の `handleConfirmReplace`
  （アプリ本体の生きた DB に対して呼ぶ、§9.12 の対象操作のうち実際に
  SyncWorker と競合しうる唯一の既存呼び出し元）。当初は
  `performReplaceImport` 自身に `runExclusive` を仕込んでいたが、
  `services/RecoveryService.restoreFromBackup`（§8.8）が同じ関数を
  **一時 DB**（`tempDb`、アプリ本体の接続とは別物）に対して呼んでおり、
  Coordinator はプロセス全体のグローバル状態のため、無関係な一時 DB への
  操作がグローバルな mutex 状態を動かしてしまっていた（2回目のレビュー
  指摘。直列化キューの追加と組み合わさると自己デッドロックの経路にも
  なりえた）。DB Migration（`database/migrations/index.ts`）と Recovery
  は、いずれも「生きた DB 接続」が存在する前に／存在しない状態でのみ
  実行される——SyncWorker が動きようがない区間なので、意図的に
  `runExclusive` で包んでいない。この前提の詳細は `SyncCoordinator.ts`
  のコメント参照
- テスト：`services/__tests__/SyncCoordinator.test.ts`（DB 非依存の
  mutex 単体テスト。直列化・複数 in-flight 呼び出しの追跡を含め、
  §17.3 I12/I13/I20 を明示的に参照）、
  `test/__tests__/syncCoordinator.integration.test.ts`（実 SQLite +
  実際の `performReplaceImport`（呼び出し側で `runExclusive` に包む形）+
  モック化した `HealthConnectService` で end-to-end 検証。上記のネストした
  トランザクションのバグはこのテストで発見・修正した）、
  `test/__tests__/syncWorker.integration.test.ts` に claim 自体が保護
  されていることの検証を含む Coordinator 統合テストを追加。全22スイート・
  307件パス

#### レビューで見つかり、修正したもの（3回目）

- **🟠 `runExclusive` が `isSuspended()` を同期的に立てていなかった**：
  直列化キュー（2回目のレビューで追加）は `exclusiveQueue.then(...)` の
  中で `suspended = true` を設定していたため、`runExclusive()` を呼んだ
  直後の数 microtask は `isSuspended()` が false のままになる窓があった。
  `__testHooks.suspend()` を直接呼ぶ単体テストはこの性質を守っている
  ように見えていたが、**production の唯一の入口である `runExclusive`
  自身はこの性質を持っていなかった**——テストが緑でも不変条件が
  守られていない状態だった。`suspendingCount`（カウンタ）を
  `runExclusive` の**先頭で同期的に**加算し `finally` で同期的に減算する
  形に変更し、`isSuspended()` が「呼ばれてから完全に終わるまで」一貫して
  true になるよう修正した。修正の効果を実際に検証するテスト
  （`runExclusive()` を呼んだ直後、await を一切挟まずに `isSuspended()`
  を確認する）を追加した
- **🟡 タイムアウト未実装との相互作用**：直列化キューの追加により、
  ネイティブ呼び出しが永久に settle しない場合の影響範囲が「その破壊的
  操作1件がハング」から「以降のすべての `runExclusive` 呼び出しが実行
  不能」に広がっていた。`SyncCoordinator.ts` の「実装していないもの」
  節にこの影響範囲の変化を明記した
- **🟢 命名の見直し**：`trackExternalCall`/`waitForInFlightExternalCalls`
  は実態（claim〜finalize の1サイクル全体）と合わなくなっていたため
  `trackSyncCycle`/`waitForInFlightSyncCycles` に改名した
- （検討したが見送ったもの）`performReplaceImport` を生きた DB 用/一時 DB
  用の2関数に型レベルで分割する案：現状は呼び出し元が1箇所ずつしかなく、
  doc コメントで明示済みのため、API 表面を増やすコストに見合わないと
  判断した。§10.6 全Activity削除等、新しい破壊的操作を追加する際にこの
  判断が今も妥当か再検討すること

### ステップ4: AppState 配線（実装完了。実機確認済み）

バックグラウンド/フォアグラウンド遷移でのクラッシュ・無限ループの有無は
「Settings UI の実機確認」の一環として Pixel 11 で確認済み（下記 Known
gaps および「実機確認（Pixel 11、初回/2回目/3回目）」参照）。

- [contexts/SyncWorkerLoop.tsx](contexts/SyncWorkerLoop.tsx)：「いつ
  `drainDueJobs` を呼ぶか」（§9.5.4 の AppState 表：`active`→開始・
  再開、`inactive`/`background`→新規 claim 停止・実行中の呼び出しは
  確定処理まで進める、次の`active`→再開）を配線する `useSyncWorkerLoop`
  hook。`lib/screenMask.ts` の `useScreenMask`（純粋な遷移判定関数 +
  AppState 配線の分離）と同じ構造で、純粋関数
  `shouldTriggerDrainOnAppStateChange` を切り出した
- `services/SyncWorker.ts` の `drainDueJobs` に `shouldContinue` オプションを
  追加し、`DrainStoppedReason` に `'backgrounded'` を追加——このファイルは
  「いつ呼ぶか」を知らないという既存の設計方針は変えず、「継続してよいか」を
  呼び出し側から注入する形にした
- 周期的な再チェック（10秒間隔）を実装した。§9.5.4 はフォアグラウンド中に
  `not_before` が経過したジョブ（5秒の Undo 遅延等）をいつ拾うかを規定して
  いない——仕様上の根拠は無いので調整可能な値として扱っている
- `DataRevision`（記録・編集・削除のたびに bump される既存の仕組み）の
  変化でも drain を試みる。マウント時の重複呼び出しを避けるため、
  revision 監視の effect は初回マウント時だけスキップする
- **`SyncCoordinator.runExclusive` は呼ばない**——`drainDueJobs` が内部で
  `isSuspended()` を確認するだけで新規 claim は自然に止まる。将来
  Settings UI から同様の drain 処理を `runExclusive` の内側から呼ぶと
  デッドロックしうる（§9.12「直列化」節）ため、その旨をファイル冒頭に
  明記した
- `app/_layout.tsx` の `AppShell`（`DatabaseProvider`/`DataRevisionProvider`
  の内側）で呼び出す。表示は無い（副作用のみの hook）
- テスト：`contexts/__tests__/SyncWorkerLoop.test.tsx`
  （`lib/__tests__/screenMask.test.ts` と同じ react-test-renderer による
  検証）、`test/__tests__/syncWorkerLoop.concurrency.integration.test.ts`
  （実 SQLite での多重 drain 再現）。全24スイート・324件パス
- **実機/エミュレータでの動作確認はこのステップ時点では未実施**——この
  時点で接続された Android 実機/エミュレータが無かったため。ネイティブ
  ファイルは変更していないためビルド自体は不要だが、起動・バックグラウンド
  /フォアグラウンド遷移でクラッシュや無限ループが無いことは実機側の確認が
  必要、という課題として残していた。**のちにステップ6「Settings 画面の
  Health Connect UI」の実機確認（Pixel 11）に含める形で確認済み**——上記
  見出し直下の注記参照

#### レビューで見つかり、修正したもの

- **🔴 drain の多重実行ガードが無く、`db.transaction` が衝突する**：
  `drain()` はトリガ4つ（マウント時・AppState→foreground復帰・周期実行・
  DataRevision bump）に対して fire-and-forget だった。ネイティブ呼び出しが
  周期間隔（10秒）を超えて続くと（低速端末・コールドスタート・D-41の
  「cancel もタイムアウトも無い」性質から現実的にありうる）、次の周期
  tick が2本目の `drainDueJobs` を起動し、2本がそれぞれ別のジョブを
  claim して両方が finalize の `db.transaction` に到達し「cannot start a
  transaction within a transaction」で衝突することを、レビュー側が実機
  相当の再現で確認・報告。`drainingRef`/`rerunRef` で「実行中なら、完了後に
  もう一度だけ実行する」形に直列化し、取りこぼしも防いだ。さらに
  `services/SyncWorker.ts` の `processNextDueJob` に1サイクル単位の
  try/catch を追加——多重実行ガードを入れても finalize が何らかの理由で
  例外を投げれば claim が残る性質自体は残るため、失敗時は
  `markJobFailed` 相当（§9.6 の通常のバックオフ経路）でジョブを解放し、
  drain ループ全体を道連れにしないようにした（Rule 2）。実際に
  「cannot start a transaction within a transaction」を発生させた上で
  ジョブが正しく回復することを確認する統合テストを追加した
  （`test/__tests__/syncWorkerLoop.concurrency.integration.test.ts`）
- **🟠 `AppState.currentState` が `'active'` とは限らない**：React Native
  自身、マウント直後の `currentState` の初期値が信頼できない既知の癖が
  ある（`null`/`'unknown'` になりうる）。`=== 'active'` で判定していると、
  その場合に「継続してよいか」が false のまま固定され、セッション中一度も
  バックグラウンドへ移行しなければ同期が一度も走らずに終わる。
  `'background'`/`'inactive'` **以外**はフォアグラウンド扱いにする形へ
  反転し（不明な状態は安全側＝動かす方に倒す）、`AppState.currentState`
  が `null` の状態でもマウント時に drain されることを検証するテストを
  追加した

### ステップ5: 「同期しないことを選んだ」永続状態の設計判断（完了。UI は次のステップ）

設計判断記録 [D-51](docs/Solo%20+%20Us_設計判断記録%20v0.11.md) 参照。
`services/syncJobPlanner.ts`/`repositories/HealthSyncJobRepository.ts` の
両方が「Phase 4 の設計判断として保留」としていた欠落——discard 後の
delete が防御的cleanupを落とす、declinedとuncertainを区別できない——を解消。

- `health_sync` に `sync_state`（`'synced'|'uncertain'|'declined'`）を追加、
  `last_synced_at` を nullable に変更（`database/schema.ts` を直接編集
  ——v1 は未リリースのため D-11 の「ALTER TABLE のみ」はまだ適用されない）
- `services/syncJobPlanner.ts`：`planForEdit`/`planForDelete` の第2引数を
  `mappingExists: boolean` から `MappingState`（`'none'|'synced'|
  'uncertain'|'declined'`）に変更。`planForDelete` では `uncertain` は
  `synced` と同じ側（防御的cleanupを積む）、`declined` は `none` と
  同じ側（何もしない）に倒す。両者で共有する述語
  `mappingImpliesExternalTouch` を export（D-21「表の複製を避ける」）
- `repositories/HealthSyncRepository.ts`：`upsertMapping`（`SyncWorker`
  finalize成功時）は常に `sync_state='synced'` を明示的に書く——
  `ON CONFLICT DO UPDATE SET` に含め忘れると、`uncertain` だった記録が
  実際に同期成功しても `uncertain` のまま残ってしまう不具合を実装前の
  レビューで指摘され、修正した。新設の `upsertDeclinedOrUncertainMapping`
  は `external_record_id`/`last_synced_at` を上書きしない（将来の防御的
  削除・履歴として保持する価値の方が高いと判断）
- `services/HealthSyncManualActions.ts`（新設）：Settings「破棄」の実体
  `discardSyncJob`。ジョブ削除と `health_sync` への `uncertain`/`declined`
  記録を1トランザクションで束ねる（`ActivityService.deleteActivity` と
  同じ構造）
- discard の確認文（D-35）は変更不要——`uncertain`/`declined` どちらも
  同じ文言で正しく、後続の delete が取る挙動だけが内部で変わる
- テスト：`services/__tests__/syncJobPlanner.test.ts`（4値の全分岐）、
  `test/__tests__/healthSyncRepository.integration.test.ts`、
  `test/__tests__/healthSyncManualActions.integration.test.ts`
  （discard→delete で防御的cleanupが積まれることを含む end-to-end 検証）。
  全26スイート・352件パス
- **副次的な影響**：`uncertain` からの delete は `external_record_id=NULL`
  のまま HC へ delete を投げるため、「存在しない clientRecordId への
  delete」が通常運用で発生する経路になった。この経路がカバーすべき
  Android 9〜13（D-20）実機検証は 2026-09-21 に実施済み——Pixel 3 で
  reject されることを確認した（詳細は下記「実機確認（Pixel 3、D-20）」・
  設計判断記録 D-20 参照）
- **受け入れた制約**：`health_sync` は Export に含まれない（D-42）ため、
  置換復元（D-10）を実行すると `uncertain`/`declined` は失われ `none` に
  戻る——D-10 の既存設計と整合的なので意識して受け入れる

#### レビューで見つかり、修正したもの

- **🔴 `discardSyncJob` の判定が、破棄するジョブ自身の `attempts` だけでは
  不十分だった**：`update`/`recreate` ジョブは `planForEdit` が
  `mappingState === 'synced'` のときにしか作られないため、`update` ジョブの
  存在自体が「既に確認済みの mapping がある」ことを含意する。その
  `update` が未試行（`attempts === 0`）のまま破棄されても、それ以前の
  `create` が既に外部へ到達している可能性は消えない——`attempts === 0`
  だけで `declined` と判定すると、確実に存在する `external_record_id`
  を持ったまま `sync_state` だけ `declined` になり（`
  upsertDeclinedOrUncertainMapping` は `external_record_id` を上書きしない
  ため）、`planForDelete` から見えなくなる（§10.1 順6 に落ち、防御的
  delete が一切積まれない）。レビューで実際に「確定同期済み→編集→即
  discard→ローカル削除」の手順で再現された。判定を「このジョブの
  `attempts` **または** discard 直前の mapping が
  `mappingImpliesExternalTouch` だったか」の OR に修正し、この手順を
  そのまま回帰テストとして追加した
  （`test/__tests__/healthSyncManualActions.integration.test.ts`
  「D-51 regression」）
- **🟠 `uncertain` を編集で再同期させると D-35 の明示的な拒否が覆る**：
  `uncertain`/`declined` はどちらも `discardSyncJob` の同じ確認文
  （「この記録を Health Connect へ同期しない」）からしか設定されない。
  利用者からは判定根拠の `attempts`（ワーカーがそのジョブを試行済み
  だったか）が不可視なため、同じ文言を確認した2人が、この見えない
  内部事情だけで異なる将来挙動（片方は編集で同期が自動的に復活する）に
  なってしまう——D-35 の「黙って破棄すると利用者はローカルと HC が
  一致していると誤解する」の鏡像。`planForEdit` は `uncertain` を
  `synced` 側ではなく `declined` 側（noop）に倒すよう修正した
  （`planForDelete` 側は物理的な状態の問いなので `synced` 側のまま
  ——この非対称こそが D-51 の主旨）

いずれも設計判断記録 D-51 に訂正の経緯を追記済み。

### ステップ6: Settings 画面の Health Connect UI（実装完了。実機確認済み）

基本設計 §9.6（再試行/破棄の operation 別文言）・§10.4（未同期の変更の可視化）・
§10.5（切断時の警告）・§9.12（切断は `SyncCoordinator.runExclusive` 経由）、
UI/UX §17/§18 を実装。§10.6「全 Activity 削除」の進行表示付きフローは対象外の
まま（`app/settings/data.tsx`/`index.tsx` で既に明示、切断時の警告が見るのは
「未処理の delete job」の件数だけ）。

- `app/settings/health-connect.tsx`（新規）：接続ステータス（Connected/Not
  connected/未インストール）、単一の "Sync to Health Connect" トグル、
  About synchronization、Last synced、未同期の変更一覧（`describeJobAction`
  による operation 別の文言・確認ダイアログ、claim 中は「Syncing…」で
  操作を無効化）
- `services/healthSyncJobPresentation.ts`（新規）：§9.6 の破棄文言テーブルを
  そのままコード化した純粋関数 `describeJobAction`。優先順位は
  内部不整合（`lastErrorCode === 'LOCAL_ACTIVITY_NOT_FOUND'`）→ `delete` →
  それ以外（create/update/recreate）
- **UI/UX §18 モックからの意図的な逸脱**（`health-connect.tsx` の
  doc comment に明記）：
  1. モックは Partnered/Solo 別々のトグルを描くが、データモデルは
     `healthConnect.enabled` という単一 boolean のみ（Phase 1 から既存）。
     単一トグルにした
  2. 未同期の変更一覧はモック上は日付＋Solo/Partnered バッジ付きだが、
     `delete` ジョブ（および内部不整合で Activity が消えている行）は
     構造的にそれができない——`health_sync_jobs` に `activities` への FK が
     無く、delete ジョブは定義上 Activity が既に無いから存在する。
     そうした行は `created_at`（ジョブが積まれた日時）を代わりに表示し、
     バッジは出さない
  3. §10.5「未処理が残っている間は Settings に件数を表示し続ける」は、
     この画面内（Unsynced changes の見出し）でのみ満たす——`settings/
     index.tsx` の Settings トップの行にはバッジを出さない（そのファイルは
     現状 DB に一切アクセスしない静的な一覧のため）
- **`healthConnect.lastSyncedAt` の配線漏れを解消**：`types/Settings.ts` に
  型・既定値・Export除外リストまで用意されていたが、どこからも書き込まれて
  いなかった。`services/SyncWorker.ts` の `finalizeUpsertSuccess`/
  `finalizeDeleteSuccess`（外部呼び出し成功の確定処理）で書くようにした
  ——`upsertMapping` と同じトランザクション内（D-32 と同じ理由：外部呼び出し
  が成功した事実は、ジョブ行を消せるかとは無関係に記録する）
- 切断（トグル OFF）は必ず `SyncCoordinator.runExclusive` 経由——CLAUDE.md/
  §9.12 で名指しされている注意点。渡すコールバックは `setSetting` 一発のみで、
  内側から drain 相当の処理を呼ばない（runExclusive のネスト禁止に抵触しない）
- 手動再試行/破棄の成功後は `useDataRevision().bump()` を呼ぶだけ——新しい
  drain トリガは追加していない（`SyncWorkerLoop.tsx` 側の既存の直列化
  経路にそのまま乗る、CLAUDE.md 参照）。画面がマウントされている間は
  読み取り専用の5秒 polling でジョブ一覧を再取得し、バックグラウンドの
  周期 drain（10秒間隔、DataRevision を bump しない）で claim が外れた
  行が古びて見えるのを防ぐ——`drainDueJobs` は一切呼ばないため、これも
  「新しい drain トリガ」には当たらない
- テスト：`services/__tests__/healthSyncJobPresentation.test.ts`（新規、
  operation × lastErrorCode の全分岐）、`test/__tests__/syncWorker.
  integration.test.ts` に `healthConnect.lastSyncedAt` 更新の検証を追加。
  全27スイート・372件パス

#### レビューで見つかり、修正したもの

- **🔴 可用性チェックの失敗で画面全体が「何も無い」状態に倒れる（iOS では
  常時発生）**：初版は DB 読み取り4件と `HealthConnectService.isAvailable()`
  を同じ `Promise.all` に入れていた。`react-native-health-connect` は iOS
  向けに「どのメソッドを呼んでも必ず throw する Proxy」を返す実装
  （`node_modules/react-native-health-connect/lib/commonjs/index.js` の
  `moduleProxy`）のため、iOS では `isAvailable()` が毎回 reject し、
  `Promise.all` 全体が失敗して `enabled`/`lastSyncedAt`/`jobs` の
  `setState` が1つも走らず、未処理ジョブが残っていても「Everything is
  synced」に見えてしまっていた（§10.5 違反）。DB 読み取りとネイティブの
  可用性/権限チェックを別の `try/catch` に分離し、一方の失敗が他方を
  巻き込まないようにした（`SyncWorker.ts` の `drainDueJobs` が
  `ensureInitialized()` の reject を個別に扱っているのと同じ形）
- **🔴 HEALTH セクションが iOS でも表示されていた**：Health Connect は
  Android 専用機能（§9.11）で、上記の理由によりこの画面のあらゆる操作が
  iOS では失敗するだけだった。`app/settings/index.tsx` の HEALTH セクション
  を `Platform.OS === 'android'` でガードした——「まだビルドされていない
  項目はプレースホルダー行を置かない」という同ファイルの既存ルールの
  延長
- **🟠 切断に進行表示が無い**：§18「破壊的操作は同期の完了を待つ」に対し、
  Switch を disabled にするだけで何も表示していなかった。`data.tsx` の
  置換復元と同水準（スピナー＋ラベル、キャンセルボタンは無し）の busy
  表示を追加した
- **🟠 切断中・HC 未インストール時の Retry now が無反応**：§10.5 により
  切断してもジョブは保持されるため、`enabled=false` かつジョブが残っている
  状態は正常に到達する。この状態では `drainDueJobs` が provider-disabled
  で即 return するため Retry now を押しても何も起きず、故障に見えていた。
  `enabled=false` の間は Retry now を無効化し、一覧の見出しに理由を出す
  ようにした（Discard は引き続き有効——§10.5 の個別打ち切り経路）
- **🟠 権限取り消し後も「Connected」を表示し続ける**：接続ステータスが
  `enabled`/`isAvailable()` しか見ておらず、OS 側で権限が取り消されても
  （§9.5.4）ドットは緑のままだった。`HealthConnectService.
  hasWritePermission()`（新設、`getGrantedPermissions()` を使う——
  `requestWritePermission()` と違いダイアログを出さない）を追加し、
  ステータスを `connected`/`not-connected`/`unavailable`/
  `permission-revoked` の4値にした
- **🟡 5秒ポーリングの設計に4つの不備**：①`enabled` を毎回 DB から
  読み直していたため、権限ダイアログ表示中や `runExclusive` 待ちの最中に
  先行ポーリングの古い結果が後着して一瞬巻き戻ることがあった→`enabled`
  はこの画面自身の書き込み以外で変わらないため、起動時の一度だけ読み、
  定期更新の対象から外した。②unmount 後の `setState` ガードが無かった→
  `mountedRef` を追加。③`isLoadingRef` が多重実行防止のみで、実行中に
  来た `bump()` 起因の再読込を取りこぼしていた→`SyncWorkerLoop.tsx` の
  `drainingRef`/`rerunRequestedRef` と同じ「実行中なら完了後にもう一度」に
  変更。④バックグラウンドでもタイマーが回り続け、N+1 の
  `findActivityById` が無意味に走り続けていた→`AppState` を見てフォア
  グラウンド中だけ回すようにした（復帰時は即座に1回読み直す）
- **🟡 `healthConnect.lastSyncedAt` の書き込みが `finalizeUpsertSuccess`
  の中で非対称だった**：「外部呼び出しが成功した事実は、ジョブ行を消せる
  かとは無関係に記録する」（D-32 と同じ理由）と自分で書いたコメントに
  反し、実際には Activity が見つかる分岐の中でしか書いていなかった——
  処理中に Activity が削除された §9.5.1 else 分岐（外部呼び出し自体は
  成功している）で書き漏れていた。`db.transaction` の先頭・無条件に
  移動した
- **🟢 doc comment の陳腐化**：`SyncCoordinator.ts`「Settings UI 自体が
  まだ無いため配線先が無い」、`HealthSyncJobRepository.ts`「SyncWorker は
  Phase 4 で未実装」——いずれも本ステップで実装済みになったため誤りに
  なっていた。修正した
- **🟢 内部不整合ジョブ（`LOCAL_ACTIVITY_NOT_FOUND`）にも Retry now を
  出していた**：Activity が無い事前チェックで決定論的に落ちるだけの状態
  なので、再試行しても claim → 同じチェック → `markJobInternalInconsistency`
  を繰り返すだけだった。`describeJobAction` の `retryLabel` を
  `string | null` にし、このケースでは `null`（ボタン自体を出さない）に
  した
- **見送ったもの**：`requestManualRetry` が `last_error_code` をクリアしない
  点、`findAllJobsForProvider` の N+1（`buildRow`）は、いずれも現在の UI が
  operation 別の一般的な文言しか出さずエラーコード別の文言を出していない
  こと、上記のバックグラウンド停止で N+1 の常時コストは解消したことから、
  見送った（指摘としては妥当、現状のスコープでは実害が無いと判断）

#### レビュー2巡目で見つかり、修正したもの

1巡目の修正（`hasWritePermission()` 新設・4値ステータス化）自体が新たな
不備を持ち込んでいたのを、再レビューで指摘・修正。

- **🟠 `hasWritePermission()` を `ensureInitialized()` 無しで呼んでいた**：
  ネイティブ側の `getGrantedPermissions` は `throwUnlessClientIsAvailable`
  を通り、`initialize()` 未実行だと `ClientNotInitialized` で reject する
  （`HealthConnectManager.kt`）。`initialize()` を呼ぶ経路は
  `drainDueJobs`（`enabled` が true のときだけ）と `handleEnable` の2つ
  しか無いため、`enabled=false` のままこの画面を開くと毎回 reject して
  `logError` が5秒ごとに積み上がり、`enabled=true` でもアプリ起動直後
  （`SyncWorkerLoop` の最初の drain が `ensureInitialized()` に到達する前）
  は一時的に reject しうる。さらに深刻なのは catch の倒し方——
  `isAvailable()` が true を返した直後でも権限チェックの失敗だけで
  `available` まで巻き込んで `false` にしていたため、実際には利用可能
  なのに「Health Connect isn't installed」と誤表示していた（4値化した
  狙いと逆方向）。`refreshConnectionHealth`（新設、
  `services/healthSyncJobPresentation.ts` ではなく画面側に置く——DB/
  ネイティブ両方に触れるため純粋関数にできない）で、可用性チェックの
  失敗と権限チェックの失敗を別の `try/catch` にし、権限チェック失敗時は
  `hasPermission` だけ倒して `available` は変更しないようにした。権限
  チェックの前に `ensureInitialized()` を呼ぶ（`drainDueJobs` 自身も毎回
  呼んでいる操作なので、繰り返し呼ぶこと自体はこのコードベースで
  既に許容されているパターン）
- **🟡 「HC 未インストール時の Retry now 無効化」が `enabled` しか見ていな
  かった**：`UnsyncedRow` に渡していたのは `enabled` のみで、
  `unavailable`/`permission-revoked` の状態（`enabled=true` だが未
  インストール、または権限取り消し）では Retry now が押せてしまい、
  `drainDueJobs` が空振りする（未インストールは即 return、権限取り消しは
  `PERMISSION_DENIED` でバックオフを消費するだけ）押しても無反応な状態が
  残っていた。`connectionStatus(...) === 'connected'` を `canRetry` として
  渡すよう変更し、`connected` 以外は理由付きの caption
  （`RETRY_BLOCKED_CAPTION`）とともに無効化するようにした
- **🟢 `mountedRef` の初期化位置**：`useRef(true)` の初期値と cleanup での
  `false` 代入だけだと、React StrictMode の dev-only
  mount→unmount→remount で永久に `false` に固定されうる（このアプリは
  StrictMode 未使用のため現状実害は無い）。effect 本体で
  `mountedRef.current = true` を明示するよう修正
- **🟢 doc comment の陳腐化（続き）**：`services/ActivityService.ts` の
  「`SyncWorker`/`HealthConnectService` は Phase 4 で未実装」
  「`healthConnect.enabled` は常に `false`（UI が無い）」——1巡目の修正で
  見落としていた。修正した
- `connectionStatus`/`CONNECTION_STATUS_LABEL`/`RETRY_BLOCKED_CAPTION` は
  `describeJobAction` と同じ理由（DB/RN 非依存の純粋関数として網羅的に
  テストする）で `services/healthSyncJobPresentation.ts` に集約——当初は
  `health-connect.tsx` 内のローカル関数だった
- 全27スイート・376件パス

#### レビュー3巡目で見つかったもの（いずれも低・必須ではないとの評価込みで指摘）

- **`loaded` がネイティブ呼び出しの完了まで待つ構造だった**：`load()` は
  DB 読み取りブロックの後に `await refreshConnectionHealth()` してから
  `finally` で `setLoaded(true)` していたため、D-41 と同じ「cancel も
  タイムアウトも無い」native module 呼び出しが settle しなければ画面が
  永久に "Loading…" のまま固まりうる（`loadingRef` も解放されずポーリングも
  止まる）。`setLoaded(true)` を DB ブロック直後に移し、接続ステータスは
  後から埋まる progressive enhancement にした
- **`enabled=false` の間も5秒ごとにネイティブ往復していた**：
  `connectionStatus` は `!enabled` を最優先で `not-connected` に倒すため
  `available`/`hasPermission` は表示に無関係なのに、`refreshConnectionHealth`
  は毎回 `isAvailable`→`ensureInitialized`→`getGrantedPermissions` を
  素通りさせていた。`enabledRef`（トグルのたびに `load`/interval を
  再生成しないための ref）で早期 return するようにした
- `healthSyncJobPresentation.ts` 冒頭の doc に `connectionStatus` 系の説明を
  追記（`describeJobAction` 専用の説明のままだった）
- **見送ったもの**：`permission-revoked` からの復帰導線（再許可ボタン/
  `openHealthConnectSettings()` への導線）は UI/UX §18 に明文が無いため
  v1 では実装しない（上記 Known gaps に記録）

#### 実機確認（Pixel 11、初回）

`adb install -r` で上書きインストールした際に `table health_sync has no
column named sync_state`（D-51 より前の古い DB スキーマが端末に残って
いたため——CLAUDE.md「schema.ts を変更した後の実機テストは、既存アプリを
一度アンインストールすること」参照）を踏んだが、これはコードの不具合では
なく実機側のデータが古かっただけ。アンインストール→再インストールで解消し、
以下をクリーンな状態で確認できた：

- HC ON → OS 権限ダイアログ（要求されるのは「性行為」のみ、「月経周期の
  管理」等は要求されていないことを実際の OS ダイアログで確認——D-12/D-20
  「READ 権限を要求しない・WRITE_SEXUAL_ACTIVITY のみ」の実装が実機でも
  そのとおりであることの確認になった）→ 許可 →「Connected」表示
- Activity 記録 → 数秒後に自動同期 → Last synced が実際の時刻に更新
  （`finalizeUpsertSuccess` の `lastSyncedAt` 書き込みを実機で確認）
- Activity 削除 → delete job → 自動同期 → Last synced が再び更新
  （`finalizeDeleteSuccess` 側も確認）、Unsynced changes は両方とも
  「Everything is synced」に戻る

**🟠 実機で新たに発見・修正した不具合**：`healthConnect.enabled` の
起動時読み込みが非同期のため、この画面をマウントした直後（Settings から
毎回ナビゲートするたびに新規マウントになる）に `refreshConnectionHealth`
が走ると、`enabledRef.current` がまだ `useState(false)` の初期値のまま
（本当に false と確定したわけではなく、単に「まだ読めていない」だけ）で
早期 return し、`available`/`hasPermission` を false に固定してしまう
——enabled=true かつ実際に同期成功済みでも "Health Connect isn't
installed" と表示され、次の5秒ポーリングまで放置される、という形で実機で
再現した。3巡目レビューで追加した `enabledRef` 早期 return ガード自体が
生んだ回帰で、ユニットテストでは検出できない類のタイミング依存バグ
（画面のマウント〜複数 effect の実行順序に依存）だった。

その場しのぎの修正（専用の `enabledKnownRef` を追加）で収めた後、
レビューで「`enabled` state 自体も相変わらず `boolean` で『未確定』と
『確定して false』を同一視している——今回たまたま `load()` の DB 読み取り
（3件＋ジョブ件数ぶんの `buildRow`）が enabled の読み込みより遅いから
表面化していないだけで、根は同じ」「マウント時に `refreshConnectionHealth`
が2つの effect から2回走っている」と指摘され、根本から直した：
`enabled` state・`enabledRef` とも `boolean | null`（`null` = 未読み込み）
にし、`healthConnect.enabled` の読み込みを別 effect に分けず `load()` の
DB 読み取りブロックに統合（`enabledRef.current === null` の間だけ読む）。
これにより①`setLoaded(true)` の時点で enabled は必ず確定済みになり、
②マウント時のネイティブ往復（isAvailable→ensureInitialized→
getGrantedPermissions）も1回に減った。render 側も `loaded || enabled ===
null` の間は描画しないガードを追加し、実行順序が将来崩れても壊れない形に
した。`enabledKnownRef` という専用 ref との二重管理も、この統合で1本
（`enabledRef`）に畳まれた。

#### 実機確認（Pixel 11、2回目）

上記修正後、force-stop→再起動直後の初回マウントで即座に「Connected」が
安定して表示されること（40分アイドル後のコールドスタートでも再現）、
Settings 画面への連続的な出入り（3回連続）でもステータスが崩れないことを
確認した。

レビューで「discard は `health_sync` に declined/uncertain を永続化し、
以後 `planForDelete` の分岐を変える書き込みで UI から元に戻す導線が無い
ため、実機で一度通しておくべき」と指摘され、確認した：HC を OFF にして
ジョブを凍結させ（切断してもジョブは破棄しない、§10.5 の性質を利用）、
「Don't sync」→確認ダイアログ「Don't sync this record? / Solo + Us and
Health Connect will no longer match.」→確定→ジョブが一覧から消え
「Everything is synced」に戻ることを確認。あわせて、OFF 中は Retry now が
無効化され「Turn on Sync to Health Connect to retry these.」の caption が
出ること（レビュー2巡目で直した canRetry ロジック）も実機で確認できた。

Retry now の実際の再試行、claim 中の無効化表示、delete job が残っている
状態での OFF 切断警告、`permission-revoked` の実機確認は今回未実施
（下記 Known gaps に残す）。

**🟢 レビューで認識共有された残り1点（修正・さらにレビューで再指摘）**：
`healthConnect.enabled` の読み取りが失敗した場合、`enabledRef.current` を
`false` で確定させていたため、一過性の DB エラーでもこの画面を開いている
間ずっと "Not connected" にラッチする（裏では `SyncWorkerLoop` が正しく
同期を続けているにもかかわらず）。失敗時は今回の描画だけ `false` を
見せつつ `enabledRef.current` は `null` のまま残すよう最初に修正したが、
**この修正自体が効いていなかった**：`enabledRef` には `enabled` state の
変化を自動反映する mirror effect（`useEffect(() => { enabledRef.current =
enabled }, [enabled])`）が既にあり、失敗パスの `setEnabled(false)` が
`enabled` state を変えるため、直後にこの mirror effect が
`enabledRef.current` を `false` で上書きしてしまい、「`null` のまま残す」
という意図を無効化していた——実機では state 変更→effect の実行順序に
依存するため踏まず、レビューで指摘された（検証するには `getSetting` を
一時的に throw させる必要がある）。

mirror effect 自体を廃止し、`enabledRef` を更新すべき3箇所（`load()` の
初回読み込み成功時・`handleEnable`・`disconnect`）でそれぞれ明示的に
更新する形にした——読み込み失敗パスだけ意図的に触らない、という
非対称性は、自動追従をやめて書き手を管理する以外に保てない。

#### 実機確認（Pixel 11、3回目）

2回目で未実施のまま残していた項目をすべて確認した（HC 未インストール
環境の ON 操作は試みたが、Pixel 11 では検証不能と判明——詳細は末尾）。
claim 中の状態や「未 claim のまま OFF にする」瞬間は
自然発生ではタイミングが合わないため、`services/HealthConnectService.ts`
の `upsertActivity`/`deleteActivityRecord` 冒頭に一時的な `await
new Promise((r) => setTimeout(r, ...))` を差し込んで意図的に外部呼び出しを
遅延させ、確認後に `git diff` が空になることを確認してから元に戻す、という
手法で検証した（`services/HealthConnectService.ts` はネイティブ層を持たない
純粋な TS のため、この差し替えは Metro の Fast Refresh だけで反映され、
gradle 再ビルドは不要だった）。

- **claim 中の行の無効化表示**：create/update ジョブ・delete ジョブの両方で
  「Syncing…」表示中は Retry now/Discard 系ボタンがグレーアウトすることを
  確認
- **Retry now の実際の再試行**：初回は権限剥奪→復元→即 Retry now という
  手順で確認したが、自動バックオフ（1回目失敗で5秒後に再試行）と周期
  drain（10秒間隔）が並走しており、タップした瞬間に処理が始まったのか
  自動再試行が先んじていたのかを区別できていなかった（レビュー指摘）。
  `services/SyncWorker.ts` の `not_before IS NOT NULL` という due 判定
  （`repositories/HealthSyncJobRepository.ts` の `claimNextDueJob`）を
  踏まえ、`MAX_AUTOMATIC_ATTEMPTS` を一時的に `10`→`1` に変更（TEMP、
  確認後に `git diff` が空になることを確認して復元）した状態で再検証：
  1回目の失敗で即座に `not_before = NULL`（自動再試行の対象から構造的に
  外れる）の手動待ちへ落ちることを確認し、**権限復元後も無操作で
  35秒以上（切断中20秒＋ Connected 状態で15秒）放置してジョブが
  一切変化しないこと**を確認したうえで Retry now をタップ→即座に成功
  （Last synced 更新・ジョブ消滅）。これにより「Retry now が実際に
  同期を成立させている」ことを自動再試行の関与なしに確認できた
- **`permission-revoked` の表示**：上記の権限剥奪操作で確認。**発見**：
  `pm revoke` で Health Connect の permission を取り消すと、対象アプリの
  プロセスが即座に kill される（ホーム画面に落ちる）——通常の Android
  runtime permission の revoke と同じ挙動。実機で意図的に権限を消して
  確認する際は、revoke 直後にプロセスが死ぬ前提で手順を組むこと（今回は
  再起動後に "Permission needed" 表示が正しく復元されることも合わせて
  確認できた）
- **delete job が残っている状態での OFF 切断時の警告と再接続後の再開**：
  §10.5 の確認ダイアログ「Health Connect has N unsynced deletion(s)」→
  「Disconnect anyway」で実際に OFF にできること、OFF 中はジョブが
  `Not connected`/`Turn on Sync to Health Connect to retry these.` の
  まま保持され続けること、再度 ON にすると自動的に delete が完了し
  `Last synced` が更新されることを確認した。**注記**：claim 済み（外部
  呼び出しが in-flight）のジョブに対して OFF にした場合は
  `SyncCoordinator.runExclusive` がその呼び出しの settle を待ってから
  `enabled=false` を書き込むため、待っている間にジョブ自体が成功で
  完了することがある（§9.12 の設計通り——「呼び出し側が諦めても裏で
  待ち続け、settle してから通常状態に戻す」が disconnect 経路でも
  そのまま働いている）。ジョブを未 claim のまま OFF できた場合のみ、
  警告ダイアログ通りに「OFF にしても記録は残る」状態を再現できる
- **バックグラウンド/フォアグラウンド遷移**：ホーム→復帰を4回連続、
  加えてバックグラウンドで15秒待機して `dumpsys cpuinfo` の累積値が
  待機前後で変化しないこと（＝ポーリングが暴走していないこと）を確認。
  クラッシュ・ログ上のエラーなし
- **HC 未インストール環境での ON 操作時の表示は、Pixel 11（Android
  プラットフォーム統合パス）では検証できないことが判明**：`adb shell pm
  disable-user com.google.android.apps.healthdata` で Health Connect
  本体アプリを無効化しても、`HealthConnectService.isAvailable()`
  （`getSdkStatus`）は無効化前と変わらず利用可能を返し続け、Sync トグルを
  OFF→ON しても `handleEnable` の「Health Connect isn't installed」
  Alert は一度も出なかった——Android 14 以降は Health Connect がプラット
  フォーム本体に統合されており、`com.google.android.apps.healthdata` は
  設定 UI 側のフロントエンドに過ぎず、SDK の可用性はこのアプリの
  有効/無効に左右されないためと考えられる（確認後、`pm enable` で
  元の状態に復帰させ、Sync が引き続き正常動作することも確認済み）。
  この検証は Android 9〜13（Health Connect が Play ストア配布の別アプリ、
  D-20 と同じ非プラットフォーム統合パス）でなければ意味を持たない
  ——**D-20 の Pixel 3 実機検証と合わせて実施する**

#### 実機確認（Pixel 3、D-20——Android 9〜13 非プラットフォーム統合パス）

2026-09-21、Pixel 3（Android 12、API 31）で実施。この端末には Health
Connect が最初から入っていない（Android 13 以下は Play ストア配布の別
アプリのため）ため、まず上記「HC 未インストール環境での ON 操作」を
この端末で確認できた：Sync トグル ON →「Health Connect isn't installed」
「Install Health Connect to sync your records.」の Alert が正しく表示
され、OK で閉じても状態は Not connected のまま——Pixel 11 では検証不能
だった項目が、非プラットフォーム統合パスでは想定どおり動くことを確認
できた。

続けて Play ストアから Health Connect（v2026.08.06.00）をインストールし、
D-20 本題（存在しない `clientRecordId` への delete）を検証した：

1. Solo + Us で Sync ON →実際の OS 権限フロー（すべて許可 / 性行為の
   書き込みトグルを個別に ON → 許可）を通す——要求されるのは
   「性行為の書き込み」のみで、Pixel 11 の platform 経路と同じく
   READ 権限は要求されないことをこの経路でも確認
2. Activity を1件記録→自動同期→ Health Connect アプリの「データと
   アクセス」画面で実レコードが入っていることを確認
3. **Health Connect アプリ側から直接そのレコードを削除**（外部で
   先に消えた状態を人為的に再現）
4. Solo + Us 側で同じ Activity を削除→ delete ジョブ作成→ Retry now

**結果**：`deleteRecordsByUuids` が
`{"code":"UNDERLYING_ERROR","message":"Request contains invalid UID.",
"str":"android.os.RemoteException: Request contains invalid UID."}`
で reject された（一時的に `console.log` を仕込んで実測、確認後に
`git diff` が空になることを確認してから削除）。`classifyError()` の
switch に `UNDERLYING_ERROR` は無いため `UNKNOWN` に分類され、§9.6 の
通常のリトライ・バックオフに乗る——**Android 9〜13 では「存在しない」
削除は成功にならず、`attempts` が `MAX_AUTOMATIC_ATTEMPTS`（10）に到達
するまで自動リトライを繰り返した末に手動待ち（Retry now/discard）に
落ちる。** バックオフ表 `[5,15,60,300,900,3600,21600,86400]` 秒により、
1回目の失敗から10回目の失敗（手動待ちに落ちる瞬間）まで実時間で約
55.4 時間（≈2.3 日）かかる——この間ずっと「Not synced to Health
Connect」相当の表示が残る。これは D-20 の「ラッパーが識別できない場合は
既知の制限として受け入れる」という想定どおりの帰結で、**`delete`
ジョブに関しては**実装変更は不要と判断した。「Stop retrying」による
破棄（確認文言「Stop retrying this deletion? / This record may remain
in Health Connect.」）も実機で正常に動作し、ジョブが消えて
「Everything is synced.」に戻ることを確認した。

**この結論の範囲についての注記**（レビュー指摘、2026-09-21）：

- **`recreateActivity`（§9.3.1）への影響は未検証・要注意。**
  `services/HealthConnectService.ts` の `recreateActivity` は「delete が
  失敗したら insert せずここで失敗を返す」（D-34）ため、Android 9〜13 で
  `operation: 'recreate'` のジョブが「外部レコードが実在しない」状態に
  当たった場合、delete の段階で今回確認した reject を受け続け、**insert
  に一度も到達できないまま同じ約55時間のサイクルで手動待ちに落ちる**。
  現状 `operation: 'recreate'` を生成するコードは存在しない（§13.6 は
  Known gap、未実装）ため実害は出ていないが、D-34 の「`NOT_FOUND` を
  成功扱いにしている以上、先頭からの再実行は常に安全」という記述は
  Android 9〜13 では「安全（副作用がない）」は成り立つが「いずれ成功する」
  は成り立たない——§13.6 実装時に別途判断が必要。詳細は
  [設計判断記録 D-20](docs/Solo%20+%20Us_設計判断記録%20v0.11.md#d-20-削除の存在しないを成功として扱いread-権限は追加しない)・
  D-34 に追記済み（**解消: 2026-09-21——`recreateActivity` を修正し、
  delete が `UNKNOWN` 分類で失敗した場合は insert へ進むようにした
  （§9.4 の clientRecordId upsert により二重レコードは生まれない）。
  「Phase 4 実装状況 > ステップ7」・D-34「§13.6 実装時の結論」参照**。
  **実機確認も 2026-09-21 に完了（ステップ7「実機確認（Pixel 3、
  `recreateActivity` の insert-after-delete-failure）」参照）**）
- **検証したのは「HC アプリ側で直接削除」という1経路のみ。** D-20 が
  本来想定していたのは「外部 delete に成功した直後・ローカル確定前に
  クラッシュ」というケースで、これも「対象 UID がもう存在しない」という
  点では同じはずだが、HC 内部の実装（トゥームストーンの有無等）次第で
  挙動が完全に一致しない可能性は理論上残る
- **検証環境は Pixel 3 / Android 12（API 31）/ Health Connect
  v2026.08.06.00 の1台1バージョンのみ。** Health Connect は単一 APK
  として配布されるため大きく異なる可能性は低いと考えるが、「Android
  9〜13 では」という断定は、この1点の検証に基づくものであることを
  明記しておく

**実機検証中に踏んだ、この端末固有の妨害要因**（アプリのバグではない）：
検証の後半、Gmail の大量通知により通知シェードが開いたまま固着し、
adb 経由のタップが吸われて一切効かなくなる状態を繰り返し踏んだ
（`cmd statusbar collapse`・systemUI 再起動でも解消せず、ユーザーに端末を
直接操作してもらって解消）。個人の実機を検証機に使う場合、通知量が
多い端末では同様の症状が起こりうる——再現しない場合は uiautomator の
タップが本当に届いているか（`dumpsys window | grep mCurrentFocus` が
自アプリを指しているか）を先に確認すること。

#### §9.11 リリースビルド分離（2026-09-21、実装・実機確認完了）

`EXPO_PUBLIC_HEALTH_CONNECT_ENABLED` で `app.config.js` が Manifest の
permission（`WRITE_SEXUAL_ACTIVITY`）と rationale plugin を切り替え、
`lib/healthConnectBuild.ts`（`isHealthConnectBuildEnabled()`）が
`app/settings/index.tsx` の HEALTH セクション表示を同じフラグでゲートする
（ネイティブモジュール自体は両ビルドで維持——理由は CLAUDE.md 参照）。
`eas.json` を新規作成し、`production`（without-health-connect）/
`production-with-health-connect` の2プロファイルを用意（EAS build は
未実行、ビルド枠温存のため）。

ローカル検証：①`expo prebuild` で両条件の生成 Manifest を diff し
permission/rationale activity の有無を確認、②Pixel 3 実機（無効化フラグ、
`.env.local` 経由）で HEALTH セクションが非表示になること・クラッシュが
無いことを確認。**なお `EXPO_PUBLIC_*` は dev-client のライブリロードでは
shell export だけでは反映されず `.env.local` が必要**（`expo export`/
EAS Build の静的バンドルでは shell export のみで正しく動くことを確認
済み）——詳細は CLAUDE.md 参照。

**レビュー指摘を反映済み（2026-09-21・コード変更なしのレビュー→別コミットで対応）：**
- フラグの既定値を「未設定=有効」から「`=== '1'` のときだけ有効」（opt-in）
  へ変更——env 指定漏れが安全側に倒れるように
  （`.env.local.example` を追加、`eas.json` の development/preview には
  明示的に `"1"` を設定）
- with-health-connect ビルドで ON にした端末へ without ビルドを重ねても
  `healthConnect.enabled` が true のまま残る問題を、起動時の是正
  （`services/ActivityService.ts` の `reconcileHealthConnectBuildFlag`、
  `contexts/DatabaseContext.tsx` から呼ぶ）で解消
- `app/settings/health-connect.tsx` への deep link 直接到達（Settings 一覧の
  行を隠すだけでは防げない）を、画面自体のリダイレクトガードで解消
- `app.config.js` の `android.permissions` 上書き・plugin 挿入位置の脆さを修正

**未検証のまま残る項目（ストア申請前に確認すること）：** `eas.json` の
`production` と `production-with-health-connect` は同じ `versionCode`
空間を共有する（`extends` で `autoIncrement` を継承）。`appVersionSource:
"local"` と動的 config（`app.config.js`）の組み合わせで EAS CLI が
ローカルバージョンを正しく読み書きできるかは EAS build 未実行のため未検証。

#### Known gaps（次のステップ）

- **Settings UI の実機確認は完了**（上記「実機確認（Pixel 11、
  初回/2回目/3回目）」「実機確認（Pixel 3、D-20）」参照）：HC ON→権限
  ダイアログ→Connected 表示、Activity 記録/削除→HC への反映、Last synced
  の実際の更新、破棄（confirm ダイアログ＋実際の discard）、OFF 中の
  Retry now 無効化＋caption、claim 中の行の無効化、Retry now の実際の
  再試行、delete job が残っている状態での OFF 切断時の警告と再接続後の
  再開、`permission-revoked` の表示、バックグラウンド/フォアグラウンド
  遷移でのクラッシュ・無限ループの有無（AppState 配線自体、ステップ4
  参照）、HC 未インストール環境での ON 操作時の表示（Pixel 3 で確認、
  Pixel 11 の platform 統合パスでは検証不能）
- **Android 9〜13（非プラットフォーム統合パス）での D-20 実機検証は
  `delete` ジョブについて完了**（上記「実機確認（Pixel 3、D-20）」参照）：
  存在しない `clientRecordId` への delete は `UNDERLYING_ERROR`/
  「Request contains invalid UID.」で reject され、`UNKNOWN` 分類→通常の
  リトライ・バックオフ（手動待ちまで約55時間）に乗ることを確認した。
  設計判断記録 D-20 に確認結果を追記済み。**`recreateActivity`（§13.6/
  D-34 の recreate 経路）への影響は未検証**——外部レコードが不在の場合、
  delete 段階で同じ reject を受け続け insert に到達できない可能性が
  あり、§13.6 実装時に別途判断が必要（詳細は上記「実機確認（Pixel 3、
  D-20）」の注記参照。**解消: 2026-09-21——`recreateActivity` を修正し、
  この delete reject（`UNKNOWN` 分類）を受けても insert へ進むように
  なった。上記結果はいまも「delete ジョブ」自体には正確だが、recreate
  経路はもはやここで止まらない。「Phase 4 実装状況 > ステップ7」参照**。
  **実機確認も 2026-09-21 に完了（ステップ7「実機確認（Pixel 3、
  `recreateActivity` の insert-after-delete-failure）」参照）**）
- **`permission-revoked`（OS 側で権限を取り消された後）からの復帰導線が
  無い**：ステータスと caption で状態は伝わるが、再許可する手段（トグルを
  OFF→ON し直す以外の導線——`requestWritePermission()` を直接呼ぶボタン、
  または `openHealthConnectSettings()` への導線）は無い。仕様（UI/UX §18）
  に明文が無いため v1 は見送り（レビューで指摘・妥当と判断）。実装するなら
  `HealthConnectService.openHealthConnectSettings` のラッパーが必要
  （現状未追加）

### ステップ7: 復元後の Health Connect 再同期（§13.6、実装完了。実機確認済み）

Phase 4 に残っていた唯一の機能実装。置換復元（`services/ImportService.ts`
の `performReplaceImport`）は `health_sync`/`health_sync_jobs` を全削除
するため、復元後は全 Activity が Health Connect に対して「未同期」に
なる——これを §13.1「既定 OFF・明示同意制」のもとで解消する。

実装後、レビューで2ラウンドの重大な指摘を受け、当初案から設計を変更
している。以下は最終形。

#### 実装内容

1. **`services/HealthConnectService.ts` の `recreateActivity` 修正**
   （§13.6/D-34、詳細は設計判断記録 D-34「§13.6 実装時の結論」参照）：
   delete が `classifyError` で `UNKNOWN` に分類される失敗をした場合は
   insert へ進むよう変更した。`PERMISSION_DENIED`/`UNAVAILABLE` は
   従来通り即座に失敗。§13.6 の主要ユースケース（機種変更・復旧）では
   復元先の Health Connect に対象レコードが1件も存在しないため、当初の
   「delete に失敗したら常に作成しない」では Android 9〜13（D-20）で
   recreate が**全件・恒久的に**（リトライしても解消しない）失敗して
   いた——「大多数の環境で問題なく機能する」という当初の前提が誤って
   いたことがレビューで判明した。二重レコードを作らない安全性は
   `clientRecordId`（§9.4）による upsert 冪等性に由来するため、health_connect
   ではロジック変更後も二重作成のリスクは無い。OS バージョンによる分岐、
   エラーメッセージ文字列への依存はいずれも追加していない（D-20 の
   2原則を維持）。
2. **`services/HealthSyncResyncService.ts`（新規）**：
   `queueResync(db)` と、書き込みを伴わない事前カウント
   `countPendingResync(db)`（判定ロジックは `resolveResyncTargets` として
   共有、2巡目のレビュー後に追加）。有効な provider ごとに全 Activity を
   走査し、`health_sync_jobs` に該当行が無く、かつ `health_sync`
   （mapping）の `sync_state` が `'declined'`/`'uncertain'` でないものに
   `operation: 'recreate'` をまとめて `insertJob` する。**`sync_state
   = 'synced'` は除外しない**（2巡目のレビューで指摘・修正——当初は
   除外していたが、それだと Health Connect アプリ側で直接削除された
   記録（D-20 が実機検証した経路そのもの）をこの一括操作では二度と
   救済できなかった。ローカルは READ 権限を持たない（D-12/D-20）ため
   「synced のままだが実は HC 側に無い」を判別できず、`recreate` は
   常に安全（D-34）なので同期済みも含めて対象にする方を採った）。
   `declined`/`uncertain`（D-51、利用者が明示的に「同期しない」を選んだ
   状態）は除外し続ける——一括操作でこれを覆さない。`SyncCoordinator.
   runExclusive` では包まない——既存の行の削除・置換を一切行わず追加のみを
   行う点で `ActivityService.recordActivity` のジョブ挿入と同じ性質であり、
   `runExclusive` が対象とする「破壊的操作」に該当しないため
   （`performReplaceImport` の `runExclusive` が完了した**後**に、別の
   ステップとして呼ぶ——同じコールバック内にネストすると
   `SyncCoordinator.ts` の直列化キューが自己デッドロックする、CLAUDE.md
   参照）。挿入は `HealthSyncJobRepository.insertJobsBulk`（新規、複数
   VALUES の一括 INSERT・読み戻し無し）を使う——`@op-engineering/op-sqlite`
   の `db.transaction()` は接続ごとに1つの FIFO キューで直列化されるため
   （`node_modules/@op-engineering/op-sqlite/src/functions.ts` で確認）、
   この関数の実行中はアプリ全体の他のどのトランザクション（新規記録・
   SyncWorker の finalize 含む）も完了までブロックされる——1件あたり
   INSERT+SELECT の2ステートメントを要する `insertJob` のループではなく
   一括 INSERT にまとめることで、Activity 数が数百〜数千件でもこの関数
   自体を短時間で終わらせる。
3. **`app/settings/data.tsx` の `offerResync` ステップ（新規）**：
   置換復元成功後、`healthConnect.enabled`（`DEVICE_OWNED_SETTING_KEYS`
   に属し復元で変更されない）が true の場合のみ表示。「Sync to Health
   Connect」／「Not now」の二択で、同意時のみ `queueResync` を呼ぶ。
   HC が無効な場合はこの画面自体をスキップし、従来通り Import 完了の
   Alert のみを表示する。
4. **`app/settings/health-connect.tsx` の「Sync everything to Health
   Connect」（新規、恒久的な入口）**：レビュー指摘で追加。`offerResync`
   は一度きりの画面のため、「Not now」を押す・画面を離れる・復元直後に
   アプリが落ちる等で同意の機会を逃すと再同期する手段が無く、復元後は
   `health_sync` が空になり以後の編集も `planForEdit` が noop を返し
   続ける（D-51）ため、**基本設計 §13.3.2「復元後に Activity を編集
   すれば、通常どおり同期ジョブが作られる」という約束と矛盾する恒久的な
   未救済状態**になっていた。Settings > Health Connect にいつでも呼べる
   ボタンとして追加し、`queueResync` を再利用する。**この入口は §13.6
   が本来規定する「復元後の再同期」の範囲を超えて使える**（2巡目の
   レビュー指摘）——例えば HC を初めて ON にした直後に押せば、過去の
   全履歴を一括送信できる。センシティブなデータを外部へまとめて送る
   操作のため、確認ダイアログを出す前に `countPendingResync` で対象件数を
   数え、件数を明示したうえで同意を取る（`handleResyncEverything`）。
5. **`app/settings/health-connect.tsx` の N+1 クエリ修正**：
   レビュー指摘。Unsynced changes 一覧の描画（5秒ポーリングごと）が
   `findActivityById` をジョブ1件ごとに呼んでいたが、`queueResync`
   により一度に数百〜数千件のジョブが増えうるようになったため、
   `findAllActivities` の一括読み込み1回＋ Map 参照に変更した。

#### テスト

- `services/__tests__/HealthConnectService.test.ts`：`recreateActivity` の
  分岐（`UNKNOWN` は insert へ進む／`PERMISSION_DENIED`・`UNAVAILABLE`
  は進まない／insert も失敗すればジョブ全体は失敗のまま）
- `test/__tests__/exportImport.integration.test.ts`：`queueResync`/
  `countPendingResync` の統合テスト——全 Activity × 有効 provider に
  `recreate` が積まれること、HC 無効時は何も積まれないこと、既存ジョブが
  ある Activity はスキップされ上書きされないこと（ユニーク制約違反が
  起きないことの直接的な証拠）、連続2回呼んでも冪等であること、
  Activity 0件のエッジケース、`synced` mapping は再送される一方
  `declined`/`uncertain` はスキップされること、`countPendingResync` が
  書き込みをせず `queueResync` と同じ件数を返すこと
- `test/__tests__/syncWorker.integration.test.ts`：`queueResync` が積んだ
  ジョブが実際に `SyncWorker.drainDueJobs` で処理されるまでの
  end-to-end（積まれたジョブが即 due であること・claim/finalize まで
  通ること）

#### 実機確認（Pixel 3、`recreateActivity` の insert-after-delete-failure、2026-09-21）

D-20 と同じ Android 12（API 31、ビルド `SP1A.210812.016.C1`、セキュリティ
パッチ 2021-10-05、Google Play システムアップデート 2026-07-01、Health
Connect アプリ v2026.08.06.00.release）で、`recreateActivity` の delete
失敗→insert 進行の経路を確認した。

**手順**：Health Connect アプリ側で対象 Activity の性行為エントリを直接
削除（「接続されているアプリが、このデータにアクセスできなくなります」の
確認ダイアログ経由）→アプリの Settings > Health Connect で
「Sync everything to Health Connect」→確認ダイアログ（「Sync 1 activity to
Health Connect?」）→SYNC。

**結果**：
- LogBox の警告バナーに `HealthConnectService: recreateActivity delete
  failed as UNKNOWN — proceeding to insert anyway (clientRecordId upsert is
  idempotent, §9.4)` が実際に出力された——`services/HealthConnectService.ts`
  の `recreateActivity` 内、`UNKNOWN` 分類時の診断ログ（DEV ビルド向け）が
  意図通りこの分岐に到達したことの直接的な証拠
- Settings > Health Connect の Last synced が実行直後の時刻に更新され、
  Unsynced changes が「Everything is synced.」に戻った（ジョブが
  finalize まで到達し、手動待ちに落ちていないことを確認）
- Health Connect アプリ側で該当エントリ（10:31・Solo + Us）が実際に
  再作成されていることを確認——delete 失敗後に本当に insert まで到達し、
  外部レコードが復元されたことの直接証拠

これにより、Known gaps に残っていた「`recreateActivity` の
insert-after-delete-failure 経路の実機検証」は解消。設計判断記録 D-20/D-34
にも追記済み。

**この確認の限界**（D-20 の「実機確認結果」に記載した限界がそのまま
当てはまる）：検証したのは「Health Connect アプリ側で直接削除して
外部レコード不在を再現する」という1経路のみ。検証環境は上記の Pixel 3
1台1バージョンのみ。

**実機検証中に踏んだ、この端末固有の妨害要因**（アプリのバグではない）：
「Hide App Preview」が Android 12 では常時 ON 固定のため（上記 CLAUDE.md
の既知の制約）、アプリ画面表示中は `adb shell screencap` が常に失敗する
（`FLAG_SECURE` の副作用）。UI 確認は `uiautomator dump` のテキスト階層で
代替した——同じ制約を踏む場合はこの方法が有効。

#### 実機確認（Pixel 11、置換復元→同意画面→Sync→Settings 反映、2026-09-21）

Android 17（API 37、ビルド `CD1A.260905.001.B1`、セキュリティパッチ
2026-09-01、Google Play システムアップデート 2026-07-01、Health Connect
アプリ v2026.08.06.00.release）のプラットフォーム統合パス（Pixel 11）で、
§13.6 の主要ユースケース（置換復元→`offerResync`→Health Connect 再同期）を
一気通貫で確認した。

**手順**：Activity を1件記録（自動同期で HC にも反映）→ Settings > Data >
Export JSON でバックアップを作成→同じファイルを Import from a backup で
選択→「Replace all data」→安全バックアップ保存先フォルダを選択（新規
フォルダ作成が必要だった——ルートや `Download` 直下は「このフォルダは
使用できません」と拒否された。プライバシー保護のための SAF 制限と思われる）
→復元実行。

**結果**：
- 復元後、`offerResync` 画面（「Health Connect sync is on for this
  device, but Solo + Us doesn't automatically resend restored data.」）が
  設計通り表示された
- 「Sync to Health Connect」→「Health Connect sync has been queued.」→
  「Import complete」の Alert まで到達
- Settings > Health Connect で Last synced が実行直後の時刻に更新され、
  Unsynced changes が「Everything is synced.」に戻った
- Health Connect アプリ側の性行為エントリ一覧（今日）を確認したところ
  `occurredAt = 12:49` の Solo + Us エントリが1件だけ存在し、12:49 近傍の
  重複エントリは無かった——**これが recreateActivity（delete→insert）が
  二重レコードを作っていないことの直接的な証拠**。また「最近のアクセス」
  ログ（過去24時間）には Solo + Us からの書き込みが 12:49（記録時の
  自動同期）・12:57（再同期の finalize）の2件のみ記録されており、
  「新規作成→再同期での delete+insert」という今回の操作回数とも整合する
  （ただしこれは補強証拠にとどまる——delete+insert が1件のアクセスログ
  行として記録される、という点自体は未検証の仮定であり、ログの粒度に
  依存する。**非重複性の主たる根拠はエントリ一覧に重複が無いことの方**）。
- **同じ画面にもう1件、無関係と思われる孤立レコード（`occurredAt = 1:21`・
  Solo + Us）があったが、その由来は特定できていない——**当初「アクセス
  ログの過去24時間に 1:21 台の書き込みが無いことから、本日の再インストール
  （`firstInstallTime` 01:25:03）以前の無関係な残留データと確認した」と
  記録したが、これは誤った推論だった：エントリ一覧が表示するのは
  `occurredAt`（記録時刻）であり書き込み（アクセスログ）時刻ではないため、
  両者を突き合わせても由来は判定できない。それどころか、`occurredAt` と
  書き込み時刻が近いと仮定すると `firstInstallTime` とほぼ同時刻の書き込みが
  24時間ログに現れないという矛盾が生じ、「アクセスログが網羅的でない」か
  「occurredAt と書き込み時刻は無関係」のどちらかを示しているに過ぎない。
  **このレコードの起源は未確認のまま**とする——ただし上記の通り、今回の
  テストの非重複性の結論はこの孤立レコードの解釈に依存しないため、
  別途調査するまで Known gaps として残す（下記参照）

これにより、Known gaps に残っていた「置換復元→同意画面→Sync のフロー
確認」も解消。Phase 4 の実機確認タスクは完了。

**実機検証中に踏んだ NOTE**：置換復元前の安全バックアップ保存先は
Android の SAF がルート直下や標準ディレクトリ（`Download` 等）直下への
`ACTION_OPEN_DOCUMENT_TREE` 許可を拒否する場合がある。実機確認時は
「新規フォルダを作成」で専用サブフォルダを切ってから選択すると確実。

#### Known gaps

- **Health Connect のレート制限は未調査（D-41）**：`queueResync` は
  積んだジョブすべてを即 due（`not_before` = 実行時刻）にするため、
  数百〜数千件の recreate が SyncWorker の claim/finalize ループで
  連続して Health Connect に送られる。1件ずつ順次処理するため一度に
  大量呼び出しが飛ぶわけではないが、連続呼び出しに対するレート制限の
  有無・挙動は未確認
- **Unsynced changes 一覧は全件描画（2巡目のレビュー指摘、未対応）**：
  N+1 は解消したが、`jobs.map` による `ScrollView` 全件描画自体は変えて
  いない。`queueResync`/「Sync everything」により、復元直後やHCを初めて
  ONにした直後はジョブが Activity 全件（数百〜数千件）になりうるため、
  件数上限付き表示（「ほか N 件」）や仮想化リストへの変更が引き続き
  検討課題として残る。**3巡目のレビューで指摘された通り、`sync_state
  = 'synced'` も再送対象にしたため（上記1の修正）、「Sync everything」を
  押した直後は既に同期済みだった Activity まで一時的に Unsynced changes
  に並ぶ**——drain されるまでの一過性で仕様違反ではないが、この Known
  gap が顕在化しやすくなる方向の変更である
- **Pixel 11 の Health Connect に起源未確認の孤立レコードが1件ある**
  （上記「実機確認（Pixel 11、置換復元→同意画面→Sync→Settings 反映）」
  参照、`occurredAt = 1:21`・Solo + Us）。今回のテストの非重複性の結論は
  この孤立レコードの解釈に依存しない形に整理し直した（影響が無いことを
  積極的に検証したわけではない）が、由来自体は未調査のまま。再調査する場合は
  Health Connect アプリの「アクセス」タブ（レコード単位の権限アクセス
  履歴、今回は「最近のアクセス」というアプリ単位のログしか見ていない）
  も合わせて確認すること
- **置換復元の安全バックアップ保存先で SAF がルート/標準ディレクトリ直下を
  拒否する場合、原因がユーザーに伝わらない**：`app/settings/data.tsx` の
  文言は "you'll be asked to choose a folder" とだけ述べ、フォルダ選択が
  拒否された場合のヒントが無い。拒否は OS のピッカー内で起きるため
  ユーザーはキャンセルするしかなく、結果としてアプリ側には
  [services/SafetyExportService.ts](services/SafetyExportService.ts) の
  "Choose a save location to continue" が出るだけで原因不明に見える
  （実機確認時は「新規フォルダを作成」で回避——上記手順参照）。v1 必須では
  ないが、UI 文言の改善課題として残す
