# Solo + Us 要件定義書 v0.8

作成日：2026-09-15（v0.8 改訂：2026-09-16）  
ステータス：実装着手前の確定版  
関連：基本設計 v0.8 / UI-UX Specification v0.8 / **設計判断記録 v0.8**

> 用語・データ設計・セキュリティ要件は v0.2 で確定した。変更理由は設計判断記録を参照する。
> 本文と図版が矛盾する場合は本文を正とする。`docs/old/` は検討履歴であり仕様ではない。

---

## 1. プロジェクト概要

### 1.1 アプリ概要

Solo / Partnered な性的活動を、日々の健康データの一つとして簡単に記録・蓄積するモバイルアプリ。

禁欲・依存克服・回数削減を主目的とせず、

> **性的活動を評価せず、淡々と記録する**

ことを基本思想とする。

長期間記録することで、

- 年齢による頻度の変化
- Solo / Partnered の割合
- 曜日・時間帯による傾向
- 月・年単位での変化
- 他の健康データとの関連

などを振り返れるPersonal Health Logを目指す。

AndroidではGoogle Health Connectとの連携を行い、可能な範囲で標準の健康データとしても保存する。

---

# 2. 開発目的

## 2.1 背景

性的活動は健康・生活の一部であるにもかかわらず、歩数・睡眠・運動・体重などと比較すると、長期間記録する手段が少ない。

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

| 年 | 年齢 | Solo | Partnered | Total |
|---|---:|---:|---:|---:|
| 2026 | 41 | 80 | 45 | 125 |
| 2027 | 42 | 91 | 38 | 129 |
| 2028 | 43 | 72 | 52 | 124 |
| 2030 | 45 | 65 | 41 | 106 |
| 2035 | 50 | 35 | 29 | 64 |

長期利用時に、

「40代前半と後半でどう変化したか」

「Partnered が減っただけなのか、性的活動全体が減ったのか」

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

技術構成（v0.2 で確定）：

- React Native + Expo Router
- `@op-engineering/op-sqlite`（SQLCipher による暗号化）
- prebuild / dev client 前提（**Expo Go では動作しない**）

暗号化 DB を使うためドライバが `expo-sqlite` では要件を満たさず、
この判断は Phase 1 の最初のコードに影響する。

Android では Health Connect に対応する。ただしリリース判断は §25.1 のゲートに従う。

iOS では将来的に HealthKit 対応を検討する。
HealthKit の sexual activity も Solo / Partnered を区別しないため、
**SQLite を正本とする方針は iOS でも変わらない。**

---

# 5. 記録対象

## 5.1 Activity Context

Activity の分類軸は「行為の種類」ではなく **「相手の有無」** とする。

### Solo

自分ひとりの性的活動。

### Partnered

相手のいる性的活動。**行為の内容は問わない。**

## 5.2 「Solo = Masturbation」と固定しない

`solo` / `partnered` は、何をしたかではなく **一人だったか / 誰かとだったか** を表す。

この軸にすると、

- 挿入を伴わない行為
- partnered な文脈での masturbation
- 将来の類型追加

のいずれでも分類が破綻しない。行為名（`masturbation` / `sex`）を内部値にすると、
これらのケースで意味が壊れる。

## 5.3 将来拡張

将来的なデータタイプ追加を考慮した設計とする。ただし初期版では種類を増やしすぎない。

---

# 6. 記録項目

## 6.1 必須項目

記録時に必須なのは以下のみ。

```text
context
dateTime
```

例：

```text
context:  solo
dateTime: 2026-09-15 22:35
```

## 6.2 任意項目

以下は入力しなくても保存できる。**すべて任意であり、入力を促さない。**

### Outcome（何が起きたか）

```text
orgasm
ejaculation
protectionUsed
```

### Optional context（どういう状況だったか）

```text
duration
moodBefore
moodAfter
note
```

`orgasm` と `ejaculation` は**別項目として保持する**。
Partnered では `orgasm = true` かつ `ejaculation = false` のようなケースがあり得るため、
この2つを同一概念にしない。

`protectionUsed` は Partnered で既定表示とするが、Solo で選べないよう禁止はしない。

### 用語

**「避妊具」単独では感染予防の目的が抜ける。** 行ラベルと説明文を分ける。

```text
行ラベル    プロテクション          （英語版: Protection）
説明文      避妊・感染予防のための保護具を使用したかどうか
```

## 6.3 表示項目は利用者が選ぶ

**アプリは利用者の性別を尋ねず、保存しない。**

項目の出し分けを性別の推定で行うのではなく、利用者自身が表示項目を選ぶ。

```text
TRACKING DETAILS

☑ Orgasm
☐ Ejaculation
☐ Duration
☐ Mood before / after
☐ Protection
☑ Notes
```

既定では **Orgasm と Notes のみ ON**。

### 理由

1. **データ最小化。** 端末の物理取得を想定した脅威モデルに対し、
   出し分けのためだけに性別という属性を増やすのは割に合わない。**持たないデータは漏れない**
2. 身体的特徴をアプリ側が推測しない。トランス・ノンバイナリーの利用者にも同じ設計で成立する
3. 男性でも「Orgasm だけ記録したい」でよく、女性でも必要なら Ejaculation を有効にできる

「射精したか」を標準項目に据えると、アプリ全体が男性中心の設計に見える。
既定値を Orgasm 中心にすることが、この問題の実際の解決策である。

### 不変条件

> **記録済みの値は、表示項目の設定に関わらず常に表示する。**

設定が制御するのは「未記録の項目を編集画面に出すかどうか」だけであり、既存の値を隠す手段ではない。
あわせて「その他の項目を追加」という逃げ道を用意し、OFF の項目にも到達できるようにする。

## 6.4 記録を強制しない

詳細項目は Quick Record では一切尋ねない。
記録したい日にだけ、Activity を開いて追記する（§7、§8）。

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
│      Solo      │
└────────────────┘

┌────────────────┐
│   Partnered    │
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
Solo

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

Solo
5

Partnered
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

Solo / Partnered を視覚的に区別する。

日付を選択すると、その日のActivity一覧を表示する。

---

# 11. Statistics

以下の統計を提供する。

## 基本統計

- 今月の回数
- 前月の回数
- 年間回数
- Solo回数
- Partnered回数
- Total Sexual Activity
- 平均間隔
- 最終Activityからの日数

計算方法は基本設計 §14 で固定する。
「同日の複数回を別々に数えるか」「期間端の空白を含めるか」などは実装者の裁量に委ねない。

## 11.1 Outcome を統計の指標にしない

Orgasm / Ejaculation / Protection は記録・表示・Export の対象とするが、**集計しない。**
割合・率・達成度としての指標を作らない。

```text
Context（Solo / Partnered） : 集計してよい
Outcome                     : 集計しない
```

`orgasm rate 62%` のような指標は達成率のスコアカードとして読まれ、
「ユーザーを評価しない」という原則に正面から抵触する。

Statistics と Insights が扱うのは「いつ・どれだけ・どの間隔で」であり、「うまくいったか」ではない。

---

## 傾向

- 曜日別
- 時間帯別
- 月別
- 年別
- Solo / Partnered 比率

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

## 12.1 最低データ件数

件数が少ない状態で傾向を表示すると、事実ではなく偶然を提示することになる。

| 項目 | 最低件数 | 満たさない場合 |
|---|---:|---|
| 平均間隔 | 2 | `—` |
| 最頻曜日 | 10 | `—` |
| 最頻時間帯 | 10 | `—` |

最頻曜日が同率首位となった場合、2つまでは併記する（`Sunday and Friday`）。3つ以上は `—` とする。
件数が十分あるうえでの同率は事実であり、隠すと情報を失う。

「まだデータが足りません」のような評価的・催促的な文言を出さない。`—` を出すだけにとどめる。

---

# 13. Health Connect連携

## 13.1 Android

Google Health Connectの

```text
SexualActivityRecord
```

との連携を行う。

Health Connect 上では Solo / Partnered を区別するフィールドが存在しないため、アプリ内データを正とする。

`SexualActivityRecord` が保持できるのは**時刻と避妊具使用の有無だけ**である。

| Solo + Us | Health Connect |
|---|---|
| 日時 | time |
| protectionUsed | protectionUsed |
| Solo / Partnered の区別 | **送られない** |
| Orgasm / Ejaculation | **送られない** |
| Duration / Mood / Notes | **送られない** |

外へ出る情報の範囲は、設定画面に具体的に明示する。

これは HealthKit でも同じであり、iOS 対応時も SQLite を正本とする方針は変わらない。

---

## 13.2 データ構造

```text
App Database

Activity
├─ context
│   ├─ solo
│   └─ partnered
│
├─ dateTime
│
├─ Outcome
│   ├─ orgasm
│   ├─ ejaculation
│   └─ protectionUsed
│
└─ Optional context
    ├─ duration
    ├─ moodBefore
    ├─ moodAfter
    └─ note
```

Health Connect：

```text
Solo ──────┐
           ├──→ SexualActivityRecord
Partnered ─┘
```

---

# 14. Health Connect同期設定

ユーザーが同期対象を選択できる。

```text
Health Connect

Sexual activity synchronization
ON

Sync

☑ Partnered
☑ Solo
```

説明を表示する。

> Health Connect には Solo と Partnered を区別するデータ項目がありません。
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

> 睡眠不足になると Solo が増えます。

OK：

> 過去90日の記録では、睡眠6時間未満の日にActivityが記録された割合が高くなっています。

あくまで**ユーザー自身の記録上の相関**として扱う。

---

# 19. Privacy / Security

本アプリにおける最重要要件とする。**v0.2 でセキュリティを MVP 要件へ昇格した。**

## 19.1 基本方針

- アカウント不要
- 原則ローカル保存
- 独自サーバーへの Activity 送信なし
- Activity を広告目的に利用しない
- Health Connect データを広告目的に利用しない
- 不要な Analytics を導入しない

## 19.2 MVP 要件としてのセキュリティ

以下は「必要に応じて検討」ではなく **v1.0 の必須要件** とする。

| 項目 | 要件 |
|---|---|
| DB 暗号化 | SQLCipher で暗号化する。ドライバ選定に直結するため Phase 1 で決定済み |
| 鍵の保管 | 初回起動時に32バイト乱数を生成し、Keychain / Android Keystore に保管する |
| 鍵と生体認証 | **結合しない。** 生体情報の変更で鍵が失効する設定を使わない |
| ログ | Activity の内容をログ・クラッシュレポートに出さない |
| Analytics | v1.0 ではクラッシュレポート SDK・Analytics SDK を導入しない |
| 画面マスク | バックグラウンド移行時にアプリ内容をマスクする |
| OS バックアップ | DB を OS バックアップ・端末転送の対象外とする |
| Export ファイル | 平文であることを明示し、共有後に一時ファイルを削除する |
| **アプリ設定の保存先** | 暗号化 DB 内の `app_settings`。平文の AsyncStorage に置かない |

「Ejaculation を表示する」といった設定自体が、何を記録対象にしているかという
**記録内容に近い情報**を漏らすため、設定も暗号化対象とする。

Export に含める設定は allowlist で限定する。
端末固有の状態（App Lock の有効状態、Health Connect の接続状態、最終同期日時）は
**復元しても実態と一致しない**ため含めない。

## 19.3 脅威モデル

何を防ぎ、何を防がないかを明示する。

| 対象 | 防ぐ | 防がない |
|---|---|---|
| 端末の物理取得・ファイル抽出 | ● | |
| OS バックアップ経由の流出 | ● | |
| root / jailbreak 済み端末 | | ● |
| 端末内で動作するマルウェア | | ● |
| ロック解除後の画面の覗き見 | | ●（App Lock の領域） |

## 19.4 バックアップ除外の帰結

端末外に出ない鍵を使うため、OS バックアップから復元しても **復号できない DB だけが戻る**。
この状態を防ぐために DB をバックアップ対象から除外する。

その結果、**端末紛失＝全データ喪失**となり、Export / Import が唯一の復旧手段になる。
したがって Export / Import は v1.0 必須かつ無料とする（§24、§25）。

## 19.5 復号できない場合の挙動

「DB は存在するが鍵が読み出せない」状態は、端末移行やバックアップ復元で現実に起こりうる。

アプリはクラッシュせず、復号できないことを明示し、
**バックアップからの復元**または**データの初期化**を選ばせる画面を表示する。

---

# 20. アプリロック

端末の認証（Device authentication）に委譲する。

```text
生体認証（Face ID / Touch ID / 指紋）
    ↓ 利用できない・無効にしている場合
端末のパスコード等による認証
```

**アプリ独自の PIN を実装しない。**

独自 PIN を持つと「PIN 忘れ時の復旧」の設計が必要になり、
復旧手段を用意すればロックは形骸化し、用意しなければ利用者は自分のデータに二度と触れられない。
OS の認証に委譲すればこの問題自体が発生しない。

UI 文言は OS 差を吸収して「端末の認証 / Device authentication」と表記する。

## 20.1 受け入れ条件

- 生体認証を無効にしている端末でも、端末パスコード等で解除できること（実機で確認する）
- App Lock の状態と DB 復号鍵が独立していること

---

# 21. Discreet Mode

アプリ内容を第三者に推測されにくくする機能を検討する。

候補：

| 項目 | v1.0 |
|---|---|
| Recent Apps 画面のマスク | **実装する** |
| アプリ名・アイコンの配慮 | ブランド方針で担保済み（Intersect Plus） |
| ロック画面に件数等を表示しない | **実装する** |
| 通知に Activity 内容を表示しない | — |
| Widget でのセンシティブ情報非表示 | — |

**v1.0 では Push 通知を実装しない（検討ではなく決定とする）。**

通知を持たなければ「通知に何を出すか」という問題自体が発生せず、
記録を催促しない・評価しないというプロダクト方針とも一致する。
Widget も v1.0 では実装しない。

---

# 22. Backup / Export / Restore

長期保存をコンセプトとするため、**復元可能性を機能ではなく安全性の一部**として扱う。

## 22.1 形式の役割分担

```text
JSON : バックアップ／復元の正本（全項目・可逆・schema version 付き）
CSV  : 分析用の一方向エクスポート（Import 対象外）
```

CSV を復元経路に含めると、タイムゾーンや作成日時の表現・解釈を CSV 側でも定義する必要が生じ、
仕様が不必要に大きくなる。CSV は人間と表計算が読むものと割り切る。

## 22.2 Import（strict restore）

v1.0 の JSON Import は **strict restore のみ**とする。

- `id` を必須とする。持たないファイルは不正データとして拒否する
- 推測による自動重複排除を行わない（同一性判定は `id` のみ）
- **1件でも不正があれば全体を確定しない**（行単位スキップをしない）
- 全件検証 → 件数プレビュー → 単一トランザクションで確定する
- モードは「置換復元（既定）」と「追加のみ」の2つ
- 置換復元の前に、現在のデータを自動でセーフティ Export する

バックアップ復元で数件だけ欠落する事態は、理由を表示しても危険である。
完全性が要求される場面では全体を失敗させる方が安全とする。

## 22.3 完成条件

**Export → アンインストール → 再インストール → Import で全件・全項目が一致すること。**

これを満たさない状態でリリースしない。

---

# 23. 削除

ユーザーはいつでも、

- 個別Activity削除
- 期間指定削除
- 全Activity削除

を実行できる。

### 全 Activity 削除と置換復元は外部への影響が違う

| | 外部への反映 |
|---|---|
| 全 Activity 削除 | **Health Connect 上の記録も削除する** |
| 置換復元（Import） | Health Connect 上の記録は残る |

全削除における利用者の意思は「このデータを消す」であり外部も対象に含まれるが、
置換復元は機種変更・復旧が主用途で、外部を消す意図とは限らない。
**同じ「消える」でも影響が違うため、画面上でも言い分ける。**

外部削除は非同期で進むため、次を満たす。

- 全削除では前面で進行を表示する
- **アプリを閉じると削除は一時停止し、次回起動時に再開する**（v1 はバックグラウンド同期を持たない）
- Health Connect を切断しても未処理の削除は破棄せず、再接続時に再開する
- **「端末から削除しました」と「すべて削除されました」を言い分ける**
- **未処理が残った状態でアンインストールすると外部に残る**ことを確認画面で明示する

記録を消したうえでアプリも消す、という流れはこの製品では十分に起こりうる。
**消したい瞬間に外部へ残ることが、このアプリにとって最大の失敗である。**

Health Connect 同期済みの場合の削除同期は基本設計 §10 で設計済み。要点は以下。

- **ローカル削除は常に即時成功させる。** 外部削除の失敗で画面上の削除を巻き戻さない
- 外部削除に必要な情報は削除ジョブへ退避してから Activity を消す
- 失敗した削除は再試行キューに残り、Settings > Health Connect に「未同期の変更」として表示する
- Health Connect 接続を OFF にする際、未反映の削除が残っていれば警告する

**既知の制限：** Health Connect 側でユーザーが手動削除しても、v1 は Health Connect を読まないため検知できない。

---

# 24. Monetization

**無料 + Pro買い切り**を基本とする。

広告モデルはセンシティブなデータを扱うアプリとの相性が悪いため採用しない。

## 24.1 無料

- Activity 記録（Solo / Partnered）
- カレンダー
- 基本統計
- ローカル保存・暗号化
- App Lock
- **Export / Import（JSON・CSV）**
- Health Connect 書き込み

## 24.2 Pro

- 長期 Analytics
- Health Data との相関分析
- 詳細グラフ
- カスタム記録項目
- 高度な Insights

## 24.3 Export を課金対象にしない理由

§19.4 のとおり、DB を OS バックアップから除外する以上、Export が唯一の復旧手段になる。
バックアップを課金対象にすると、

- 無料利用者は端末紛失時に全データを失う
- 「データはあなたのもの」というコアメッセージと正面から衝突する

ため、製品として成立しない。**Export / Import は無料とする。**

---

# 25. MVP 範囲

**この表を、v1.0 に入れるかどうかの唯一の基準とする。**
他の文書に異なる記述がある場合はこの表を優先する。

| 機能 | v1.0 | v1.1 | 備考 |
|---|:---:|:---:|---|
| Solo / Partnered の記録 | ● | | |
| 編集・削除 | ● | | |
| 日時変更・過去日時への記録 | ● | | |
| 詳細項目（orgasm / ejaculation / protection / duration / mood / note） | ● | | 入力は完全任意 |
| 表示項目のカスタマイズ（§6.3） | ● | | 既定は Orgasm と Notes のみ ON |
| Today（月次カウント・内訳・Recent） | ● | | |
| Calendar（月表示・日別一覧） | ● | | |
| Insights（合計・内訳・平均間隔） | ● | | タブは v1.0 から3つ出す |
| Insights（年次・曜日・時間帯・All Time） | | ● | |
| ローカル SQLite | ● | | |
| **DB 暗号化・鍵管理** | ● | | v0.2 で MVP へ昇格 |
| **App Lock（端末の認証）** | ● | | |
| **復号不能時のリカバリ画面** | ● | | v0.2 で追加 |
| 画面マスク（Recent Apps） | ● | | |
| **Export JSON / Import** | ● | | 無料 |
| Export CSV | ● | | 分析用・一方向 |
| Health Connect 書き込み・同期設定 | ○ | | §25.1 のゲートに従う |
| Health Connect 読み込み・相関分析 | | | v1.2 以降 |
| HealthKit | | | v1.2 以降 |
| Push 通知 | | | 実装しない |
| バックグラウンド同期 | | | 実装しない（同期はフォアグラウンドの単一 runtime のみ） |

## 25.1 Health Connect のリリース判断

Health Connect の権限が配布ビルドの Manifest に含まれていると、
アプリ内で機能を OFF にしていても Health apps declaration の提出とデータ型ごとの説明が必要になる。
`SexualActivityRecord` は Reproductive and Sexual Health に属する。

そのため **ビルドプロファイルを2つ用意し、Manifest 自体を切り替える**。

```text
without-health-connect : health 権限を Manifest に含めない
with-health-connect    : 権限とネイティブモジュールを含む
```

コードフリーズ時点で宣言が承認されていれば `with-health-connect` で v1.0 を出す。
間に合わなければ `without-health-connect` で v1.0 を出し、承認後に v1.0.x で有効化する。

**これにより、ストア審査をリリースのクリティカルパスから外す。**

---

# 26. 非機能要件

## Performance

Activity 数が10年以上蓄積されても快適に動作すること。
月次集計・カレンダーはローカル日付列のインデックスで解決する。

## Offline

すべての基本機能をオフラインで利用可能とする。

## Reliability

- 記録データの消失を最優先で防ぐ
- DB Migration は前方向のみとし、実行前に整合したバックアップを取得する
- 外部 API の障害で Activity を失わない

## Security

- DB を SQLCipher で暗号化する（§19.2）
- 鍵は Keychain / Android Keystore に保管し、生体認証と結合しない
- Activity 内容をログ・外部送信の対象にしない

## Recoverability

- Export → 再インストール → Import で全件・全項目が一致すること
- 鍵が復元できない状態でクラッシュループに入らないこと

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

## 27.1 ストア掲載と年齢レーティング

年齢レーティングを事前に特定の値へ固定しない。

> 成人向けを想定して各ストアの質問票に正確に回答し、最終レーティングは質問票・審査結果に従う。
> 必要であれば開発者側でより高いレーティングを設定する。

Apple は地域や回答内容に応じて複数段階のレーティングを割り当てる体系を採っており、
性的テーマの頻度・内容によって結果が変わるため、事前に固定すると実態と食い違う。

### 露骨にしないことと、説明しないことは別である

性的な画像・表現を避ける方針は維持する。
ただし **ストア説明ではアプリが何をするものかを明確に記述する。**

審査時の説明（特に Health apps declaration）と、利用者に対する透明性の両方に必要である。
目的を曖昧にしたまま配布しない。

---

# 28. アプリの価値

本アプリが提供する価値は、

> 「ひとりの行為を管理する」

ことではない。

また、

> 「パートナーとの回数を増やす」

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

という一つの Personal Health Data として扱う。

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

> **Solo + Us — Your intimate life, over time.**

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