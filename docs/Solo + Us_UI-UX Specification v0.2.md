# Solo + Us — UI/UX Specification v0.2

**App Name:** Solo + Us  
**Tagline:** *Your intimate life, over time.*

改訂：2026-09-16  
関連：要件定義書 v0.2 / 基本設計 v0.2 / **設計判断記録 v0.2**

> **本文と図版が矛盾する場合は本文を正とする。**
> `docs/old/` は検討履歴であり仕様ではない。
> 記録の確認表現は Snackbar が正であり、専用の「記録完了画面」は不採用。

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

## Dark Palette

Settings に Appearance があり、App Icon にも Dark 版があるため、トークンも両テーマ分を定義する。

```ts
export const darkColors = {
  solo: '#4FA890',
  partnered: '#F0B2A6',
  intersection: '#7FB3A6',

  background: '#121615',
  surface: '#1B211F',

  textPrimary: '#F2F4F3',
  textSecondary: '#A8B0AD',
  textTertiary: '#79827F',

  border: '#2C3532',
  destructive: '#E0827F',
};
```

Dark では彩度を落として明度を上げる。Light の値をそのまま暗い背景に載せない。
コントラスト比は §23 の受け入れ基準で検証する。

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

## Undo の仕様

**同期遅延と Snackbar 表示を分離する。**

| | 値 | 根拠 |
|---|---|---|
| 同期遅延 | **記録時刻 + 5秒固定** | 永続キューの時刻列で表現するため、アプリが kill されても失われない |
| Undo 可能期間 | **Snackbar 表示中** | 画面遷移で Snackbar が消えたら Undo も終了する。同期遅延は変更しない |

- Undo 対象は直前の1件のみ。冪等に実装する
- Undo 実行時は SQLite から物理削除し、未送信の同期ジョブを削除する
- Snackbar が消えてから同期開始までの数秒は「Undo できないが未同期」になるが、無害である

タイマーで同期をキャンセルする方式は採らない。アプリが即座に kill されると遅延が失われ、同期されてしまう。

5秒以内に詳細画面で編集された場合も、ジョブを2つに分けず最終状態を1回で送る。

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

最終的には seconds で保存。

**日時の入力・表示精度は分単位とし、記録時刻の秒は常に `00` に正規化する。**
秒を扱う UI を設けない。

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

## 表示規則

計算方法は基本設計 §14 に従う。UI 側で守るべき点は以下。

| 項目 | 規則 |
|---|---|
| Average interval | 2件未満は `—` を表示する |
| Most common day | 10件未満は `—`。同率首位が2つなら `Sunday and Friday` と併記。3つ以上なら `—` |
| Most common time | **1時間刻みの循環3時間ウィンドウ**の最大値。`10 PM – 1 AM` のような日跨ぎ表記を許す |
| 件数不足 | 空欄にせず `—` を出し、評価的な代替文言（「まだ足りません」等）を出さない |

固定3時間バケット（`21–24` / `0–3`）では `10 PM – 1 AM` を原理的に表示できないため、循環ウィンドウを用いる。

同率首位を隠さず併記するのは、**件数が十分あるうえでの同率は事実**であり、事実は記述してよいため。評価はしない。

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

Partnered                   ON

Solo                        ON


────────────────────────────


About synchronization

Health Connect currently stores
these entries as sexual activity.

Solo + Us keeps Solo and
Partnered separately inside
the app.


Last synced
Today · 10:24 AM


Unsynced changes            3
[ Retry now ]
```

重要：

Health Connect 上で Solo / Partnered の区別が維持されると誤解させない。

---

## 未同期の変更

同期エラーはこの画面にのみ表示する。**Today や Insights には出さない。**
記録画面に外部同期の失敗を持ち込まない。

---

## 接続を OFF にするとき

未反映の削除が残っている場合は必ず警告する。

```text
Health Connect に未反映の削除が
2 件あります。

切断すると、これらの記録は
Health Connect 上に残ります。

[ 先に処理する ]   [ このまま切断する ]
```

---

## 既知の制限

Health Connect 側でユーザーが手動削除しても、v1 は Health Connect を読まないため検知できない。

---

# 19. Screen 09 — App Lock

```text
App Lock


Use App Lock                    ON


UNLOCK WITH

Device authentication            ✓
（生体認証、利用できない場合は端末パスコード）


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

      Unlock with device
        authentication
```

ロック画面には activity count 等を表示しない。

---

## アプリ独自の PIN を実装しない

文言は「Device PIN」ではなく **「端末の認証 / Device authentication」** とする。
OS ごとの解除手段の差をアプリ側で説明しすぎない。

独自 PIN を持つと「PIN 忘れ時の復旧」が必要になり、
復旧手段を用意すればロックは形骸化し、用意しなければ利用者は自分のデータに二度と触れられない。

---

## App Lock と DB 暗号鍵は別物

```text
App Lock     : 画面を表示してよいか
DB 暗号鍵    : データが読めるか（生体認証と結合しない）
```

生体情報の変更で DB が復号できなくなる実装にしない。

---

## 受け入れ条件

- 生体認証を無効にしている端末でも、端末パスコード等で解除できること（実機で確認する）
- バックグラウンド移行時に内容がマスクされること

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

# 21. Screen 11 — Recovery（復号できない場合）

「DB は存在するが暗号鍵が読み出せない」状態は、端末移行や OS バックアップからの復元で現実に起こりうる。
**このときアプリはクラッシュせず、専用画面を出す。**

```text
              +

        Solo + Us


  このデバイスでは記録データを
  復号できませんでした。


  端末の移行や復元によって、
  暗号鍵が失われた可能性があります。


  ┌────────────────────────────────┐
  │  バックアップから復元する       │
  └────────────────────────────────┘

  ┌────────────────────────────────┐
  │  データを削除してやり直す       │
  └────────────────────────────────┘
```

- 「バックアップから復元する」→ Import 画面へ
- 「データを削除してやり直す」→ 確認のうえ DB を破棄して初期化

## 文言のルール

- 利用者の操作ミスとして書かない（実際にほとんどの場合そうではない）
- 何が起きたかを事実として述べ、選べる操作を2つだけ出す
- 復旧できない可能性を隠さない

---

# 22. Interaction Rules

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

# 23. Motion

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

# 24. Accessibility

「対応する」ではなく、**検証できる受け入れ基準**として定義する。

| # | 受け入れ基準 |
|---|---|
| A1 | 最大 Dynamic Type でも記録フローが完結し、要素が切れない |
| A2 | VoiceOver / TalkBack だけで Quick Record ができる |
| A3 | Solo / Partnered を色覚に依存せず識別できる（ラベルまたはアイコン併用） |
| A4 | グラフと同じ情報をテキストでも取得できる |
| A5 | すべての操作対象が 44pt 以上 |
| A6 | Light / Dark の両テーマでコントラスト比を満たす |
| A7 | Reduce Motion 有効時にトランジションが無効化される |
| A8 | **記録フローが片手の親指到達域で完結する**（FAB → シートのカードが画面下半分に収まる） |

A8 は、このアプリが片手・短時間・人目を気にする状況で使われる前提によるもので、
利便性ではなく機能要件に近い性質を持つ。

検証は画面幅 320dp でも行う。

---

# 25. Component Structure

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
├─ SyncStatusRow        -- 未同期の変更と再試行
├─ ImportPreview        -- 件数プレビュー（確定前）
├─ DestructiveConfirm   -- 置換復元・全削除の確認
├─ RecoveryPanel        -- 復号できない場合の選択肢
└─ IntersectPlus
```

v0.2 で追加した4つは、いずれも**失敗・破壊的操作を利用者に見せるための部品**である。
これらを装飾的にしない。

---

# 26. Suggested Routes

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
├─ recovery.tsx
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

# 27. MVP UI Priority

基本設計 §18 の開発順序と対応する。
v0.1 から順序を変更し、**暗号化と復元可能性を Phase 1 に置いた**（後付けできないため）。

### Phase 1 — Core

暗号化 DB 接続 / Migration runner / スキーマ  
Today / Quick Record / Undo  
Activity Detail / Edit / Delete  
Export・Import の schema 定義と往復テスト

### Phase 2 — History

Calendar / 月次統計 / Recent history  
詳細項目の入力 UI

### Phase 3 — Privacy & Data

App Lock / **Recovery 画面** / Recents protection  
Export / Import の UI  
Insights（合計・内訳・平均間隔）

### Phase 4 — Health & Release

Health Connect（clientRecordId 確認 → 同期 → リトライ → 削除同期）  
Health apps declaration 提出 / ストア申請  
Insights（年次・曜日・時間帯・All Time）

---

# 28. Do Not Build Yet

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
- 独自 PIN
- 双方向同期 / 自動マージ
- 行単位スキップ付きの Import

---

# 29. Core UX Test

新機能を追加するときは必ず問う。

> **Does this make it easier to privately record and understand your intimate life over time?**

YESなら検討。

NOなら原則追加しない。

---

# 30. Final Product Identity

Solo + Usは、

**Masturbation Trackerではない。**

**Sex Diaryでもない。**

**NoFapアプリでもない。**

位置付けは、

> **A private, long-term record of your intimate life.**

そしてブランドを一文で表すなら、

> **Solo + Us — Your intimate life, over time.**