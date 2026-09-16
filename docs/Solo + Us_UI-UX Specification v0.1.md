# Solo + Us — UI/UX Specification v0.1

**App Name:** Solo + Us  
**Tagline:** *Your intimate life, over time.*

---

# 1. Design Principles

Solo + Usは、Solo / Partnered sexual activityを長期間記録し、自分自身の変化を振り返るためのPrivate Wellnessアプリ。

デザイン上、以下を最優先する。

### Private

アプリを他人に見られても、性的な内容を扱うアプリだと即座には分からない。

ハート、唇、炎、性的な身体表現などは使用しない。

### Neutral

頻度について「多い・少ない」「良い・悪い」の評価をしない。

連続日数、禁欲記録、失敗、目標回数などのGamificationは行わない。

### Fast

最も重要な操作は「記録」。

通常の記録は、

**＋ → Solo / Partnered**

の2アクションで完了できること。

### Long-term

数週間ではなく、数年〜数十年の利用を想定する。

UIも「今日」だけではなく、

**Month → Year → Over Time**

へ自然に広がる構造とする。

---

# 2. Brand System

## App Icon

**Intersect Plus**

縦棒と横棒が交差するシンボル。

意味：

- Solo
- Partnered
- その両方を持つ一人の自分
- Add Activity

単純な透明合成ではなく、交差部分には専用色を使用する。

---

# 3. Color Tokens

```ts
export const colors = {
  solo: '#2E7D6B',
  partnered: '#F4A699',
  intersection: '#3E5F58',

  background: '#F8F7FA',
  surface: '#FFFFFF',

  textPrimary: '#1F2937',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',

  border: '#E7E7EA',
  destructive: '#B84A4A',
};
```

### Semantic usage

`solo`

Solo activity / primary interaction.

`partnered`

Partnered activity.

`intersection`

ブランドマークやSolo + Partneredをまとめて表現するとき。

**Solo/Partneredの判別を色だけに依存しないこと。**

必ずラベルまたはアイコンを併用する。

---

# 4. Typography

基本フォント：

- iOS: System / SF Pro
- Android: System / Roboto
- ブランド素材: Interまたは類似Modern Sans

アプリ本体ではOS標準フォントを優先する。

### Hierarchy

```text
Display Number     40–48
Screen Title       28–32
Section Title      13–15 / Semibold
Body               16
Secondary          14
Caption            12
```

年間回数・月間回数など、**数字を情報の主役として大きく表示する。**

---

# 5. Navigation

Bottom Tabs：

```text
Today        Calendar        Insights
  ●             □              ◇
```

SettingsはToday右上のgear icon。

記録はGlobal FABとしてToday画面右下に配置。

```text
        ＋
```

この＋はブランドのIntersect Plusを簡略化したものとする。

---

# 6. Screen 01 — Privacy Introduction

初回起動時のみ表示。

```text
            +

        Solo + Us

 Your intimate life, over time.


 Your intimate life belongs
 to you.

 • Stored on this device
 • No account required
 • No advertising use
 • Health connection is optional


          Continue
```

コピーは性的な内容を過度に強調しない。

Continue後、必要ならApp Lock設定を案内する。

---

# 7. Screen 02 — Today

アプリのメイン画面。

```text
Solo + Us                         ⚙

Tuesday, September 16


THIS MONTH

               12
            activities

       8                 4
      Solo           Partnered


────────────────────────────


LAST ACTIVITY

Solo
September 14 · 11:42 PM
2 days ago


────────────────────────────


RECENT

Sep 14        Solo
Sep 11        Partnered
Sep 08        Solo
Sep 06        Solo


                            ＋


 Today        Calendar      Insights
```

## Empty State

初回は、

```text
THIS MONTH

             —

No activities recorded yet.


Your history starts
with your first entry.


             ＋
```

とする。

「Start your streak」等の表現は禁止。

---

# 8. Screen 03 — Add Activity

FABタップ。

Bottom SheetまたはModal。

```text
Add Activity                       ×


         How would you
          like to log?


┌────────────────────────────────┐
│                                │
│       ●   Solo                 │
│                                │
│       Personal activity        │
│                                │
└────────────────────────────────┘


┌────────────────────────────────┐
│                                │
│      ● ●  Partnered            │
│                                │
│       With someone             │
│                                │
└────────────────────────────────┘


             ◷ Just now

         Change date & time
```

### Quick Record

SoloまたはPartneredをタップした瞬間、

1. SQLiteへ保存
2. Modalを閉じる
3. Today更新
4. confirmation表示
5. Health Connect同期を非同期開始

Health Connectの成功を待たない。

---

# 9. Record Confirmation

```text
              ✓


       Solo activity
          recorded


             Undo
```

ただし専用画面への遷移ではなく、基本はToast / Snackbarを使用。

推奨：

```text
✓ Solo activity recorded              Undo
```

約5秒表示。

Undo：

- SQLite record削除
- Health sync済みならexternal recordも削除対象
- pending syncならqueueから除外

---

# 10. Screen 04 — Activity Detail

Recent / Calendarから開く。

```text
Activity                            ⋯


Solo


DATE & TIME

Sep 14, 2026
11:42 PM


DETAILS

Duration
Not recorded                         >

Orgasm
Not recorded                         >

Ejaculation
Not recorded                         >

Mood before
Not recorded                         >

Mood after
Not recorded                         >

Notes
Add a note                           >


────────────────────────────

Health Connect
Synced


────────────────────────────

Delete Activity
```

詳細項目は**すべてOptional**。

Quick Record時には入力を要求しない。

---

# 11. Optional Detail Input

## Duration

```text
Duration

○ Not recorded
○ 5 min
○ 10 min
○ 15 min
○ 30 min

Custom
```

最終的にはsecondsで保存。

## Orgasm

```text
Orgasm

○ Not recorded
○ Yes
○ No
```

## Ejaculation

```text
Ejaculation

○ Not recorded
○ Yes
○ No
```

`Not recorded`と`No`はDB上でも明確に区別する。

---

# 12. Mood

```text
How did you feel?

1      2      3      4      5

●      ●      ●      ●      ●
```

数字だけではなく、

```text
Very low
Low
Neutral
Good
Very good
```

などの補助ラベルを検討する。

診断・評価用途ではない。

---

# 13. Screen 05 — Calendar

```text
Calendar


       September 2026

 M   T   W   T   F   S   S

     1   2   3   4   5   6

 7   8   9  10  11  12  13
     ●           ●

14  15  16  17  18  19  20
●

21  22  23  24  25  26  27

28  29  30


Sep 14

● Solo                      11:42 PM
```

### Multiple activities

同日に複数回ある場合、

```text
●●
```

を並べすぎない。

3件以上は、

```text
● 3
```

などにまとめる。

Solo / Partneredは色＋activity indicatorで識別。

---

# 14. Screen 06 — Insights

```text
Insights


                  2026⌄


TOTAL ACTIVITIES

              94

       61              33
      Solo         Partnered


────────────────────────────


MONTHLY ACTIVITY

20 │
   │
15 │       ▇
   │ ▇     ▇   ▇
10 │ ▇ ▇   ▇ ▇ ▇
   │ ▇ ▇ ▇ ▇ ▇ ▇
 5 │ ▇ ▇ ▇ ▇ ▇ ▇
   └────────────────────
     J F M A M J ...


────────────────────────────


YOUR PATTERNS

Average interval

3.1 days


Most common day

Sunday


Most common time

10 PM – 1 AM
```

---

# 15. Insights — Period Selector

```text
Month
Year
All Time
```

All Timeでは年単位表示。

```text
OVER TIME

2026        94
2027       103
2028        97
2029        88
2030        91
```

長期利用時に、この画面がSolo + Usの中心価値になる。

---

# 16. Insight Language Rules

許可：

> Your activity was more frequent on weekends.

> Your average interval this year is 3.1 days.

> You recorded more activity in May than in April.

Health data連携後：

> In your recorded history, activity was less frequent following nights with under 6 hours of sleep.

禁止：

> You should have sex more often.

> Your libido is unhealthy.

> Masturbating this often is bad.

> Better sexual health.

ユーザーのデータを**記述する**。

ユーザーを**評価しない**。

---

# 17. Screen 07 — Settings

```text
Settings


PRIVACY

App Lock                         >
Hide App Preview                 >


HEALTH

Health Connect                   >


DATA

Export Data                      >
Import Data                      >
Delete Data                      >


PREFERENCES

First Day of Week                >
Time Format                      >
Appearance                       >


ABOUT

About Solo + Us                  >
Privacy Policy                   >
Version                         1.0
```

---

# 18. Screen 08 — Health Connect

```text
Health Connect


○ Connected


SYNC TO HEALTH CONNECT

Sex / Partnered             ON

Masturbation / Solo         ON


────────────────────────────


About synchronization

Health Connect currently stores
these entries as sexual activity.

Solo + Us keeps Solo and
Partnered separately inside
the app.


Last synced
Today · 10:24 AM
```

重要：

Health Connect上でSolo / Partneredの区別が維持されると誤解させない。

---

# 19. Screen 09 — App Lock

```text
App Lock


Use App Lock                    ON


LOCK WITH

Biometrics                       ✓
Device PIN


LOCK

Immediately                      ✓
After 1 minute
After 5 minutes
```

ロック画面：

```text
              +

          Solo + Us


             🔒

           Unlock
```

ロック画面にはactivity count等を表示しない。

---

# 20. Screen 10 — Export

```text
Your Data


Export everything you've
recorded in Solo + Us.


JSON
Complete backup

CSV
For spreadsheets and analysis


        Export JSON

        Export CSV
```

JSONにはschema versionを必ず含める。

```json
{
  "version": 1,
  "exportedAt": "...",
  "activities": []
}
```

---

# 21. Interaction Rules

## Quick Record

目標：

```text
App Open
   ↓
＋
   ↓
Solo / Partnered
   ↓
DONE
```

通常操作では詳細フォームを挟まない。

## Edit Later

詳細を入力したいユーザーのみ、

```text
Recent
 ↓
Activity
 ↓
Details
```

から編集する。

---

# 22. Motion

Animationは控えめ。

記録成功：

```text
＋
↓
✓
```

程度の150–250ms transition。

Confetti、fire、celebration animationは使用しない。

これは「達成」ではなく「記録」である。

---

# 23. Accessibility

最低限：

- Dynamic Type対応
- Screen Reader labels
- Solo / Partneredを色だけで区別しない
- 44pt以上のtouch target
- sufficient contrast
- Reduce Motion対応
- chartにはtext summaryを提供

---

# 24. Component Structure

```text
components/

├─ AppHeader
├─ SectionHeader
├─ MetricCard
├─ ActivityTypeCard
├─ ActivityRow
├─ ActivityBadge
├─ QuickRecordSheet
├─ RecordSnackbar
├─ MonthCalendar
├─ InsightCard
├─ ActivityChart
├─ EmptyState
├─ SettingsRow
├─ AppLockOverlay
└─ IntersectPlus
```

---

# 25. Suggested Routes

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
├─ onboarding/
│  ├─ index.tsx
│  └─ privacy.tsx
│
└─ settings/
   ├─ index.tsx
   ├─ health-connect.tsx
   ├─ app-lock.tsx
   ├─ data.tsx
   └─ about.tsx
```

---

# 26. MVP UI Priority

### Phase 1 — Core

Today  
Quick Record  
Activity Detail  
Edit / Delete  
SQLite

### Phase 2 — History

Calendar  
Monthly statistics  
Recent history

### Phase 3 — Insights

Year statistics  
Intervals  
Weekday / time patterns  
All-time history

### Phase 4 — Privacy / Health

App Lock  
Recents protection  
Health Connect  
Export / Import

---

# 27. Do Not Build Yet

v1では以下を入れない。

- streak
- goals
- badges
- social sharing
- partner accounts
- community
- AI advice
- medical diagnosis
- recommendations based on frequency
- advertisements
- cloud account
- push notifications
- complicated sexual detail diary
- pornography tracking
- abstinence tracking

---

# 28. Core UX Test

新機能を追加するときは必ず問う。

> **Does this make it easier to privately record and understand your intimate life over time?**

YESなら検討。

NOなら原則追加しない。

---

# 29. Final Product Identity

Solo + Usは、

**Masturbation Trackerではない。**

**Sex Diaryでもない。**

**NoFapアプリでもない。**

位置付けは、

> **A private, long-term record of your intimate life.**

そしてブランドを一文で表すなら、

> **Solo + Us — Your intimate life, over time.**