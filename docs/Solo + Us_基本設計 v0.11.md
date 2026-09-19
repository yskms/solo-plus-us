# Solo + Us 基本設計 v0.11

作成日：2026-09-16  
前提：要件定義書 v0.11 / 設計判断記録 v0.11  
v0.1 からの変更点と理由は **設計判断記録 v0.11** を参照する。

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

## 3.1 Context と Outcome を分ける

Activity は「誰といたか（Context）」と「何が起きたか（Outcome）」を分けて持つ。

```text
Activity
│
├─ Context           solo / partnered        ← 必須
├─ 日時                                       ← 必須
│
├─ Outcome（すべて任意）
│   ├─ orgasm
│   ├─ ejaculation
│   └─ protectionUsed
│
└─ Optional context（すべて任意）
    ├─ durationSeconds
    ├─ moodBefore / moodAfter
    └─ note
```

v0.2 までの `type` を **`context` に改名した。値（`solo` / `partnered`）は変えない。**
「行為の種類ではなく相手の有無」という D-01 の定義に、名前の方を合わせるための改名である。

## 3.2 型定義

```ts
type ActivityContext = 'solo' | 'partnered';

interface Activity {
  id: string;                       // UUID v4
  context: ActivityContext;

  occurredAtUtc: string;            // 'YYYY-MM-DDTHH:MM:SSZ' 秒は常に '00'
  occurredLocalDate: string;        // 'YYYY-MM-DD'
  occurredLocalTime: string;        // 'HH:MM'
  timezoneOffsetMinutes: number;
  timezoneId: string | null;

  // Outcome
  orgasm: boolean | null;
  ejaculation: boolean | null;
  protectionUsed: boolean | null;

  // Optional context
  durationSeconds: number | null;
  moodBefore: number | null;        // 1–5
  moodAfter: number | null;         // 1–5
  note: string | null;

  syncVersion: number;              // 外部同期用の単調増加カウンタ（§9.4）
  createdAt: string;
  updatedAt: string;
}
```

`context` の値は **Export の公開契約として固定**し、以後改名しない。
画面に出す文言は i18n キー（`activityContext.solo.label` など）で別管理する。

## 3.3 optional ではなく `| null` を使う理由

**永続モデルでは `?:` を使わない。** `| null` を明示する。

optional のままだと、

```text
JSON にキーがない
JSON に null がある
JavaScript 上で undefined
```

の3つが区別できず、strict restore の契約が書けない。したがって契約を次のように定義する。

> **キーの欠落は不正。未記録は `null`。**

## 3.4 Outcome を統計に昇格させない

Orgasm / Ejaculation / Protection は**記録・表示・Export の対象とするが、Insights の指標にしない。**
割合・率・達成度としての集計を行わない。

`orgasm rate 62%` のような指標は達成率のスコアカードとして読まれ、
UI/UX §16 の「ユーザーを評価しない」に正面から抵触する。

```text
Context（Solo / Partnered） : 集計してよい
Outcome                     : 集計しない
```

Insights が扱うのは「いつ・どれだけ・どの間隔で」であり、「うまくいったか」ではない。

## 3.5 性別を保存しない

アプリは利用者の性別を尋ねず、保存しない。
項目の出し分けは性別の推定ではなく、**利用者自身が表示項目を選ぶ方式**で行う（要件定義書 §6.3）。

持たないデータは漏れない。D-05 の脅威モデルに対して、これは暗号化と同列の**データ最小化**である。

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

ユーザーが切り替え時刻（例: 4:00）を設定可能にする場合の設計方針は
設計判断記録 D-49 を参照。着手時期・MVP 範囲は未定だが、
`occurred_local_date` を書き換えない前提が先に固定されている。

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

    context                 TEXT NOT NULL
                              CHECK (context IN ('solo','partnered')),

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

    -- Outcome（NULL = 未記録、0 = なかったと記録、1 = あったと記録）
    orgasm                  INTEGER CHECK (orgasm          IN (0,1)),
    ejaculation             INTEGER CHECK (ejaculation     IN (0,1)),
    protection_used         INTEGER CHECK (protection_used IN (0,1)),

    -- Optional context
    duration_seconds        INTEGER
                              CHECK (duration_seconds IS NULL
                                     OR (duration_seconds > 0
                                         AND duration_seconds <= 86400)),
    mood_before             INTEGER CHECK (mood_before BETWEEN 1 AND 5),
    mood_after              INTEGER CHECK (mood_after  BETWEEN 1 AND 5),
    note                    TEXT    CHECK (note IS NULL OR length(note) <= 2000),

    -- 外部同期用の単調増加カウンタ（§9.4）
    sync_version            INTEGER NOT NULL DEFAULT 1 CHECK (sync_version >= 1),

    created_at              TEXT NOT NULL CHECK (length(created_at) = 20),
    updated_at              TEXT NOT NULL CHECK (length(updated_at) = 20),

    CHECK (updated_at >= created_at)
);

CREATE INDEX idx_activities_local_date   ON activities(occurred_local_date);
CREATE INDEX idx_activities_utc          ON activities(occurred_at_utc);
CREATE INDEX idx_activities_context_date ON activities(context, occurred_local_date);


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
                         CHECK (operation IN ('create','update','delete','recreate')),
    external_record_id TEXT,

    -- 楽観的並行制御（§9.5）。行を変更するたびに +1 する
    revision           INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    -- ワーカーが取得した時刻。NULL = 未取得
    claimed_at         TEXT,
    -- NULL = 手動再試行待ち（sentinel を使わない）
    not_before         TEXT,
    -- 外部呼び出しを「開始」した回数。> 0 なら外部に到達した可能性がある
    attempts           INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error_code    TEXT,
    created_at         TEXT NOT NULL CHECK (length(created_at) = 20)
);

-- 1 Activity × 1 provider あたり未処理ジョブは常に高々1件
CREATE UNIQUE INDEX uq_health_sync_jobs
  ON health_sync_jobs(activity_id, provider);

-- 実行待ちのジョブだけを対象にする partial index
CREATE INDEX idx_health_sync_jobs_due
  ON health_sync_jobs(provider, not_before)
  WHERE claimed_at IS NULL AND not_before IS NOT NULL;


-- アプリ設定。暗号化 DB の中に置く（§5.5）
CREATE TABLE app_settings (
    key        TEXT PRIMARY KEY NOT NULL CHECK (length(key) > 0),
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL CHECK (length(updated_at) = 20)
);
```

## 5.1 CHECK 制約の位置づけ

`length()` ベースの CHECK は**形式検証ではなく「長さの番人」**に過ぎない。
`xxxx-yy-zzTaa:bb:ccZ` も20文字なので通るし、`length(id) = 36` は UUID を保証しない。

したがって：

- **ISO 8601 の厳密なパースと UUID v4 の検証は Repository 層で行う**
- **Repository を DB への唯一の入口とする**（UI・Service から生 SQL を呼ばない）
- CHECK は最後の防波堤であり、入力検証の代替ではない
- CHECK は既存行に遡及しないため、**Import 経路には別途アプリ側の検証が必要**（§13.4）

## 5.2 `last_error_code` に生メッセージを入れない理由

OS や外部 API が返すエラー文に何が含まれるか保証がない。
内部で定義した列挙値（`PERMISSION_DENIED` / `UNAVAILABLE` / `NOT_FOUND` / `RATE_LIMITED` / `UNKNOWN`）のみを保存する。

## 5.3 NULL と false の区別

```text
ejaculation = NULL  →  記録していない
ejaculation = 0     →  「なかった」と記録した
```

統計上この2つを混同しない。`CHECK (x IN (0,1))` は NULL を許すため、この3値がそのまま表現できる。

## 5.4 `external_record_id` の意味は provider ごとに異なる

| provider | 意味 |
|---|---|
| `health_connect` | **null 可。** clientRecordId（= `activity_id`）でアドレッシングするため必須ではない |
| `healthkit` | **保持する。** SyncIdentifier で upsert はできるが、READ 権限に依存せず確実に削除するため、保存時に得た外部 UUID も持つ |

「mapping 行が存在する = 外部にレコードが存在すると考えてよい」という点は両者共通だが、
**何を使って引くかは provider ごとに違う。**

HealthKit でメタデータ述語による削除が書き込み権限のみで可能かは、
**HealthKit 実装時に検証する**。可能であれば `external_record_id` への依存を減らせる。

## 5.5 設定を暗号化 DB の中に置く

アプリ設定は `app_settings` に保存する。**平文の AsyncStorage に置かない。**

保存する設定：

```text
activityDetails.orgasm          表示 ON/OFF
activityDetails.ejaculation     表示 ON/OFF
activityDetails.protection      表示 ON/OFF
activityDetails.duration        表示 ON/OFF
activityDetails.mood            表示 ON/OFF
activityDetails.note            表示 ON/OFF

appLock.enabled
appLock.timing
preferences.firstDayOfWeek
preferences.timeFormat
preferences.appearance

healthConnect.enabled
healthConnect.lastSyncedAt
```

### 理由

**「Ejaculation を表示する」という選択自体がセンシティブである。**
何を記録対象にしているかは、記録内容そのものに近い情報を漏らす。

これは Activity Details のために増えた設計ではない。
First Day of Week / Time Format / Appearance / App Lock は既に v1.0 の設定項目であり、
保存先の設計は元々必要だった。Activity Details が追加するのは **boolean 6個のキー**だけである。

### 型・既定値・Export 対象

| Key | 型 | 既定値 | Export |
|---|---|---|:---:|
| `activityDetails.orgasm` | boolean | `true` | ● |
| `activityDetails.ejaculation` | boolean | `false` | ● |
| `activityDetails.protection` | boolean | `false` | ● |
| `activityDetails.duration` | boolean | `false` | ● |
| `activityDetails.mood` | boolean | `false` | ● |
| `activityDetails.note` | boolean | `true` | ● |
| `preferences.firstDayOfWeek` | enum(`monday`/`sunday`) | 初回に locale から解決した具体値 | ● |
| `preferences.timeFormat` | enum(`12h`/`24h`) | 初回に locale から解決した具体値 | ● |
| `preferences.appearance` | enum(`system`/`light`/`dark`) | `system` | ● |
| `appLock.enabled` | boolean | `false` | — |
| `appLock.timing` | enum(`immediately`/`1m`/`5m`) | `immediately` | — |
| `healthConnect.enabled` | boolean | `false` | — |
| `healthConnect.lastSyncedAt` | ISO8601 \| null | `null` | — |

### `firstDayOfWeek` に `locale` という値を保存しない

**初回起動時に解決した具体値（`monday` / `sunday`）を保存する。**

`locale` を値として持つと、端末のロケール変更でカレンダーの並びが黙って変わる。
10年単位のログでは、表示が安定している方が分かりやすい。
設定画面には常に具体値を表示するため、利用者は現在の設定を確認できる。

### 型安全性

key-value は型が弱いため、**SettingsRepository でキーごとの型を持つ薄いラッパーを被せる**。
UI から `app_settings` を直接読み書きしない。

Export 対象の判定は、この表の `Export = ●` を**明示的なキー一覧の定数**として持つ（§12.2.1）。
ワイルドカードで判定しない。

### `last_synced_at` と `healthConnect.lastSyncedAt` は別物

| | 単位 | 用途 |
|---|---|---|
| `health_sync.last_synced_at` | **Activity ごと** | その記録が最後に同期された時刻 |
| `healthConnect.lastSyncedAt` | **全体で1つ** | 設定画面の「Last synced」表示用 |

前者は同期の正しさに関わり、後者は表示のためだけに存在する。混同しない。

### App Lock 設定との循環に注意

App Lock の設定が暗号化 DB 内にあるため、**復号できないときは App Lock の要否が分からない。**

したがって **Recovery 画面（§8.5 / §8.8）は App Lock を経ずに到達可能とする。**
読めない DB に守るべきデータはないため、これは妥当である。

---

# 6. 接続時設定（DDL とは分離する）

以下は**アプリ起動時に接続ごとに設定・確認する**。初期スキーマ SQL に混ぜない。

| 設定 | 単位 | 備考 |
|---|---|---|
| 暗号鍵 | 接続ごと | **ライブラリの API で鍵を渡す** |
| `foreign_keys = ON` | 接続ごと | 既定は OFF。設定しないと `ON DELETE RESTRICT` が一切効かない |
| `journal_mode = WAL` | 永続 | 永続設定だが起動時に確認する |

## 6.1 鍵の渡し方

**鍵を SQL 文字列へ埋め込まない。** ライブラリが提供する鍵指定 API を使う。

```text
NG : db.execute("PRAGMA key = '" + key + "'")
OK : open({ name, encryptionKey: key })   ※ API 名はライブラリに従う
```

文字列連結の実装例をドキュメントに残すと、そのままコピーされる。
鍵がクエリログやエラーメッセージに乗る経路を最初から作らない。

## 6.2 起動時にジョブの claim を解除する

ワーカーはプロセス内で単一に動くため、**起動時点で処理中のジョブは存在し得ない。**

```sql
UPDATE health_sync_jobs SET claimed_at = NULL WHERE claimed_at IS NOT NULL;
```

クラッシュで `claimed_at` が残ったままのジョブを復帰させる。
`attempts` は claim 時に加算済みなので、「外部へ到達したかもしれない」情報は失われない（§9.5）。

### この一律解除が成立する前提

> **v1 の同期ワーカーは、フォアグラウンドの単一プロセス・単一 runtime 内でのみ動作する。**
> バックグラウンドタスク（Headless JS / WorkManager / BGTaskScheduler 等）は使用しない。

複数 runtime が並行しうる構成では、**実行中の claim を別 runtime が解除してしまう。**

将来バックグラウンド同期を追加する場合、起動時の一律解除をやめ、**lease 期限方式**へ変更する。

```sql
-- 将来の方式（v1 では実装しない）
UPDATE health_sync_jobs
   SET claimed_at = NULL
 WHERE claimed_at < :now_minus_lease_timeout;
```

## 6.3 `user_version`

**Migration runner が成功後に更新する**（§7）。初期スキーマ SQL に固定値を書かない。

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

## 8.8 Recovery 専用の bootstrap 経路

§8.5 の画面から Import へ進むとき、**通常の Import フローは使えない。**
既存 DB が復号できない以上、通常の起動処理・接続確立・Repository はいずれも成立しないためである。

そのままだと「Import するには DB を開く必要があり、DB を開くには復号が必要」という循環に陥る。
したがって Recovery は**通常経路から独立した bootstrap** として実装する。

```text
1. 復号できない DB 接続を閉じる
2. 新しい暗号鍵と一時 DB を作る
3. Import を一時 DB へ全件投入し、検証する
4. 一時 DB を閉じ、新しい鍵で開き直して復号と件数を確認する
5. 旧 DB を退避する（この時点でも削除しない）
6. 一時 DB を正式な DB の位置へ切り替える
7. 正式 DB を開き直して動作を確認する
8. 新しい鍵を正式な鍵として確定する
9. **最後に**旧 DB と旧鍵を破棄する
```

**7 の確認が終わるまで旧鍵を消さない。**
切替に失敗したときに旧 DB へ戻れる可能性を、自分から手放さないための順序である。

4 まで成功しなければ旧 DB に一切触れない。読めない DB であっても、
**将来復号できる可能性がある限り、こちらから消さない。**

### セーフティ Export の例外

§13.3 では破壊的操作の前に自動セーフティ Export を行うが、
**Recovery 時はこれを実施できない**（元 DB を復号できないため、書き出す中身がない）。

この場合に限り、セーフティ Export なしで置き換えを許可する。
失うものが「読めない DB」だけであるため、例外として妥当である。

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

**この分離は不整合を構造的に禁止するものではない。**
`health_sync_jobs` は意図的に FK を持たないため、孤児 create/update は DB 上は保存できてしまう。

分離によって得られるのは、**不整合が発生しうる箇所が1つに限定される**ことである。
禁止は Repository のトランザクションと状態遷移規則で行い、**状態遷移テストで保証する**（§17.3）。

trigger による構造的強制は採らない。Migration のたびに trigger の再作成が必要になり、
Rule 4（過去データとの互換性最優先）のコストを上げる。

## 9.2 ジョブはペイロードを持たない

ワーカーは送信時に `activities` を読んで最新値を送る。

- `create` と `update` の合流が自明になる（create のまま、送信時に最新値を読む）
- stale payload 問題が発生しない
- `delete` のみ Activity が存在しないため、必要な識別子をジョブ自身が保持する

## 9.3 ジョブ合流規則

`UNIQUE (activity_id, provider)` により、ジョブ登録時は必ず既存ジョブとの合流を判断する。

**`attempts > 0` または claim 中のジョブは「外部に到達した可能性がある」として扱う。**
これを見落とすと、送信済みの create を黙って取り消す経路ができる。

| 既存ジョブ | 状態 | 新イベント | 結果 |
|---|---|---|---|
| なし（mapping なし） | — | 記録 | `create` を追加 |
| なし（mapping あり） | — | 編集 | `update` を追加 |
| なし（mapping あり） | — | 削除 | `delete` を追加 |
| `create` | `attempts = 0` かつ未 claim **かつ mapping なし** | 削除 | **ジョブを削除**（外部へ未到達が確実） |
| `create` | `attempts > 0`、claim 中、**または mapping あり** | 削除 | **`delete` へ置換**（外部に残る可能性がある） |
| `create` | 任意 | 編集 | `create` のまま（送信時に最新値を読む） |
| `update` | 任意 | 編集 | `update` のまま |
| `update` | 任意 | 削除 | `delete` へ置換 |
| `recreate` | 任意 | 編集 | `recreate` のまま |
| `recreate` | 任意 | 削除 | `delete` へ置換 |
| `delete` | — | — | 発生しない（Activity が存在しない） |

ジョブ行を変更したときは必ず `revision` を +1 する。

### 削除時の分岐は §10.1 と同一である

上表の「削除」行は §10.1 の判定表と同じ条件でなければならない。
**mapping の存在も「外部へ到達済み」の証拠**として扱う（§10.1）。

I3（`attempts = 0` なら mapping は存在しない）が成り立てば mapping の確認は冗長だが、
**これは DB 制約ではなくテストで保証する性質のもの**なので、分岐側でも確認する。

## 9.3.1 `recreate` 操作

Import 後の明示的な再同期でのみ使う（§13.6）。

```text
recreate : provider 固有の安定識別子で既存レコードを削除
           （NOT_FOUND は成功扱い）
             ↓
           現在の sync_version で再作成
           削除がそれ以外のエラーなら作成しない（外部を二重にしない）
```

provider 別の実装：

| provider | 削除に使う識別子 |
|---|---|
| `health_connect` | `clientRecordId`（= `activity.id`） |
| `healthkit` | `SyncIdentifier` または保存済みの `external_record_id`。**実装時に確定する**（§5.4） |

delete ジョブ成功 → create ジョブ登録、という2段構えにすると、
その間にプロセスが落ちたときに create が失われる。1つのジョブで完結させてこの窓をなくす。

**この操作を v1 の時点で `operation` の CHECK に含めておく理由：**
CHECK は列制約なので、後から値を増やすと D-11 のもとでテーブル再構築が必要になる。
使う予定がある以上、**今なら無料、後からは有料**である。

### provider は DB 制約で縛らない

> v1 では Health Connect にのみ `recreate` を生成する。
> HealthKit での使用可否は HealthKit 実装時に決定する。**DB 制約では縛らない。**

`CHECK (operation != 'recreate' OR provider = 'health_connect')` を書きたくなるが、追加しない。

HealthKit にも SyncIdentifier / SyncVersion があるため（§9.4）、
**同じ recreate 戦略が HealthKit でも必要になる可能性が高い。**
ここで縛ると HealthKit 実装時に制約を緩めることになり、テーブル再構築が要る。

`recreate` を今のうちに enum へ入れた理由と同じ論理が、**この制約を追加しない理由**にもなる。

### 状態遷移（クラッシュ時の扱い）

内部的には delete → create の二段階だが、**永続的な substate を持たない。**

| 規則 |
|---|
| `recreate` は**常に先頭（delete）から再実行する** |
| 「delete 済み」を表す永続状態を持たない |
| delete の NOT_FOUND は成功として create へ進む |
| create 成功後・ジョブ削除前にクラッシュした場合も、次回は delete からやり直して収束する |
| delete 成功後・create 失敗の場合も、次回は delete から始める |

実装者が「delete 済みフラグ」を追加したくなる箇所なので、**持たないことを明記する。**
NOT_FOUND が成功扱いである以上、先頭からの再実行は常に安全である。

## 9.4 冪等性（clientRecordId と clientRecordVersion）

Health Connect の `Metadata.clientRecordId` に `activity.id` を設定する。削除も clientRecordId で引く。

```text
Health Connect   activity.id           ──→  clientRecordId
                 activity.sync_version ──→  clientRecordVersion

HealthKit        activity.id           ──→  HKMetadataKeySyncIdentifier
                 activity.sync_version ──→  HKMetadataKeySyncVersion
```

**両プラットフォームとも「同じ識別子・より大きい version が以前のオブジェクトを置き換える」
という同一のセマンティクスを持つ。** したがって `sync_version` 1本で両方に対応できる。

同じ clientRecordId で再度 insert された場合、**clientRecordVersion が大きい方が優先される**。
したがって version の管理規則を定める。

| 場面 | sync_version |
|---|---|
| 初回 create | `1` |
| Activity の編集 | `+1`（`updated_at` と同じトランザクション内） |
| **同じジョブのリトライ** | **変わらない**（activity 行が変化しないため自動的にそうなる） |
| **新しい編集** | **必ず前より大きい**（単調増加カウンタ） |
| クラッシュ後 | 永続化済みなので再現できる |

`updated_at` のエポック値を version に使う案は採らない。端末時計のずれや巻き戻しで単調性が壊れる。

### 増加の対象は限定しない（v1）

**どの項目を編集しても `+1` する。** Health Connect へ送られない項目
（note / mood / duration / orgasm / ejaculation）だけの編集でも version は増え、
不要な HC update ジョブが発生する。

これは承知の上の選択である。

| 方式 | 外部書き込み | Repository の複雑さ |
|---|---|---|
| **単純性優先（v1 で採用）** | note 編集でも update が飛ぶ | 分岐なし |
| 最小同期 | HC へ送る項目（`occurredAt` / offset / `protectionUsed`）が変わった場合のみ | 項目ごとの差分判定が必要 |

note や mood の編集頻度は低く、1件あたりの書き込みも小さいため、最適化の価値が分岐のコストに見合わない。
必要になれば後から最小同期へ変えられる（スキーマ変更を伴わない）。

**provider 別の version は持たない。**
両プラットフォームが同じ単調増加セマンティクスを採るため、**1本の `sync_version` が両方に使える。**
片方が使わないからではなく、**同じ意味で使えるから**共有する。

（v0.4 までは「HealthKit に相当概念がない」と記載していたが、これは誤りだった。
決定自体は変わらないが、根拠を訂正する。）

> **実装前の確認事項（v1.0 のゲート）**
> 1. ラッパーが `clientRecordId` と `clientRecordVersion` を露出しているか
> 2. **`clientRecordId` を指定した削除 API を露出しているか**
> 3. 削除時に「存在しない」を他のエラーと識別できるか（§9.7）
> 4. **ネイティブ呼び出しがタイムアウト後も継続するか、明示的に cancel できるか**（§9.12）
>
> **1・2 を満たせない場合、HC 同期の v1.0 投入を見送る。**
> **3 を満たせない場合は、見送りにはせず D-20・§9.7 の「識別できない場合は既知の制限として
> 受け入れる」を適用する。**（この既知の制限自体が D-20 で当初から定義済みの代替扱いであり、
> 「3 が常に満たされる」ことを前提にしていない。）
> 4 は見送り条件ではないが、cancel できない場合は §9.12 の「in-flight のまま扱う」規則が必須になる。
>
> **確認結果（2026-09-19、ソース読解による。実機/エミュレータでの実行検証ではない）**
>
> **調査対象バージョン**（導入時に差分がないか再確認すること）：
> - `react-native-health-connect` v4.1.3（commit `8d72b6a0774326059ce4f3854273a58b5f4d471f`）。
>   `android/build.gradle:95` で `androidx.health.connect:connect-client:1.1.0` に固定依存。
> - `androidx.health.connect:connect-client` **1.1.0**（Google Maven の
>   `connect-client-1.1.0-sources.jar` を直接取得し、実際に配布されているソースを確認。
>   `androidx-health-connect-release` ブランチ commit `870b85addc984c9b92c3f26cc116ed07af29297f`、
>   および `androidx-main` 最新版とも同一ロジックであることを照合済み）
> - platform 側 `android.health.connect`（AOSP `packages/modules/HealthFitness`）。
>   出荷版タグ `android-14.0.0_r32`（Android 14 リリース時点）と `main` HEAD
>   `45168a88ae2a7e1abafe1cc81001d97ff00194e2`（2026-09-19 時点の最新開発版）の**両方**で同一の
>   呼び出し経路を確認。この module は Mainline（Google Play システムアップデート）で
>   OS バージョンとは別に更新されるため、実機の実装はこの2点の間のどこかにあると考えられるが、
>   両端で経路が一致することを確認済み。
>
> **1・2 とも満たす。** `src/types/metadata.types.ts` の `Metadata` 型が `clientRecordId?: string` /
> `clientRecordVersion?: number` を公開し、`insertRecords` で渡した値は
> `HealthConnectUtils.kt#convertMetadataFromJSMap` がそのまま `androidx.health.connect.client`
> の `Metadata` オブジェクトへ橋渡しする（読み込み側 `convertMetadataToJSMap` も同様に往復可能）。
> 削除 API は `deleteRecordsByUuids(recordType, recordIdsList, clientRecordIdsList)` として
> `clientRecordIdsList` を直接受け付ける。この2点は OS バージョンに依存しない（型・JS↔Native 変換層の話のため）。
>
> **3 は Android 14（API 34）以降の経路に限り満たす。** ただし「識別できる」のではなく
> **そもそもエラーにならない**。理由：Health Connect には2つの実行経路があり、挙動の根拠が異なる。
>
> - **Android 14 以降（プラットフォーム統合パス、実装まで直接確認済み）：**
>   `deleteRecordsByUuids` → AndroidX `HealthConnectClientUpsideDownImpl.deleteRecords` が
>   `clientRecordId` を `RecordIdFilter.fromClientRecordId(...)` に変換 →
>   platform の `HealthConnectManager.deleteRecords(List<RecordIdFilter>, ...)` を呼ぶ。
>   この先の実装（AOSP `packages/modules/HealthFitness`
>   `HealthConnectServiceImpl#deleteUsingFiltersForSelf`）を追うと、`deleteUsingFilters`
>   （SystemApi 専用の別オーバーロード）と**同じ** private メソッド `deleteUsingFiltersInternal`
>   に合流し、最終的に `TransactionManager#deleteAllRecords` が対象行を検索してから削除する
>   SQL 相当の処理を行う——**一致件数 0 件でも例外を投げるコードパスが存在しない**ことを
>   実装レベルで確認した（Javadoc の記述からの類推ではない）。
> - **Android 9〜13（API 28〜33、非プラットフォーム統合パス）：未確認。**
>   この範囲では Health Connect は Play ストア配布の別アプリとして動作し、AndroidX は
>   `HealthConnectClientImpl`（AIDL 経由でそのアプリのサービスを呼ぶ実装）を使う。
>   このアプリ自体のサーバー側実装は AOSP に公開されておらず、**ソース読解では確認できない**。
>   （なお API 24〜27 は Health Connect アプリ自体が対応外のため、この論点は生じない。）
>
> **この範囲についての方針（2026-09-19、ユーザー判断）：** 実機/エミュレータでの追加検証は
> 現時点では行わない。アプリの実装自体は OS バージョンで分岐させない——`deleteRecordsByUuids` が
> resolve すれば成功、reject すればリトライ、上限到達で手動待ちという単一の処理のままでよい
> （詳細は §9.7 参照）。**Android 9〜13 では reject されうる（＝「存在しない」を積極的に
> 成功と決めつけない）という結果面での違いが残る**というだけであり、これが D-20 / §9.7 の
> 「識別できない場合は既知の制限として受け入れる」に当たる。
>
> 未確認のまま残るのは **4（cancel/タイムアウト、§9.12）と、上記の Android 9〜13 の削除挙動**。
> いずれも見送り条件ではない（3 は元々「満たせない場合の代替扱い」が定義済みのため）。
>
> **HealthKit 実装時の確認事項（v1.0 のゲートではない）**
> - メタデータ述語による削除が書き込み権限のみで可能か（§5.4）

## 9.5 ワーカーの手続き（revision + claim）

外部 API 呼び出しは DB トランザクションに入れられないため、**楽観的並行制御が必要**である。

**取得の前に provider が有効かを確認する。**

```text
0. 事前確認  SettingsRepository で provider の有効状態を読む
             healthConnect.enabled = false
               → provider = 'health_connect' のジョブを claim しない
```

`app_settings` を SQL で JOIN せず、ワーカー開始前に確認する方が単純である。

```text
1. 取得   SELECT ... WHERE provider = ?
                       AND not_before IS NOT NULL
                       AND not_before <= now
                       AND claimed_at IS NULL
                     ORDER BY not_before LIMIT 1

2. claim  UPDATE health_sync_jobs
             SET claimed_at = now,
                 attempts   = attempts + 1,
                 revision   = revision + 1
           WHERE id = ? AND revision = ?
          -- 0 行なら他の変更が入ったので諦めて次のジョブへ

3. 検証   create / update の場合、activities の存在を確認する
          存在しなければ §9.5.3 に従い、自動再試行の対象から外す
          （claim を解除するだけにしない。同じジョブを拾い続けるため）

4. 外部呼び出し（トランザクション外）

5. 確定   §9.5.1 の3分岐に従う
```

## 9.5.1 確定処理は「外部の成功」と「ジョブの完了」を分ける

**外部呼び出しが成功した事実は、ジョブを完了できるかどうかとは独立に記録する。**

これを分けないと、外部 create に成功した直後に利用者が編集した場合、
revision 不一致で mapping が作られないまま再送に回り、
その再送が恒久的に失敗すると **「外部にレコードがあるのにローカルは未同期」が永続する。**

```text
BEGIN
  job      = id で再読込          -- 見つからない場合は §9.5.4
  activity = job.activity_id で再読込

  IF activity が存在する:
      health_sync を upsert              ← 成功した事実を必ず残す
      IF job.revision == claim 時の revision:
          DELETE job                     ← 完了
      ELSE:
          job は残す                     ← 新しい内容で再送される

  ELSE:  -- 処理中に削除された
      mapping は作らない（FK RESTRICT のため作れない）
      IF job が存在し operation = 'delete':
          UPDATE job SET external_record_id = <今回得た外部 ID>,
                         revision = revision + 1
COMMIT
```

### `else` 側で外部 ID を書き戻す理由

Health Connect は clientRecordId で引けるため delete ジョブに外部 ID は不要だが、
**HealthKit では READ 権限に依存せず確実に削除するために外部 UUID が必要になりうる**（§5.4）。

ここで外部 ID を捨てると、**HealthKit で削除手段を失うおそれがある。**
保存時に得られた識別子は、使うかどうかに関わらず捨てない。

## 9.5.2 `attempts` を claim 時に加算する

**`attempts` は失敗時ではなく claim 時に加算する。**
これにより `attempts > 0` が「外部呼び出しを開始した ＝ 到達したかもしれない」の判定に使え、
列を増やさずに §9.3 と §10.1 の分岐が書ける。

## 9.5.3 Activity が存在しない create / update ジョブ（内部不整合）

手順3で create / update の対象 Activity が存在しない場合、**これは一時エラーではなく内部不整合**である。
claim を解除するだけだと、同じジョブを何度も拾い続ける。

```text
last_error_code = 'LOCAL_ACTIVITY_NOT_FOUND'
not_before      = NULL              → 自動再試行の対象から外す
開発ビルドでは assert / テスト失敗とする
診断ログは Activity の内容を含まない範囲に限る
```

**削除との正常な競合と混同しない。**
正常な削除競合は §9.5.1 の `else` 分岐（確定時点で Activity がない）として現れ、
`revision` 不一致を伴う。一方こちらは claim 直後・外部呼び出し前に発見される。
両者を同じエラーとして扱うと、正常な競合を内部不整合として報告してしまう。

## 9.5.4 確定時にジョブが見つからない場合

§9.6 の guard により **claim 中のジョブは手動操作できない**ため、
正常系ではこの状態は発生しない（手動破棄が唯一の経路だった）。

したがって発生した場合は §9.5.3 と同じく**内部不整合として扱う**。

```text
外部呼び出しは成功している可能性がある
  ↓
activity が存在するなら health_sync を upsert する（成功の事実は残す）
  ↓
開発ビルドでは assert / テスト失敗とする
```

ジョブが消えていること自体は復旧できないが、**mapping を残すことで
「外部にあるのにローカルは未同期」という状態を作らない。**

### 競合が解決される様子

| 競合 | 結果 |
|---|---|
| update 送信中に削除 | ジョブが `delete` へ置換され revision が進む → 確定の DELETE が0行 → **新しい delete ジョブが残る** |
| create 送信中に削除 | §9.3 により `delete` へ置換 → 確定が0行 → delete ジョブが外部レコードを消す |
| create 送信中に編集 | **mapping は作られる**（§9.5.1）→ ジョブは残り、大きい sync_version で送り直す |

保証できるのは「競合しない」ことではなく、
**「外部が一時的に余分なレコードを持っても、最終的に収束する」**ことである。

### provider が無効な間はジョブを保持したまま止める

D-45 により、Health Connect を切断しても未処理ジョブは破棄しない。
**この規則がないと「再接続時に再開」ではなく「切断直後から再試行」になる。**

```text
healthConnect.enabled = false  → HC のジョブを claim しない（ジョブは保持）
healthConnect.enabled = true   → due なジョブから処理を再開する
```

OS 側で権限が取り消された場合は claim 後の失敗として現れ、
`PERMISSION_DENIED` でバックオフ・手動待ちへ進む（§9.6）。

### AppState による開始・停止

v1 はフォアグラウンドの単一 runtime で動くため（§6.2）、AppState に従う。

| AppState | 動作 |
|---|---|
| `active` | ワーカーを開始・再開する |
| `inactive` / `background` | **新しい claim を停止する。実行中の外部呼び出しは結果の確定まで進める** |
| 次の `active` | due なジョブから再開する |

**バックグラウンド移行時に実行中のネイティブ呼び出しを強制キャンセルしない。**
新しい claim だけを止め、可能な範囲で確定処理まで終える方が安全である（§9.12 と同じ理由）。

確定できないまま JS の実行が止まっても、`attempts > 0` が「外部へ到達したかもしれない」
状態を表現しているため、次回起動後の分岐は正しい。

### クラッシュ

起動時にすべての `claimed_at` をクリアする（§6.2）。
ワーカーはプロセス内単一なので、起動時点で処理中のジョブは存在し得ない。

## 9.6 リトライと手動解決

```text
失敗 → UPDATE SET claimed_at = NULL,
                  last_error_code = ?,
                  not_before = now + backoff(attempts),
                  revision = revision + 1
        WHERE id = ? AND revision = ?

attempts が上限（10）を超えた
     → not_before = NULL（手動再試行待ち）
```

バックオフは指数（5s, 15s, 1m, 5m, 15m, 1h, 6h, 24h …）。

**`not_before` の sentinel 値（遠い未来の日付）を使わない。**
`not_before IS NULL` を手動待ちの表現とし、due index を partial index にする（§5）。

手動待ちのジョブには、Settings > Health Connect に **「再試行」と「破棄」** を用意する。
外部の状態を読めない以上、最終的に人間が打ち切れる経路が必要である。

### claim 中のジョブは手動操作できない

手動操作と実行中のワーカーが競合すると、**外部に作成された記録を取り消す後続ジョブが存在しない**
状態が生まれる（送信中に利用者が「同期しない」を選んだ場合など）。

```sql
-- 破棄
DELETE FROM health_sync_jobs
 WHERE id = ? AND claimed_at IS NULL;

-- 再試行
UPDATE health_sync_jobs
   SET not_before = :now, revision = revision + 1
 WHERE id = ? AND claimed_at IS NULL;
```

0件なら **「現在処理中です。完了後にもう一度操作してください」** を表示する。

「今すぐ再試行」も同様に claim 中は二重実行しない。

この guard には副次的な効果がある。**確定処理で「ジョブが見つからない」状態が正常系では
発生しなくなる**ため、§9.5.4 は内部不整合としてのみ扱えばよくなる。

### 破棄の文言は operation ごとに変える

**「解決済みにする」という表現は使わない。** 外部の状態を確認していないのに解決したように見える。

| operation | 操作名 | 確認文 |
|---|---|---|
| `delete` | この削除の再試行を停止 | この記録は Health Connect 上に残る可能性があります |
| `create` / `update` / `recreate` | この記録を Health Connect へ同期しない | Solo + Us と Health Connect の内容が一致しなくなります |
| 内部不整合（§9.5.3） | この同期エラーを破棄 | — |

create / update を黙って破棄すると、利用者はローカルと Health Connect が
一致していると誤解する。何が起きるかを operation ごとに言い分ける。

## 9.7 削除の再実行

Health Connect の削除は冪等でない（存在しない ID の削除がエラーになる）可能性を前提に、
以下の方針を立てる。**Android 14 以降では §9.4 の確認結果により実際にはエラーにならない
ことを確認済み**だが、Android 9〜13（非プラットフォーム統合パス）は未確認のため、
以下の方針はそちらでも安全に成立するように書く。

```text
外部の削除に成功
  ↓
ローカルのジョブ削除前にクラッシュ
  ↓
再起動して同じ削除を再試行
  ↓
外部にはもう存在しないためエラー
```

方針：

| 結果 | 扱い |
|---|---|
| 削除成功 | ジョブ削除 |
| **「存在しない」** | **成功として扱う**（ジョブ削除） |
| その他のエラー | リトライ。上限到達で手動待ち（§9.6） |

**READ 権限の追加による存在確認は採らない。**
D-12（Manifest から権限を外して審査をクリティカルパスから外す）と衝突し、
宣言するデータ型と審査面積を自分から増やすことになる。
削除の冪等性という局所的な問題に対して払うコストとして見合わない。

ラッパーが「存在しない」を識別できない場合は、
**「削除済みだがローカル確定前に落ちると未同期表示が残る」を既知の制限として受け入れ**、
§9.6 の operation 別の破棄操作（削除なら「この削除の再試行を停止」）で打ち切る。

> **§9.4 確認結果との対応：実装は OS バージョンで分岐しない。** ワーカーが行うのは
> 「`deleteRecordsByUuids` が resolve すれば成功としてジョブ削除、reject すればその他の
> エラーと同じくリトライし、上限到達で手動待ちに回す」という単一の処理だけであり、
> `Platform.Version` 等で分岐するコードは書かない。OS バージョンによって違うのは
> **その処理を実行した結果**である。Android 14 以降は「存在しない」がそもそもエラーとして
> 上がってこない（platform が無視して成功を返す）ため、上表の「成功」行と「存在しない」行は
> 呼び出し側から見て同じ1つの resolve という結果になる。Android 9〜13 は未確認のため、
> reject された場合はこれまで通り「その他のエラー」としてリトライに回る——つまり、
> 「削除済みだがローカル確定前に落ちると未同期表示が残りうる」という**結果としての制限**が
> この OS 範囲に残る、というだけであり、そのための特別な分岐コードを追加する必要はない。

## 9.8 記録と同期の関係

```text
recordActivity()
      │
      ├─ SQLite 保存           ← ここが成功すれば記録は成功
      │
      └─ health_sync_jobs へ create を登録（not_before = now + 5秒）
```

**SQLite 保存の成功をもって Activity 作成成功とする。**
Health Connect 同期の失敗で Activity 記録自体を失敗させない。UI は同期の完了を待たない。

## 9.9 同期される項目

`SexualActivityRecord` が保持できるのは**時刻と避妊具使用の有無だけ**である。

| Solo + Us | Health Connect |
|---|---|
| `occurred_at_utc` | time |
| `protection_used` | protectionUsed |
| `context`（solo / partnered） | **送られない** |
| `orgasm` / `ejaculation` | **送られない** |
| `duration_seconds` / `mood_*` / `note` | **送られない** |

`protection_used` は HC が保持できる唯一の詳細項目である。
外へ出る情報の範囲は設定画面に具体的に明示する（UI/UX §18）。

### 値の変換

ローカルの3値は Health Connect の3値にそのまま対応する。

| Solo + Us | Health Connect |
|---|---|
| `true`（1） | `PROTECTION_USED_PROTECTED` |
| `false`（0） | `PROTECTION_USED_UNPROTECTED` |
| `null` | `PROTECTION_USED_UNKNOWN` |

**「未記録」を `UNPROTECTED` に潰さない。** §5.3 の NULL と false の区別を外部でも保つ。

### 用語

**「避妊具」単独では感染予防の目的が抜ける。** 行ラベルと説明文を分ける。

```text
行ラベル    プロテクション          （英語版: Protection）
説明文      避妊・感染予防のための保護具を使用したかどうか
```

## 9.10 v1 の既知の制限

- Health Connect 側でユーザーが手動削除しても、v1 は HC を読まないため検知できない
- 置換復元（§13）を実行すると `health_sync` の対応関係は破棄され、HC 上の既存レコードは残る
- **Android 9〜13（非プラットフォーム統合パス）** では、削除の「存在しない」が reject
  されうるため、未同期表示が残ることがある（§9.4・§9.7）。Android 14 以降はソースで
  確認済みのため該当しない

## 9.11 リリースビルドの分離

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

## 9.12 破壊的操作との排他制御（SyncCoordinator）

§9.6 の guard は**手動ボタン単位**のものであり、ジョブをまとめて削除する経路には効かない。

```text
同期ワーカーが create を claim
  ↓
外部 API 呼び出し中
  ↓
利用者が置換復元を実行 → health_sync_jobs を全削除
  ↓
Import 内容を投入
  ↓
古い外部 create が成功して戻る
  ↓
確定処理がジョブを見つけられない
  （さらに、同じ Activity ID が Import に含まれていると
    古い処理の結果で health_sync が作られる）
```

### 対象となる操作

- 置換復元（§13.3）
- 全 Activity 削除（§10.6）
- Health Connect の切断処理（provider の停止・設定更新）（§10.5）
- DB Migration の開始（§7）
- Recovery の開始（§8.8）
- アプリ内データの初期化

### SyncCoordinator

**プロセス内の mutex で、破壊的操作と同期ワーカーを排他する。**
v1 はフォアグラウンドの単一 runtime（§6.2 / D-36）なので、プロセス内 mutex で十分である。

```text
破壊的操作の開始
  ↓
suspend()        新しい claim を停止する
  ↓
現在実行中の外部 API 呼び出しの完了を待つ
  ↓
破壊的操作を実行する（単一トランザクション）
  ↓
resume()         ワーカーを再開する
```

### 外部呼び出しが終わらない場合

**JavaScript 側のタイムアウトは、ネイティブ処理の終了を意味しない。**

`Promise.race()` で30秒後に reject しても、Health Connect へのネイティブ呼び出しは
裏で継続している可能性がある。ここで mutex を解放すると、防ぎたかった競合が再発する。

```text
外部 API 呼び出し開始
  ↓
JS 側で30秒タイムアウト
  ↓
mutex 解放            ← 誤り
  ↓
置換復元
  ↓
ネイティブ側の書き込みが遅れて成功
```

**規則：**

| 状況 | 扱い |
|---|---|
| API が明示的な cancel をサポートする | **cancel の完了を待ってから** mutex を解放する |
| cancel できない | タイムアウトは **UI の待機を打ち切るためだけ**に使う |
| タイムアウト経過 | 破壊的操作を**中止**し、利用者に再試行を案内する |
| 外部 Promise が未 settle | **Coordinator は in-flight のまま扱う**。ワーカーは再開しない |
| 実際に settle した | そこで初めて通常状態へ戻す |

```text
30秒経過
  → 破壊的操作を中止する
  → 利用者には再試行を案内する
  → 外部処理の監視は継続する
  → 実際に settle してから Coordinator を通常状態へ戻す
```

**タイムアウトを「外部処理の終了」とみなさない。**

```text
同期の完了を待っています…

[ キャンセル ]      ← 破壊的操作を中止する（同期は中止しない）
```

**待ちきれないから強行する、という経路を作らない。**
破壊的操作は後からやり直せるが、外部に取り残されたレコードは自力で見つけられない。

### Promise が永久に settle しない場合

Coordinator が in-flight のままになり、破壊的操作が実行できなくなる。
**唯一の逃げ道はアプリの再起動であり、これは設計上安全である。**

```text
再起動
  ↓
§6.2 ですべての claimed_at をクリア
  ↓
attempts は claim 時に加算済みなので残る
  ↓
「外部へ到達したかもしれない」ジョブとして正しく扱われる（§9.3 / §10.1）
```

プロセスが死んでもネイティブ側の書き込みが完了する可能性はあるが、
`attempts > 0` がその可能性を表現しているため、**再起動後の分岐は既に正しい。**
タイムアウトの問題は、**すでに解決済みのケースに退化する。**

**利用者にもこの逃げ道を伝える。** 内部事情を説明せず、操作だけを案内する。

```text
同期の完了を待っています…

処理が終わらない場合は、アプリを
再起動してからもう一度お試しください。

[ キャンセル ]
```

### この排他が §9.5.4 の前提になる

§9.6 の guard とこの排他制御の両方があって初めて、
**「確定時にジョブが見つからない = 内部不整合」**という前提が成立する。
どちらか一方だけでは、正常な操作の結果としてジョブが消えうる。

---

# 10. 削除フロー

## 10.1 同期状態によって分岐する

**無条件の手順ではない。** §9.3 の合流規則と一致させる必要がある。

### 判定は必ずこの順序で行う

**「HC が未接続かどうか」を先に見てはいけない。**

現在 HC が未接続でも、以前の接続時に作られた mapping やジョブが残っている可能性がある。
接続状態を先に判定すると、**外部削除に必要なジョブまで消してしまう。**

```text
1. mapping または既存ジョブがあるか？
     → あれば、その状態に従って処理する（接続状態は見ない）

2. mapping なし AND ジョブなし AND 現在も同期対象外
     → Activity のみ削除する
```

### 既存ジョブを先に分類する

mapping を先に分類すると状態が漏れる。**ジョブの有無と種別を先に見る。**

| 順 | 条件 | 処理 |
|---:|---|---|
| 1 | `create` ジョブ **かつ** `attempts = 0` **かつ** mapping なし | **create ジョブを削除**して Activity 削除 |
| 2 | `create` ジョブ **かつ**（`attempts > 0` **または** mapping あり） | **delete ジョブへ置換** |
| 3 | `update` ジョブ（mapping の有無を問わない） | **delete ジョブへ置換** |
| 4 | `recreate` ジョブ（mapping の有無を問わない） | **delete ジョブへ置換** |
| 5 | ジョブなし **かつ** mapping あり | delete ジョブを作成 |
| 6 | ジョブなし **かつ** mapping なし | Activity のみ削除 |

mapping がある場合は delete ジョブ作成後に mapping を削除してから Activity を削除する（§10.2）。

### 見落としやすい2つの正常系

**`mapping あり + create ジョブ`** は §9.5.1 の競合の直後に発生する。

```text
create を外部へ送信中 → 利用者が編集 → 外部 create 成功
→ mapping は作成される（外部成功の事実は必ず残す）
→ revision が変わっているため create ジョブは残る
```

この状態で削除すると順2に該当し、`delete` へ置換される。

**`mapping なし + recreate ジョブ`** は Import 後の明示的な再同期で発生する。
置換復元で `health_sync` を破棄した状態から `recreate` を作るためである（§13.6）。
この状態で削除すると順4に該当する。

### 順1と順2の境界

順1は「**外部へ未到達が確実**」なときだけである。
`attempts > 0` は外部呼び出しを開始した証拠であり、mapping の存在は外部レコードの存在そのものを意味する。
**どちらか一方でも成り立てば、黙って取り消してはいけない。**

これがないと「送信済みの create を黙って取り消す」経路が残り、
ローカルに存在しない記録が Health Connect 側に残る。

### claim 中のジョブ

個別削除では §9.5 の revision により競合が解決される。
全削除（§10.6）では §9.12 の排他制御により claim 中のジョブが存在しない。

### HC が未接続のまま delete ジョブが残る場合

ジョブは**保持する**。切断時に破棄しない。

```text
Health Connect へ再接続すると、
残っている削除を再開できます。
```

を Settings に表示する。個別に打ち切りたい場合は §9.6 の破棄操作を使う。

## 10.2 トランザクション

```text
BEGIN
  1. health_sync と health_sync_jobs の現在の状態を読む
  2. 上表に従ってジョブを作成・置換・削除する（revision を +1）
  3. health_sync の行があれば削除する
  4. activities の行を削除する   ← RESTRICT があるので 3 の後でなければ失敗する
COMMIT
```

`ON DELETE RESTRICT` は「消し忘れ」を実行時エラーにするための安全装置であり、
削除手順をこの順序に強制する。

## 10.3 ローカル削除は常に即時成功させる

外部削除の失敗で画面上の削除を巻き戻さない。失敗したジョブは outbox に残り、バックオフで再試行される。

## 10.4 未同期の変更の可視化

```text
Settings → Health Connect

  未同期の変更            3件

  Sep 14  Solo
  この記録を Health Connect へ同期できていません
  [ 今すぐ再試行 ]   [ 同期しない ]

  Sep 11  Partnered
  削除を Health Connect へ反映できていません
  [ 今すぐ再試行 ]   [ 再試行を停止 ]
```

**単一のボタンにしない。** 操作名と結果はジョブの operation によって変わる（§9.6）。
claim 中のジョブは操作を無効化し「処理中」と表示する。

Today や Insights には同期エラーを出さない（記録画面に外部同期の失敗を持ち込まない）。

## 10.5 Health Connect 接続を OFF にするとき

未処理の delete job が残っている場合は警告する。

```text
Health Connect に未反映の削除が 2 件あります。

切断すると、これらの記録は Health Connect 上に残ります。
再接続すると、残っている削除を再開できます。

[ 先に処理する ]   [ このまま切断する ]
```

黙って切断すると外部に残るため、必ず選択させる。

### 切断してもジョブは破棄しない

「このまま切断する」を選んでも、**未処理のジョブは保持し、再接続時に再開する。**

破棄すると、外部に残った記録へ到達する手段が永久に失われる。
個別に打ち切りたい場合は §9.6 の operation 別の破棄操作を使う（利用者の明示的な選択）。

未処理が残っている間は Settings に件数を表示し続ける（§10.4）。

---

## 10.6 全 Activity 削除

Settings > Delete Data からの全件削除は、**置換復元とは扱いが異なる。**

| | 外部への反映 | 理由 |
|---|---|---|
| **全 Activity 削除** | **delete ジョブを作る** | 利用者の意思は「このデータを消す」であり、外部も対象に含まれる |
| 置換復元（§13.3） | delete ジョブを作らない | 機種変更・復旧が主用途であり、外部の記録を消す意図とは限らない |

### §10.1 の状態遷移を全 Activity へ一括適用する

**「同期済みの Activity だけ」を対象にしない。**

mapping がない未同期 create でも、**過去に外部へ到達している可能性がある。**

```text
create 送信 → 外部では成功 → ローカル確定前に通信エラー／クラッシュ
→ mapping なし、create ジョブの attempts > 0
→ ここで「同期済みではない」として無視すると、外部に記録が残る
```

したがって全削除は、§10.1 の分岐表を**全 Activity へ一括適用する**。

**§10.1 の判定表をそのまま全 Activity へ適用する。表は §10.1 を正本とし、ここでは複製しない。**

「HC が未接続かどうか」を先に見ない。
HC が現在 OFF でも、mapping や不確定なジョブがあれば delete ジョブを残す。

```text
BEGIN
  1. 全 Activity に上表を適用してジョブを整理する
  2. health_sync を全削除
  3. activities を全削除
COMMIT
```

**§9.12 の排他制御下で実行するため、claim 中のジョブは存在しない。**
したがって個別削除（§10.1）にある「claim 中」の分岐は不要で、判定は `attempts` だけで足りる。

実行前に、外部への反映が非同期であることを明示する。

```text
すべての記録を削除しますか？

Health Connect に同期済みの記録は、
順次削除されます。完了までアプリを
開いたままにしてください。

[ キャンセル ]        [ 削除 ]
```

置換復元との違いを画面上でも言い分ける。**同じ「消える」でも外部への影響が違う。**

### 外部削除の進行と中断

全削除は「記録を消したい」という意思が最も強い場面であり、
**このアプリでは、消したい瞬間に外部へ残ることが最大の失敗**になる。

したがって全削除では、キューに投げっぱなしにせず**前面で進行を見せる**。

```text
削除しています…

Health Connect     12 / 47

アプリを閉じると削除は一時停止し、
次回起動時に再開します。

[ 画面を閉じる ]
```

**「バックグラウンドで続ける」と書かない。**
v1 はバックグラウンド同期を実装しない（§6.2）ため、
OS のバックグラウンドでも削除が続くと誤解される。
このボタンが意味するのは「進行画面を閉じてアプリ内の別画面へ戻る」だけである。

- ローカル削除は即座に完了する（外部の成否を待たない）
- 外部削除はキュー（§9）をそのまま使い、進行だけを前面に出す
- 完了したら **「すべて削除されました」** を表示する
- 途中で閉じてもキューは残り、**次回起動時に自動再開する**
- アプリの終了を禁止しない

### `lastSyncedAt` を全削除の開始時に `null` にする

全削除の開始時点で mapping がすべて消えるため、以前の「Last synced」を残すと誤解を招く。

```text
全削除の開始      healthConnect.lastSyncedAt = null
pending delete 中  「削除中・残り N 件」を表示する
全 delete 完了後   「同期対象の記録はありません」を表示する
```

**削除中は日時ではなく状態を表示する。** 日時を出すと、何が最新なのかが読み取れない。

### 進行総数を永続化しない

進行表示の総数（`12 / 47` の 47）は**メモリ上にだけ持つ**。

ローカル Activity は既に削除済みで、完了件数は delete ジョブ数の減少から計算できるが、
**再起動後には元の総数を復元できない。** 総数を永続化するにはバッチ情報
（`deletion_batch_id` / `initial_job_count` / `created_at`）が要る。

v1 ではそこまで増やさず、表示を切り替える。

```text
同一セッション   削除しています…  Health Connect  12 / 47
再起動後         Health Connect から削除中  残り 35 件
```

**表示のためだけにスキーマを増やさない。**

### Health Connect が未接続の場合

外部削除を実行できないため、進行表示は進まない。**「削除中」と「再接続待ち」を分ける。**

```text
端末からすべての記録を削除しました。

Health Connect から削除する記録が
35 件残っています。

再接続すると削除を再開できます。
```

進行バーを出したまま止めない。止まっている理由を状態として示す。

### 「ローカル削除完了」と「全削除完了」を言い分ける

```text
端末からすべての記録を削除しました。
Health Connect からの削除を続けています。
```

と

```text
すべて削除されました。
```

を区別する。前者の状態で「完了」と言わない。

### アンインストールすると再開できない

**未処理の外部削除が残った状態でアプリを削除すると、Health Connect 側の記録は残る。**
再開する主体がいなくなるためである。

全削除の確認画面でこれを明示する。記録を消したうえでアプリも消す、という流れは
この製品では十分に起こりうるため、黙っていてよい制限ではない。

未処理が残っている間は、Settings に件数を表示し続ける（§10.4）。

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

**未記録は `null` として明示的に出力する。キーを省略しない**（§3.3）。

```json
{
  "version": 1,
  "exportedAt": "2026-09-16T14:20:00Z",
  "activities": [
    {
      "id": "8f14e45f-ceea-4d0e-b44e-1b2c3d4e5f60",
      "context": "solo",
      "occurredAtUtc": "2026-09-14T14:42:00Z",
      "occurredLocalDate": "2026-09-14",
      "occurredLocalTime": "23:42",
      "timezoneOffsetMinutes": 540,
      "timezoneId": "Asia/Tokyo",
      "orgasm": true,
      "ejaculation": null,
      "protectionUsed": null,
      "durationSeconds": null,
      "moodBefore": null,
      "moodAfter": null,
      "note": null,
      "syncVersion": 1,
      "createdAt": "2026-09-14T14:42:03Z",
      "updatedAt": "2026-09-14T14:42:03Z"
    }
  ]
}
```

`health_sync` / `health_sync_jobs` は**エクスポートしない**（端末固有の同期状態であり、復元しても意味がない）。

## 12.2.1 `settings` を含める

バックアップである以上、設定も含める。トップレベルに別オブジェクトとして置く。

```json
{
  "version": 1,
  "exportedAt": "...",
  "settings": {
    "activityDetails.orgasm": true,
    "activityDetails.ejaculation": false,
    "preferences.firstDayOfWeek": "monday"
  },
  "activities": []
}
```

- **置換復元のときだけ復元**し、追加のみモードでは無視する
- **設定の不整合で Activity の復元を失敗させない**（設定は復元の本質ではない）
- 未知のキーは無視する。既知のキーで値が不正なら既定値を使う

### 型の境界

**DB が TEXT だからといって、公開する JSON まで文字列にしない。**

```text
DB app_settings.value : TEXT
SettingsRepository    : boolean / enum へ変換
Export JSON           : JSON 本来の型で出力（true / false / "monday"）
Import JSON           : JSON の型を厳密に検証してから DB 用 TEXT へ変換
```

`"false"` という文字列は JavaScript では truthy である。
公開形式で文字列に潰すと、他のツールや将来の実装がこの事故を踏む。

### allowlist で明示する

**すべての設定を Export しない。** 端末固有の状態を復元すると、実態と食い違う表示になる。

**実装では明示的なキー一覧を定数として持つ。** ワイルドカードで判定しない。

```ts
const EXPORTABLE_SETTING_KEYS = [
  'activityDetails.orgasm',
  'activityDetails.ejaculation',
  'activityDetails.protection',
  'activityDetails.duration',
  'activityDetails.mood',
  'activityDetails.note',
  'preferences.firstDayOfWeek',
  'preferences.timeFormat',
  'preferences.appearance',
] as const;
```

`activityDetails.*` のような表記は**説明上の省略**であり、実装の判定条件ではない。
ワイルドカードで判定すると、将来 `preferences` 配下に端末固有の項目を足したときに
**自動的に Export 対象へ入ってしまう。**

Export しないもの：

```text
healthConnect.*       端末ごとの権限状態と一致しない
healthKit.*           同上
appLock.*             新しい端末で突然ロックが有効になるのを避ける
最終同期日時          health_sync が空なのに「同期済み」と表示される
一時的な UI 状態
```

`healthConnect.lastSyncedAt` を復元すると、**`health_sync` が空なのに
設定画面が「同期済み」と表示する**という実害がある。

`appLock.*` を Export しない理由は、新しい端末で認証の設定も確認もしないうちに
ロックが有効な状態で起動するためである。App Lock は端末ごとの判断とする。

## 12.2.2 `syncVersion` を出力する理由と、その限界

`syncVersion` は出力する。ないと、復元後に外部へ同期したときに
以前より小さい `clientRecordVersion` を送ることになる。

**ただし出力するだけでは、古いバックアップの問題は解決しない。**

```text
Health Connect 上   : clientRecordVersion 8
復元した古い Export : syncVersion 3
```

この状態で通常の update を送っても、**HC は大きい version を優先するため反映されない。**
対処は §13.6 に定める。

## 12.3 CSV

人間と表計算が読むための形式。ローカル日時を可読形式で含める。

```csv
id,context,occurredLocalDate,occurredLocalTime,occurredAtUtc,timezoneOffsetMinutes,timezoneId,orgasm,ejaculation,protectionUsed,durationSeconds,moodBefore,moodAfter,note
```

## 12.4 ファイルの扱い

| 用途 | 経路 | 理由 |
|---|---|---|
| 通常の Export | 共有シート | 保存先を利用者に委ねてよい |
| **セーフティ Export**（§13.3） | **保存先を選ばせる**（iOS: Files、Android: SAF） | **保存の成否と保存先を検証する必要がある** |

共有シートは保存先も成否も返さないため、**破壊的操作の前提条件としては使えない。**

- アプリの cache に書いてから渡し、共有後に一時ファイルを削除する
- 共有先で平文になることを画面上で明示する
- パスフレーズ付き暗号化 Export は v1.1 で検討する

---

# 13. Import（strict restore）

## 13.1 原則

v1 の JSON Import は **strict restore のみ**とする。行単位スキップ（tolerant import）は実装しない。

| ルール | 内容 |
|---|---|
| `id` | **必須**。持たない JSON は不正データとして拒否する |
| キーの欠落 | **不正**。未記録は `null` で表現する（§3.3） |
| 重複排除 | **推測による自動重複排除を行わない**。同一性判定は `id` のみ |
| 不正行 | **1件でもあれば確定しない**（全体を中止し、理由と件数を表示） |
| トランザクション | 全件検証 → プレビュー → **単一トランザクションで確定** |
| version | 現行より新しいものは拒否。古いものは §13.2 で変換する |
| HC 再同期 | **既定 OFF**（明示同意制） |

**重複排除をしない理由：** 同時刻に2件記録される場合や、重複記録自体が意図的である場合があり、
`(context, occurred_at_utc)` 一致による自動マージは正当なデータを失う。

**行単位スキップをしない理由：** バックアップ復元で「3件だけ欠落」は、理由を表示しても危険。
完全性が要求される場面では全体を失敗させる方が安全である。

## 13.2 Export schema の Migration

**「`version <= 現行` を受理する」だけでは、旧形式を現行形式へ変換できない。**
DB Migration とは別に、Export schema の Migration を持つ。

```text
export v1
   ↓ migrateExportV1ToV2()
export v2
   ↓ migrateExportV2ToV3()
export v3（＝現行）
   ↓ 現行形式として全件検証
Import
```

- version ごとに validator（JSON Schema または型 validator）を持つ
- 旧 version は**順番に**現行形式へ変換する
- **変換後、改めて現行形式として全件検証する**（変換のバグを素通しさせない）
- 現行より新しい version は明示的に拒否する（「新しいバージョンの Solo + Us で作成されたファイルです」）

これがないと「昔のバックアップは読める」という約束が実効性を持たない。

## 13.3 モード

```text
置換復元（既定）  現在の全データを破棄し、Import 内容で置き換える
                  → 機種変更・復旧の主用途

追加のみ          id が未存在のものだけ追加する。既存 id は変更しない
                  → 取りこぼしの補完
```

**`updated_at` による last-writer-wins は採用しない。**
`updated_at` はローカル端末時計に依存するため端末間で信頼できず、
また別端末の古いバックアップから削除済みデータが復活する。

### 置換復元の手順

```text
1. セーフティ Export を実行する
     - 保存先を選ばせる（共有シートではない）
     - 保存の成功を確認する
     - 保存したファイルを読み直し、件数が一致することを確認する
     - キャンセルされた／検証に失敗した場合、置換を開始しない
2. Import ファイルを全件検証する
3. プレビューを表示する
     12,431 件を読み込みます
     現在の 8,902 件は置き換えられます
4. 単一トランザクションで実行
     - health_sync_jobs を全削除
     - health_sync を全削除
     - activities を全削除
     - Import 内容を挿入
     - **allowlist 対象の設定のみ app_settings へ upsert**
     - **allowlist 対象外は §13.3.1 に従って維持またはリセットする**
```

設定の復元も同じトランザクション内で行うが、**設定の不整合で Activity の投入を失敗させない。**
未知のキーは無視し、既知のキーで値が不正なら既定値を使う。

### 13.3.1 allowlist 対象外の設定を一律維持しない

**「現在値を維持する」だけでは、Export から除外した理由そのものを再現してしまう。**

置換復元後は `health_sync` が空になるため、置換前の `healthConnect.lastSyncedAt` が
残っていると、設定画面が「同期済み」と表示する。これは allowlist で避けたかった状態そのものである。

| 設定 | 置換復元時 | Recovery 時 |
|---|---|---|
| `appLock.enabled` / `appLock.timing` | **維持** | 既定値 |
| `healthConnect.enabled` | **維持** | 既定値 |
| `healthConnect.lastSyncedAt` | **`null` にリセット** | 既定値 |
| `healthKit.lastSyncedAt` | **`null` にリセット** | 既定値 |
| その他、同期状態から導出される値 | **リセット** | 既定値 |

**判定基準：** 端末そのものに属する設定は維持し、**データの状態から導出される値はリセットする。**

Recovery（§8.8）では旧 DB を読めないため、対象外の設定もすべて既定値になる。

### 13.3.2 `healthConnect.enabled` を維持しても自動再同期はしない

接続が有効なまま維持されても、**Import した Activity を一括で同期ジョブへ入れない。**
再同期は既定 OFF・明示同意制である（§13.1 / §13.6）。

ただしこれは「以後の編集も同期しない」という意味ではない。
復元後に Activity を編集すれば、通常どおり同期ジョブが作られる。
**禁じているのは Import 時の一括投入だけである。**

**1 が成功しない限り 4 を実行しない。** cache に書いただけの一時ファイルは
セーフティバックアップとして数えない。

**例外：** Recovery 経路（§8.8）では元 DB を復号できないためセーフティ Export を実施できない。
この場合に限り省略する。

**既知の制限：** 置換復元により `health_sync` の対応関係は破棄され、Health Connect 上の既存レコードは残る。
実行前に警告する。

## 13.4 検証項目

DB の CHECK は既存行に遡及せず形式検証もしないため、**Import 経路には独立した検証を置く**。

- `id` が **UUID v4** であること・ファイル内で重複しないこと
- すべてのキーが存在すること（欠落は不正、未記録は `null`）
- `context` が既知の値であること
- 日時が ISO 8601 としてパースでき、固定長 UTC 表記に正規化できること（秒は `00`）
- `occurredLocalDate` / `occurredLocalTime` が `occurredAtUtc + offset` と一致すること
- 数値範囲（mood 1–5、duration > 0、`syncVersion >= 1` など）
- `updatedAt >= createdAt`

## 13.5 完成条件

**Export → アンインストール → 再インストール → Import で全件・全列が一致すること**を E2E テストとする。
Export/Import の UI 実装は後回しでよいが、**JSON schema と復元可能性の検証は DB 設計と同時に始める。**
暗号化を採用した以上、復元手段は製品の安全性の一部である。

---

## 13.6 復元後の Health Connect 再同期

Import 後の HC 再同期は**既定 OFF・明示同意制**である（§13.1）。
明示的に再同期する場合、通常の `update` ではなく **`recreate`** を使う。

```text
recreate : clientRecordId で削除（NOT_FOUND は成功扱い）→ 新しい version で作成
```

### 通常の update を使わない理由

古いバックアップから復元すると、ローカルの `syncVersion` が
Health Connect 上の `clientRecordVersion` より小さいことがある。
この状態で update を送っても HC 側は大きい version を優先するため、**復元内容が反映されない。**

削除してから作り直せば、version の大小に関係なく決定的に上書きできる。
READ 権限を使わずに解決できる点で、D-20（READ を追加しない）とも整合する。

### 削除に失敗した場合

**作成しない。** 外部に同じ記録が二重に存在する状態を作らない。
ジョブはリトライに回り、上限到達で手動待ちになる（§9.6）。

### 却下した案

| 案 | 却下理由 |
|---|---|
| 古いバックアップでは上書きできないことを既知の制限とする | 復元したのに外部が古いまま、という状態が説明しづらい |
| READ 権限で既存 version を確認する | D-12 / D-20 と衝突し、審査面積が増える |
| 復元後は新しい clientRecordId を使う | 外部に重複が残り、重複解消の仕組みが別途必要になる |

---

# 14. 統計の定義

計算方法によって値が変わるため、Statistics Service の仕様として固定する。

| 項目 | 定義 |
|---|---|
| 平均間隔 | `(最新 − 最古) ÷ (件数 − 1)` の**実時間差**。期間端の空白は含めない。**2件未満は「—」** |
| 同日複数 | 別件として数える（記録された事実を丸めない） |
| Solo / Partnered | 合算が既定。内訳は別セクションに表示 |
| **Outcome** | **集計しない**（§3.4）。割合・率・達成度としての指標を作らない |
| 曜日・時間帯 | `occurred_local_*` 列で判定。後からタイムゾーンを変えても過去の曜日は動かない |
| 最頻曜日 | 最低10件。同率首位が2つなら**併記**、3つ以上なら「—」 |
| 最頻時間帯 | **1時間刻みの循環3時間ウィンドウを24通り評価し、最大の窓を採用。同数なら開始時刻が早い方** |
| 「今月」 | ローカル暦月 |

## 14.1 時間帯を循環ウィンドウにする理由

固定3時間バケット（`21–24` / `0–3`）では `10 PM – 1 AM` のような日跨ぎの結果を原理的に出せない。
24通りの候補窓を評価すれば、開始時刻に制約されずに実態を表せる。

## 14.2 平均間隔は実時間差である

UTC の差分で計算するため、夏時間を跨ぐ期間では利用者の体感日数と1時間ずれることがある。
これは誤差ではなく**実時間差**という定義そのものなので、仕様として明記する。

## 14.3 同率首位を併記する理由

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
├─ SyncCoordinator.ts     -- 破壊的操作との排他（§9.12）
├─ SettingsRepository.ts  -- app_settings への型付きアクセス（§5.5）
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
claim / revision による楽観的並行制御は §9.5 に従う。

## SyncCoordinator

破壊的操作（置換復元・全削除・切断・Migration・Recovery）と SyncWorker を排他する（§9.12）。

```text
suspend()   新しい claim を止め、実行中の外部呼び出しの完了を待つ
resume()    ワーカーを再開する
```

**破壊的操作は必ずこの Coordinator 経由で実行する。**
Repository や Service から直接 `health_sync_jobs` を全削除しない。

---

## 17.3 Repository の必須テスト（不変条件）

§9.1 のとおり、テーブル分離だけでは不整合を構造的に防げない。
以下は **DB 制約ではなくテストで保証する**。

| # | 不変条件 |
|---|---|
| I1 | `create` / `update` / `recreate` ジョブがあるなら、対応する Activity も存在する |
| I2 | `delete` ジョブがあるなら、対応する Activity は存在しない |
| I3 | **`create` ジョブが `attempts = 0` なら、mapping は存在しない** |
| I4 | **`update` ジョブが存在するなら、mapping も存在する** |
| I5 | 同一 `(activity_id, provider)` のジョブは最大1件 |
| I6 | Activity 削除トランザクションが失敗したとき、全状態が元に戻る |
| I7 | ワーカーの処理中に編集・削除が入っても、新しいジョブを失わない |
| I8 | 起動時の claim クリア後、`attempts` が保持されている |
| I9 | **外部 create 成功後・確定前に編集**しても mapping が作られ、新しいジョブも残る |
| I10 | 外部 create 成功後・確定前に**削除**すると、delete ジョブに外部 ID が書き戻される |
| I11 | 設定を OFF にしても、記録済みの値が読み出せる |
| I12 | **外部呼び出し中は置換復元を開始できない**（§9.12） |
| I13 | **外部呼び出し中は全データ削除を開始できない** |
| I14 | **破壊的操作の実行中に新しいジョブを claim しない** |
| I15 | 置換復元の後、`healthConnect.lastSyncedAt` が `null` になっている |
| I16 | Export JSON の設定値が文字列ではなく JSON 本来の型で出力される |
| I17 | **`attempts > 0` で mapping のない create を全削除すると delete ジョブが残る** |
| I18 | **外部未到達が確実な create を全削除するとジョブごと消える** |
| I19 | **`update` / `recreate` 待ちを全削除すると delete へ置換される** |
| I20 | 外部 Promise が未 settle の間、Coordinator が通常状態へ戻らない |
| I21 | **タイムアウト経過後も、破壊的操作が実行されない** |
| I22 | **HC 未接続でも、mapping または不確定ジョブがある Activity の削除は delete ジョブを残す** |
| I23 | HC を切断しても未処理ジョブが保持され、再接続後に再開する |
| I24 | **`mapping あり + create` ジョブを削除すると `delete` へ置換される** |
| I25 | **`mapping なし + recreate` ジョブを削除すると `delete` へ置換される** |
| I26 | **HC 切断中は HC のジョブを claim しない** |
| I27 | **再接続後に残存ジョブを再開する** |
| I28 | バックグラウンド移行で新しい claim が止まり、次の `active` で再開する |
| I29 | **（遷移）§10.1 の順2〜5 だけが `delete` ジョブを生成・置換する。順1と順6は `delete` ジョブを残さない** |

### I3 は「同時に存在しない」ではない

**`mapping あり + create` ジョブは正常な一時状態である**（§10.1、I9）。

```text
create を外部へ送信中 → 利用者が編集 → 外部 create 成功
→ mapping は作成される → revision 不一致で create ジョブは残る
```

したがって「create ジョブと mapping は同時に存在しない」とは言えない。
言えるのは **「一度も外部へ送っていない create ジョブ（`attempts = 0`）に mapping はない」**
ことであり、これは §10.1 順1 の「外部へ未到達が確実」という判定をそのまま保証する。

### I29 は状態ではなく遷移のテストである

`delete` ジョブの生成と mapping の削除は同一トランザクション内で行われる（§10.2）ため、
**生成後の状態を見ても mapping の存在は確認できない。**

したがって「delete ジョブは根拠を持つ」は状態不変条件として書けない。
**生成時点の遷移**をテストする。

### I29 で根拠を列挙しない理由

当初 I29 を「mapping の存在または `attempts > 0` を根拠としていた」と書いていたが、
これは **`mapping なし + recreate` の正常系を排除してしまう**（順4）。

```text
Import 後に recreate を生成 → mapping なし → 未試行なので attempts = 0
→ Activity を削除 → recreate を delete へ置換     ← 上の条件では違反になる
```

**条件を列挙することは、判定表を別の形で複製することである。**
表を更新しても列挙側が取り残されるという、D-21 で避けたはずの失敗が再現する。

したがって I29 は条件を数えず、**§10.1 の行番号に直接結び付ける。**

I7 は §9.5 の競合表をそのままテストケースにする。
外部呼び出しをスタブ化し、claim 後・確定前に編集／削除を差し込んで検証する。

---

# 18. 開発順序

```text
Phase 1  暗号化 DB 接続 → Migration runner → スキーマ
         → ActivityRepository → Quick Record → Undo → 履歴
         → Export/Import の schema 定義と往復テスト

Phase 2  Calendar → 月次統計 → Activity Detail（詳細項目）

Phase 3  Insights（合計・内訳・平均間隔）
         → App Lock → Recovery 画面 → 画面マスク
         → 日時編集 UI（過去日時への記録・編集、§4.4/§11.4）
         → Export / Import の UI

Phase 4  Health Connect（clientRecordId / clientRecordVersion 確認 → 同期 → リトライ → 削除同期）
         → Health apps declaration 提出
         → ストア申請
```

v0.1 から順序を変更した。**暗号化と復元可能性を Phase 1 に置く**（後付けできないため）。
Health Connect を最後に置くことで、審査をリリースのクリティカルパスから外せるようにする。

日時編集 UI は §25 の MVP 表で v1.0 必須（●）とされているにもかかわらず、当初この表に
明記されていなかった。実装時（Phase 2 レビュー）に気づき、Phase 3 に割り当てた
（ネイティブの日時ピッカーが必要で、他の Phase 3 項目と同様に実機ビルドが前提になるため）。

---

# 19. MVP でやらないこと

アカウント / 独自クラウド / SNS / Community / NoFap / streak / Porn 管理 / AI アドバイス /
医療診断 / パートナー共有 / Push 通知 / 広告 / Wear OS / Apple Watch / 詳細な Health 相関分析 /
双方向同期 / 独自 PIN / tolerant import / **バックグラウンド同期**（§6.2）/
Outcome を用いた統計

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

### Rule 6（v0.2 で追加・v0.3 で補足）
**不正状態は制約で塞ぐより、構造上表現できないようにする。**

ただし構造で防ぎきれない箇所（FK を意図的に外した `health_sync_jobs` など）では、
**状態遷移テストで保証する**（§17.3）。「構造で防いでいる」と書かない。

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
- **§17.3 の不変条件テストがすべて通ること**
- **記録済みの Outcome が、表示項目の設定に関わらず失われないこと**

---

# 22. プロダクトの最終判断基準

> 「この機能は、長期間・気軽に自分の intimate life を記録して振り返るために必要か？」

必要でなければ追加しない。

本アプリの強みは機能数ではなく、
**記録が簡単で、データが自分のものであり、何年経っても残っていること。**