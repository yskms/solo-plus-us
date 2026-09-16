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

`phase1/foundation` ブランチ。117 件のテストが通り、`tsc --noEmit` はエラーなし。

### ビルド構成

- Expo Router（`tabs` テンプレート）+ TypeScript
- `@op-engineering/op-sqlite`（`package.json` の `"op-sqlite": {"sqlcipher": true}` で SQLCipher 有効化。
  `pod install` で `OpenSSL-Universal` が解決されることを確認済み — SQLCipher 配線は実機ビルド一歩手前まで検証済み）
- Android は `plugins/withAndroidNoBackup.js`（自作 config plugin）で `allowBackup="false"` /
  `fullBackupContent="false"` を注入。`expo prebuild --platform android` で生成される
  AndroidManifest.xml に反映されることを確認済み（D-07 の Android 側）
- `expo prebuild`（iOS / Android とも）・`pod install` は実行・成功済み。`[OP-SQLITE] using SQLCipher`
  → `OpenSSL-Universal` 解決までログで確認しており、SQLCipher の配線は実機ビルド一歩手前まで検証済み
- **iOS シミュレータでの起動は未検証**：`expo run:ios` を試したが、このマシンの Xcode 16.2 が既定で
  要求する iOS 18.2 プラットフォームが未インストールで、インストール済みの Simulator ランタイム
  （iOS 17.0 / 17.2）が `xcodebuild -showdestinations` に一切出てこない状態だった
  （`xcodebuild: error: ... iOS 18.2 is not installed`）。Simulator.app を明示的に起動しても解消せず。
  **Xcode > Settings > Platforms から iOS 18.2 Simulator をインストールすれば解消する見込み**（未実施 —
  数 GB のダウンロードを伴うため無断では実行していない）。Android 側の実機 / エミュレータ起動も未実施

### 実装済み

| 層 | 内容 |
|---|---|
| `database/` | `schema.ts`（v1 DDL）、`key.ts`（SecureStore 鍵管理、D-06）、`connection.ts`（PRAGMA・§7.2 バックアップ付き migration 起動）、`migrations/`（runner + 初期 migration） |
| `repositories/` | `ActivityRepository` / `HealthSyncRepository` / `HealthSyncJobRepository`。§9.5 の claim/finalize、§10.1 の削除分岐を含む |
| `services/` | `syncJobPlanner`（§9.3/§10.1 を純粋関数化）、`ActivityService`（record/update/delete/undo の transaction 統括）、`SettingsRepository`、`ExportService` / `ImportService`（JSON schema v1、strict restore） |
| `lib/` | `datetime.ts`（UTC 固定長表記、DST を考慮した offset 解決）、`id.ts`（UUID v4）、`relativeDate.ts` |
| UI | Onboarding（Privacy Intro）、Today（月次集計・直近履歴・FAB）、Add Activity（Solo/Partnered 即記録）、Undo Snackbar（D-15 の2段タイマー）、Activity Detail（編集・削除） |

### テスト

`better-sqlite3` を devDependency として使い、**実際の SQLite に対して**スキーマの CHECK/FK 制約、
`ActivityService` の同期ジョブ分岐（§9.3/§10.1 の全パターン）、Export → Import の全件往復
（基本設計 §13.5 の完成条件そのもの）を検証している（`test/support/sqliteTestDb.ts`）。
SQLCipher 固有の挙動そのものは対象外（別の SQLite バインディングのため）。

```
lib/__tests__/               datetime, relativeDate
services/__tests__/          syncJobPlanner, importValidation
database/migrations/__tests__/ runner のシーケンス・バックアップ呼び出し
test/__tests__/              schema・ActivityService・Export/Import（better-sqlite3 統合）
```

### Known gaps（意図的に未実装）

- **iOS のバックアップ除外**（D-07 の後半）：Android の `allowBackup=false` は実装済みだが、iOS の
  `NSURLIsExcludedFromBackupKey` は expo-file-system の API に無く、小さなネイティブモジュールが要る。
  未実装（DB は現状 Documents 配下に置かれ、iOS 側は iCloud/iTunes バックアップに含まれる）
- **日時編集 UI**：過去日時への記録・編集（§12/§4.4）は未実装。ネイティブの日時ピッカーを追加する前に
  まず SQLCipher 配線を実機で確認したかったため、意図的に後回し
- **Settings 画面一式**：Activity Details カスタマイズ、App Lock、Health Connect、Data(Export/Import UI)
  はいずれも Phase 3。`ExportService`/`ImportService` は実装・テスト済みだが、呼び出す UI がまだ無い
- **Calendar / Insights**：プレースホルダーのみ（Phase 2/3）
- **Health Connect 同期の実行部分**：`HealthConnectService` / `SyncWorker` は未実装（Phase 4）。
  ジョブのキューイング自体（`ActivityService` → `health_sync_jobs`）は実装・テスト済みで、
  `healthConnect.enabled` が既定 `false` のため実際には空のまま動く
- **App Lock / Recovery 画面**：DB を開けなかった場合、`DatabaseContext` は素朴なエラー画面を
  出すのみ。§8.8 の Recovery bootstrap（別鍵での一時 DB 作成・検証・差し替え）は未実装
- **実機 / シミュレータでの起動確認**：`pod install` の成功までは確認済み。`expo run:ios` /
  `expo run:android` によるビルド・起動、Android 側の Gradle ビルド（SQLCipher 分岐の実行）は未実施
