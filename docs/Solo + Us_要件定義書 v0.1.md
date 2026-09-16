# Sexual Wellness Tracker 要件定義書

作成日：2026-09-15  
ステータス：初期要件定義

---

## 1. プロジェクト概要

### 1.1 アプリ概要

Sex / Masturbationなどの性的活動を、日々の健康データの一つとして簡単に記録・蓄積するモバイルアプリ。

禁欲・依存克服・回数削減を主目的とせず、

> **性的活動を評価せず、淡々と記録する**

ことを基本思想とする。

長期間記録することで、

- 年齢による頻度の変化
- Sex / Masturbationの割合
- 曜日・時間帯による傾向
- 月・年単位での変化
- 他の健康データとの関連

などを振り返れるPersonal Health Logを目指す。

AndroidではGoogle Health Connectとの連携を行い、可能な範囲で標準の健康データとしても保存する。

---

# 2. 開発目的

## 2.1 背景

SexやMasturbationは健康・生活の一部であるにもかかわらず、歩数・睡眠・運動・体重などと比較すると、長期間記録する手段が少ない。

既存アプリには、

- 禁欲
- NoFap
- Porn addiction対策
- streak管理

を目的としたものが多い。

本アプリではこれらとは異なり、

**「増やす」「減らす」「我慢する」などの価値判断を行わない。**

単純に、

> いつ、どのようなsexual activityがあったか

を記録する。

---

## 2.2 長期的な目的

数年〜数十年単位で利用できるデータを蓄積する。

例：

| 年 | 年齢 | Masturbation | Sex | Total |
|---|---:|---:|---:|---:|
| 2026 | 41 | 80 | 45 | 125 |
| 2027 | 42 | 91 | 38 | 129 |
| 2028 | 43 | 72 | 52 | 124 |
| 2030 | 45 | 65 | 41 | 106 |
| 2035 | 50 | 35 | 29 | 64 |

長期利用時に、

「40代前半と後半でどう変化したか」

「Sexが減っただけなのか、sexual activity全体が減ったのか」

などを振り返れる状態を目指す。

---

# 3. プロダクトコンセプト

## 3.1 基本コンセプト

**Personal Sexual Wellness Log**

性的活動を健康データとして記録する、プライバシー重視の個人ログ。

---

## 3.2 基本原則

### Judgment-free

回数について「多い」「少ない」「良い」「悪い」と評価しない。

### No streak pressure

「禁欲○日達成」などを主要機能にしない。

### Low friction

記録を面倒にしない。

基本操作は、

**種類を選ぶだけで現在日時に記録**

できるものとする。

### Privacy first

非常にセンシティブなデータであるため、原則として端末内で管理する。

### Long-term data

短期的な習慣改善より、数年〜数十年単位でデータを残すことを重視する。

---

# 4. 対応プラットフォーム

初期対象：

- Android
- iOS

開発候補：

- React Native
- Expo
- SQLite

AndroidではHealth Connectに対応する。

iOSでは将来的にApple Health / HealthKit対応を検討する。

---

# 5. 記録対象

## 5.1 Activity Type

初期版では以下の2種類とする。

### Masturbation

自慰行為。

### Sex

パートナーとの性的活動。

---

## 5.2 将来拡張

将来的なデータタイプ追加を考慮した設計とする。

ただし初期版では種類を増やしすぎない。

---

# 6. 記録項目

## 6.1 必須項目

記録時に必須なのは以下のみ。

```text
type
dateTime
```

例：

```text
type: MASTURBATION
dateTime: 2026-09-15 22:35
```

---

## 6.2 任意項目

以下は入力しなくても保存できる。

```text
duration
ejaculation
orgasm
moodBefore
moodAfter
note
```

詳細項目についてはユーザーテスト後に追加・削除を検討する。

---

# 7. 最重要UX

## 7.1 クイック記録

アプリ起動後、可能な限り少ない操作で記録できること。

例：

```text
Today
────────────────

Last activity
2 days ago

This month
8

        ＋ Record
```

「Record」を押す。

```text
What?

┌────────────────┐
│  Masturbation  │
└────────────────┘

┌────────────────┐
│      Sex       │
└────────────────┘
```

種類をタップした時点で、

```text
現在日時
+
Activity Type
```

を保存する。

**基本記録は2タップ以内を目標とする。**

---

# 8. 詳細記録

記録後、必要な場合のみ詳細情報を追加できる。

例：

```text
Masturbation

Sep 15, 2026
22:35

Duration
12 min

Ejaculation
Yes

Orgasm
Yes

Mood before
●●●○○

Mood after
●●●●○

Note
────────────

[ Save ]
```

詳細入力を強制しない。

---

# 9. ホーム画面

ホーム画面では直近の状況を簡潔に表示する。

例：

```text
Today

Sexual Wellness
────────────────

Last activity
2 days ago

This month
8

Masturbation
5

Sex
3


        ＋ Record
```

---

# 10. カレンダー

月単位でActivityを確認できる。

例：

```text
September 2026

 M  T  W  T  F  S  S

    ●        ●
          ●        ●
 ●
```

Sex / Masturbationを視覚的に区別する。

日付を選択すると、その日のActivity一覧を表示する。

---

# 11. Statistics

以下の統計を提供する。

## 基本統計

- 今月の回数
- 前月の回数
- 年間回数
- Masturbation回数
- Sex回数
- Total Sexual Activity
- 平均間隔
- 最終Activityからの日数

---

## 傾向

- 曜日別
- 時間帯別
- 月別
- 年別
- Masturbation / Sex比率

---

## 長期推移

年単位で比較できることを重要視する。

例：

```text
Sexual Activity

2026  █████████████ 125
2027  █████████████ 129
2028  ████████████  124
2029  ███████████   113
2030  ██████████    106
```

---

# 12. Insights

一定量のデータが蓄積された場合、ユーザー自身の傾向を表示する。

例：

```text
Your patterns

Most common day
Sunday

Most common time
23:00–01:00

Average interval
3.4 days
```

アプリは医学的・心理学的な評価を行わない。

---

# 13. Health Connect連携

## 13.1 Android

Google Health Connectの

```text
SexualActivityRecord
```

との連携を行う。

Health Connect上ではSex / Masturbationを区別するフィールドが存在しないため、アプリ内データを正とする。

---

## 13.2 データ構造

```text
App Database

Activity
├─ type
│   ├─ MASTURBATION
│   └─ SEX
│
├─ dateTime
├─ duration
├─ ejaculation
├─ orgasm
├─ moodBefore
├─ moodAfter
└─ note
```

Health Connect：

```text
Masturbation ─┐
              ├──→ SexualActivityRecord
Sex ──────────┘
```

---

# 14. Health Connect同期設定

ユーザーが同期対象を選択できる。

```text
Health Connect

Sexual activity synchronization
ON

Sync

☑ Sex
☑ Masturbation
```

説明を表示する。

> Health ConnectではSexとMasturbationを区別するデータ項目がありません。
>
> 選択したActivityはHealth Connect上ではすべて「Sexual activity」として保存されます。

---

# 15. Health Connectの基本方針

Health Connectは**アプリDBの代替にはしない。**

```text
                  Activity
                     │
             ┌───────┴───────┐
             ↓               ↓

        Local SQLite     Health Connect

        詳細データ        標準健康データ
        Type区別          Sexual Activity
        統計用            他アプリとの連携
```

アプリDBをPrimary Data Sourceとする。

Health Connectは外部健康データ基盤として扱う。

---

# 16. 将来のHealth Connect仕様変更への対応

将来Googleが、

```text
MasturbationRecord
```

または

```text
SexualActivityRecord.activityType
```

などを追加した場合でも対応できるよう、アプリDBでは必ずActivity Typeを保持する。

これにより既存データを新しいHealth Connect形式へ再同期できるようにする。

---

# 17. Health Data連携

将来的にはHealth Connectから他の健康データを読み込み、Activityとの関連を分析できるようにする。

候補：

- Sleep
- Exercise
- Steps
- Resting Heart Rate
- Weight
- Mood関連データ

---

# 18. Personal Analytics

十分なデータがある場合のみ相関を計算する。

例：

```text
Your patterns

Sleep < 6 hours

Sexual activity
1.4× more frequent
```

または、

```text
Exercise days

Sexual activity
18% less frequent
```

---

## 18.1 表現上のルール

因果関係として表示しない。

NG：

> 睡眠不足になるとMasturbationが増えます。

OK：

> 過去90日の記録では、睡眠6時間未満の日にActivityが記録された割合が高くなっています。

あくまで**ユーザー自身の記録上の相関**として扱う。

---

# 19. Privacy

本アプリにおいて最重要要件の一つとする。

## 基本方針

- アカウント不要
- 原則ローカル保存
- 独自サーバーへのActivity送信なし
- Activityを広告目的に利用しない
- Health Connectデータを広告目的に利用しない
- 不要なAnalyticsを導入しない

---

# 20. アプリロック

以下に対応する。

Android：

- 生体認証
- PIN

iOS：

- Face ID
- Touch ID
- PIN

設定により有効化できる。

---

# 21. Discreet Mode

アプリ内容を第三者に推測されにくくする機能を検討する。

候補：

- 通知にActivity内容を表示しない
- Recent Apps画面をマスク
- アプリ名・アイコンの配慮
- Widgetではセンシティブ情報を非表示

初期版では通知機能そのものを搭載しない方針も検討する。

---

# 22. Backup / Export

長期間保存をコンセプトとするため、データ消失対策を重要視する。

## Export

以下の形式を検討する。

```text
CSV
JSON
```

ユーザー自身がデータを保持できることを優先する。

---

## Import

エクスポートしたデータを再インポート可能にする。

端末変更時にも履歴を引き継げるようにする。

---

# 23. 削除

ユーザーはいつでも、

- 個別Activity削除
- 期間指定削除
- 全Activity削除

を実行できる。

Health Connect同期済みの場合の削除同期については、Health Connectの仕様を確認したうえで設計する。

---

# 24. Monetization

初期候補：

**無料 + Pro買い切り**

または、

**基本機能無料 + 高度分析Pro**

を検討する。

広告モデルはセンシティブなデータを扱うアプリとの相性が悪いため、原則採用しない。

---

## 無料候補

- Activity記録
- Sex / Masturbation
- カレンダー
- 基本統計
- ローカル保存
- Health Connect書き込み

基本的な「記録」は無料で成立させる。

---

## Pro候補

- 長期Analytics
- Health Dataとの相関分析
- 詳細グラフ
- CSV / JSON Export
- カスタム記録項目
- 高度なInsights

---

# 25. MVP

最初から大規模なHealthアプリにはしない。

## v1.0

必須：

- Masturbation記録
- Sex記録
- 日時変更
- 履歴
- 編集
- 削除
- カレンダー
- 月間回数
- Masturbation / Sex内訳
- ローカルSQLite
- 生体認証ロック
- Health Connect書き込み
- Health Connect同期設定

---

## v1.1

候補：

- 詳細統計
- 年間グラフ
- 曜日分析
- 時間帯分析
- CSV / JSON Export / Import

---

## v1.2以降

候補：

- Health Connect読み込み
- Sleepとの相関
- Exerciseとの相関
- Heart Rate等との相関
- Personal Insights
- HealthKit
- Backup

---

# 26. 非機能要件

## Performance

Activity数が10年以上蓄積されても快適に動作すること。

1日数件としてもデータ量は非常に小さいため、SQLiteで十分対応可能と想定する。

---

## Offline

すべての基本機能をオフラインで利用可能とする。

---

## Reliability

記録データの消失を最優先で防ぐ。

DB Migrationを慎重に設計する。

---

## Security

センシティブなデータであることを前提とする。

必要に応じてSQLite暗号化も検討する。

---

# 27. UI / Design方針

性的・アダルト的なデザインにしない。

イメージ：

- Apple Health
- Google Fit
- Fitbit
- シンプルなPersonal Tracker

避けるもの：

- 性的画像
- 性器を連想させるイラスト
- Porn的表現
- 「我慢」「失敗」などの評価
- 🔥を使ったstreak演出
- ゲーミフィケーション過多

---

# 28. アプリの価値

本アプリが提供する価値は、

> 「Masturbationを管理する」

ことではない。

また、

> 「Sexを増やす」

ことでもない。

**自分のsexual activityを、自分自身の健康・生活履歴として長期間残すこと。**

歩数、睡眠、運動、体重などと同じように、

```text
Sleep
Exercise
Weight
Heart Rate
Sexual Activity
```

という一つのPersonal Health Dataとして扱う。

---

# 29. 本アプリのポジショニング

```text
NoFap / 禁欲アプリ
        │
        │ 目的：減らす・やめる
        │
        ↓
────────────────────

        本アプリ

   Personal Sexual
    Wellness Log

        │
        │ 目的：記録・理解
        ↓

────────────────────
        │
        │ 詳細な性行為日記
        ↓
Sex Diary / Couple App
```

NoFapアプリでもSex Diaryでもない中間領域を狙う。

---

# 30. コアメッセージ

候補：

> **Just track it.**

または、

> **Your sexual health, over time.**

アプリ自身はユーザーの性的活動を評価しない。

**Record. Understand. That's it.**

を基本思想とする。

---

# 31. MVP成功条件

初期版の成功条件は機能数ではなく、

> **Activityを数秒で記録でき、それを何年間でも続けられること**

とする。

「毎回詳細入力したくなるアプリ」ではなく、

**「面倒にならず記録し続けられるアプリ」**

を最優先する。