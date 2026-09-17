# Solo + Us

> Your intimate life, over time.

Solo / Partnered な性的活動を長期間記録し、自分自身の変化を振り返るための Private Wellness アプリ。

評価しない・急かさない・端末内に留める。NoFap アプリでも Sex Diary でもなく、
**Personal Health Data の一種として淡々と記録し続けられること**を中心価値とする。

## ステータス

設計文書は **v0.11** で確定済み。実装は **Phase 1**（`phase1/foundation` ブランチ）着手中。
現状は「暗号化 DB → Migration runner → スキーマ → Repository → Quick Record → Undo → 履歴 →
Export/Import の往復」まで実装・テスト済み。詳細は下記「Phase 1 実装状況」を参照。

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

`phase1/foundation` ブランチ。134 件のテストが通り、`tsc --noEmit` はエラーなし。

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

### Known gaps（意図的に未実装）

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
- **Calendar / Insights**：プレースホルダーのみ（Phase 2/3）
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
