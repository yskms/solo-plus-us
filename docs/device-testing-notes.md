# 実機テストの落とし穴（DB スキーマ変更後の migration とアンインストール・LogBox バナー）

- 読むタイミング: DB スキーマ（`database/schema.ts`・`database/migrations/`）を変えた回のブランチ/コミットを実機やエミュレータでテストするとき、`adb uninstall` を実行しようとしているとき、adb での実機 UI 操作でタップが無反応に見えるとき
- 元の場所: `CLAUDE.md` の「schema.ts を変更した後の実機テストは、既存アプリを一度アンインストールすること」「adb での実機 UI 操作時、LogBox の警告バナーがタップを奪うことがある」の2節（2026-11-03 に移動）。LogBox の節は原文のまま。ただし、各節が兄弟の節になるよう、見出しの `#` の数だけそろえた
- 注記（2026-11-04 の書き換え）: Android 版は公開済み（ユーザー確認。提出・公開の記録は `docs/store-listing.md` の v1.0.1 のリリースノート）。そのため D-11 が効いており、旧節の「アンインストールしてから入れ直す」は現在の運用では誤誘導になる。CLAUDE.md の節の見出しを「DBスキーマ変更後の実機テストはmigrationを確認する（アンインストールに注意）」に変え、この文書の最初の節にその詳細を書いた。旧節は公開前の記録として、見出しに【公開前の記録・現在は無効】を付けて残している。README の3箇所の参照も新しい見出しに合わせた（README のそれ以外の記述は、公開前の時点の記録として直していない）

---

## DBスキーマ変更後の実機テストはmigrationを確認する（アンインストールに注意）

CLAUDE.md の同名の節の詳細。各項目は 2026-11-04 に D-11 の原文と実装を照合した結果。

### D-11 の制約（正確な内容）

原文は `docs/Solo + Us_設計判断記録 v0.11.md` の D-11（「その他の Migration ルール」）と `docs/Solo + Us_基本設計 v0.11.md` §7.1・§7.2。「ALTER TABLE のみ」は略した言い方で、実際は次のとおり。

- `PRAGMA user_version` で管理し、前方向のみ。ダウングレードは実装しない（新しすぎる DB は `SchemaTooNewError` で開かない）
- 破壊的変更の禁止。**列追加は `ALTER TABLE ADD COLUMN` のみ。改名・型変更は、新テーブル作成 → コピー → 差し替えを migration のトランザクション内で行う。** CHECK は列制約なので、値を増やすときもテーブルの再構築になる（基本設計 §9.3.1 の `operation` の CHECK の注記）
- `user_version` は migration runner が成功後に更新する。SQL に固定値を書かない
- 既存データのある DB に migration をかける前に、`VACUUM INTO` でバックアップを取り、失敗したら復元して起動を続ける（`database/connection.ts`）

### migration の足し方

- `database/migrations/` に `NNN_*.ts` を作り、`database/connection.ts` の `MIGRATIONS`（2026-11-04 時点は `[migration001Initial]` のみ）に登録する
- `SCHEMA_V1_STATEMENTS`（`database/schema.ts`）を使うのは migration 001 だけで、新規インストールの初回にしか走らない。ここを直接編集した列は、既存ユーザーの DB には入らない
- `database/schema.ts` 冒頭の D-51 の注記（「未リリースの v1 スキーマへの直接編集」）は、公開前の例外の記録で、今は効かない
- runner の振る舞いは `database/migrations/__tests__/index.test.ts` がテストしている

### 実機でのアップグレード確認

1. 旧コミットの開発ビルドを入れ、データを作る
2. 新コミットのビルドを、アンインストールせず `adb install -r` で上に入れる
3. 起動して migration が走ること、データが残ることを確認する

署名の注意: ローカルの開発ビルド・`assembleRelease` は `android/app/debug.keystore` で署名される（`android/app/build.gradle`）。Play 版は Play の署名なので、署名が違い、Play 版の上に `-r` では入らない（一般的な Android の挙動。このプロジェクトでは実測していない）。入れるにはアンインストールが必要で、その端末の記録は消える。

### アンインストールが必要なケース

- 開発中の migration を書き換えたとき（端末は書き換え前の migration を適用済みで、`user_version` が進んでいる）
- migration を含むブランチから、含まないブランチへ切り替えたとき（`user_version` が新しすぎて `SchemaTooNewError` になり、DB を開けない）
- 新規インストール経路（`SCHEMA_V1_STATEMENTS` と migration 001）の確認
- 直接編集していた古いブランチで、`no column named …` が出たとき（公開前の運用の名残）

### `adb uninstall` の影響

- アプリのデータが全部消える。**Android では、DB の暗号鍵（expo-secure-store、`database/key.ts`）もアプリのデータと一緒に消える**
- OS バックアップは無効（`plugins/withAndroidNoBackup.js`、D-07）なので、再インストールしても戻らない
- 開発ビルドと Play 版は同じ applicationId（`com.yskms.soloplusus`、`app.json`・`android/app/build.gradle`）で、サフィックスで分けていない。Play 版を実使用している端末でアンインストールすると、実際の記録を失う
- テスト用の端末は、残したい記録の無い端末にする。実使用の端末では、やむを得ないとき以外は実行しない

### Export（JSON）で復元できる範囲

アンインストール前のバックアップにアプリの Export を使うときの範囲。根拠は `services/ExportService.ts`、`types/Settings.ts` の `EXPORTABLE_SETTING_KEYS`、基本設計 §12.1・§12.2・§12.2.1・§12.4、設計判断記録 D-10 の「置換復元の既知の制限」。

- **戻るもの:** すべての Activity（id、context、日時とタイムゾーン、orgasm・ejaculation・protectionUsed・durationSeconds・moodBefore・moodAfter・note、syncVersion、createdAt・updatedAt）と、設定のうち `activityDetails.*`（記録項目の表示と既定値）、`preferences.*`（週の開始曜日、時刻形式、外観、言語）
- **戻らないもの:** App Lock の設定（`appLock.*`）、スクリーンショットのブロック（`privacy.blockScreenshots`）、Health Connect の設定と状態（`healthConnect.*`）、同期の対応関係（`health_sync`・`health_sync_jobs`）。復元後に再設定が必要で、Health Connect 側に書き込み済みのレコードとの対応関係も戻らない
- **CSV は復元に使えない**（分析用の一方向、基本設計 §12.1）。バックアップは JSON を使う
- JSON は暗号化されない（平文）。保存先の扱いに注意する
- 通常の Export は共有シート経由で、保存の成否と保存先が返らない（基本設計 §12.4）。アンインストールの前に、保存先（ファイルアプリ・クラウド等）でファイルが実際に存在することを確認する
- 復元は、再インストール後に Settings › Export & Import › Import from a backup から行う。現行より新しい version のファイルは拒否される（基本設計 §13.1）
- 検証の範囲: 置換復元は実機で動かした記録がある（README の「Import（置き換え復元）後に外観が更新されない問題」）。**アンインストール → 再インストール → Import の通しは、今回は実機で確認していない**

---

## 【公開前の記録・現在は無効】schema.ts を変更した後の実機テストは、既存アプリを一度アンインストールすること

以下は、Android 版の公開前の運用の記録で、そのまま残している。現在の運用は、この文書の最初の節に従う。この記録の経緯（D-51 の列追加で `no column named sync_state` を踏んだ件）は、公開前の直接編集という運用に固有のもの。

v1 は未リリースのため D-11「ALTER TABLE のみ」はまだ適用されず、
`database/schema.ts` を直接編集する方針（README 各所に記載）。これは
「新規インストール前提」の設計であり、**過去に一度でもインストールした
実機/エミュレータの DB ファイルは、`schema.ts` に後から追加された列を
自動では持たない**（`adb install -r` はアプリデータを保持したまま
アップグレードするため、DB ファイルは古いスキーマのまま残る）。

実際に、D-51（`health_sync.sync_state` 列追加）より前からテストに使って
いた Pixel 11 に最新ビルドを `-r` で上書きインストールしたところ、
`table health_sync has no column named sync_state` という SQLite
エラーが `SyncWorker` の finalize で発生し続けた（Settings 画面の
接続ステータスが不安定に見えるなど、無関係に見える副作用も伴った——
Health Connect Settings UI 実装時に実際に踏んだ）。

**`schema.ts` を変更した回のブランチ/コミットを実機でテストする際は、
`adb uninstall <applicationId>` してから `adb install` し直すこと。**
`-r`（保持アップグレード）で踏むと、コードのバグと勘違いして無駄に
調査することになる。

## adb での実機 UI 操作時、LogBox の警告バナーがタップを奪うことがある

開発ビルドで LogBox の警告バナー（「Open debugger to view warnings」等）が画面下部に
出ている間、`adb shell input tap` でその帯と重なる位置（Save ボタン等）をタップしても
**ネイティブの overlay に吸われて何も起こらない**——ログも出ず、画面遷移もしない。
一見「保存処理がサイレントに失敗している」ように見えるため、これを実際のアプリの
不具合と誤診しかけたことがある（Activity Detail の DATE & TIME 編集、2026-09-21）。
adb でのタップが理由なく無反応に見えたら、まず `uiautomator dump` でバナーの有無を
確認し、バナーの「X」を閉じてから再現し直すこと。
