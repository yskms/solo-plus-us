# Solo + Us 基本設計 v0.3

作成日：2026-09-16  
前提：要件定義書 v0.3 / 設計判断記録 v0.3  
v0.1 からの変更点と理由は **設計判断記録 v0.3** を参照する。

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
                         CHECK (operation IN ('create','update','delete')),
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
| `healthkit` | **必須。** clientRecordId 相当の概念がないため、外部 ID を保持しないと削除・更新ができない |

「mapping 行が存在する = 外部にレコードが存在すると考えてよい」という点は両者共通だが、
**何を使って引くかは provider ごとに違う。**

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
4. 成功した場合にだけ、旧 DB と置き換える
5. 旧 DB と旧鍵を破棄する
6. 失敗した場合は旧 DB をそのまま残す（何も壊さない）
```

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
| `create` | `attempts = 0` かつ未 claim | 削除 | **ジョブを削除**（外部へ未到達が確実） |
| `create` | `attempts > 0` または claim 中 | 削除 | **`delete` へ置換**（外部に残る可能性がある） |
| `create` | 任意 | 編集 | `create` のまま（送信時に最新値を読む） |
| `update` | 任意 | 編集 | `update` のまま |
| `update` | 任意 | 削除 | `delete` へ置換 |
| `delete` | — | — | 発生しない（Activity が存在しない） |

ジョブ行を変更したときは必ず `revision` を +1 する。

## 9.4 冪等性（clientRecordId と clientRecordVersion）

Health Connect の `Metadata.clientRecordId` に `activity.id` を設定する。削除も clientRecordId で引く。

```text
activity.id           ──→  clientRecordId
activity.sync_version ──→  clientRecordVersion
```

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

**provider 別の version は持たない。**
HealthKit に `clientRecordVersion` 相当の概念がなく、使う予定のない列を先に作ると意味の分からない列が残る。
必要になれば HealthKit 実装時に `ALTER TABLE ADD COLUMN` で足す（D-11 が許す種類の変更）。

> **実装前の確認事項（ゲート）**
> 1. ラッパーが `clientRecordId` と `clientRecordVersion` を露出しているか
> 2. 削除時に「存在しない」を他のエラーと識別できるか（§9.7）
>
> いずれも満たせない場合、**HC 同期の v1.0 投入を見送る。**

## 9.5 ワーカーの手続き（revision + claim）

外部 API 呼び出しは DB トランザクションに入れられないため、**楽観的並行制御が必要**である。

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
          存在しなければ中止し、claim を解除する

4. 外部呼び出し（トランザクション外）

5. 確定   BEGIN
            n = DELETE FROM health_sync_jobs WHERE id = ? AND revision = ?
            n = 1 かつ operation != 'delete' → health_sync を upsert
            n = 0                            → 何もしない（後続ジョブに委ねる）
          COMMIT
```

**`attempts` は失敗時ではなく claim 時に加算する。**
これにより `attempts > 0` が「外部呼び出しを開始した ＝ 到達したかもしれない」の判定に使え、
列を増やさずに §9.3 の分岐が書ける。

### 競合が解決される様子

| 競合 | 結果 |
|---|---|
| update 送信中に削除 | ジョブが `delete` へ置換され revision が進む → 確定の DELETE が0行 → **新しい delete ジョブが残る** |
| create 送信中に削除 | §9.3 により `delete` へ置換 → 確定が0行 → delete ジョブが外部レコードを消す |
| create 送信中に編集 | ジョブは `create` のまま revision が進む → 確定が0行 → 再度 claim され、大きい sync_version で送り直す |

保証できるのは「競合しない」ことではなく、
**「外部が一時的に余分なレコードを持っても、最終的に収束する」**ことである。

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

手動待ちのジョブには、Settings > Health Connect に **「再試行」と「解決済みにする」** を用意する。
外部の状態を読めない以上、最終的に人間が打ち切れる経路が必要である。

## 9.7 削除の再実行

Health Connect の削除は完全には冪等ではない。存在しない ID の削除はエラーになりうる。

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
§9.6 の「解決済みにする」で逃がす。

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

## 9.10 v1 の既知の制限

- Health Connect 側でユーザーが手動削除しても、v1 は HC を読まないため検知できない
- 置換復元（§13）を実行すると `health_sync` の対応関係は破棄され、HC 上の既存レコードは残る
- 削除の「存在しない」を識別できないラッパーの場合、未同期表示が残ることがある（§9.7）

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

# 10. 削除フロー

## 10.1 同期状態によって分岐する

**無条件の手順ではない。** §9.3 の合流規則と一致させる必要がある。

| Activity の同期状態 | 既存ジョブ | 削除時の処理 |
|---|---|---|
| 同期対象外 / HC 未接続 | なし | Activity のみ削除 |
| 未同期（mapping なし） | `create`、`attempts = 0` かつ未 claim | **create ジョブを削除**して Activity 削除 |
| 未同期（mapping なし） | `create`、`attempts > 0` または claim 中 | **delete ジョブへ置換** + Activity 削除 |
| 同期済み（mapping あり） | なし | delete ジョブ作成 → mapping 削除 → Activity 削除 |
| 同期済み（mapping あり） | `update` | **delete ジョブへ置換** → mapping 削除 → Activity 削除 |

`attempts > 0` の行が要点である。これがないと「送信済みの create を黙って取り消す」経路が残り、
ローカルに存在しない記録が Health Connect 側に残る。

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
  [ 今すぐ再試行 ]   [ 解決済みにする ]
```

Today や Insights には同期エラーを出さない（記録画面に外部同期の失敗を持ち込まない）。

## 10.5 Health Connect 接続を OFF にするとき

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

`syncVersion` は出力する。これがないと、復元後に外部へ同期したときに
過去より小さい `clientRecordVersion` を送る可能性がある。

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
```

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

---

## 17.3 Repository の必須テスト（不変条件）

§9.1 のとおり、テーブル分離だけでは不整合を構造的に防げない。
以下は **DB 制約ではなくテストで保証する**。

| # | 不変条件 |
|---|---|
| I1 | `create` / `update` ジョブがあるなら、対応する Activity も存在する |
| I2 | `delete` ジョブがあるなら、対応する Activity は存在しない |
| I3 | `create` ジョブと `health_sync` の mapping は同時に存在しない |
| I4 | `update` / `delete` ジョブは、同期済みだった根拠（mapping の存在または `attempts > 0`）を持つ |
| I5 | 同一 `(activity_id, provider)` のジョブは最大1件 |
| I6 | Activity 削除トランザクションが失敗したとき、全状態が元に戻る |
| I7 | ワーカーの処理中に編集・削除が入っても、新しいジョブを失わない |
| I8 | 起動時の claim クリア後、`attempts` が保持されている |

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
         → Export / Import の UI

Phase 4  Health Connect（clientRecordId / clientRecordVersion 確認 → 同期 → リトライ → 削除同期）
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
