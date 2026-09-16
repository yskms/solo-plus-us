# Sexual Wellness Tracker 基本設計 v0.1

作成日：2026-09-15  
前提：要件定義書 v0.1

---

# 1. 技術構成

## 1.1 基本構成

```text
React Native + Expo
        │
        ├─ UI
        │
        ├─ Service
        │
        ├─ Repository
        │
        └─ SQLite
              │
              └─ Activity
```

Android：

```text
App
 ├─ SQLite
 └─ Health Connect
```

iOS：

```text
App
 ├─ SQLite
 └─ HealthKit（将来対応）
```

**SQLiteを正本（Source of Truth）とする。**

Health Connect / HealthKitは外部同期先であり、アプリ独自データの代替にはしない。

---

# 2. データ設計の原則

このアプリでは数年〜数十年間データを保持する可能性がある。

そのため、

- Health Connect固有仕様にDBを合わせすぎない
- 将来Activity Typeが増えてもMigrationを最小化する
- 外部同期状態を管理できる
- Export可能な構造にする
- 日時を後から修正できる
- 削除・復元・再同期を安全に行える

ことを重視する。

---

# 3. Activityモデル

## 3.1 Activity

```ts
type ActivityType =
  | 'masturbation'
  | 'sex';

interface Activity {
  id: string;

  type: ActivityType;

  occurredAt: string;
  timezoneOffsetMinutes: number;

  durationSeconds?: number;

  ejaculation?: boolean;
  orgasm?: boolean;

  moodBefore?: number;
  moodAfter?: number;

  note?: string;

  createdAt: string;
  updatedAt: string;
}
```

---

# 4. なぜ occurredAt と timezone を分けるか

長期間記録するアプリなので、旅行やタイムゾーン変更を考慮する。

例：

```text
occurredAt
2026-09-15T23:20:00

timezoneOffsetMinutes
540
```

これにより、

> 「そのActivityが現地時間でいつだったか」

を将来も復元できる。

単純に現在端末のTimezoneだけで表示しない。

---

# 5. SQLite

初期テーブル：

```sql
CREATE TABLE activities (
    id TEXT PRIMARY KEY NOT NULL,

    type TEXT NOT NULL,

    occurred_at TEXT NOT NULL,
    timezone_offset_minutes INTEGER NOT NULL,

    duration_seconds INTEGER,

    ejaculation INTEGER,
    orgasm INTEGER,

    mood_before INTEGER,
    mood_after INTEGER,

    note TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

Index：

```sql
CREATE INDEX idx_activities_occurred_at
ON activities(occurred_at);

CREATE INDEX idx_activities_type
ON activities(type);
```

---

# 6. Health Connect同期管理

ActivityテーブルにHealth Connect固有情報を直接大量に持たせない。

別テーブルとする。

```sql
CREATE TABLE health_sync (
    activity_id TEXT PRIMARY KEY NOT NULL,

    provider TEXT NOT NULL,

    external_record_id TEXT,

    sync_status TEXT NOT NULL,

    last_synced_at TEXT,

    FOREIGN KEY(activity_id)
      REFERENCES activities(id)
      ON DELETE CASCADE
);
```

provider：

```text
health_connect
healthkit
```

sync_status：

```text
pending
synced
failed
```

これにより将来的にHealthKitを追加しやすくする。

---

# 7. Health Connectマッピング

アプリ：

```text
Activity

type = masturbation
または
type = sex
```

↓

Health Connect：

```text
SexualActivityRecord
```

Health ConnectにはActivity Typeの区別を持たせない。

したがって、

```text
SQLite

Sex
Masturbation
     ↓
     ↓
Health Connect

Sexual Activity
```

となる。

---

# 8. 同期設定

設定：

```text
Health Connect
────────────────

Connect                     ON

Sync to Health Connect

Sex                         ON
Masturbation                ON

Last sync
Today 23:12
```

初回接続時に説明する。

> Health ConnectではSexとMasturbationを区別できません。
>
> 同期した記録はHealth Connect上ではどちらも「Sexual activity」として保存されます。

---

# 9. 記録フロー

最重要フロー。

```text
Home
 │
 │ ＋
 ↓
Activity Selector
 │
 ├─ Masturbation
 │
 └─ Sex
 │
 ↓
即保存
 │
 ↓
Toast / Feedback
```

**詳細入力画面を経由しない。**

---

# 10. Quick Record

例：

```text
┌─────────────────────────┐
│                         │
│       What happened?    │
│                         │
│   ┌─────────────────┐   │
│   │  Masturbation   │   │
│   └─────────────────┘   │
│                         │
│   ┌─────────────────┐   │
│   │       Sex       │   │
│   └─────────────────┘   │
│                         │
│        Just now          │
│                         │
└─────────────────────────┘
```

Activity Typeを押す。

↓

```text
✓ Recorded
```

終了。

---

# 11. 記録直後のUndo

誤タップ対策として、

```text
✓ Masturbation recorded

                 Undo
```

を数秒表示する。

記録速度を落とさず誤操作にも対応できる。

---

# 12. 過去日時への記録

Quick Record画面の

```text
Just now
```

を押すことで日時変更可能。

```text
When?

Today
23:35

[ Save ]
```

過去記録も可能とする。

---

# 13. 詳細入力

Activity履歴から編集する。

```text
Masturbation

Date
Sep 15, 2026

Time
23:35

────────────────

Duration
— min

Ejaculation
Not set

Orgasm
Not set

Mood before
Not set

Mood after
Not set

Note
—

────────────────

Delete Activity
```

詳細項目は完全任意。

---

# 14. Navigation

初期案：

```text
┌────────┬──────────┬─────────┐
│ Today  │ Calendar │ Insights│
└────────┴──────────┴─────────┘
```

SettingsはToday右上。

タブを増やしすぎない。

---

# 15. Today

```text
Sexual Wellness

September 15

────────────────────

Last activity

2 days ago

────────────────────

This month

       8

 Masturbation    Sex
      5           3

────────────────────

Recent

Sep 13   Masturbation
Sep 10   Sex
Sep 8    Masturbation


          ＋
```

---

# 16. Calendar

```text
September 2026

 M  T  W  T  F  S  S
    1  2  3  4  5  6

    ●        ●
          ○

 ●              ●

────────────────

Sep 15

23:35  Masturbation
```

記号またはデザインでActivity Typeを区別する。

色だけに依存しない。

---

# 17. Insights

```text
Insights

September
────────────────

Total
8

Masturbation
5

Sex
3

────────────────

Average interval
3.4 days

Most common day
Sunday

Most common time
23:00–01:00
```

---

# 18. Long-term

年表示を重要機能として扱う。

```text
Activity by year

2026    125
2027    129
2028    118
2029    113
2030    106
```

タップ：

```text
2028

Total             118
Masturbation       74
Sex                44

Average / month    9.8
Average interval   3.1 days
```

---

# 19. 「連続日数」は原則表示しない

以下は実装可能でも基本UIには出さない。

```text
🔥 7 day streak!
```

または、

```text
Last masturbation:
7 days ago

Great job!
```

など。

単純な事実として、

```text
Last activity
7 days ago
```

は表示してよい。

価値判断を加えない。

---

# 20. Mood

初期案：

```text
1 Very low
2 Low
3 Neutral
4 Good
5 Very good
```

ただしv1.0では詳細入力項目としてのみ提供する。

毎回Mood入力を要求しない。

---

# 21. Orgasm / Ejaculation

別項目として保持する。

理由：

Sexでは、

```text
orgasm = true
ejaculation = false
```

というケースがあり得る。

また、将来的なユーザー層拡大を考えると、

```text
orgasm
```

と

```text
ejaculation
```

を同一概念にしない。

どちらもNullableとする。

---

# 22. Nullとfalseを区別する

重要。

```text
ejaculation = null
```

は、

> 記録していない

```text
ejaculation = false
```

は、

> 「なかった」と記録した

という意味。

統計上この2つを混同しない。

---

# 23. Delete

Activity削除：

```text
Delete this activity?

This will remove the record
from this app.

If it has been synced with
Health Connect, the synced
record will also be removed.

Cancel        Delete
```

Health Connect側削除の実装仕様は実装時に最新API仕様を確認する。

---

# 24. Export

長期保存のため重要機能とする。

CSV：

```csv
id,type,occurredAt,durationSeconds,ejaculation,orgasm,moodBefore,moodAfter,note
...
```

JSON：

```json
{
  "version": 1,
  "exportedAt": "...",
  "activities": []
}
```

---

# 25. Export Version

JSONには必ず、

```json
"version": 1
```

を入れる。

将来DB構造が変わっても旧バックアップをImportできるようにする。

---

# 26. Privacy Screen

初回起動時に簡潔に説明する。

```text
Your data stays yours.

Your activity records are stored
on your device.

No account required.

We don't upload your sexual
activity to our servers.

Health Connect sync is optional.
```

---

# 27. Analytics SDK

Activity内容をAnalyticsへ送信しない。

禁止例：

```text
event:
masturbation_recorded
```

```text
property:
activity_count = 83
```

など。

必要なら、

```text
screen_opened
settings_opened
```

などセンシティブ情報を含まないイベントに限定する。

可能なら初期版はAnalytics SDK自体を使用しない。

---

# 28. App Lock

Settings：

```text
Privacy

App Lock                  ON

Require authentication
Immediately
```

バックグラウンド移行時に内容をマスクする。

---

# 29. データ保持

自動削除は行わない。

ユーザーが削除するまでActivityを保持する。

これは本アプリの、

> 長期間Personal Health Dataを残す

という目的による。

---

# 30. MVP画面一覧

v1.0：

```text
01 Splash
02 Privacy Introduction
03 Today
04 Quick Record
05 Activity Detail
06 Calendar
07 Insights
08 Settings
09 Health Connect Settings
10 App Lock Settings
```

約10画面。

---

# 31. ディレクトリ構成案

Expo Routerを想定。

```text
app/
├─ _layout.tsx
│
├─ (tabs)/
│  ├─ _layout.tsx
│  ├─ index.tsx
│  ├─ calendar.tsx
│  └─ insights.tsx
│
├─ activity/
│  └─ [id].tsx
│
├─ record.tsx
│
└─ settings/
   ├─ index.tsx
   ├─ health-connect.tsx
   └─ privacy.tsx
```

その他：

```text
database/
├─ init.ts
├─ migrations/
└─ schema.ts

repositories/
└─ ActivityRepository.ts

services/
├─ ActivityService.ts
├─ HealthConnectService.ts
├─ StatisticsService.ts
└─ ExportService.ts

types/
├─ Activity.ts
└─ HealthSync.ts
```

---

# 32. Repository責務

ActivityRepository：

```text
create()
update()
delete()
findById()
findByDateRange()
findRecent()
countByDateRange()
```

SQLをUIから直接呼ばない。

---

# 33. Service責務

ActivityService：

```text
recordActivity()
updateActivity()
deleteActivity()
```

Health Connect同期を含むActivity操作を統括する。

例：

```text
recordActivity()
      │
      ├─ SQLite保存
      │
      └─ Health Connect同期
```

SQLite保存成功をActivity作成成功条件とする。

Health Connect同期失敗によってActivity記録自体を失敗させない。

---

# 34. Health Connect障害

例：

```text
SQLite
  ✓

Health Connect
  ✕
```

の場合：

Activityは保存済み。

```text
health_sync
sync_status = failed
```

として保持する。

後で再同期する。

---

# 35. ID

Activity IDはUUIDを使用する。

Health Connect側IDとは分離する。

```text
activity.id
≠
health_connect_record_id
```

これにより外部サービス変更に影響されない。

---

# 36. 初期開発順序

Phase 1：

```text
SQLite
↓
Activity CRUD
↓
Quick Record
↓
History
```

Phase 2：

```text
Calendar
↓
Statistics
↓
Insights
```

Phase 3：

```text
Health Connect
↓
Sync
↓
Retry
↓
Delete synchronization
```

Phase 4：

```text
App Lock
↓
Export / Import
↓
Store release
```

---

# 37. MVPでやらないこと

以下は初期版から外す。

- アカウント
- 独自クラウド
- SNS
- Community
- NoFap
- streak
- Porn管理
- AIアドバイス
- 医療診断
- パートナー共有
- Push通知
- 広告
- Wear OS
- Apple Watch
- 詳細なHealth相関分析

---

# 38. 開発上の最重要ルール

### Rule 1

Activityの保存は常にローカルDBを最優先する。

### Rule 2

外部API障害でActivityを失わない。

### Rule 3

Sex / Masturbationの区別を外部Health仕様に依存させない。

### Rule 4

過去データとの互換性を最優先する。

### Rule 5

Activity記録操作を増やさない。

---

# 39. MVPの完成定義

以下ができればv1として成立する。

```text
アプリを開く
     ↓
＋
     ↓
Masturbation / Sex
     ↓
記録完了
```

そして翌月・翌年・10年後に、

```text
いつ
何を
何回
```

が正確に振り返れる。

Health Connectを利用するユーザーについては、同時に標準のSexual Activityデータとして蓄積できる。

---

# 40. プロダクトの最終判断基準

新機能を追加するときは、

> 「この機能は、長期間・気軽に自分のsexual activityを記録して振り返るために必要か？」

で判断する。

必要でなければ追加しない。

本アプリの強みは機能数ではなく、

**記録が簡単で、データが自分のものであり、何年経っても残っていること。**