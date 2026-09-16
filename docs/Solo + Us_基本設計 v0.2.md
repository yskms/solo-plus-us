# Solo + Us 基本設計 v0.2

作成日：2026-09-16  
前提：要件定義書 v0.2 / 設計判断記録 v0.2  
v0.1 からの変更点と理由は **設計判断記録 v0.2** を参照する。

> 本文と図版が矛盾する場合は本文を正とする。`docs/old/` は検討履歴であり仕様ではない。

---

# 1. 技術構成

```text
React Native + Expo（prebuild / dev client）
        │
        ├─ UI
        │
        ├─ Service
        │
        ├─ Repository
        │
        └─ SQLite（SQLCipher で暗号化）
              │
              ├─ activities
              ├─ health_sync
              └─ health_sync_jobs
```

Android：

```text
App
 ├─ SQLite（暗号化）
 └─ Health Connect（with-health-connect ビルドのみ）
```

iOS：

```text
App
 ├─ SQLite（暗号化）
 └─ HealthKit（v1.2 以降）
```

**SQLite を正本（Source of Truth）とする。**
Health Connect / HealthKit は外部同期先であり、アプリ独自データの代替にはしない。
この方針は iOS でも同じである（HealthKit の sexual activity も Solo / Partnered を区別しない）。

## 1.1 ドライバ選定

| | 採用 | 理由 |
|---|---|---|
| SQLite | `@op-engineering/op-sqlite` | SQLCipher による暗号化が必要。`expo-sqlite` は暗号化を持たない |
| 鍵保管 | `expo-secure-store` | iOS Keychain / Android Keystore |
| 認証 | `expo-local-authentication` | 生体認証と OS デバイス認証フォールバック |

暗号化ドライバを使う以上 **Expo Go では動作しない**。Phase 1 の時点から prebuild / dev client で開発する。

---

# 2. データ設計の原則

数年〜数十年データを保持する前提で、以下を優先する。

- Health Connect 固有仕様に DB を合わせすぎない
- 将来 Activity Type が増えても Migration を最小化する
- 外部同期状態を管理でき、外部 API 障害でローカルデータを失わない
- Export 可能かつ **完全に復元可能** な構造にする
- 日時を後から修正できる
- 削除・復元・再同期を安全に行える
- **表現可能な不正状態を減らす**（制約で塞ぐより、構造上表現できない形にする）

---

# 3. Activity モデル

```ts
// 内部値は「行為の種類」ではなく「相手の有無」で定義する
type ActivityType =
  | 'solo'        // 自分ひとりの性的活動
  | 'partnered';  // 相手のいる性的活動（行為の内容は問わない）

interface Activity {
  id: string;                       // UUID v4

  type: ActivityType;

  occurredAtUtc: string;            // 'YYYY-MM-DDTHH:MM:SSZ' 秒は常に '00'
  occurredLocalDate: string;        // 'YYYY-MM-DD'
  occurredLocalTime: string;        // 'HH:MM'
  timezoneOffsetMinutes: number;
  timezoneId?: string;              // 'Asia/Tokyo'。未確定なら undefined

  durationSeconds?: number;
  ejaculation?: boolean;
  orgasm?: boolean;
  moodBefore?: number;              // 1–5
  moodAfter?: number;               // 1–5
  note?: string;

  createdAt: string;
  updatedAt: string;
}
```

`type` の値は **Export の公開契約として固定**し、以後改名しない。
画面に出す文言は i18n キー（`activityType.solo.label` など）で別管理する。

---

# 4. 日時設計

## 4.1 4つの表現を持つ理由

| 列 | 役割 |
|---|---|
| `occurred_at_utc` | 瞬間の正本。並び替え・間隔計算 |
| `occurred_local_date` | 月次集計・カレンダーの範囲検索（インデックス対象） |
| `occurred_local_time` | 曜日・時間帯集計 |
| `timezone_offset_minutes` | 記録時点のオフセット。表示の再現 |
| `timezone_id` | 将来の再計算用。nullable |

`local = utc + offset` なので冗長だが、常に再計算・検証可能な種類の冗長性である。
Import 時にはこの整合性を検証する。

UTC 単独だと月次集計のたびにオフセット加算が必要でインデックスが効かず、
ローカル単独だと夏時間・端末移動で瞬間が復元できない。

## 4.2 精度

**v1 の入力・表示精度は分単位。`occurred_at_utc` の秒も常に `00` に正規化する。**

UTC 側だけ秒を持つと `occurred_local_time`（`HH:MM`）と精度が食い違い、どちらが正本か曖昧になるため。

## 4.3 日時文字列の不変条件

すべての日時列を `YYYY-MM-DDTHH:MM:SSZ` の**固定長 UTC 表記**とする。
これにより文字列比較がそのまま時系列比較として成立し、`updated_at >= created_at` のような CHECK が意味を持つ。

## 4.4 過去日時を記録・編集する場合

保存するオフセットは、**現在の端末オフセットではなく `timezone_id` におけるその瞬間のオフセット**を計算して入れる。
これを誤ると夏時間を跨ぐ過去記録がずれる。

v1 はタイムゾーン選択 UI を持たないため、旅行先の出来事を帰国後に入力すると現在地のタイムゾーンが適用される。
**これは既知の制限として受け入れる。**

## 4.5 「その日」の境界

現地 00:00 とする。結果として深夜1時の記録は翌日扱いになる。
時間帯統計は日跨ぎを扱えるよう循環ウィンドウで計算する（§14）。

## 4.6 `timezone_id` が NULL の意味

```text
timezone_id != NULL : IANA タイムゾーンが判明している
timezone_id == NULL : オフセットのみ判明（外部 Import 由来など）
```

---

# 5. SQLite スキーマ（schema version 1）

```sql
CREATE TABLE activities (
    id                      TEXT PRIMARY KEY NOT NULL
                              CHECK (length(id) = 36),

    type                    TEXT NOT NULL
                              CHECK (type IN ('solo','partnered')),

    -- 'YYYY-MM-DDTHH:MM:SSZ'（20文字）。秒は常に '00'
    occurred_at_utc         TEXT NOT NULL
                              CHECK (length(occurred_at_utc) = 20),
    occurred_local_date     TEXT NOT NULL
                              CHECK (length(occurred_local_date) = 10),
    occurred_local_time     TEXT NOT NULL
                              CHECK (length(occurred_local_time) = 5),
    timezone_offset_minutes INTEGER NOT NULL
                              CHECK (timezone_offset_minutes BETWEEN -840 AND 840),
    timezone_id             TEXT,

    duration_seconds        INTEGER
                              CHECK (duration_seconds IS NULL
                                     OR (duration_seconds > 0
                                         AND duration_seconds <= 86400)),
    ejaculation             INTEGER CHECK (ejaculation IN (0,1)),  -- NULL = 未記録
    orgasm                  INTEGER CHECK (orgasm      IN (0,1)),  -- NULL = 未記録
    mood_before             INTEGER CHECK (mood_before BETWEEN 1 AND 5),
    mood_after              INTEGER CHECK (mood_after  BETWEEN 1 AND 5),
    note                    TEXT    CHECK (note IS NULL OR length(note) <= 2000),

    created_at              TEXT NOT NULL CHECK (length(created_at) = 20),
    updated_at              TEXT NOT NULL CHECK (length(updated_at) = 20),

    CHECK (updated_at >= created_at)
);

CREATE INDEX idx_activities_local_date ON activities(occurred_local_date);
CREATE INDEX idx_activities_utc        ON activities(occurred_at_utc);
CREATE INDEX idx_activities_type_date  ON activities(type, occurred_local_date);


-- 現在の対応関係のみを保持する。生きている Activity だけが行を持つ。
CREATE TABLE health_sync (
    activity_id        TEXT NOT NULL,
    provider           TEXT NOT NULL
                         CHECK (provider IN ('health_connect','healthkit')),
    external_record_id TEXT,
    last_synced_at     TEXT NOT NULL CHECK (length(last_synced_at) = 20),

    PRIMARY KEY (activity_id, provider),
    FOREIGN KEY (activity_id)
      REFERENCES activities(id)
      ON DELETE RESTRICT
);


-- 未処理ジョブの outbox。FK を持たない（Activity 削除後も残すため）。
CREATE TABLE health_sync_jobs (
    id                 TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    activity_id        TEXT NOT NULL CHECK (length(activity_id) = 36),
    provider           TEXT NOT NULL
                         CHECK (provider IN ('health_connect','healthkit')),
    operation          TEXT NOT NULL
                         CHECK (operation IN ('create','update','delete')),
    external_record_id TEXT,                      -- delete 用。HC は clientRecordId を使う
    not_before         TEXT NOT NULL CHECK (length(not_before) = 20),
    attempts           INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error_code    TEXT,                      -- 内部定義のコードのみ
    created_at         TEXT NOT NULL CHECK (length(created_at) = 20)
);

-- 1 Activity × 1 provider あたり未処理ジョブは常に高々1件
CREATE UNIQUE INDEX uq_health_sync_jobs
  ON health_sync_jobs(activity_id, provider);

CREATE INDEX idx_health_sync_jobs_due
  ON health_sync_jobs(provider, not_before);
```

## 5.1 CHECK 制約の位置づけ

`length()` ベースの CHECK は**形式検証ではなく「長さの番人」**に過ぎない。
`xxxx-yy-zzTaa:bb:ccZ` も20文字なので通る。

したがって：

- **ISO 8601 の厳密なパースとフォーマットは Repository 層で行う**
- **Repository を DB への唯一の入口とする**（UI・Service から生 SQL を呼ばない）
- CHECK は最後の防波堤であり、入力検証の代替ではない
- CHECK は既存行に遡及しないため、**Import 経路には別途アプリ側の検証が必要**

## 5.2 `last_error_code` に生メッセージを入れない理由

OS や外部 API が返すエラー文に何が含まれるか保証がない。
内部で定義した列挙値（`PERMISSION_DENIED` / `UNAVAILABLE` / `RATE_LIMITED` / `UNKNOWN` など）のみを保存する。

## 5.3 NULL と false の区別

```text
ejaculation = NULL  →  記録していない
ejaculation = 0     →  「なかった」と記録した
```

統計上この2つを混同しない。SQLite の `CHECK (x IN (0,1))` は NULL を許すため、この3値がそのまま表現できる。

---

# 6. 接続時設定（DDL とは分離する）

以下は**アプリ起動時に接続ごとに設定・確認する**。初期スキーマ SQL に混ぜない。

```sql
PRAGMA key = '...';          -- SQLCipher。最初に実行する
PRAGMA foreign_keys = ON;    -- 接続ごと。デフォルトは OFF
PRAGMA journal_mode = WAL;   -- 永続設定だが起動時に確認する
```

`PRAGMA foreign_keys` は接続単位の設定であり、これを設定しないと `ON DELETE RESTRICT` が一切効かない。
接続確立処理の中で必ず実行し、テストで検証する。

`user_version` は **Migration runner が成功後に更新する**（§7）。初期スキーマ SQL に固定値を書かない。

---

# 7. Migration

## 7.1 方針

- `PRAGMA user_version` で管理し、「番号 → 手続き」の配列として前方向のみ適用する
- ダウングレードは実装しない。アプリのバージョンダウン時は **DB を開かずにエラー表示**する
- 破壊的変更を禁止する。列追加は `ALTER TABLE ADD COLUMN` のみ。
  改名・型変更は新テーブル作成 → コピー → 差し替えをトランザクション内で行う

## 7.2 Migration 前のバックアップ

**DB 本体の単純なファイルコピーをバックアップとしない。**
`journal_mode=WAL` では未チェックポイントのデータが `-wal` ファイル側にあり、本体だけのコピーは不完全になりうる。

```text
1. 書き込みを停止する
2. チェックポイント完了後の整合した状態を取得する
   （SQLite Online Backup 相当 / VACUUM INTO 等。SQLCipher での動作を実装時に検証する）
3. Migration をトランザクション内で実行する
4. 成功 → バックアップを削除
   失敗 → バックアップから復元し、起動を継続してエラーを表示する
```

バックアップファイルは：

- アプリ専有領域に置く
- **OS バックアップ除外の対象に含める**
- SQLCipher で暗号化されたセンシティブデータとして扱い、成功・失敗いずれの場合も残さない

---

# 8. 暗号化と鍵管理

## 8.1 暗号化

SQLCipher で DB を暗号化する（MVP 要件）。

## 8.2 鍵

```text
初回起動時に32バイト乱数を生成
        ↓
expo-secure-store に保存（requireAuthentication は使わない）
        ↓
起動ごとに読み出して PRAGMA key に渡す
```

**`requireAuthentication: true` を使わない。**
生体情報の追加・変更で保存値が読めなくなる場合があり、DB 暗号鍵がこれに該当すると
正当な利用者でも DB を永久に復号できなくなる。

## 8.3 App Lock との分離

```text
DB 暗号鍵         : データが読めるかどうか       （SecureStore・認証なし）
App Lock          : 画面を表示してよいかどうか   （expo-local-authentication）
```

この2つの状態を結合しない。App Lock はアプリ起動・復帰時のゲートであり、データの可読性とは無関係とする。

## 8.4 プラットフォーム差を前提にしない

iOS の Keychain 値は同一 Bundle ID の再インストール後も残る場合があるが、Android ではアンインストールで失われる。
**両者が同じ挙動をすると仮定した設計にしない。**

## 8.5 鍵が復元できない場合（新規画面）

「DB ファイルは存在するが鍵が読み出せない」状態は、Android のバックアップ復元や端末移行で現実に起こりうる。

```text
起動 → 鍵の読み出し失敗 → 復号テスト失敗
        ↓
クラッシュせず、専用画面を表示する

  このデバイスではデータを復号できません。

  [ バックアップから復元する ]   → Import 画面へ
  [ データを削除してやり直す ]   → 確認のうえ DB を破棄
```

黙ってクラッシュループに入る実装にしない。

## 8.6 OS バックアップからの除外

- Android: `allowBackup=false`
- iOS: DB ファイルに `isExcludedFromBackup` を設定

**検証対象は2つある。**

1. SecureStore 内の鍵がバックアップされないこと
2. SQLCipher DB 本体もバックアップ／端末転送の対象外であること

SecureStore は Android 側で自動除外されるが、アプリ DB 全体の除外はこれとは別問題である。

**帰結：端末紛失＝全データ喪失。Export / Import が唯一の復旧手段になる。**

## 8.7 ログ

- Activity の内容をログ・クラッシュレポートに出さない
- v1 ではクラッシュレポート SDK・Analytics SDK を導入しない
- 送信するとしても `screen_opened` 程度のセンシティブ情報を含まないイベントに限る

---

# 9. Health Connect 同期設計

## 9.1 テーブルの役割分担

```text
health_sync        現在の対応関係だけを持つ
                   生きている Activity のみが行を持つ（FK RESTRICT）

health_sync_jobs   作業指示だけを持つ
                   Activity の生死と無関係（FK なし）
```

この分離により「Activity が存在しないのに create 待ち」のような不整合が**構造上表現できなくなる**。

## 9.2 ジョブはペイロードを持たない

ワーカーは送信時に `activities` を読んで最新値を送る。

- `create` と `update` の合流が自明になる（create のまま、送信時に最新値を読む）
- stale payload 問題が発生しない
- `delete` のみ Activity が存在しないため、必要な識別子をジョブ自身が保持する

## 9.3 ジョブ合流規則

`UNIQUE (activity_id, provider)` により、ジョブ登録時は必ず既存ジョブとの合流を判断する。

| 既存ジョブ | health_sync | 新イベント | 結果 |
|---|---|---|---|
| なし | なし | 記録 | `create` を追加 |
| なし | あり | 編集 | `update` を追加 |
| なし | あり | 削除 | `delete` を追加 |
| `create` | なし | 編集 | `create` のまま（送信時に最新値を読む） |
| `create` | なし | 削除 | **ジョブを削除**（外部に未書き込み） |
| `update` | あり | 編集 | `update` のまま |
| `update` | あり | 削除 | `delete` に置換 |
| `delete` | — | — | 発生しない（Activity が存在しない） |

## 9.4 冪等性（clientRecordId）

Health Connect の `Metadata.clientRecordId` に `activity.id` を設定する。削除も clientRecordId で引く。

```text
activity.id  ──→  Health Connect clientRecordId
```

これにより create が upsert 相当になり、
**「外部への書き込み成功後・ローカル保存前にプロセスが落ちて二重登録される」窓が消える。**

`external_record_id` 列は HealthKit と診断用に残すが、**HC の主たるアドレッシングは clientRecordId** とする。

> **実装前の確認事項**
> 使用するラッパーが `clientRecordId` と削除時の client record id 指定を露出しているかを確認する。
> 露出していない場合、**HC 同期の v1.0 投入を見送る。**

## 9.5 リトライ

```text
ワーカーは provider ごとに単一で動く
  ↓
not_before <= now のジョブを1件ずつ処理
  ↓
成功 → health_sync を upsert し、ジョブを削除（同一トランザクション）
      delete 成功 → health_sync 行も削除済みなのでジョブ削除のみ
  ↓
失敗 → attempts += 1
      last_error_code を記録
      not_before = now + backoff(attempts)
  ↓
attempts が上限（10）を超えたら not_before を遠い未来にし、
「手動再試行待ち」として設定画面に出す
```

バックオフは指数（例：5s, 15s, 1m, 5m, 15m, 1h, 6h, 24h …）。

## 9.6 記録と同期の関係

```text
recordActivity()
      │
      ├─ SQLite 保存           ← ここが成功すれば記録は成功
      │
      └─ health_sync_jobs へ create を登録（not_before = now + 5s）
```

**SQLite 保存の成功をもって Activity 作成成功とする。**
Health Connect 同期の失敗で Activity 記録自体を失敗させない。UI は同期の完了を待たない。

## 9.7 v1 の既知の制限

- Health Connect 側でユーザーが手動削除しても、v1 は HC を読まないため検知できない
- 置換復元（§13）を実行すると `health_sync` の対応関係は破棄され、HC 上の既存レコードは残る

## 9.8 リリースビルドの分離

feature flag では審査要件を回避できない。**Manifest 自体を切り替える。**

```text
without-health-connect : health 権限を Manifest に含めない
with-health-connect    : 権限とネイティブモジュールを含む
```

配布 AAB の Manifest に `WRITE_SEXUAL_ACTIVITY` が含まれていれば、
アプリ内で機能を OFF にしていても Health apps declaration と Play Console でのデータ型説明が必要になる。
`SexualActivityRecord` は Reproductive and Sexual Health に属する。

Expo の build profile / app config / config plugin で権限の有無を切り替え、
`without-health-connect` ビルドでは HC 関連モジュールを実行時に参照しないようガードする。

---

# 10. 削除フロー

## 10.1 トランザクション

```text
BEGIN
  1. health_sync から external_record_id を読む
  2. health_sync_jobs へ delete job を作成（識別子をコピー）
  3. health_sync の行を削除
  4. activities の行を削除      ← RESTRICT があるので 3 の後でなければ失敗する
COMMIT
```

`ON DELETE RESTRICT` は「消し忘れ」を実行時エラーにするための安全装置であり、
削除手順を必ずこの順序に強制する。

## 10.2 ローカル削除は常に即時成功させる

外部削除の失敗で画面上の削除を巻き戻さない。失敗したジョブは outbox に残り、バックオフで再試行される。

## 10.3 未同期の変更の可視化

```text
Settings → Health Connect

  未同期の変更            3件
  [ 今すぐ再試行 ]
```

Today や Insights には同期エラーを出さない（記録画面に外部同期の失敗を持ち込まない）。

## 10.4 Health Connect 接続を OFF にするとき

未処理の delete job が残っている場合は警告する。

```text
Health Connect に未反映の削除が 2 件あります。

切断すると、これらの記録は Health Connect 上に残ります。

[ 先に処理する ]   [ このまま切断する ]
```

黙って切断すると外部に永久に残るため、必ず選択させる。

---

# 11. 記録フロー

## 11.1 Quick Record

```text
Today
 │
 │ ＋
 ↓
Add Activity（Bottom Sheet）
 │
 ├─ Solo
 │
 └─ Partnered
 │
 ↓
即保存（SQLite）
 │
 ├─ Sheet を閉じる
 ├─ Today 更新
 ├─ Snackbar 表示
 └─ 同期ジョブ登録（not_before = now + 5s）
```

**詳細入力画面を経由しない。** 基本記録は2アクション以内で完了する。

## 11.2 Undo

同期遅延と Snackbar 表示を分離する。

| | 値 | 根拠 |
|---|---|---|
| 同期遅延 | **記録時刻 + 5秒固定**（`not_before`） | 永続キューの時刻列なので、プロセスが kill されても失われない |
| Undo 可能期間 | **Snackbar 表示中** | 画面遷移で Snackbar が消えたら Undo も終了する。`not_before` は変更しない |

- Undo 対象は直前の1件のみ。冪等に実装する
- Undo 実行時：`activities` を物理削除し、未送信の create job を削除する
- Snackbar が消えてから `not_before` までの数秒は「Undo できないが未同期」という状態になるが、無害である

タイマーで同期をキャンセルする方式は採らない。アプリが即座に kill されると遅延が失われ、同期されてしまう。

## 11.3 記録直後に編集された場合

`create` ジョブのまま、送信時に最新値を読む（§9.2）。`create → update` の2ジョブにしない。

## 11.4 過去日時への記録

Add Activity の「Just now」から日時変更に入る。オフセットの決定規則は §4.4 に従う。

---

# 12. Export

## 12.1 形式の役割分担

```text
JSON : バックアップ／復元の正本（全列・可逆・schema version 付き）
CSV  : 分析用の一方向エクスポート（Import 対象外）
```

CSV を復元経路に含めると、タイムゾーンや `created_at` の表現・解釈を CSV 側でも定義する必要が生じ、仕様面積が倍になる。

## 12.2 JSON

```json
{
  "version": 1,
  "exportedAt": "2026-09-16T14:20:00Z",
  "activities": [
    {
      "id": "…",
      "type": "solo",
      "occurredAtUtc": "2026-09-14T14:42:00Z",
      "occurredLocalDate": "2026-09-14",
      "occurredLocalTime": "23:42",
      "timezoneOffsetMinutes": 540,
      "timezoneId": "Asia/Tokyo",
      "durationSeconds": null,
      "ejaculation": null,
      "orgasm": null,
      "moodBefore": null,
      "moodAfter": null,
      "note": null,
      "createdAt": "2026-09-14T14:42:03Z",
      "updatedAt": "2026-09-14T14:42:03Z"
    }
  ]
}
```

`health_sync` / `health_sync_jobs` は**エクスポートしない**（端末固有の同期状態であり、復元しても意味がない）。

## 12.3 CSV

人間と表計算が読むための形式。ローカル日時を可読形式で含める。

```csv
id,type,occurredLocalDate,occurredLocalTime,occurredAtUtc,timezoneOffsetMinutes,timezoneId,durationSeconds,ejaculation,orgasm,moodBefore,moodAfter,note
```

## 12.4 ファイルの扱い

- アプリの cache ディレクトリに書き、共有シート経由で渡す
- 共有後に一時ファイルを削除する
- 共有先で平文になることを画面上で明示する
- パスフレーズ付き暗号化 Export は v1.1 で検討する

---

# 13. Import（strict restore）

## 13.1 原則

v1 の JSON Import は **strict restore のみ**とする。行単位スキップ（tolerant import）は実装しない。

| ルール | 内容 |
|---|---|
| `id` | **必須**。持たない JSON は不正データとして拒否する |
| 重複排除 | **推測による自動重複排除を行わない**。同一性判定は `id` のみ |
| 不正行 | **1件でもあれば確定しない**（全体を中止し、理由と件数を表示） |
| トランザクション | 全件検証 → プレビュー → **単一トランザクションで確定** |
| version | `version <= 現行` のみ受理。未来バージョンは明示的に拒否 |
| HC 再同期 | **既定 OFF**（明示同意制） |

**重複排除をしない理由：** 同時刻に2件記録される場合や、重複記録自体が意図的である場合があり、
`(type, occurred_at_utc)` 一致による自動マージは正当なデータを失う。

**行単位スキップをしない理由：** バックアップ復元で「3件だけ欠落」は、理由を表示しても危険。
完全性が要求される場面では全体を失敗させる方が安全である。

## 13.2 モード

```text
置換復元（既定）  現在の全データを破棄し、Import 内容で置き換える
                  → 機種変更・復旧の主用途

追加のみ          id が未存在のものだけ追加する。既存 id は変更しない
                  → 取りこぼしの補完
```

**`updated_at` による last-writer-wins は採用しない。**
`updated_at` はローカル端末時計に依存するため端末間で信頼できず、
また別端末の古いバックアップから削除済みデータが復活する。

自動的な双方向マージに近づけると削除 tombstone と端末識別が必要になり、仕様が急激に大きくなる。

## 13.3 置換復元の手順

```text
1. 現在のデータを自動でセーフティ Export し、保存先を画面に表示する
2. Import ファイルを全件検証する
3. プレビューを表示する
     12,431 件を読み込みます
     現在の 8,902 件は置き換えられます
4. 単一トランザクションで実行
     - health_sync_jobs を全削除
     - health_sync を全削除
     - activities を全削除
     - Import 内容を挿入
```

**既知の制限：** 置換復元により `health_sync` の対応関係は破棄され、Health Connect 上の既存レコードは残る。
実行前に警告する。

## 13.4 検証項目

DB の CHECK は既存行に遡及せず形式検証もしないため、**Import 経路には独立した検証を置く**。

- `id` が UUID 形式であること・ファイル内で重複しないこと
- `type` が既知の値であること
- 日時が ISO 8601 としてパースでき、固定長 UTC 表記に正規化できること
- `occurredLocalDate` / `occurredLocalTime` が `occurredAtUtc + offset` と一致すること
- 数値範囲（mood 1–5、duration > 0 など）
- `updatedAt >= createdAt`

## 13.5 完成条件

**Export → アンインストール → 再インストール → Import で全件・全列が一致すること**を E2E テストとする。
Export/Import の UI 実装は後回しでよいが、**JSON schema と復元可能性の検証は DB 設計と同時に始める。**
暗号化を採用した以上、復元手段は製品の安全性の一部である。

---

# 14. 統計の定義

計算方法によって値が変わるため、Statistics Service の仕様として固定する。

| 項目 | 定義 |
|---|---|
| 平均間隔 | `(最新 − 最古) ÷ (件数 − 1)`。期間端の空白は含めない。**2件未満は「—」** |
| 同日複数 | 別件として数える（記録された事実を丸めない） |
| Solo / Partnered | 合算が既定。内訳は別セクションに表示 |
| 曜日・時間帯 | `occurred_local_*` 列で判定。後からタイムゾーンを変えても過去の曜日は動かない |
| 最頻曜日 | 最低10件。同率首位が2つなら**併記**、3つ以上なら「—」 |
| 最頻時間帯 | **1時間刻みの循環3時間ウィンドウを24通り評価し、最大の窓を採用。同数なら開始時刻が早い方** |
| 「今月」 | ローカル暦月 |

## 14.1 時間帯を循環ウィンドウにする理由

固定3時間バケット（`21–24` / `0–3`）では `10 PM – 1 AM` のような日跨ぎの結果を原理的に出せない。
24通りの候補窓を評価すれば、開始時刻に制約されずに実態を表せる。

## 14.2 同率首位を併記する理由

「表示しない」は情報を失う。件数が十分あるうえでの同率は事実であり、事実は記述してよい。
ただし評価はしない。

---

# 15. Navigation と画面一覧

```text
┌────────┬──────────┬─────────┐
│ Today  │ Calendar │ Insights│
└────────┴──────────┴─────────┘
```

Settings は Today 右上。記録は Today 右下の FAB。

v1.0 の画面：

```text
01 Splash
02 Privacy Introduction
03 Today
04 Add Activity（Bottom Sheet）
05 Activity Detail
06 Calendar
07 Insights
08 Settings
09 Health Connect Settings
10 App Lock Settings
11 Data（Export / Import / Delete）
12 Recovery（復号不能時）        ← v0.2 で追加
```

---

# 16. ディレクトリ構成

```text
app/
├─ _layout.tsx
├─ (tabs)/
│  ├─ _layout.tsx
│  ├─ index.tsx
│  ├─ calendar.tsx
│  └─ insights.tsx
├─ activity/
│  └─ [id].tsx
├─ record.tsx
├─ recovery.tsx
├─ onboarding/
│  ├─ index.tsx
│  └─ privacy.tsx
└─ settings/
   ├─ index.tsx
   ├─ health-connect.tsx
   ├─ app-lock.tsx
   ├─ data.tsx
   └─ about.tsx

database/
├─ connection.ts          -- PRAGMA 設定を含む接続確立
├─ key.ts                 -- SecureStore からの鍵取得・生成
├─ migrations/
│  ├─ index.ts            -- Migration runner（user_version 管理）
│  └─ 001_initial.ts
└─ schema.ts

repositories/
├─ ActivityRepository.ts
├─ HealthSyncRepository.ts
└─ HealthSyncJobRepository.ts

services/
├─ ActivityService.ts
├─ HealthConnectService.ts
├─ SyncWorker.ts
├─ StatisticsService.ts
├─ ExportService.ts
└─ ImportService.ts

types/
├─ Activity.ts
└─ HealthSync.ts
```

---

# 17. Repository / Service の責務

## ActivityRepository

```text
create()
update()
delete()
findById()
findByDateRange()
findRecent()
countByDateRange()
```

**Repository を DB への唯一の入口とする。** UI・Service から生 SQL を呼ばない。
ISO 8601 のパースと正規化、ローカル日時列の導出はここで行う。

## ActivityService

```text
recordActivity()
updateActivity()
deleteActivity()
undoLastRecord()
```

SQLite 保存と同期ジョブ登録を1つのトランザクションで束ねる。

## SyncWorker

`not_before` を過ぎたジョブを provider ごとに単一で処理する。UI をブロックしない。

---

# 18. 開発順序

```text
Phase 1  暗号化 DB 接続 → Migration runner → スキーマ
         → ActivityRepository → Quick Record → Undo → 履歴
         → Export/Import の schema 定義と往復テスト

Phase 2  Calendar → 月次統計 → Activity Detail（詳細項目）

Phase 3  Insights（合計・内訳・平均間隔）
         → App Lock → Recovery 画面 → 画面マスク
         → Export / Import の UI

Phase 4  Health Connect（clientRecordId 確認 → 同期 → リトライ → 削除同期）
         → Health apps declaration 提出
         → ストア申請
```

v0.1 から順序を変更した。**暗号化と復元可能性を Phase 1 に置く**（後付けできないため）。
Health Connect を最後に置くことで、審査をリリースのクリティカルパスから外せるようにする。

---

# 19. MVP でやらないこと

アカウント / 独自クラウド / SNS / Community / NoFap / streak / Porn 管理 / AI アドバイス /
医療診断 / パートナー共有 / Push 通知 / 広告 / Wear OS / Apple Watch / 詳細な Health 相関分析 /
双方向同期 / 独自 PIN / tolerant import

---

# 20. 開発上の最重要ルール

### Rule 1
Activity の保存は常にローカル DB を最優先する。

### Rule 2
外部 API 障害で Activity を失わない。

### Rule 3
Solo / Partnered の区別を外部 Health 仕様に依存させない。

### Rule 4
過去データとの互換性を最優先する。

### Rule 5
Activity 記録の操作数を増やさない。

### Rule 6（v0.2 で追加）
**不正状態は制約で塞ぐより、構造上表現できないようにする。**

### Rule 7（v0.2 で追加）
**復元手段を機能ではなく安全性の一部として扱う。** Export/Import が壊れた状態でリリースしない。

---

# 21. MVP の完成定義

```text
アプリを開く → ＋ → Solo / Partnered → 記録完了
```

そして翌月・翌年・10年後に「いつ・何を・何回」が正確に振り返れること。

加えて v0.2 では以下を完成条件に含める。

- **Export → 再インストール → Import で全件・全列が一致すること**
- **鍵が復元できない状態でアプリがクラッシュループに入らないこと**
- **生体認証を無効にした端末でも App Lock を解除できること**

---

# 22. プロダクトの最終判断基準

> 「この機能は、長期間・気軽に自分の intimate life を記録して振り返るために必要か？」

必要でなければ追加しない。

本アプリの強みは機能数ではなく、
**記録が簡単で、データが自分のものであり、何年経っても残っていること。**
