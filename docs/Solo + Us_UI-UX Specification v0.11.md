# Solo + Us — UI/UX Specification v0.11

**App Name:** Solo + Us  
**Tagline:** *Your intimate life, over time.*

改訂：2026-09-16  
関連：要件定義書 v0.11 / 基本設計 v0.11 / **設計判断記録 v0.11**

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
  partneredStrong: '#92635B',
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

Partnered activity。ブランドの面の色（大きめの色面・`IntersectPlus` ブランドマークなど装飾用途）。

`partneredStrong`

`partnered` の濃色バリアント。文字やドット等の小さな図形要素に `partnered` を使うと、
Light テーマで背景（`background`/`surface`）に対して約 1.8〜1.95:1 しかなく、WCAG 1.4.11
（図形要素 3:1）・1.4.3（大きな文字 3:1）を満たさない。**色そのもので「Partnered」を
伝える要素（Activity バッジのドット、Calendar のドット、件数表示など）には `partnered`
ではなく `partneredStrong` を使う。** Dark テーマは `partnered` 自体で十分なコントラストが
あるため、`partneredStrong` は `partnered` と同値でよい。

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
  partneredStrong: '#F0B2A6',
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

Recent / Calendar から開く。

```text
Activity                            ⋯


Solo


DATE & TIME

Sep 14, 2026
11:42 PM


DETAILS

Orgasm
Not recorded                         >

Notes
Add a note                           >


        + Add more details


────────────────────────────

Health Connect
Synced


────────────────────────────

Delete Activity
```

詳細項目は**すべて Optional**。Quick Record 時には入力を要求しない。

---

## 表示項目は設定に従う

表示する項目は Settings > Activity Details（§17）の設定に従う。
**既定では Orgasm と Notes のみ表示する。**

```text
既定 ON    Orgasm / Notes
既定 OFF   Ejaculation / Protection / Duration / Mood before / Mood after
```

「射精したか」を標準項目に据えると、アプリ全体が男性中心の設計に見える。
既定値を Orgasm 中心にすることが、この問題の実際の解決策であり、設定画面はその調整手段にすぎない。

---

## 不変条件：記録済みの値は常に表示する

> **設定が OFF の項目でも、値が記録されていれば必ず表示する。**

設定が制御するのは「未記録の項目を編集画面に出すかどうか」だけであり、
既存の値を隠す手段ではない。これを守らないと、設定変更で実データが見えなくなる。

```text
DETAILS

Orgasm
Yes                                  >

Ejaculation                ← 設定は OFF だが値があるので表示する
Yes                                  >

Notes
Add a note                           >
```

---

## + Add more details

設定が OFF の項目にも、この行から到達できる。

```text
Add more details

○ Ejaculation
○ Protection
○ Duration
○ Mood before
○ Mood after
```

ある日だけ記録したい項目のために設定画面を往復させない。

---

## Partnered の場合

Protection を既定表示にする。ただし **Solo で選べないようハードゲートはしない。**

アプリが「あなたにこの項目は関係ない」と決める構造を作らない。

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

## Protection

```text
プロテクション
Protection

○ Not recorded
○ Yes
○ No

避妊・感染予防のための保護具を
使用したかどうか
```

**「避妊具」単独の表記を使わない。** 感染予防の目的が抜けて読める。
行ラベルは短く保ち、目的の説明は補助テキストに置く。

---

## Orgasm と Ejaculation は別項目である

同じ意味に畳まない。Partnered では `Orgasm = Yes` かつ `Ejaculation = No` のようなケースがあり得る。

また「sexual activity の結果 ＝ ejaculation」と定義してしまうと、
アプリ全体が特定の身体を前提にした設計になる。

---

## `Not recorded` と `No` を区別する

DB 上でも明確に区別する。

```text
Not recorded  →  記録していない
No            →  「なかった」と記録した
```

統計上この2つを混同しない。

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

## Outcome を指標にしない

Orgasm / Ejaculation / Protection は記録・表示・Export の対象とするが、**Insights で集計しない。**

禁止：

> Orgasm rate: 62%

> You reached orgasm in 8 of 12 activities.

> Your orgasm rate improved this month.

割合・率・達成度として提示すると、達成率のスコアカードとして読まれる。
低い数字を見せることに治療的・矯正的な含みが生まれ、「評価しない」という原則が崩れる。

```text
Context（Solo / Partnered） : 集計してよい
Outcome                     : 集計しない
```

Insights が扱うのは「いつ・どれだけ・どの間隔で」であり、「うまくいったか」ではない。

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

（Delete Data と Import Data では
  Health Connect への影響が異なる。
  それぞれの確認画面で言い分ける）


TRACKING

Activity Details                 >


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

## Screen 07a — Activity Details（表示項目のカスタマイズ）

```text
Activity Details


Choose what you want to track.
You can change this anytime.


TRACKING DETAILS

Orgasm                          ON
Ejaculation                    OFF
Protection                     OFF
Duration                       OFF
Mood before / after            OFF
Notes                           ON


Values you have already recorded
are always shown, even if turned off.
```

### 設計意図

**アプリは利用者の性別を尋ねない。**

「男性なら Ejaculation、女性なら Orgasm」と出し分けるのではなく、**必要な項目を本人が選ぶ**。

これにより、

- 男性でも「Orgasm だけ記録したい」でよい
- 女性でも必要なら Ejaculation を有効にできる
- トランス・ノンバイナリーの利用者に対して、アプリが身体的特徴を推測しない
- **性別という属性そのものを保存しなくて済む**（持たないデータは漏れない）

### 文言のルール

- 「あなたに必要な項目」のように、アプリ側が利用者の属性を推定する書き方をしない
- 既定値の理由を説明しない（説明すると属性の話になる）
- OFF にすることを「使わない」ではなく「表示しない」と表現する

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

Health Connect に保存されるのは、
記録した日時と、避妊具使用の有無だけです。

Solo / Partnered の区別、Orgasm、
Mood、Notes は Solo + Us の中だけに
保存されます。


Last synced
Today · 10:24 AM


Unsynced changes            3

Sep 14  Solo
Not synced to Health Connect
[ Retry now ]   [ Don't sync ]

Sep 11  Partnered
Deletion not applied
[ Retry now ]   [ Stop retrying ]

Sep 08  Solo
Syncing…
```

重要：

Health Connect 上で Solo / Partnered の区別が維持されると誤解させない。

---

## 未同期の変更

同期エラーはこの画面にのみ表示する。**Today や Insights には出さない。**
記録画面に外部同期の失敗を持ち込まない。

### 破棄の経路が必要な理由

外部の状態を読む権限を持たないため、「既に削除済みなのか、まだ残っているのか」を
アプリ側から確認できない場合がある。

永久に消えない未同期表示を残さないために、**最終的に人間が打ち切れる経路**を用意する。

### 「解決済みにする」という語を使わない

外部の状態を確認していないのに、解決したように見えるため。
**何が起きるかを operation ごとに言い分ける。**

| 対象 | 操作名 | 確認文 |
|---|---|---|
| 削除の同期 | この削除の再試行を停止 | この記録は Health Connect 上に残る可能性があります |
| 記録・更新の同期 | この記録を Health Connect へ同期しない | Solo + Us と Health Connect の内容が一致しなくなります |
| 内部エラー | この同期エラーを破棄 | — |

特に記録・更新の同期を黙って破棄すると、
**利用者はローカルと Health Connect が一致していると誤解する。**

### 処理中のジョブは操作できない

送信中に破棄されると、**外部に作られた記録を取り消す手段がなくなる。**

処理中の行はボタンを無効化し `Syncing…` と表示する。
操作が競合した場合は「現在処理中です。完了後にもう一度操作してください」を出す。

---

## 破壊的操作は同期の完了を待つ

置換復元・全データ削除・Health Connect の切断は、実行中の同期処理と排他する。

```text
同期の完了を待っています…

           ◷

処理が終わらない場合は、アプリを
再起動してからもう一度お試しください。

    [ キャンセル ]
```

内部事情（ネイティブ処理が settle しない可能性）を説明せず、**操作だけを案内する。**

**「待ちきれないから強行する」ボタンを置かない。**
キャンセルは破壊的操作を中止するものであり、同期を中断するものではない。

破壊的操作はやり直せるが、外部に取り残された記録は利用者が自力で見つけられない。

---

## 全データ削除

### 確認文

```text
すべての記録を削除しますか？

端末の記録はすぐに削除されます。

Health Connect 上の記録は順次削除
されます。完了前にアプリを削除すると、
Health Connect には残ります。

[ キャンセル ]        [ 削除 ]
```

置換復元では Health Connect 上の記録は残る。**同じ「消える」でも影響が違うため、
確認文で言い分ける。**

### 進行表示

```text
削除しています…

Health Connect     12 / 47

アプリを閉じると削除は一時停止し、
次回起動時に再開します。

[ 画面を閉じる ]
```

全削除は「記録を消したい」という意思が最も強い場面であり、
**消したい瞬間に外部へ残ることが、このアプリにとって最大の失敗**になる。
キューに投げっぱなしにせず、進行を前面に出す。

**「バックグラウンドで続ける」と書かない。**
v1 はバックグラウンド同期を実装しないため、OS のバックグラウンドでも削除が続くと誤解される。
このボタンが意味するのは「進行画面を閉じてアプリ内の別画面へ戻る」だけである。

### 再起動後の表示

```text
Health Connect から削除中
残り 35 件
```

進行総数は永続化しないため、再起動後は残り件数だけを表示する（基本設計 §10.6）。

### Health Connect が未接続の場合

外部削除を実行できないため進行は進まない。**「削除中」と「再接続待ち」を分ける。**

```text
端末からすべての記録を削除しました。

Health Connect から削除する記録が
35 件残っています。

再接続すると削除を再開できます。
```

**進行バーを出したまま止めない。** 止まっている理由を状態として示す。

### 完了表示を言い分ける

```text
端末からすべての記録を削除しました。
Health Connect からの削除を続けています。
```

```text
すべて削除されました。
```

**前者の状態で「完了」と言わない。**
未処理が残っている間は Settings に件数を表示し続ける。

### アプリの終了を禁止しない

途中で閉じてもキューは残り、次回起動時に自動再開する。
終了を禁止しても OS には勝てないため、**再開できる設計で担保する。**

---

## 接続を OFF にするとき

未反映の削除が残っている場合は必ず警告する。

```text
Health Connect に未反映の削除が
2 件あります。

切断すると、これらの記録は
Health Connect 上に残ります。
再接続すると、残っている削除を
再開できます。

[ 先に処理する ]   [ このまま切断する ]
```

**切断しても未処理のジョブは破棄しない。** 破棄すると、外部に残った記録へ
到達する手段が永久に失われる。個別に打ち切りたい場合は上記の破棄操作を使う。

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

- 「バックアップから復元する」→ Recovery 専用の復元経路へ（通常の Import 画面ではない）
- 「データを削除してやり直す」→ 確認のうえ DB を破棄して初期化

## App Lock を経ずに到達する

App Lock の設定は暗号化 DB 内にあるため、**復号できないときは App Lock の要否が分からない。**

したがってこの画面は App Lock を経ずに表示する。
読めない DB に守るべきデータはないため、これは妥当である。

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
├─ ActivityContextCard
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
├─ DetailFieldRow       -- 記録済みなら設定 OFF でも表示する
├─ AddMoreDetailsSheet  -- OFF の項目への逃げ道
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
   ├─ activity-details.tsx
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
日時編集 UI（過去日時への記録・編集。§8「Just now」からの日時変更入口、基本設計 §4.4/§11.4）  
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
- 性別の質問・保存
- orgasm rate 等の Outcome 指標

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