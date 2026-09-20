# Solo + Us — 設計判断記録 v0.11

作成日：2026-09-16  
対象：要件定義書 v0.11 / 基本設計 v0.11 / UI/UX Specification v0.11

改訂履歴：
- v0.2 で D-01〜D-17 を確定
- v0.3 で D-18〜D-31 を追加し、D-01 / D-04 / D-10 を改訂
- v0.4 で D-32〜D-38 を追加し、D-18 / D-19 / D-20 を改訂
- v0.5 で D-39 / D-40 を追加し、D-19 / D-32 / D-34 / D-37 を改訂
- v0.6 で D-41〜D-43 を追加し、D-37 / D-39 を改訂
- v0.7 で D-44 を追加し、D-41 / D-43 を改訂
- v0.8 で D-45 を追加し、D-21 / D-44 を改訂
- v0.9 で D-46 を追加し、D-21 / D-45 を改訂
- v0.10 で D-21 / D-43 から判定表の複製を削除し、正本参照に統一
- v0.11 で D-21 から残っていた要約条件を削除（正本参照のみにする）
- v0.12 で D-48 を追加（多言語対応をロードマップ外とするスコープ確定）
- v0.13 で D-49 を追加（「日の切り替え時刻」設定を実装する場合の設計方針。着手時期は未定）
- v0.14 で D-50 を追加（記録済み Activity の日時事後編集をスコープに含める。D-48 と
  同様の経緯で、以前の README 記載のスコープ判断を上書き）

---

## この文書の役割

v0.1 に対する2回のレビューで確定した設計判断を、**決定・理由・却下した案**の形で記録する。
実装中に「なぜこうなっているか」を再議論しないための参照元とする。

**文書間で矛盾がある場合、この文書 > 各設計文書の本文 > 図版 の順で優先する。**
`docs/old/` は検討履歴であり仕様ではない。

---

## D-01 Activity の分類軸を `context`（`solo` / `partnered`）とする

> **v0.3 改訂：** 列名・型名を `type` から `context` に改めた。**値は変更していない。**

**決定**

内部値・DB 値・Export 値を `'solo' | 'partnered'` とする。表示ラベルは i18n キー経由で別管理する。
定義は「行為の種類」ではなく **「相手の有無」** とする。
名前もその定義に合わせ、`ActivityType` / `type` ではなく **`ActivityContext` / `context`** とする。

```text
solo      : 自分ひとりの性的活動
partnered : 相手のいる性的活動（行為の内容は問わない）
```

**理由**

`sex` / `masturbation` は行為名に縛られるため、挿入を伴わない行為や将来の類型追加で意味が壊れる。
「相手の有無」で定義すれば、行為の内容が何であっても分類が破綻しない。

**却下した案**

- `'masturbation' | 'partnered_sexual_activity'` — 非対称で、片方だけが行為名に縛られる
- UI だけ婉曲表現にして DB は `sex` のまま — Export 値が公開契約になるため、後から変えられない

**付随する決定**

Export の `context` 値は **v1 の公開契約として固定**し、以後改名しない。

**改名のタイミング（v0.3）**

D-11 で「列の改名は新テーブル作成＋コピー」と決めているため、リリース後の改名は有料の変更になる。
まだ実装していない時点なら無料であり、**やるなら今しかない**という理由で v0.3 で実施した。

副作用として Export の JSON キーが `type` → `context` に変わる。未リリースのため破壊はしないが、
公開契約の変更なので黙って行わずここに記録する。

---

## D-02 日時は UTC 正本 + ローカル非正規化列 + 分単位固定

**決定**

| 列 | 役割 |
|---|---|
| `occurred_at_utc` | 瞬間の正本。`YYYY-MM-DDTHH:MM:SSZ` 固定長、**秒は常に `00`** |
| `occurred_local_date` | 集計・カレンダー用（`YYYY-MM-DD`） |
| `occurred_local_time` | 曜日・時間帯集計用（`HH:MM`） |
| `timezone_offset_minutes` | 記録時点のオフセット |
| `timezone_id` | IANA タイムゾーン（nullable） |

- v1 の入力・表示精度は**分単位**。秒は UTC 側でも `00` に正規化する
- すべての日時列を固定長 UTC 表記に統一し、**文字列比較が時系列比較として成立する**ことを不変条件とする
- `timezone_id IS NULL` は「オフセットのみ判明（外部 Import 由来など）」を意味する
- 「その日」の境界は**現地 00:00**

**理由**

UTC 単独ではローカル日付の集計に毎回オフセット計算が必要で、インデックスも効かない。
ローカル単独では夏時間・端末間移動で瞬間が復元できない。両方を持ち、`local = utc + offset` で常に検証可能にする。

秒を UTC 側だけ保持すると local 列との精度が食い違い、どちらが正本か曖昧になるため、分単位に統一する。

**実装ルール**

過去日時を記録・編集する場合、保存するオフセットは**現在の端末オフセットではなく、`timezone_id` におけるその瞬間のオフセット**を計算して入れる。ここを誤ると夏時間を跨ぐ過去記録がずれる。

**v1 の既知の制限**

タイムゾーン選択 UI を持たないため、旅行先での出来事を帰国後に入力すると現在地のタイムゾーンが適用される。

---

## D-03 同期状態と同期ジョブを2テーブルに分離する

**決定**

- `health_sync` — 現在の対応関係のみ。`PRIMARY KEY (activity_id, provider)`、`FOREIGN KEY ... ON DELETE RESTRICT`
- `health_sync_jobs` — 未処理ジョブの outbox。**FK を持たない**。`activity_id` は `NOT NULL`、`UNIQUE (activity_id, provider)`

削除は単一トランザクションで「delete job を作成 → `health_sync` 行を削除 → `activities` 行を削除」の順に行う。

**理由**

v0.1 の `ON DELETE CASCADE` は、Activity 削除時に外部レコード削除に必要な情報を同時に失う。
一方、FK を完全に外して1テーブルに統合すると「Activity が存在しないのに `pending_op='create'`」のような不整合が表現可能になる。

役割を分ければ、`health_sync` は常に「生きている Activity の対応関係」だけを保ち、
`health_sync_jobs` は「Activity の生死と無関係な作業指示」だけを保つ。

**却下した案**

- 1テーブル + 相互条件 CHECK — 表現可能な不正状態を制約で塞ぐより、そもそも表現できない構造にする方が堅い
- `activities` の soft delete — 統計・カレンダーの全クエリに `deleted_at IS NULL` が必要になる

**付随する決定**

- **ジョブはペイロードを持たない**。ワーカーは送信時に `activities` を読む。これにより `create → update` の合流が自明になり、stale payload 問題が発生しない
- delete job のみ、Activity が存在しないため必要な識別子を自身で保持する
- `UNIQUE (activity_id, provider)` により、ジョブ合流規則の実装が必須になる（→ 基本設計 §同期ジョブの合流規則）

---

## D-04 Health Connect への書き込みは clientRecordId で冪等化する

**決定**

Health Connect の `Metadata.clientRecordId` に `activity.id` を設定する。削除も `clientRecordId` で引く。

**実装前の確認事項**

使用するラッパー（`react-native-health-connect` 等）が `clientRecordId` と
`deleteRecords` の client record id 指定を露出しているかを確認する。
**露出していない場合、HC 同期の v1.0 投入を見送る。**

> **確認結果（2026-09-19、ソース読解による）：`react-native-health-connect` v4.1.3
> （commit `8d72b6a`）で確認済み。**
> `Metadata.clientRecordId` / `clientRecordVersion` を型・ネイティブ実装の両方で往復できる。
> 削除も `deleteRecordsByUuids(recordType, recordIdsList, clientRecordIdsList)` として
> client record id を直接渡せる。この2点は OS バージョンに依存しない。詳細・調査対象
> バージョンの全リストは基本設計 §9.4 の確認結果を参照。**ラッパー導入時に上記バージョンから
> 変わっていないか再確認すること。**

**理由**

外部への書き込みに成功した直後・ローカルに外部 ID を保存する前にプロセスが落ちると、
再試行で二重登録が発生する。clientRecordId があれば create が upsert 相当になり、この窓自体が消える。

`external_record_id` 列は HealthKit と診断用に残すが、**HC の主たるアドレッシングは clientRecordId** とする。
provider ごとの意味の違いは基本設計 §5.4 に記載する。

> **v0.3 改訂：** `clientRecordVersion` の管理を D-19 に分離した。ゲートに削除エラーの識別可否を追加した（D-20）。

**v1 の既知の制限**

Health Connect 側でユーザーが手動削除しても、v1 は HC を読まないため検知できない。

---

## D-05 SQLite を暗号化する（MVP 要件）

**決定**

SQLCipher を採用する。ドライバは `@op-engineering/op-sqlite`（`expo-sqlite` は暗号化を持たない）。
Expo Go では動作しないため、**Phase 1 の時点から prebuild / dev client 前提**とする。

**理由**

「Privacy First」を掲げてローカル保存するなら、平文 DB はファイル抽出・バックアップ経由で内容が読める。
これは後付け機能ではなくドライバ選定の問題であり、Phase 1 の1行目に影響する。

**脅威モデル（明記する）**

| 対象 | 防ぐ | 防がない |
|---|---|---|
| 端末の物理取得・ファイル抽出 | ● | |
| OS バックアップ経由の流出 | ● | |
| root / jailbreak 済み端末 | | ● |
| 端末内で動作するマルウェア | | ● |
| アプリのロック解除後の画面覗き見 | | ●（App Lock の領域） |

---

## D-06 DB 暗号鍵と生体認証を分離する

**決定**

- DB 暗号鍵：初回起動時に32バイト乱数を生成し `expo-secure-store` に保存する。
  **`requireAuthentication: true` を使わない**
- App Lock：`expo-local-authentication` で別途解除する
- 両者の状態を結合しない

**理由**

SecureStore の認証付き保存は、生体情報の追加・変更で保存値が読めなくなる場合がある。
DB 暗号鍵がこれに該当すると、**正当な利用者でも DB を永久に復号できなくなる**。
App Lock は「画面を出すか」の判断であり、データの可読性と結び付けてはならない。

**プラットフォーム差（前提にしない）**

iOS の Keychain 値は同一 Bundle ID の再インストール後も残る場合があるが、Android では
アンインストールで失われる。両者が同じ挙動をすると仮定した設計にしない。

**必要な画面（新規）**

「DB は存在するが鍵が復元できない」状態が現実に起こりうる。クラッシュループに入らず、
**復号不能であることを明示し、Import からの復元または初期化を選ばせる画面**を用意する。

---

## D-07 DB を OS バックアップから除外する

**決定**

Android は `allowBackup=false`、iOS は DB ファイルに `isExcludedFromBackup` を設定する。

**理由**

端末外に出ない鍵を採用するため、バックアップから復元すると**復号不能な DB だけが戻る**。
これを避けるための除外であり、「暗号化するから論理的に必然」ではなく、
復元不能状態の発生を防ぐという目的による選択である。

**検証対象は2つ**

1. SecureStore 内の鍵がバックアップされないこと
2. SQLCipher DB 本体もバックアップ／端末転送の対象外であること

（SecureStore は Android 側で自動除外されるが、アプリ DB 全体の除外はこれとは別問題）

**帰結**

端末紛失＝全データ喪失となるため、**Export / Import が唯一の復旧手段**になる。
この時点で D-09 / D-10 / D-13（Export の v1.0 必須化・無料化）が自動的に決まる。

---

## D-08 独自 PIN を実装せず OS のデバイス認証に委譲する

**決定**

App Lock は `expo-local-authentication` による生体認証と、**OS のデバイス認証フォールバック**のみとする。
アプリ独自の PIN を持たない。UI 文言は「Device PIN」ではなく **「端末の認証 / Device authentication」** とする。

**理由**

独自 PIN を持つと「PIN 忘れ時の復旧」の設計が必要になる。復旧手段を用意すればロックは形骸化し、
用意しなければ利用者は自分のデータに二度と触れられない。OS に委譲すればこの問題自体が消える。

**受け入れテスト**

生体認証を無効にしている利用者でも、端末パスコード等で解除できることを実機で確認する。

**追記（App Lock 実装時のレビューで発見）**

上記の理由「OS に委譲すればこの問題自体が消える」には、想定していなかった抜けがあった。
OS への委譲は「PIN を忘れる」という失敗モードは消すが、**「端末自体に認証手段が一つも
設定されていない」**という別の失敗モードは消さない。App Lock を ON にした後で端末の
パスコード・生体認証を**すべて外す**と、`authenticateAsync` は常に失敗し、アプリ独自の
PIN もバイパスも無い設計のため、二度とロックを解除できなくなる。唯一の脱出手段はアプリの
削除だが、DB は OS バックアップの対象外（§8.6）なので削除は全データ喪失と同義になる。

**対応**：ロック画面表示時・認証失敗時に `getEnrolledLevelAsync()` で端末の認証状態を
確認し、`SecurityLevel.NONE`（何も設定されていない）であれば **App Lock を自動的に OFF
にしてロックを解除**する（`contexts/AppLock.tsx` の `disableAppLockDueToNoEnrollment`）。
端末自体に認証手段が無い以上、アプリだけをロックしても守れるものはない、という判断。

---

## D-09 JSON を復元の正本、CSV を一方向エクスポートとする

**決定**

```text
JSON : バックアップ／復元の正本（全列・可逆・schema version 付き）
CSV  : 分析用の一方向エクスポート（Import 対象外と明記）
```

**理由**

CSV を復元経路に含めると、タイムゾーン列や `created_at` の表現・解釈を CSV 側でも定義する必要が生じ、
仕様面積が倍になる。CSV は人間と表計算が読むものと割り切る。

---

## D-10 JSON Import は strict restore のみとする

**決定**

- **`id` 必須**。ID を持たない JSON は不正データとして拒否する
- **キーの欠落は不正。未記録は `null`**（D-23）
- **`(type, occurred_at_utc)` による自動重複排除を行わない**
- **1件でも不正なら確定しない**（行単位スキップをしない）
- 全件検証 → プレビュー（件数表示）→ 単一トランザクションで確定
- `version <= 現行` のみ受理。未来バージョンは明示的に拒否
- モードは2つ。**置換復元（既定）** と **追加のみ**
- 置換復元の実行前に、現在のデータを自動でセーフティ Export する
- Import 後の Health Connect 再同期は**既定 OFF**（明示同意制）

**理由**

- 同時刻に2件記録される・重複自体が意図的である場合があり、推測による重複排除は正当なデータを失う
- バックアップ復元で「3件だけ欠落」は、理由を表示しても危険。完全性が要求される場面では全体を失敗させる方が安全
- `updated_at` はローカル端末時計に依存するため、端末間の last-writer-wins は信頼できない。
  また、別端末の古いバックアップから削除済みデータが復活する

**却下した案**

- `updated_at` による自動マージ — 双方向同期に近づくと削除 tombstone と端末識別が必要になり、仕様が急激に大きくなる
- 行単位スキップ（tolerant import）— 将来の他アプリ Import 用に専用 Importer を作る際に検討する

**置換復元の既知の制限**

置換復元すると `health_sync` の対応関係は破棄され、Health Connect 上の既存レコードは残る。実行前に警告する。

---

## D-11 Migration バックアップは WAL を考慮した方式にする

**決定**

`journal_mode=WAL` のため、**DB 本体の単純なファイルコピーをバックアップとしない**。
チェックポイント後の整合した状態を取得するか、SQLite の Online Backup 相当（`VACUUM INTO` 等）を使う。

- バックアップ先はアプリ専有領域。**OS バックアップ除外対象に含める**
- バックアップファイル自体も SQLCipher で暗号化されたセンシティブデータとして扱う
- Migration 成功後に削除、失敗時は復元して起動を継続する

**その他の Migration ルール**

- `PRAGMA user_version` で管理。**初期スキーマ SQL に固定値を混ぜず、Migration runner が成功後に更新する**
- 前方向のみ。ダウングレードは実装しない（アプリのバージョンダウン時は DB を開かずエラー表示）
- 破壊的変更の禁止。列追加は `ALTER TABLE ADD COLUMN` のみ。改名・型変更は新テーブル作成＋コピー＋差し替えをトランザクション内で行う

---

## D-12 Health Connect 無効版は Manifest から権限を除外する

**決定**

feature flag では審査要件を回避できない。**ビルドプロファイルを2つ用意し、Manifest 自体を切り替える。**

```text
without-health-connect : health 権限を Manifest に含めないリリースビルド
with-health-connect    : 権限とネイティブモジュールを含むビルド
```

Expo の build profile / app config / config plugin で権限の有無を切り替える。

**理由**

アプリ内で機能を OFF にしても、配布 AAB の Manifest に `WRITE_SEXUAL_ACTIVITY` が含まれていれば、
Health Connect のデータ型宣言（Health apps declaration）と Play Console でのデータ型説明が必要になる。
`SexualActivityRecord` は Reproductive and Sexual Health に属し、データ型ごとの説明を求められる。

**リリース判断のゲート**

コードフリーズ時点で宣言が承認されていれば `with-health-connect` で v1.0 を出す。
承認が間に合わなければ `without-health-connect` で v1.0 を出し、承認後に v1.0.x で有効化する。

---

## D-13 MVP 範囲を1つの表に統一し、Export を無料とする

**決定**

→ 要件定義書 v0.11 §MVP 範囲の表を唯一の基準とする。

- App Lock：**v1.0 必須**
- Export / Import：**v1.0 必須・無料**
- Health Connect：**v1.0 系で提供**（D-12 のゲートに従う）
- Insights タブ：v1.0 では合計／内訳／平均間隔（全期間）まで。期間セレクタ（Month/Year
  トグル）・月次棒グラフ・曜日・時間帯は v1.1
  （Phase 3 実装時に修正——当初「All Time も v1.1」としていたが、v1.0 の「合計／内訳／
  平均間隔」がそもそも全期間集計である以上、All Time 自体は v1.0 に含まれる。v1.1 なのは
  Month/Year の期間セレクタと、それに伴う年次表示・月次棒グラフ・曜日/時間帯統計。
  要件定義書 §25 の該当行もあわせて修正済み）

**理由**

D-07 によりバックアップが唯一の復旧手段になるため、Export を課金対象にすると製品として成立しない。
また「データはあなたのもの」というコアメッセージと正面から衝突する。

Pro は長期 Analytics・Health 相関・カスタム項目に限定する。

---

## D-14 統計の計算方法を確定する

| 項目 | 定義 |
|---|---|
| 平均間隔 | `(最新 − 最古) ÷ (件数 − 1)`。期間端の空白は含めない。2件未満は「—」 |
| 同日複数 | 別件として数える（記録された事実を丸めない） |
| Solo / Partnered | 合算が既定。内訳は別セクション |
| 曜日・時間帯 | `occurred_local_*` 列で判定。後からタイムゾーンを変えても過去の曜日は動かない |
| 最頻曜日の最低件数 | 10件。同率首位が2つなら **併記**（`Sunday and Friday`）。3つ以上なら「—」 |
| 時間帯 | **1時間刻みの循環3時間ウィンドウを24通り評価し、最大の窓を採用**。同数なら開始時刻が早い方 |
| 「今月」 | ローカル暦月 |

**時間帯を循環ウィンドウにする理由**

固定3時間バケット（`21–24` / `0–3`）では `10 PM – 1 AM` のような日跨ぎの結果を原理的に出せない。

**同率首位を併記する理由**

「表示しない」は情報を失う。件数が十分あるうえでの同率は事実であり、事実は記述してよい（評価はしない）。

---

## D-15 Undo は同期遅延とスナックバー表示を分離する

**決定**

- **同期遅延は固定5秒**。`health_sync_jobs.not_before = 記録時刻 + 5秒` とし、ワーカーは `not_before` を過ぎたジョブのみ拾う
- **Undo 可能期間はスナックバー表示中**。画面遷移でスナックバーが消えたら Undo も終了するが、`not_before` は変更しない
- Undo 対象は直前の1件のみ。冪等に実装する
- 5秒以内に詳細画面で編集された場合、`create → update` の2ジョブにせず、**create のまま最終状態を送る**（D-03 の「ジョブはペイロードを持たない」により自動的にそうなる）

**理由**

タイマーで同期をキャンセルする方式は、アプリが即座に kill されると遅延が失われて同期されてしまう。
永続キューの時刻列で表現すれば、プロセスの生死と無関係に成立する。

---

## D-16 年齢レーティングを事前に固定しない

**決定**

仕様には具体的なレーティング値を書かない。

> 成人向けを想定して各ストアの質問票に正確に回答し、最終レーティングは質問票・審査結果に従う。
> 必要であれば開発者側でより高いレーティングを設定する。

**理由**

Apple は地域や回答内容に応じて複数段階のレーティングを割り当てる体系を採っており、
性的テーマの頻度・内容によって結果が変わる。事前に「17+」と固定すると、実態と食い違う可能性がある。

**あわせて明記する**

「露骨な表現を避ける」と「アプリの目的を説明しない」は別である。
ストア説明ではアプリが何をするものかを明確に記述する（審査説明と利用者への透明性の両方に必要）。

---

## D-17 文書の優先順位

```text
設計判断記録（本書） > 各設計文書の本文 > 図版
```

`docs/old/` は検討履歴であり仕様ではない。
確認表現は Snackbar が正であり、専用の「記録完了画面」は不採用。

---

## D-18 同期ワーカーに楽観的並行制御を入れる

**決定**

`health_sync_jobs` に `revision` と `claimed_at` を持たせ、ワーカーは次の手続きで動く。

1. 未 claim かつ実行時刻を過ぎたジョブを取得
2. `WHERE id = ? AND revision = ?` で claim（`claimed_at`、`attempts`、`revision` を同時更新）
3. 外部呼び出し（トランザクション外）
4. 確定は **D-32 の3分岐**に従う（v0.4 改訂。v0.3 の「0行なら何もしない」は誤り）

**`attempts` は失敗時ではなく claim 時に加算する。**

**理由**

外部 API 呼び出しは DB トランザクションに入れられないため、
「ワーカーがジョブを読む → ユーザーが編集・削除 → ワーカーが無条件にジョブを削除」という競合が起きる。
これは新しい delete ジョブを消し、ローカルに存在しない記録を外部に残す。

`attempts` を claim 時に加算すると `attempts > 0` が
「外部呼び出しを開始した ＝ 到達したかもしれない」の判定として使え、列を増やさずに D-21 の分岐が書ける。

**保証するもの**

「競合しない」ではなく **「外部が一時的に余分なレコードを持っても最終的に収束する」**。

**クラッシュ対応**

起動時にすべての `claimed_at` をクリアする。ワーカーはプロセス内単一なので、
起動時点で処理中のジョブは存在し得ない。`attempts` は claim 時に加算済みなので情報は失われない。

---

## D-19 `clientRecordVersion` を `activities.sync_version` で管理する

**決定**

`activities` に `sync_version INTEGER NOT NULL DEFAULT 1` を持ち、編集のたびに +1 する。
これを Health Connect の `clientRecordVersion` として送る。

| 場面 | 値 |
|---|---|
| 初回 create | `1` |
| 編集 | `+1`（`updated_at` と同じトランザクション内） |
| 同じジョブのリトライ | 変わらない（activity 行が変化しないため） |
| 新しい編集 | 必ず前より大きい |

**理由**

同じ `clientRecordId` で再 insert した場合、HC は `clientRecordVersion` が大きい方を優先する。
version を管理しないと、リトライや編集の順序によって古い内容が勝つ可能性がある。

**増加の対象（v0.4 追記）**

**どの項目を編集しても `+1` する。** HC へ送られない項目（note / mood など）の編集でも
version が増え、不要な HC update が発生するが、これは承知の上の選択である。
note や mood の編集頻度は低く、最適化の価値が分岐のコストに見合わない。
後から最小同期へ変更できる（スキーマ変更を伴わない）。

**却下した案**

- `updated_at` のエポック値を version にする — 端末時計のずれや巻き戻しで単調性が壊れる
- provider 別 version — **両プラットフォームが同じ単調増加セマンティクスを採るため、
  1本の `sync_version` が両方に使える**（D-40）。片方が使わないからではなく、同じ意味で使えるから共有する

---

## D-20 削除の「存在しない」を成功として扱い、READ 権限は追加しない

**決定**

| 結果 | 扱い |
|---|---|
| 削除成功 | ジョブ削除 |
| 「存在しない」 | **成功として扱う** |
| その他のエラー | リトライ。上限到達で手動待ち |

手動待ちのジョブには「再試行」と **「破棄」** を用意する（文言は D-35 に従う）。

**理由**

外部削除に成功した直後・ローカル確定前にクラッシュすると、再試行時には対象が存在しない。
これをエラーとして扱い続けると、永久に解消しない未同期表示が残る。

**却下した案**

- **READ 権限を追加して存在確認する** — D-12（Manifest から権限を外して審査をクリティカルパスから外す）
  と正面から衝突する。宣言するデータ型と審査面積を自分から増やすことになり、
  削除の冪等性という局所的な問題に対して割に合わない

**ゲートに追加**

ラッパーが削除時の「存在しない」を他のエラーと識別できるか。
できない場合は「削除済みだがローカル確定前に落ちると未同期表示が残る」を既知の制限として受け入れる。

> **確認結果（2026-09-19、ソース読解による）：Android 14 以降の経路に限り確認済み
> ——ただし「識別」ではなく無区別に成功する。**
> `react-native-health-connect` v4.1.3 の `deleteRecordsByUuids` が経由する platform の
> `RecordIdFilter` ベース削除は、AOSP `HealthConnectServiceImpl` の実装（出荷タグ
> `android-14.0.0_r32` と 2026-09-19 時点の `main` HEAD の両方で確認）を辿ると、存在しない ID
> を投げても例外を送出するコードパスが存在しない。存在しない `clientRecordId` を渡しても
> reject されず resolve するため、上表の「成功」「存在しない」の2行は呼び出し側から見て
> 同じ resolve という1つの分岐になる。バージョン詳細（`connect-client` は実際に配布されている
> 1.1.0 の sources jar で確認済み）は基本設計 §9.4 参照。
>
> **Android 9〜13（非プラットフォーム統合パス、Play ストア配布の別アプリ経由 IPC）は未確認。**
> このアプリのサーバー側実装は AOSP に公開されておらず、ソース読解では確認できない
> （2026-09-19 時点でユーザー判断により実機/エミュレータでの追加検証は行わない）。
> **この OS 範囲が、上の「ゲートに追加」で述べた『ラッパーが識別できない場合』に該当する
> ため、上表の「存在しない→成功として扱う」行ではなく「識別できない場合は既知の制限として
> 受け入れる」を適用する。** 実装自体は OS バージョンで分岐させない——`deleteRecordsByUuids`
> が resolve すれば成功、reject すれば他のエラーと同じくリトライに回すだけであり、
> Android 9〜13 で違うのはその結果として reject されうる（＝手動待ちに落ちて未同期表示が
> 残りうる）という点だけである。詳細は基本設計 §9.4・§9.7 の確認結果を参照。

---

## D-21 削除フローは同期状態によって分岐する

**決定**

削除は無条件の手順ではない。**基本設計 §10.1 の判定表に従う。**

> **条件をここに要約しない。** 要約すると条件が欠け、正本と食い違う。
> v0.10 では実際に `mapping なし` の条件が落ちた要約が残っていた。

**判定表の正本は基本設計 §10.1 とする**

> **判定表をこの文書に複製しない。** 個別削除・全削除・§9.3 の合流規則は、
> すべて基本設計 §10.1 の表を唯一の正本とする。

複製すると、片方だけ更新される。v0.9 では実際にこの文書へ古い表が残り、
修正したはずの問題（mapping を先に判定する / `create + mapping あり` を表現できない）が
再導入されていた。

**判定の原則（v0.9 改訂）**

1. **「HC が未接続かどうか」を先に見ない。**
   現在未接続でも、以前の接続時に作られた mapping やジョブが残っている可能性がある。
   接続状態を先に判定すると、外部削除に必要なジョブまで消してしまう
2. **mapping ではなくジョブの有無と種別を先に分類する。**
   mapping を先に分類すると状態が漏れる
3. **ジョブを黙って取り消してよいのは「外部へ未到達が確実」なときだけ。**
   `attempts > 0` は外部呼び出しを開始した証拠、mapping の存在は外部レコードの存在そのものを意味する。
   **どちらか一方でも成り立てば取り消さない**

**v0.8 までの表に抜けていた正常系**

- **`mapping あり + create` ジョブ** — D-32 の競合の直後に発生する。
  外部 create 成功で mapping は作られ、revision 不一致で create ジョブは残る
- **`mapping なし + recreate` ジョブ** — Import 後の明示的な再同期で発生する。
  置換復元で `health_sync` を破棄した状態から `recreate` を作るため

どちらも正常な一時状態であり、**不変条件 I3 を「create と mapping は同時に存在しない」と
書いてはいけない**（v0.10 で修正済み）。

**理由**

v0.2 の §10.1 は「常に delete ジョブを作る」と読める手順になっており、
§9.3 のジョブ合流規則と矛盾していた。実装者が §10.1 だけを読むと不要な delete ジョブを作る。

`attempts > 0` の分岐がないと、送信済みの create を黙って取り消す経路が残り、
ローカルに存在しない記録が外部に残る。

---

## D-22 「構造上表現できない」という主張を撤回する

**決定**

基本設計 §9.1 の「不整合が構造上表現できなくなる」を削除し、次のように改める。

> 分離によって得られるのは、不整合が発生しうる箇所が1つに限定されること。
> 禁止は Repository のトランザクションと状態遷移規則で行い、**状態遷移テストで保証する**。

**理由**

`health_sync_jobs` は意図的に FK を持たないため、孤児 create/update は DB 上は保存できる。
v0.2 の記述は事実として誤りだった。

**却下した案**

- trigger で構造的に強制する — Migration のたびに trigger の再作成が必要になり、
  D-11（過去データとの互換性最優先）のコストを上げる

**付随する決定**

基本設計 §17.3 に不変条件テスト I1〜I8 を必須として定義する。

---

## D-23 永続モデルは `| null` を明示し、キーの欠落を不正とする

**決定**

```ts
timezoneId: string | null;
orgasm: boolean | null;
```

optional（`?:`）を使わない。Export でも未記録を `null` として明示的に出力し、キーを省略しない。

> **キーの欠落は不正。未記録は `null`。**

**理由**

「JSON にキーがない」「JSON に null がある」「JS 上で undefined」の3つが区別できないと、
strict restore の契約が書けない。

---

## D-24 Export schema にも Migration を持つ

**決定**

```text
export v1 → migrateExportV1ToV2() → export v2 → … → 現行形式 → 全件検証 → Import
```

- version ごとに validator を持つ
- 旧 version は順番に現行形式へ変換する
- **変換後、改めて現行形式として全件検証する**
- 現行より新しい version は明示的に拒否する

**理由**

「`version <= 現行` を受理する」だけでは旧形式を現行形式へ変換できない。
DB Migration とは別の仕組みが必要であり、これがないと「昔のバックアップは読める」という約束が実効性を持たない。

---

## D-25 手動再試行待ちを `not_before IS NULL` で表す

**決定**

リトライ上限到達時に `not_before` を遠い未来の日付にする sentinel 方式をやめ、
**`not_before IS NULL` を手動再試行待ち**とする。due index は partial index にする。

**理由**

sentinel 値は「どの日付なら手動待ちなのか」が暗黙になる。
NULL なら意味が一意で、かつ実行待ちのジョブだけを対象にしたインデックスが張れる。

---

## D-26 Recovery は通常経路から独立した bootstrap にする

**決定**

復号できない DB からの復旧は、通常の起動処理・Repository を通さない専用経路で行う。

```text
1. 復号できない DB 接続を閉じる
2. 新しい暗号鍵と一時 DB を作る
3. Import を一時 DB へ全件投入し、検証する
4. 成功した場合にだけ旧 DB と置き換える
5. 旧 DB と旧鍵を破棄する
6. 失敗時は旧 DB をそのまま残す
```

**理由**

「Import するには DB を開く必要があり、DB を開くには復号が必要」という循環に陥る。
Recovery 画面から通常の Import 画面へ遷移する、とだけ書くと実装時に破綻する。

4 まで成功しなければ旧 DB に触れない。**将来復号できる可能性がある限り、こちらから消さない。**

---

## D-27 セーフティ Export は保存成功を破壊操作の前提にする

**決定**

置換復元の前に行う自動セーフティ Export は、以下を満たさなければ置換を開始しない。

- **共有シートではなく保存先を選ばせる**（iOS: Files、Android: Storage Access Framework）
- 保存が成功したことを確認する
- 保存したファイルを読み直し、件数が一致することを確認する
- キャンセルされた場合は置換を開始しない

**理由**

共有シートは**保存先も成否も返さない**ため、破壊的操作の前提条件としては使えない。
cache に書いただけの一時ファイルはセーフティバックアップとして数えられない。

**例外**

Recovery 経路（D-26）では元 DB を復号できないためセーフティ Export を実施できない。
この場合に限り省略する。失うものが「読めない DB」だけであるため妥当である。

**追記（Export/Import UI 実装時のレビューで発見）**

上記「iOS: Files」は Expo SDK では実現できないことが実装時に判明した。
`expo-file-system` の `StorageAccessFramework`（保存先を選ばせ、書き込みを読み直して
検証できる）は型定義上 **Android 専用**であり、iOS には「共有シートの外で保存先を
選ばせ、成否を確認する」ための同等 API が存在しない。

**やむを得ない代替（iOS のみ）**：アプリの Documents 直下（DB とは別の場所——DB は
D-07 により意図的にそこから除外されている）に検証付きで書き込む。

**この代替が生む新しい緊張関係**：Documents は現状 iCloud/iTunes バックアップの対象に
含まれるため、この安全策自体が「全記録の平文コピーを iCloud へ上げる」という、
D-07 がまさに避けようとした種類の露出を生む。また、iOS の Documents はこのアプリでは
Files アプリに公開していない（`UIFileSharingEnabled` 未設定）ため、利用者はこのファイルを
通常の手段で見つけたり削除したりできない——「あることを確認できるバックアップ」という
セーフティ Export の目的を、位置の点では部分的にしか満たせていない。

この事実は画面上で明示する（`app/settings/data.tsx` の確認画面・完了後の通知）。
将来 §8.6 の iOS 側 DB バックアップ除外（`NSURLIsExcludedFromBackupKey`）が実装され、
その除外範囲が Documents 全体に広がった場合はこの安全性の前提が崩れるため、
`services/SafetyExportService.ts` を再確認する必要がある。

**追記2（同レビュー、優先度低）**：基本設計 §13.3 の手順は「1. セーフティ Export →
2. 全件検証 → 3. プレビュー」の順だが、実装は「検証 → プレビュー → 確認 →
（置換を選んだ場合のみ）セーフティ Export」の順にした。不正なファイルや「追加のみ」
選択のために保存先選択（特に iOS では既定の書き込み）を求めずに済むため、この順序の
方が妥当と判断した。

---

## D-28 Context と Outcome を分離する

**決定**

```text
Activity
├─ Context（必須）      solo / partnered
├─ 日時（必須）
├─ Outcome（任意）      orgasm / ejaculation / protectionUsed
└─ Optional context（任意）  duration / mood / note
```

「誰といたか」と「何が起きたか」を別の軸として持つ。

**理由**

`orgasm` と `ejaculation` は v0.1 から別列として分離済みだったが、
軸としての位置づけが明示されていなかった。分離を明文化することで、
**Ejaculation を中心項目にしない**という判断（D-31）の根拠が構造として残る。

---

## D-29 `protection_used` を追加する

**決定**

`activities` に `protection_used INTEGER CHECK (protection_used IN (0,1))` を追加する。
既定では Partnered で表示するが、**Solo で選べないようハードゲートはしない。**

**理由**

`SexualActivityRecord` が保持できる詳細項目は `protectionUsed` **だけ**である。
これを持つと、HC 同期が「時刻だけ」から一段階豊かになる。

アプリが「あなたにこの項目は関係ない」と決める構造を作らない方が、
判断しないという方針と一貫し、条件分岐も減る。

**付随する決定**

外へ出る情報の範囲を設定画面に具体的に明示する（UI/UX §18）。

---

## D-30 Outcome を統計に昇格させない

**決定**

Orgasm / Ejaculation / Protection は**記録・表示・Export の対象とするが、Insights の指標にしない。**
割合・率・達成度としての集計を行わない。

```text
Context（Solo / Partnered） : 集計してよい
Outcome                     : 集計しない
```

**理由**

Orgasm を全員共通の中心項目にすると、次に自然に出てくる発想が `orgasm rate 62%` である。
これは達成率のスコアカードとして読まれ、UI/UX §16 の「ユーザーを評価しない」に抵触する。
低い数字を見せることに治療的・矯正的な含みが生まれる。

Insights が扱うのは「いつ・どれだけ・どの間隔で」であり、「うまくいったか」ではない。

**先に線を引く理由**

決めておかないと、Pro の「高度な Insights」を設計する段階で必ず蒸し返される。

---

## D-31 性別を尋ねず、保存しない

**決定**

- 利用者の性別を質問しない。`gender` 相当の列を持たない
- 項目の出し分けは**利用者自身が表示項目を選ぶ方式**で行う（要件定義書 §6.3）
- 既定表示は **Orgasm と Notes のみ ON**。Ejaculation / Duration / Mood / Protection は既定 OFF

**理由**

1. **データ最小化。** D-05 の脅威モデルは端末の物理取得を含む。
   出し分けのためだけに新しいセンシティブ属性を増やすのは割に合わない。**持たないデータは漏れない**
2. 身体的特徴をアプリ側が推測しない。トランス・ノンバイナリーの利用者に対しても成立する
3. 男性でも「Orgasm だけ記録したい」、女性でも「Ejaculation を有効にしたい」が成立する

**却下した案**

- 初回に性別を尋ねて項目を出し分ける — 上記3点すべてを失う

**付随する不変条件**

> **記録済みの値は、表示項目の設定に関わらず常に表示する。**
> 設定が制御するのは「未記録の項目を編集画面に出すかどうか」だけであり、既存の値を隠す手段ではない。

これがないと、設定変更で実データが見えなくなるバグになる。
あわせて「その他の項目を追加」という逃げ道を用意し、OFF の項目にも到達できるようにする。

---

## D-32 確定処理は「外部の成功」と「ジョブの完了」を分ける

> **v0.3 の D-18 手順4を改訂する。**

**決定**

```text
BEGIN
  IF activity が存在する:
      health_sync を upsert                    ← 外部成功の事実は必ず残す
      IF revision 一致 → DELETE job
      ELSE            → job は残す
  ELSE:
      mapping は作らない（FK RESTRICT）
      delete job があれば external_record_id を書き戻す
COMMIT
```

**理由**

v0.3 の手順では、revision 不一致のとき mapping が作られないまま再送に回る。
その再送が恒久的に失敗すると **「外部にレコードがあるのにローカルは未同期」が永続する。**

外部呼び出しが成功した事実と、現在のジョブを完了できるかは独立した事象である。

**`else` 側で外部 ID を書き戻す理由**

HC は clientRecordId で引けるが、**HealthKit では READ 権限に依存せず確実に削除するために
外部 UUID が必要になりうる**（D-40）。保存時に得た識別子は、使うかどうかに関わらず捨てない。

---

## D-33 内部不整合の create / update ジョブを自動再試行しない

**決定**

対象 Activity が存在しない create / update ジョブは、一時エラーではなく内部不整合として扱う。

```text
last_error_code = 'LOCAL_ACTIVITY_NOT_FOUND'
not_before      = NULL          → 自動再試行の対象から外す
開発ビルドでは assert / テスト失敗
```

**理由**

claim を解除するだけだと、同じジョブを何度も拾い続ける。

**正常な削除競合と混同しない。**
正常な競合は確定時点（D-32 の `else` 分岐）で現れ `revision` 不一致を伴うが、
内部不整合は claim 直後・外部呼び出し前に発見される。
同じエラーにすると、正常な競合を不整合として報告してしまう。

---

## D-34 `recreate` 操作を v1 の時点で定義する

**決定**

`operation` に `recreate`（削除してから作成）を追加する。Import 後の明示的な再同期でのみ使う。

**理由**

古いバックアップを復元すると、ローカルの `syncVersion` が HC 上の `clientRecordVersion` より
小さいことがある。この状態で update を送っても **HC は大きい version を優先するため反映されない。**

削除してから作り直せば version の大小に関係なく決定的に上書きでき、READ 権限も要らない。

**今のうちに追加する理由**

`operation` の CHECK は列制約であり、後から値を増やすと D-11 のもとでテーブル再構築が必要になる。
**今なら無料、後からは有料**である（D-01 の改名と同じ構図）。

**削除に失敗した場合は作成しない。** 外部に同じ記録を二重に作らない。

**provider を DB 制約で縛らない（v0.5 追記）**

> v1 では Health Connect にのみ生成する。HealthKit での使用可否は HealthKit 実装時に決定する。

`CHECK (operation != 'recreate' OR provider = 'health_connect')` は**追加しない。**
HealthKit にも SyncIdentifier / SyncVersion があるため（D-40）、同じ戦略が必要になる可能性が高い。
ここで縛ると HealthKit 実装時に制約を緩めることになり、テーブル再構築が要る。
`recreate` を今のうちに enum へ入れた理由と同じ論理が、この制約を追加しない理由にもなる。

**永続的な substate を持たない（v0.5 追記）**

`recreate` は常に先頭（delete）から再実行する。「delete 済み」を表す永続状態を持たない。
NOT_FOUND を成功扱いにしている以上、先頭からの再実行は常に安全である。
実装者がフラグを追加したくなる箇所なので、持たないことを明記する。

**却下した案**

| 案 | 却下理由 |
|---|---|
| delete ジョブ成功 → create ジョブ登録の2段構え | 間にプロセスが落ちると create が失われる |
| 古いバックアップでは上書きできない既知の制限とする | 復元したのに外部が古いまま、という状態が説明しづらい |
| READ 権限で既存 version を確認 | D-12 / D-20 と衝突し審査面積が増える |
| 復元後は新しい clientRecordId を使う | 外部に重複が残る |

---

## D-35 同期ジョブの破棄に「解決済み」という語を使わない

**決定**

操作名と確認文を operation ごとに分ける。

| operation | 操作名 | 確認文 |
|---|---|---|
| `delete` | この削除の再試行を停止 | この記録は Health Connect 上に残る可能性があります |
| `create` / `update` / `recreate` | この記録を Health Connect へ同期しない | Solo + Us と Health Connect の内容が一致しなくなります |
| 内部不整合 | この同期エラーを破棄 | — |

**理由**

「解決済みにする」は、外部の状態を確認していないのに解決したように見える。
特に create / update を黙って破棄すると、利用者はローカルと HC が一致していると誤解する。

---

## D-36 同期ワーカーはフォアグラウンドの単一 runtime に限定する

**決定**

> v1 の同期ワーカーは、フォアグラウンドの単一プロセス・単一 runtime 内でのみ動作する。
> バックグラウンドタスク（Headless JS / WorkManager / BGTaskScheduler）は使用しない。

**理由**

起動時に `claimed_at` を一律クリアする方式（D-18）は、この前提でのみ成立する。
複数 runtime が並行しうる構成では、**実行中の claim を別 runtime が解除してしまう。**

**将来バックグラウンド化する場合**

一律解除をやめ、lease 期限方式（`claimed_at < now - lease_timeout` のみ解除）へ変更する。

---

## D-37 アプリ設定を暗号化 DB 内の `app_settings` に置く

**決定**

```sql
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

平文の AsyncStorage に置かない。型は SettingsRepository で担保する。Export にも含める。

**理由**

**「Ejaculation を表示する」という選択自体がセンシティブである。**
何を記録対象にしているかは、記録内容そのものに近い情報を漏らす。

**これは Activity Details のために増えた設計ではない。**
First Day of Week / Time Format / Appearance / App Lock は既に v1.0 の設定であり、
保存先の設計は元々必要だった。Activity Details が追加するのは boolean 6個のキーだけである。

**Export での扱い（v0.5 改訂：allowlist を明示）**

- トップレベルに `settings` として含める
- **置換復元のときだけ復元**し、追加のみモードでは無視する
- **設定の不整合で Activity の復元を失敗させない**

```text
Export する    activityDetails.* / preferences.*
Export しない  healthConnect.* / healthKit.* / appLock.* / 最終同期日時
```

**実装は明示的なキー一覧の定数で判定する（v0.6 追記）。**
`activityDetails.*` という表記は説明上の省略であり、ワイルドカードで判定しない。
そうしないと、将来 `preferences` 配下に端末固有の項目を足したときに自動的に Export 対象へ入る。

**allowlist 対象外を一律「維持」しない（v0.6 追記）。**

| 設定 | 置換復元時 | Recovery 時 |
|---|---|---|
| `appLock.*` / `healthConnect.enabled` | 維持 | 既定値 |
| `healthConnect.lastSyncedAt` 等の同期状態由来 | **リセット** | 既定値 |

端末そのものに属する設定は維持し、**データの状態から導出される値はリセットする。**
維持したままだと、`health_sync` が空なのに「同期済み」と表示される
——allowlist で避けたかった状態そのものが再現する。

**すべてを Export してはいけない。**
`healthConnect.lastSyncedAt` を復元すると、`health_sync` が空なのに
設定画面が「同期済み」と表示するという実害がある。
`appLock.*` は、新しい端末で認証の設定も確認もしないうちにロックが有効になるのを避けるため除外する。

**付随する決定**

App Lock 設定が暗号化 DB 内にあるため、復号できないときは App Lock の要否が分からない。
**Recovery 画面は App Lock を経ずに到達可能とする**（読めない DB に守るべきデータはない）。

---

## D-38 Recovery では DB 切替の確認まで旧鍵を破棄しない

**決定**

```text
… 一時 DB を検証 → 旧 DB を退避 → 切替 → 正式 DB を開き直して確認
 → 新しい鍵を確定 → 最後に旧 DB・旧鍵を破棄
```

**理由**

切替に成功したことを確認する前に旧鍵を消すと、**切替失敗時に旧 DB へ戻れる可能性を自分から手放す。**
旧 DB は読めなくても、将来復号できる可能性がある限りこちらから消さない。

---

## D-39 claim 中のジョブは手動操作できない

**決定**

Settings からの「再試行」「破棄」は、`claimed_at IS NULL` のジョブにのみ適用する。

```sql
DELETE FROM health_sync_jobs WHERE id = ? AND claimed_at IS NULL;
```

0件なら「現在処理中です。完了後にもう一度操作してください」を表示する。

**理由**

D-32 は利用者の編集・削除との競合しか扱っていなかった。
手動破棄と実行中ワーカーが競合すると、
**外部に作成された記録を取り消す後続ジョブが存在しない**状態が生まれる。

```text
create を外部送信中
  ↓ 利用者が「同期しない」で破棄
外部 create 成功
  ↓ 確定時にはジョブがない
外部にレコードが残るが、取り消す手段がない
```

**副次的な効果**

確定処理で「ジョブが見つからない」状態が正常系では発生しなくなる（手動破棄が唯一の経路だった）。
このため基本設計 §9.5.4 は内部不整合としてのみ扱えばよくなる。

**この guard だけでは足りない（v0.6 追記）**

これは**手動ボタン単位**の guard であり、ジョブをまとめて削除する経路には効かない。
置換復元・全削除などとの排他は D-41 で扱う。

**却下した案**

- 破棄時に行を削除せず `cancel_requested` に変更し、外部呼び出し完了後に補償処理する —
  v1 には複雑すぎる。将来バックグラウンド同期を入れる際に再検討する

---

## D-40 HealthKit にも同期識別子と version がある

> **v0.4 までの記述の訂正。** 「HealthKit には clientRecordId 相当の概念がない」は誤りだった。

**事実**

HealthKit には `HKMetadataKeySyncIdentifier` と `HKMetadataKeySyncVersion` がある。
同じ Sync Identifier を持つデータでは、**より大きい Sync Version のオブジェクトが以前のものを置き換える。**

```text
Health Connect   activity.id → clientRecordId        / sync_version → clientRecordVersion
HealthKit        activity.id → SyncIdentifier        / sync_version → SyncVersion
```

**決定への影響**

| 決定 | 影響 |
|---|---|
| D-19（provider 別 version を持たない） | **変わらない。根拠が強くなる。** 両者が同じセマンティクスなので1本で足りる |
| D-32（delete ジョブへ外部 ID を書き戻す） | **変わらない。** ただし理由は「識別子がないから」ではなく「READ に依存せず確実に削除するため」 |
| D-34（`recreate` の provider 制約） | **制約を追加しない**根拠になる。HealthKit でも同じ戦略が使える可能性が高い |

**HealthKit 実装時の確認事項**

メタデータ述語による削除が書き込み権限のみで可能か。
可能であれば `external_record_id` への依存を減らせる。

---

## D-41 破壊的操作と同期ワーカーをプロセス内 mutex で排他する

**決定**

`SyncCoordinator` を設け、次の操作の実行中は新しい claim を止め、実行中の外部呼び出しの完了を待つ。

- 置換復元 / 全 Activity 削除 / Health Connect の切断処理（provider の停止・設定更新）
- DB Migration の開始 / Recovery の開始 / アプリ内データの初期化

```text
suspend() → 実行中の外部呼び出しの完了を待つ → 破壊的操作 → resume()
```

**理由**

D-39 の guard は手動ボタン単位であり、**ジョブをまとめて削除する経路には効かない。**

```text
create を claim → 外部呼び出し中 → 置換復元が health_sync_jobs を全削除
→ Import 投入 → 古い外部 create が成功 → 確定処理がジョブを見つけられない
```

さらに、Import に同じ Activity ID が含まれていると、
**古い処理の結果で `health_sync` が作られる。**

**外部呼び出しが終わらない場合（v0.7 改訂）**

**JS 側のタイムアウトは、ネイティブ処理の終了を意味しない。**
`Promise.race()` で reject しても、ネイティブ呼び出しは裏で継続している可能性がある。
ここで mutex を解放すると、防ぎたかった競合が再発する。

| 状況 | 扱い |
|---|---|
| cancel をサポートする | cancel の完了を待ってから mutex を解放する |
| cancel できない | タイムアウトは UI の待機打ち切りにだけ使う |
| タイムアウト経過 | 破壊的操作を中止し、再試行を案内する |
| 外部 Promise が未 settle | **Coordinator は in-flight のまま扱う** |

> **確認結果（2026-09-19、ソース読解による。実機/エミュレータでの実行検証ではない）：
> Health Connect の insert / delete は、いずれの経路でも明示的な cancel をサポートしない。
> したがって JS 側がタイムアウトで待つのをやめても、ネイティブ呼び出しは止められず継続する
> （継続を止める手段自体が存在しないため）。上表の「cancel できない」行が確定的に適用される。**
>
> - `react-native-health-connect` v4.1.3（commit `8d72b6a`）：`HealthConnectModule.kt` /
>   `HealthConnectManager.kt` の `insertRecords` / `deleteRecordsByUuids` はいずれも
>   `CoroutineScope(Dispatchers.IO).launch { ... }` で起動され、返り値の `Job` は保持されない。
>   `HealthConnectModule.kt` の `@ReactMethod` 一覧に `cancel` に相当するメソッドは存在しない。
>   JS 側が Promise を諦めても、この coroutine を止める手段が最初から無い。
> - **Android 13 以前の経路**（`HealthConnectClientImpl` → 別プロセスの Health Connect アプリへ
>   AIDL 経由）：根拠は **androidx 側の AIDL インターフェース**（`IHealthDataService`）に
>   cancellation を渡す引数が無いこと。`delegate.insertData(...).await()` /
>   `deleteData(...).await()` が呼ぶ `service.insertData(requestContext, request, callback)`
>   （`ServiceBackedHealthDataClient.kt`）はこの3引数のみで、cancellation を伝える手段がない。
>   coroutine 側の `.await()` を諦めても、別プロセスへ送信済みの Binder リクエストは止まらない。
>   `IHealthDataService` はアプリに同梱される `androidx.health.connect:connect-client` 側が
>   定義するインターフェースであり、相手の非公開実装（Health Connect アプリ）が一方的に
>   cancel 用のメソッドを追加しても、同梱バージョンの connect-client からは呼べない。
>   したがってこの結論が変わりうるのは connect-client の更新時であり、相手アプリの改訂ではない。
> - **Android 14 以降の経路**（`HealthConnectClientUpsideDownImpl` → platform 統合パス）：
>   根拠は **platform 側の公開 API `android.health.connect.HealthConnectManager` 自体**に
>   cancellation の契約が存在しないこと。`insertRecords` / `deleteRecords` の全オーバーロードの
>   シグネチャを、出荷版タグ `android-14.0.0_r32` と `main` HEAD
>   `45168a88ae2a7e1abafe1cc81001d97ff00194e2`（2026-09-19時点の最新開発版）の**両方**で確認した
>   （D-20 で確認済みの delete 挙動と同じ2点だが、今回は cancel シグネチャの有無として再確認した）。
>   `CancellationSignal` を受け取るオーバーロードは1つもなく（`(records/request, executor,
>   callback)` のみ）、両者は完全に同一シグネチャだった。androidx 側の実装
>   （`suspendCancellableCoroutine { continuation -> healthConnectManager.insertRecords(
>   records, executor, continuation.asOutcomeReceiver()) }`）も `CancellationSignal` を
>   一切生成・登録していない。`androidx.core.os.asOutcomeReceiver` の KDoc 自身が
>   「cancellation をサポートする API は `CancellationSignal` を作って
>   `continuation.invokeOnCancellation { canceller.cancel() }` を登録すべき」と明記しているが、
>   このパターンは使われていない。
>
> **結論：** 2つの経路は cancel 不可の根拠が異なる——Android 14 以降は「platform API 自体に
> cancel の契約が無い」こと、Android 9〜13 は「androidx の AIDL インターフェースに cancel を
> 渡す手段が無い」ことが理由であり、どちらも**ラッパーの実装漏れではない**。結論（cancel 不可）
> は両経路で一致するが、根拠が別物なので、一方が将来変わっても他方の結論が自動的に変わるわけ
> ではない。platform API 側（Android 14 以降）は AOSP タグと main HEAD で経路が一致することを
> 確認したため、当面のバージョンでは安定していると考えてよい。androidx の AIDL 側（Android
> 9〜13 の相手）は、`connect-client` のバージョンを固定している限り変わらない
> （AIDL 定義は同梱する androidx 側にあり、相手の非公開実装が変わっても影響しない）。
> **connect-client のバージョンを更新する際は再確認すること。**
>
> **未調査事項：** Health Connect 側・OS 側に独自のタイムアウトがあるか（ANR、Binder 切断、
> 別プロセスの Health Connect アプリが kill される等で callback が失敗扱いになる経路）は
> 調査していない。これは「外部 Promise が永久に settle しない」ケースがどれだけ起きるかに
> 関わるが、D-41 は元々そのケースを「アプリ再起動のみが逃げ道」として扱っており、頻度に
> 関わらず規則は変わらない。
>
> **ラッパー入れ替え・バージョン更新時は再確認すること。**

**タイムアウトを「外部処理の終了」とみなさない。**
「待ちきれないから強行する」経路も作らない。破壊的操作はやり直せるが、
外部に取り残されたレコードは自力で見つけられない。

**Promise が永久に settle しない場合**

逃げ道はアプリの再起動のみ。これは設計上安全である。
再起動で `claimed_at` はクリアされるが `attempts`（claim 時に加算）は残るため、
**「外部へ到達したかもしれない」ジョブとして正しく扱われる。**
プロセスが死んでもネイティブ側の書き込みが完了する可能性はあるが、
`attempts > 0` がその可能性を表現しているため、この問題は**既に解決済みのケースに退化する。**

**前提条件として成立する理由**

v1 はフォアグラウンドの単一 runtime（D-36）なので、プロセス内 mutex で十分である。

**この排他が D-32 の前提になる**

D-39 の guard とこの排他の**両方**があって初めて、
「確定時にジョブが見つからない = 内部不整合」という前提が成立する。

---

## D-42 Export JSON の設定値は JSON 本来の型で出力する

**決定**

```text
DB app_settings.value : TEXT
SettingsRepository    : boolean / enum へ変換
Export JSON           : JSON 本来の型（true / false / "monday"）
Import JSON           : JSON の型を厳密に検証してから DB 用 TEXT へ変換
```

**理由**

DB が TEXT であることと、公開形式が文字列であることは別である。
`"false"` は JavaScript では truthy であり、公開形式で文字列に潰すと
他のツールや将来の実装がこの事故を踏む。

Export は外部との契約なので、型情報を落とさない。

---

## D-43 全 Activity 削除は delete ジョブを作る（置換復元とは異なる）

**決定**

| | 外部への反映 |
|---|---|
| **全 Activity 削除**（Settings > Delete Data） | **delete ジョブを作る** |
| 置換復元（D-10） | delete ジョブを作らない |

**対象は「同期済み」ではなく全 Activity（v0.7 改訂）**

mapping がない未同期 create でも、**過去に外部へ到達している可能性がある**
（送信成功後・ローカル確定前に落ちた場合。`attempts > 0`）。
「同期済みではない」として無視すると、外部に記録が残る。

したがって **D-21（基本設計 §10.1）の判定表を全 Activity へ一括適用する。**

> **判定表をここに複製しない。** 正本は基本設計 §10.1 のみ。

D-41 の排他制御下で実行するため claim 中のジョブは存在しない。

**理由**

全削除における利用者の意思は「このデータを消す」であり、**外部も対象に含まれる。**
一方、置換復元は機種変更・復旧が主用途であり、外部の記録を消す意図とは限らない。

同じ「消える」でも外部への影響が違うため、**画面上でも言い分ける。**
全削除では、外部への反映が非同期であることを実行前に明示する。

---

## D-44 全削除の外部削除は前面で進行を見せ、中断可能にする

**決定**

- 全削除ではキューに投げっぱなしにせず、**前面で進行を表示する**
- ローカル削除は即座に完了する（外部の成否を待たない）
- 外部削除は既存のキュー（D-18）をそのまま使い、進行だけを前面に出す
- 途中で閉じてもキューは残り、**次回起動時に自動再開する**
- **「ローカル削除完了」と「全削除完了」を言い分ける**
- **未処理が残った状態でアンインストールすると外部に残る**ことを確認画面で明示する

**理由**

全削除は「記録を消したい」という意思が最も強い場面であり、
**このアプリでは、消したい瞬間に外部へ残ることが最大の失敗**になる。

記録を消したうえでアプリも消す、という流れはこの製品では十分に起こりうる。
外部に残る可能性を黙っていてよい制限ではない。

**表示の規則（v0.8 追記）**

- 全削除の開始時に `healthConnect.lastSyncedAt = null` にする。
  mapping がすべて消えるため、以前の「Last synced」を残すと誤解を招く
- **削除中は日時ではなく状態を表示する**（「削除中・残り N 件」）
- 進行総数（`12 / 47` の 47）は**メモリ上にだけ持つ**。
  再起動後は「残り N 件」に切り替える。**表示のためだけにスキーマを増やさない**
- 進行画面のボタンは「画面を閉じる」。**「バックグラウンドで続ける」と書かない**
  （v1 はバックグラウンド同期を実装しない。OS のバックグラウンドで続くと誤解される）

**却下した案**

- 外部削除を同期的に完了させてから画面を閉じる — 外部障害でローカル削除まで
  失敗させることになり、Rule 2（外部 API 障害で Activity を失わない）に反する
- アプリの終了を禁止する — 利用者の操作を奪う。禁止しても OS には勝てない
- 進行総数を永続化するバッチテーブルを追加する — 表示の都合でスキーマを増やすことになる

---

## D-45 Health Connect を切断しても未処理ジョブを破棄しない

**決定**

「このまま切断する」を選んでも、**未処理のジョブは保持し、再接続時に再開する。**

```text
Health Connect へ再接続すると、
残っている削除を再開できます。
```

を Settings に表示する。未処理が残っている間は件数も表示し続ける。

**理由**

破棄すると、**外部に残った記録へ到達する手段が永久に失われる。**
利用者から見れば「消したはずの記録が Health Connect に残り、アプリからは何もできない」状態になる。

個別に打ち切りたい場合は D-35 の operation 別の破棄操作を使う。
**これは利用者の明示的な選択であり、切断の副作用として起きてよいものではない。**

**ワーカーは provider が無効な間 claim しない（v0.9 追記）**

```text
healthConnect.enabled = false  → HC のジョブを claim しない（ジョブは保持）
healthConnect.enabled = true   → due なジョブから処理を再開する
```

**この規則がないと「再接続時に再開」ではなく「切断直後から再試行」になる。**
切断処理を D-41 で排他しても、`resume()` 後のワーカーが通常どおり取得してしまう。

`app_settings` を SQL で JOIN せず、ワーカー開始前に SettingsRepository で確認する。

**未処理が永久に残る場合**

再接続されなければジョブは残り続け、Settings の件数表示も消えない。
これは事実として正しい状態であり、隠さない。打ち切りたい利用者には D-35 の経路がある。

---

## D-46 同期ワーカーは AppState に従って開始・停止する

**決定**

| AppState | 動作 |
|---|---|
| `active` | ワーカーを開始・再開する |
| `inactive` / `background` | **新しい claim を停止する。実行中の外部呼び出しは結果の確定まで進める** |
| 次の `active` | due なジョブから再開する |

**バックグラウンド移行時に、実行中のネイティブ呼び出しを強制キャンセルしない。**

**理由**

v1 はフォアグラウンドの単一 runtime で動く（D-36）ため、AppState が事実上のワーカー寿命になる。
明文化しないと、実装者ごとに「バックグラウンドでも回し続ける」「即座に中断する」が分かれる。

強制キャンセルしない理由は D-41 と同じで、**中断が外部処理の終了を意味しないから**である。
新しい claim だけを止め、可能な範囲で確定処理まで終える方が安全である。

確定できないまま JS の実行が止まっても、`attempts > 0` が
「外部へ到達したかもしれない」状態を表現しているため、次回起動後の分岐は正しい。

**UI との整合**

全削除の進行画面に出す「アプリを閉じると削除は一時停止し、次回起動時に再開します」は、
この規則をそのまま利用者向けに言い換えたものである。

---

## D-47 画面マスクは常時オンとし、スクリーンショット・画面収録も iOS で意図的にブロックする

（画面マスク実装時に追加。設計文書に明文化された決定ではなく、実装時に必要になった2点を
ここで確定させる）

**決定1：常時オン、トグルを持たない**

要件定義書 §21 Discreet Mode「Recent Apps 画面のマスク」は「実装する」と決定されており
（v1.0 必須、●）、App Lock の enabled/disabled のような端末所有者が選ぶ設定ではない。
UI/UX §17 の「Hide App Preview >」の行は情報のみの画面（`app-lock.tsx` の「UNLOCK WITH」と
同じパターン）とし、オン/オフのトグルは持たない。

**理由**：この保護は §8 の DB 暗号化・§8.6 の OS バックアップ除外と同じ「OS レベルの露出を
防ぐ、判断の余地のない保護」の階層に属する。App Lock のように「画面を見せるかどうか」の
好みの問題ではなく、Recent Apps／App Switcher というアプリの外側の OS 機能に記録内容が
漏れることそのものを防ぐものであり、無効化を選べる理由が無い。

**決定2：iOS でもスクリーンショット・画面収録をブロックする**

要件定義書 §21 が明示的に求めているのは「Recent Apps 画面のマスク」のみで、スクリーンショット
のブロック自体はどの設計文書にも記載が無い（全文検索でも該当なし）。

Android では `expo-screen-capture` の `preventScreenCaptureAsync()`（`FLAG_SECURE`）が
Recent Apps のサムネイル空白化とスクリーンショット・画面収録のブロックを同時に行い、
両者を分離する設定は無い——ここでは「選んだ」のではなく「分離できない副作用」である。

iOS はこれと事情が異なる：App Switcher のマスクは `enableAppSwitcherProtectionAsync()` 単体
で成立し、`preventScreenCaptureAsync()` を呼ばなくてもマスクは効く。つまり iOS では
「スクリーンショット・画面収録もブロックする」のは分離できない副作用ではなく、
**独立した選択**である。ここでは両方をブロックする方を選んだ——記録内容の性質
（Personal Health Data、Private Wellness）を踏まえ、利用者が Insights の画面などを撮影して
端末外に残せてしまう経路も、Recent Apps への露出と同種のリスクとして扱う。

**帰結**：iOS・Android のいずれでも、Solo + Us の画面のスクリーンショット・画面収録は
常に禁止される。これは意図した挙動であり、バグではない。Android の `FLAG_SECURE` は
スクリーンショット・画面収録に加え、画面キャスト／ミラーリング／外部ディスプレイへの
出力も黒画面にする——これも意図した挙動として受け入れる。

**追記（2回目のレビューで発見、`node_modules/expo-screen-capture` の実装を直接確認）**

**決定3：Android のスクリーンショット「検知」用パーミッションを Config Plugin で除去する**

`expo-screen-capture` は autolinking で `READ_EXTERNAL_STORAGE`（maxSdk 32）・
`READ_MEDIA_IMAGES`（sdk 33）・`DETECT_SCREEN_CAPTURE`（sdk 34+）を Android マニフェストへ
持ち込む。これらはすべて `addScreenshotListener`/`getPermissionsAsync`/
`requestPermissionsAsync`（スクリーンショット「検知」）専用で、この app が使うのは
`preventScreenCaptureAsync`/`enableAppSwitcherProtectionAsync`（「防止」）だけである。
使わない機能のために「写真の読み取り」パーミッションが増えるのは、§8 の「記録内容を
外に出さない」姿勢と整合しない。`plugins/withoutScreenCaptureDetectionPermissions.js`
（`tools:node="remove"`）でこれら3つのパーミッション宣言を除去する。

ネイティブ側（`ScreenCaptureModule.kt` の `OnCreate`）は API 34 未満で
`ScreenshotEventEmitter` を無条件に生成し、`MediaStore.Images` への `ContentObserver` を
常時登録する——これは Config Plugin からは変更できない Kotlin の実装であり、パーミッション
除去後は権限が無いため `onChange` のたびに `Log.e` が出るだけで例外は投げない
（`ScreenShotEventEmitter.kt`）。実際にスクリーンショットが撮られる経路は
`preventScreenCaptureAsync`（`FLAG_SECURE`）で塞いでいるため、この observer が実際に
発火することは通常無い想定。サードパーティモジュールへのパッチは行わず、この無害な
ログ出力の可能性を既知の制限として受け入れる。

**「常時オン」の限界（2点、実機で確認するまで断言できない）**

1. `preventScreenCaptureAsync`/`allowScreenCaptureAsync` の JS 実装
   （`expo-screen-capture` の `ScreenCapture.js`）は、内部の `key`（既定値 `'default'`）を
   `await` の**前**に `Set` へ追加し、失敗時にロールバックしない。一度 reject すると、
   同じ key での再呼び出しは実際にはネイティブへ到達せず、即座に成功として resolve
   される。`lib/screenMask.ts` の `attemptScreenMask()` は自前でこの結果をメモ化し、
   ネイティブ呼び出し自体をプロセス内で一度しか行わないことでこの問題を回避している
   （＝再試行して確認するのではなく、最初の一度きりの試行結果を全呼び出し元で共有する）。
2. iOS の `preventScreenshots()`（`ScreenCaptureModule.swift`）は `keyWindow` が
   まだ存在しない場合に無言で何もせず終わり、それでも呼び出し元の promise は成功として
   resolve される。**「resolve した」ことは「実際に保護が有効になった」ことの証明には
   ならない。** `useScreenMask()` を `RootLayout` で `loaded`（フォント読み込み完了・
   スプラッシュ非表示直前）を待ってから呼ぶことでこの窓を狭めているが、JS からこれを
   完全に検証する手段は無い。`isAvailableAsync()` もネイティブ関数の存在確認のみで、
   この種のタイミング起因の失敗は検出しない。

したがって `app/settings/hide-app-preview.tsx` の「✓」は「明示的な失敗を検出しなかった」
ことを意味し、「実機で有効化を確認した」ことを意味しない。README にもこの限界を明記する。

**Android の再適用（Activity 再生成対策）**：`FLAG_SECURE` は `currentActivity.window` 単位で
設定されるため、`configChanges` で吸収されない構成変更で Activity が再生成されると保護が
失われ、再適用されない。`useScreenMask()` は Android に限り、`AppState` が `active` に戻る
たびに**新しい key**で `preventScreenCaptureAsync` を呼び直す（`attemptScreenMask()` 自身の
メモ化とは別の、意図的にキャッシュをバイパスする仕組み）。iOS の
`enableAppSwitcherProtection()` はモジュールインスタンス（プロセス寿命）に紐づく
`NotificationCenter` 監視であり、Activity 相当の再生成は無いためこの再適用は不要——ただし
`enableAppSwitcherProtectionAsync()` は呼ぶたびに無条件で observer を追加登録するため
（dedupe なし）、複数回呼ぶと通知が二重登録される。`attemptScreenMask()` のメモ化により
実際には一度しか呼ばれないため実害は無いが、この関数自体が冪等ではないことは明記しておく。

**iOS のぼかしは RN のルートビューにしか載らない**：`showPrivacyOverlay()` は
`keyWindow.subviews.first` に addSubview する。つまり別の native ViewController で
提示されるもの（`expo-sharing` の共有シート、`expo-document-picker`、システムの Alert）は
ぼかしの外側になる。これは `contexts/AppLock.tsx` が `presentation: 'modal'` を避けている
理由（`app/_layout.tsx` のコメント）とまったく同じ構造の制約——このプロジェクトが既に
自覚している原則の再登場である。Export/Import 中にバックグラウンドへ移った場合の
App Switcher スナップショットは、この限界の範囲内にある既知の制限として受け入れる
（パッチや回避を試みない）。

**追記（2026-09-18、ユーザーからのフィードバックにより決定2を撤回）**

**決定2（iOS でもスクリーンショット・画面収録をブロックする）を撤回し、オプトインに変更する。**

Google Health など同種のアプリはスクリーンショットを禁止していない。本人が自分のデータを
スクリーンショットしたい正当な理由（長期グラフの保存、医師への共有、バグ報告、端末間の
一時的な共有）は多くあり、これを一律に禁止するのは「Your intimate life belongs to you」
というブランド思想（本人のデータに対する自由）とも矛盾する。プライバシー保護の目的は
Recent Apps プレビューのような**意図しない露出を防ぐこと**であり、本人が意図して行う
操作まで制限する理由にはならない。

**新しい決定**：

| 保護 | 既定 | 設定可否 |
|---|---|---|
| Recent Apps／App Switcher プレビュー非表示 | 常時オン | 不可（決定1は維持） |
| スクリーンショット・画面収録のブロック | OFF | 可（`privacy.blockScreenshots`、UI/UX §17 PRIVACY「Block Screenshots」） |

**Android の技術的制約**：この2つを分離する OS API（`Activity.setRecentsScreenshotEnabled`）は
Android 13（API 33）以降にしか存在しない。API 33 未満では `FLAG_SECURE` しか手段が無く、
これは決定2以前と同じ「分離できない副作用」のまま——Recent Apps 非表示を優先し、
`privacy.blockScreenshots` は実質 ON 固定（無効化不可）として受け入れる
（ユーザーと相談のうえ決定。CLAUDE.md にも記録）。API 33 以降は `expo-screen-capture` への
自前パッチ（`patches/expo-screen-capture+*.patch`）で `setRecentsScreenshotEnabled` を追加し、
Recent Apps 非表示とスクリーンショットブロックを実際に分離した。iOS は元々
`enableAppSwitcherProtectionAsync()`/`preventScreenCaptureAsync()` が独立しているため、
コード変更は「常時呼んでいたものをオプトインに変える」だけで済む。

詳細な実装（`lib/screenMask.ts`・`contexts/ScreenshotBlock.tsx`・
`app/settings/block-screenshots.tsx`）は README「Phase 3 実装状況 > 画面マスク」を参照。

---

## D-48 多言語対応（UI 全体の翻訳）はロードマップ外とし、v1.0 には含めない

（Appearance トグル実装時の整理で追加。設計文書のどこにも計画が無いことを確認したため、
「未着手」ではなく「スコープ外」であることを明文化する）

**決定**

UI 文言全体を複数言語で提供する多言語対応（いわゆる i18n ライブラリの導入・翻訳リソースの
用意・言語切替 UI）は、v1.0 のロードマップに含めない。要件定義書・基本設計・UI/UX
Specification のいずれにも該当する計画は無く、全文検索でも見つからない。

**「i18n キー」という既存の言及との違い**

D-01 などにある「表示ラベルは i18n キー経由で別管理する」は、`ActivityContext`
（`solo`/`partnered`）のような**内部データ値と表示文言を分離して管理する**という設計原則の
話であり、UI 全体の翻訳基盤の話ではない。この言及を多言語対応が計画済みであることの根拠に
しない。

**理由**

- v0.11 時点の UI は英語文言のみで実装されており（本ファイルの各 D-XX、README 含め）、
  翻訳対象の文言一覧・翻訳版の作成・言語切替 UI のいずれも設計判断が存在しない
- Personal Health Data を扱うアプリとして、翻訳の品質（特に性的活動に関する婉曲表現・
  デリケートな文言のニュアンス）は機械翻訳では済まず、対応言語ごとに人手のレビューが要る
  ——実装量ではなく判断量が大きいタスクで、「小さいから片付ける」対象ではない

**着手する場合に先に決めるべきこと（次にこのテーマに触れる時のための整理）**

1. 対応言語の範囲（日本語 + 英語のみか、それ以上か）
2. i18n ライブラリの選定（React Native/Expo エコシステムでの標準的な選択肢の比較）
3. 翻訳対象の文言の棚卸し（既存 UI は英語ハードコード——`Text` への直書きを i18n キー経由に
   置き換える範囲の洗い出し）
4. 端末言語追従 vs アプリ内での明示的な言語選択（Appearance の `'system'/'light'/'dark'`
   と同様の設計判断が要る）
5. Export/Import・DB には影響しない（表示層のみの変更）ことの確認

**却下した案**

- 「i18n キー」の既存言及を根拠に、多言語対応はすでに計画済みとして進める
  — 上記の通り別概念であり、根拠にならない

---

## D-49 「日の切り替え時刻」設定を実装する場合の設計方針（着手時期は未定）

（Health Connect の睡眠データモデル——`SleepSessionRecord` が日付ではなく開始/終了の
瞬間を持つこと——を調べたのがきっかけで整理。実装するかどうか・いつ着手するかは
未定だが、D-02 の不変条件を壊す案を選ばないよう、先に技術方針だけ固定しておく）

**決定**

「その日」の境界は引き続き**現地 00:00 固定**（D-02 / 基本設計 §4.5）とする。将来
ユーザーが切り替え時刻（例: 4:00）を設定できるようにする場合も、
**`occurred_local_date` は暦日のまま書き換えない**。切り替え時刻を反映した
「活動日（activity date）」は、`occurred_local_date` / `occurred_local_time` から
**都度導出する別概念**として扱い、DB には保存しない（切り替え時刻はユーザー設定
1つで全行に効くため、設定変更のたびに全行を書き換えるより都度導出の方が安全）。

導出式（すでに保存されている `occurred_local_date` / `occurred_local_time` だけで
計算でき、オフセット再計算や夏時間のずれを避けられる）：

```sql
CASE WHEN occurred_local_time < :boundary
     THEN date(occurred_local_date, '-1 day')
     ELSE occurred_local_date
END
```

`occurred_local_time` は `HH:MM`（ゼロ埋め、`lib/datetime.ts` の `LOCAL_TIME_RE`
= `/^\d{2}:\d{2}$/`）で保存されている文字列なので、この比較は**文字列比較**である
ことが前提になる。`:boundary` は必ず同じゼロ埋め `HH:MM` 形式（例: `'04:00'`、
`'4:00'` や分数値では不可）で持つこと——形式がずれると比較が静かに壊れる。

日付範囲クエリは、生の `occurred_local_date` で **上限側 (`to`) だけ +1 日**した
`[from, to+1日]` を取得し（`idx_activities_local_date` / `idx_activities_context_date`
はそのまま使える）、上記 CASE の結果で絞り込む。翌日 00:00〜切り替え時刻の記録が
前日の活動日に入るため上限側の拡張が必要で、下限側を広げても該当行は絞り込みで
全部落ちるため意味がない。

**理由**

- D-02 の不変条件は `local = utc + offset` で常に検証可能であること。
  `services/importValidation.ts` の `isLocalDateTimeConsistent`
  （`lib/datetime.ts`）が Import 時にこれを厳密に検査しており、`occurred_local_date`
  を切り替え時刻に合わせてずらして保存すると、自分で Export したファイルを Import
  できなくなる。`services/ExportService.ts` は保存された `occurredLocalDate` を
  そのまま JSON 化しているため、Export の公開契約も暗黙に変わってしまう。
- 要件定義書 §26 Performance が「月次集計・カレンダーはローカル日付列のインデックス
  で解決する」ことを非機能要件として明記しており、`occurred_local_date` を暦日の
  まま残して `idx_activities_local_date` / `idx_activities_context_date`
  （`database/schema.ts`）を使い続けられる設計が要件上望ましい。

**却下した案**

- `occurred_local_date` を切り替え時刻に合わせてずらして保存し直す案 —
  D-02 の不変条件・Export/Import の往復性を壊すため却下。

**影響範囲（着手時に改めて grep で再確認する前提——コードは変わりうる）**

- `app/(tabs)/index.tsx` と `screens/CalendarScreen.tsx` に重複している
  `todayLocalDate()`
- `lib/relativeDate.ts`（Today/Yesterday 表示）
- `lib/calendarGrid.ts` の月範囲
- `app/(tabs)/index.tsx` が呼ぶ `ActivityRepository.countActivitiesByDateRange`
  （月集計）
- `screens/CalendarScreen.tsx` の `findActivitiesByDateRange` 呼び出しと、取得結果を
  `activity.occurredLocalDate` をキーに日セルへ振り分けている箇所——振り分けキーを
  活動日に変える必要がある
- `components/ActivityRow.tsx` と `app/activity/[id].tsx` の日付表示（どちらも
  `activity.occurredLocalDate` をそのまま表示）——一覧は活動日、詳細は暦日、のような
  食い違いが起きやすいので、どちらを表示するか決める必要がある
- `app/(tabs)/index.tsx` の LAST ACTIVITY——`formatRelativeLocalDate` の `today`
  引数だけでなく、渡している `lastActivity.occurredLocalDate` 自体も活動日に変える
  必要がある

**影響しない**

- §14 の時間帯統計（循環ウィンドウ、"Most common time"）——`occurred_local_time`
  ベースで日付非依存
- `services/StatisticsService.ts`——全期間の件数と UTC の最古・最新時刻から平均間隔を
  出しているだけで、日付境界に依存しない（日単位集計はまだ存在しない）

**着手する場合に先に決めるべきこと**

1. 要件定義書 §25 の MVP 表での位置づけ（v1.0 / v1.1 / v1.2 のどこに入れるか。
   Health Connect 書き込み・同期設定——§18 Phase 4、§25 で v1.0 ○——との前後関係に
   ブロック関係は無いので、どちらを先にしてもよい）
2. 新しい設定キーを `EXPORTABLE_SETTING_KEYS`（`types/Settings.ts`, D-42）に含める
   かどうか
3. D-42 が `firstDayOfWeek` を初回起動時に確定させている理由（ロケール変更で過去の
   カレンダー履歴の並びが黙って変わってはならない）と同様、切り替え時刻を変更すると
   過去記録の「何日の活動か」が一斉に変わる——**この決定（活動日を単一の設定値から
   都度導出し、DB には保存しない）を採る限り、これは遡及適用しかできない**。
   「今後の記録のみに適用」したい場合は、記録ごとに切り替え時刻または活動日を保存
   する必要があり、それは「DB には保存しない」という上記の決定そのものを見直す
   ことになる。ここで決めるのは遡及適用を受け入れるかどうかであって、両方式の
   選択ではない
4. Health Connect の睡眠相関機能（要件定義書 §17/§18、§25 で v1.2 以降）とは別の
   設計問題として切り離すこと——本項目のきっかけにはなったが、実装の必要条件では
   ない

---

## D-50 記録済み Activity の日時事後編集をスコープに含める（README のスコープ判断を上書き）

（`phase3/datetime-edit` ブランチで Add Activity 側の日時変更 UI を実装した際、README
「スコープの判断：日時を編集できるのは記録前（Add Activity）のみ」として、UI/UX §27
Phase 3 行の括弧書き「§8『Just now』からの日時変更入口」を根拠に Activity Detail
（`app/activity/[id].tsx`）の事後編集をスコープ外と判断していた。その後の利用者
フィードバックで「Activity Detail の DATE & TIME もタップで編集できたほうがよい」との
要望があり、本項目でスコープを明示的に拡張する。以下の「決定」は2回のレビューを経た
最終形——レビューで見つかった問題とその経緯は README「日時編集 UI」の D-50 追記部分に
記録している）

**決定**

Activity Detail 画面（`app/activity/[id].tsx`）の DATE & TIME 表示をタップすると、
Add Activity（`app/record.tsx`）と同じネイティブ date/time picker が開き、事後編集が
できるようにする。UI/UX §27 の Phase 3 行の文言はそのままだが、「§8『Just now』からの
日時変更入口」という限定を、記録済み Activity の事後編集も含む形の運用として拡張する
——本項目が正となる。

- Android の連鎖ダイアログ・`clampToNow`・`sameMinute` は `lib/androidDateTimePicker.ts`
  に、picker の state 管理・`AppState` dismiss・open/confirm/cancel は
  `hooks/useNativeDateTimePicker.ts` に、iOS シートの JSX は
  `components/DateTimePickerSheet.tsx` に、それぞれ共通化し `record.tsx`/`app/activity/
  [id].tsx` の両方から使う（重複させない——1回目のレビューで iOS 側の重複が指摘された）
- iOS のシートは `record.tsx` 同様、RN の `<Modal>` ではなく画面内に絶対配置した素の
  `View`（`contexts/AppLock.tsx` の原則——ネイティブの modal presentation は
  App Lock オーバーレイの外側に出てしまうため使わない）
- 選んだ値はこの画面の他フィールド（Orgasm・Duration・Note 等）と同じく、画面下部の
  Save ボタンを押すまで DB に反映しない（`customInstant` が `null` のままなら
  `occurred_*`/`timezoneId` は patch に含めず、既存値をそのまま保持する）
- **`timezoneId` は記録済みの Activity 自身が持つ値を使う（`null` のときのみ端末の
  現在の IANA ゾーンにフォールバック）。record.tsx（新規記録）とは前提が違う**：
  新規記録は「今いる場所で今起きたこと」なので端末の現在ゾーンで正しいが、事後編集は
  元の記録場所の情報（`activity.timezoneId`）を既に持っており、それを編集時にいる
  場所のゾーンで上書きしてはならない（1回目のレビューで発見・修正——東京で記録した分を
  LA で編集すると `occurredAtUtc` が約17時間ずれ、`RECENT`/カレンダーの並びまで壊れる
  不具合だった）
- **picker に渡す `Date` は、実際の瞬間ではなく「年月日・時分の数字を運ぶだけの入れ物」
  として扱う**（`app/activity/[id].tsx` の `toLocalDate`：保存済み
  `occurredLocalDate`/`occurredLocalTime` の数字をローカル `Date` コンストラクタに
  そのまま渡す）。ネイティブ picker はタイムゾーンを意識できず、常に**端末の現在の
  ゾーンとして** `Date` を表示・編集する（§4.4 既知の制限）ため、`Date` 自体の
  `.getTime()`（＝端末の現在ゾーンとして解釈した瞬間）を信用してはならない。保存時に
  初めて、選んだ数字を `activity.timezoneId` の時刻とみなして UTC へ変換する
  （`lib/datetime.ts` の `zonedComponentsToUtc`、`resolveOffsetMinutesForZone` の逆変換）
  ——この2段階（数字を運ぶ→保存時に記録ゾーンで解決）を守ることで、DATE & TIME の
  テキスト・picker の表示・保存値のすべてが常に同じ「記録時のゾーンの時刻」で揃う
  （2回目のレビューで発見・修正——1回目の修正で保存値自体は正しくなったが、代わりに
  「picker に実際の瞬間を渡す」方式を採ったため、端末の現在ゾーンと記録ゾーンが違うと
  テキスト・picker・保存後の表示がそれぞれ違う時刻を示すようになっていた）
- **picker 自身の未来日時ガード（ネイティブ `maximumDate`・Android の連鎖ダイアログ内の
  丸め）も、数字の入れ物どうしを比較する形に揃える**。picker に渡す値が数字の入れ物で
  ある以上、その未来判定を実際の「今」（`new Date()`）と比較するのは誤り——記録ゾーンが
  端末より東にある場合、正しい過去の時刻が「端末換算では未来」に見えてしまい、`Save`
  を押す前の時点で picker がその値を無言で別の時刻に丸めて上書きしてしまう（3回目の
  レビューで発見・修正）。`lib/datetime.ts` の `nowAsZonedDigits(timezoneId)` で「今」を
  記録ゾーンの数字の入れ物として表し、`hooks/useNativeDateTimePicker.ts` の `getMax`
  （`app/record.tsx` では従来どおり `() => new Date()`）・`lib/androidDateTimePicker.ts`
  の `maximumDate`/連鎖ダイアログ内の丸めの両方をこれに揃える。`resolveOccurredAtEdit`
  内の `clampToNow`（実際の瞬間どうしの比較）は最終防衛として変更なし——picker 側の
  ガードはあくまで Save 前の目安であり、権威ある判定ではない

**理由**

- 事後編集を求める実際の要望があり、UI/UX §27 の限定は「意図的にスコープ外にした」
  というより「Add Activity 側の実装時点でそこまで手を広げなかった」という経緯の方が
  実質に近い（README 参照）
- 必要なロジック（`buildOccurredAtFields`/`resolveOffsetMinutesForZone`/
  `clampToNow`/`sameMinute`）は Phase 1/3 で実装・テスト済みで、
  `ActivityRepository.updateActivity`/`ActivityService.updateActivity` も
  `occurredAtUtc`/`occurredLocalDate`/`occurredLocalTime`/`timezoneOffsetMinutes`/
  `timezoneId` の patch を既に受け付けていた（型 `ActivityUpdateInput` に既存）——
  新規のDB層変更は不要で、UI 層のみの追加で済む
- Android のネイティブダイアログ連鎖・iOS シートの App Lock 対応は record.tsx で
  実装・レビュー済みのロジックであり、そのまま共通化して転用すれば新規リスクを
  増やさずに済む

**却下した案**

- UI/UX §27 Phase 3 行の文言（「§8『Just now』からの日時変更入口」）自体を書き換える
  案——本ファイルの役割（決定・理由の記録、実装中に再議論しないための参照元）に
  すでに合致するため、仕様書本文を書き換えるより本項目を追加する方が変更範囲が
  小さく、経緯も残る

---

## D-51 `health_sync` に `sync_state`（synced/uncertain/declined）を追加し、discard 後の追跡漏れを解消する

（Phase 4 の Settings UI（手動再試行/破棄）実装に着手する前に、`services/
syncJobPlanner.ts` の `planForEdit` と `repositories/HealthSyncJobRepository.ts` の
`discardJob` の両方が「Phase 4 の設計判断として保留」としていた同じ欠落を解消する）

**背景**

§9.3/§10.1 の判定表は「mapping の有無」を2値（あり/なし）として扱っていたが、
実際には「あり」に見える状態が2種類の異なる過去を持ちうる：

- 本当に確定同期した（`SyncWorker` の finalize が成功した、§9.5.1）
- `attempts > 0` のジョブを利用者が「破棄」した——外部に届いたかもしれないが確認できない

同様に「なし」に見える状態にも2種類ある：

- この provider に一度も同期対象になったことがない
- `attempts = 0` のジョブを利用者が「破棄」した——D-35 の明示的な「同期しない」選択

この4状態を2値に潰していたため、次の2つの追跡漏れが起きていた。

1. `attempts > 0` の create/update/recreate ジョブを破棄すると mapping も無いまま
   になり、後で Activity を削除しても `planForDelete(null, false)` が「何もしない」
   （§10.1 順6）と判定し、外部に残っているかもしれないレコードの防御的削除が
   行われない。
2. D-35 で明示的に「同期しない」を選んだ record と、単にこの provider に一度も
   同期対象になったことがない record を区別できず、`planForEdit` は両方を
   「no backfill-on-edit」として扱うほかなかった。

**決定**

`health_sync` に `sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN
('synced','uncertain','declined'))` を追加する（v1 はまだ未リリースのため、D-11
の「一度リリースしたら ALTER TABLE のみ」はまだ適用されず、`SCHEMA_V1_STATEMENTS`
を直接編集した）。あわせて `last_synced_at` を nullable にする——`uncertain`/
`declined` の行は「確認できた同期時刻」を持たない。

`services/syncJobPlanner.ts` の判定は、mapping の有無（boolean）ではなく
`MappingState = 'none' | 'synced' | 'uncertain' | 'declined'`（`'none'` は
行が無い状態）を受け取るように変更する。

| mappingState | `planForEdit`（no job） | `planForDelete`（no job、§10.1 順5/6） | create ジョブの§10.1 順1/2 |
|---|---|---|---|
| `synced` | insert update | insert delete | 順2（touch possible 側） |
| `uncertain` | insert update | insert delete | 順2（touch possible 側） |
| `declined` | noop | noop | 順1 相当（touch not possible 側） |
| `none` | noop | noop | 順1 相当（touch not possible 側） |

`uncertain` は `synced` と同じ側（外部に届いた可能性がある）に、`declined` は
`none` と同じ側（届いていないと確定している）に倒す。`uncertain` を `synced`
と別扱いにしない理由：discard は「もう待たない」という利用者の意思表示であって
「二度と同期しない」という意思表示ではない——D-35 が明示的な opt-out として
確定的な文言を出すのは `attempts = 0`（= `declined`）のときだけで、`uncertain`
の確認文（D-35 の表、create/update/recreate 共通）は「今の内容が一致しなくなる
可能性がある」としか言っていない。したがって次の編集は再同期を試みてよく、
実際に成功すれば `sync_state` は `synced` に戻る。

**この判定を書き込む2箇所**

1. `HealthSyncRepository.upsertMapping`（`SyncWorker` の finalize 成功時）は
   常に `sync_state = 'synced'` を明示的に書く——`ON CONFLICT ... DO UPDATE SET`
   に含め忘れると、`uncertain` だった行が実際に同期成功しても `uncertain` の
   まま残ってしまう（実装前のレビューで指摘され、修正した）。
2. `services/HealthSyncManualActions.discardSyncJob`（新設、Settings「破棄」の
   実体）は、`HealthSyncJobRepository.discardJob`（ジョブ削除のみ）と
   `HealthSyncRepository.upsertDeclinedOrUncertainMapping`（新設）を1トランザ
   クションで束ね、破棄したジョブの `attempts` から `uncertain`/`declined` を
   決める。D-39 のガード（`discardJob` は claim 済みジョブを拒否する）により、
   この時点で `claimed_at` は必ず `NULL` なので、`planForDelete` の一般形
   `externalTouchPossible = attempts > 0 || claimedAt !== null || ...` のうち
   `claimedAt` 項は常に false——ここでは `attempts > 0` だけで判定してよい。
   `delete`/内部不整合（§9.5.3）ジョブの破棄は Activity が既に存在しないため
   （FK RESTRICT）、`health_sync` には触れない。

**`upsertDeclinedOrUncertainMapping` は `external_record_id`/`last_synced_at`
を上書きしない**——`sync_state` だけを変更する。既に `synced` だった mapping が
`uncertain` に落ちても、`external_record_id`（HealthKit では将来の防御的削除に
必要になりうる、§5.4）と `last_synced_at`（「最後に確認できた同期時刻」という
事実）は失わない。新規行（今まで一度も mapping が無かった場合）は両方 `NULL`
のまま——保存すべき値がまだ無い。

**理由**

- discard 確認文（D-35）を変更せずに済む——`uncertain`/`declined` どちらも
  「今の内容が一致しなくなる可能性がある」という同じ文言で正しく、後続の
  delete が取る挙動（防御的削除の有無）だけが内部で変わる。
- `services/syncJobPlanner.ts`/`HealthSyncJobRepository.discardJob` の両方が
  同じ欠落を「Phase 4 の設計判断として保留」としていた——doc comment を
  実装のたびに書き直さず、ここで一度に解消する。

**却下した案**

- discard 時に `health_sync_jobs` へ `not_before = NULL` のまま残す案（ジョブを
  消さない）——D-35 の「破棄」の意味（もう自動再試行しない）と矛盾する上、
  Settings の「未同期の変更」一覧に消えないジョブとして残り続け、D-35 が避けた
  かった「解決済みに見えるが実は違う」状態の逆（未解決に見えるが実は解決済み）
  を作ってしまう。
- `uncertain` を `declined` と同じ側（`planForEdit` で noop）にする案——discard
  は「もう待てない」というワーカーへの意思表示であり、record 自体の同期を
  止める意思表示ではない。同じ側にすると、`uncertain` を `declined` と分けた
  意義が `planForDelete` 側にしか残らず、`sync_state` を分けた意味が半減する。

**受け入れる制約**

`health_sync` は Export に含まれない（D-42、Export の対象は `activities` と
allowlist された settings のみ）。したがって置換復元（D-10/§13.3）を実行すると
`uncertain`/`declined` は失われ、復元後は「一度も同期対象になっていない」
（`none`）に戻る——D-10 の既存の設計（mapping は置換復元で作り直さない）と
整合的なので、意識して受け入れる。

**副次的に確認された事項**

`uncertain` の discard→delete 経路は、`external_record_id = NULL` のまま
Health Connect へ delete を投げる（health_connect は clientRecordId でアドレ
ッシングするため、§5.4）——「存在しない clientRecordId に対する delete」が
通常運用で発生する経路になる。これは D-20 の Android 9〜13 実機検証項目
（README「Phase 4」Known gaps）がカバーすべき対象そのものであり、実機検証の
優先度が上がったことを記録しておく。

---

## 実装着手の前提条件

以下が確定するまで DB を触るコードを書かない。すべて DB ファイル形式かドライバ選定を決めるため。

- [x] D-01 Activity Type の値
- [x] D-02 日時列の構成と精度
- [x] D-03 同期テーブルの分割
- [x] D-05 暗号化とドライバ選定
- [x] D-11 schema version と Migration 方針
- [x] D-18 ワーカーの楽観的並行制御（`revision` / `claimed_at` / claim 時の `attempts` 加算）
- [x] D-19 `sync_version` 列
- [x] D-23 永続モデルの null 契約
- [x] D-28 / D-29 Context・Outcome の分離と `protection_used` 列
- [x] D-32 確定処理の3分岐
- [x] D-34 `operation` に `recreate` を含める（CHECK 制約は後から変えにくい）
- [x] D-37 `app_settings` テーブル（型・既定値・Export allowlist を含む）
- [x] D-39 / D-41 claim guard と破壊的操作の排他制御
- [x] D-42 Export の型境界
### Health Connect ラッパーの検証（v1.0 のゲート）

- [x] **D-04 / D-19 `clientRecordId` と `clientRecordVersion` を露出しているか**
- [x] **D-34 `clientRecordId` を指定した削除 API を露出しているか**
- [x] **D-20 削除時の「存在しない」を成功として扱えるか**
      （Android 14 以降のみソースで確認。Android 9〜13 は未確認のため既知の制限を適用——詳細は D-20 の確認結果を参照）
- [x] **D-41 ネイティブ呼び出しがタイムアウト後も継続するか、明示的に cancel できるか**
      （全経路で cancel 不可と確認。14以降は platform API、9〜13 は androidx の AIDL が根拠——詳細は D-41 の確認結果を参照）

**1・2件目（D-04/D-19・D-34）を満たせない場合は HC 同期の v1.0 投入を見送る。**
**3件目（D-20）を満たせない場合は見送りにはせず、D-20 の「識別できない場合は既知の制限として
受け入れる」を適用する。**
**4件目（D-41）も cancel 不可と確定した。** 見送り条件ではないため v1.0 投入は妨げないが、
D-41 の「in-flight のまま扱う」規則の適用が必須であることが確定した（cancel をサポートする場合
との分岐は実質的に発生しない）。

### HealthKit 実装時の確認（v1.0 のゲートではない）

- [ ] D-40 メタデータ述語による削除が書き込み権限のみで可能か

いずれも **DB 設計には影響しない**ため、Phase 1 は着手できる。

Phase 1 と並行して確定してよいもの：Export JSON schema、Import 仕様、MVP 範囲。
ただし **JSON schema と復元可能性の検証は DB 設計と同時に始める**。
暗号化を採用した以上、復元手段は製品の安全性の一部である。
