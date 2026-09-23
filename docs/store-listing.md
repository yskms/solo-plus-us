# Google Play ストア掲載情報の草案（v1.0 / without-health-connect）

Play Console の「ストアの掲載情報」にそのまま貼れる形で書いた草案。
文字数制限は Play の仕様（アプリ名30・簡単な説明80・詳しい説明4000）。
**v1.0 では Health Connect 機能を提供せず、健康データ権限も要求しないため、
どちらの言語でも一切触れていない**（D-55）。ネイティブモジュール自体は
without ビルドにもリンクされたまま残る（CLAUDE.md「リリースビルド分離」）
——「ビルドに含まれない」のは権限と機能であって、モジュールではない。
承認後の v1.0.x で有効化する際に、掲載情報・Health apps declaration・
データセーフティを同時に更新する。

---

## en-US（デフォルト言語）

### アプリ名（30文字以内）

```
Solo + Us
```

### 簡単な説明（80文字以内）

```
A private, offline log for your intimate life. Encrypted, no account, no ads.
```

（76文字）

### 詳しい説明（4000文字以内）

```
Solo + Us is a private log for your intimate life — solo and partnered alike.

Everything stays on your device. There is no account to create, no server to sync with, and no advertising. Your records are stored in an encrypted database that is unlocked only on your device.

RECORD IN SECONDS
Open the app, tap once for Solo or Partnered, and you're done. If you tapped by mistake, Undo is right there. Recorded the wrong day or time? You can change it afterwards.

TRACK ONLY WHAT YOU WANT
Details are always optional and never asked for while recording. Turn on just the ones you care about — protection, duration, mood before and after, and a free-text note — and add them later, on the days you want to. You can also set a default value so a detail is filled in for you.

SEE YOUR PATTERNS
Today shows this month at a glance, with a solo and partnered breakdown and your most recent entries. Calendar gives you a month view and the entries for any day. Summary shows your totals, the solo/partnered split, and your average interval between entries.

BUILT FOR PRIVACY
- Encrypted local database
- App Lock with your device's fingerprint, face or passcode
- Hide the app's preview in Recent Apps
- Optional screenshot blocking
- No account, no ads, no tracking

YOUR DATA IS YOURS
Export a full JSON backup at any time, or a CSV for your own analysis. Import a backup to restore your records, either adding only new entries or replacing everything. Nothing is locked in, and nothing costs extra.

Available in English and Japanese.
```

---

## ja-JP（追加する場合）

### アプリ名（30文字以内）

```
Solo + Us
```

### 簡単な説明（80文字以内）

```
性の記録を、自分だけのものに。端末内で暗号化。アカウント登録も広告もなし。
```

（36文字）

### 詳しい説明（4000文字以内）

```
Solo + Us は、ひとりの時間もふたりの時間も記録できる、自分だけの記録アプリです。

データはすべて端末の中に保存されます。アカウント登録は不要で、サーバーと同期することもなく、広告もありません。記録は暗号化されたデータベースに保存され、あなたの端末でだけ開かれます。

数秒で記録できる
アプリを開いて、ソロかパートナーとを1回タップするだけです。間違えて押しても、その場で取り消せます。日時を間違えたときは、あとから変更できます。

記録する項目は自分で選ぶ
詳細項目の入力は常に任意で、記録のときに尋ねられることはありません。避妊、所要時間、前後の気分、自由記入のメモなどから、気になるものだけをオンにして、記録したい日にだけ書き足せます。既定値を設定して、自動で入力させることもできます。

流れが見える
「今日」では今月の件数と、ソロ / パートナーとの内訳、直近の記録をひと目で確認できます。「カレンダー」では月表示と、その日の記録の一覧が見られます。「サマリー」では合計、内訳、記録と記録の平均間隔が分かります。

プライバシーのための設計
・暗号化されたローカルデータベース
・端末の指紋 / 顔 / パスコードによるアプリロック
・アプリ履歴でのプレビューを隠す機能
・スクリーンショットのブロック（任意）
・アカウント登録なし、広告なし、トラッキングなし

データはあなたのもの
いつでも JSON で完全なバックアップを書き出せます。分析用に CSV で書き出すこともできます。バックアップからの復元にも対応しており、新しい記録だけを追加するか、すべて置き換えるかを選べます。データを囲い込むことはせず、追加の費用もかかりません。

日本語と英語に対応しています。
```

---

## リリースノート（v0.1.0 / versionCode 2、初回リリース）

Play Console の「製品版リリースの作成」にそのまま貼る。掲載文と同じ方針で、
詳細項目の個別名は書かない。

```
<en-US>
First release.
- Record Solo or Partnered in a single tap, with Undo and editable date and time
- Optional details: protection, duration, mood before and after, and notes
- Month view, calendar, and totals with your average interval
- Encrypted local database, App Lock, hidden preview in Recent Apps
- JSON and CSV export, JSON import
- English and Japanese
</en-US>
<ja-JP>
最初のリリースです。
・ソロ / パートナーとを1タップで記録。取り消しと日時の変更にも対応
・任意の詳細項目：避妊、所要時間、前後の気分、メモ
・今月の件数、カレンダー、合計と平均間隔
・暗号化されたローカルデータベース、アプリロック、アプリ履歴でのプレビュー非表示
・JSON / CSV でのエクスポート、JSON からのインポート
・日本語と英語に対応
</ja-JP>
```

リリース名は `2 (0.1.0)`（ユーザーには表示されない識別用）。

---

## Play Console 申告の記録（2026-09-24、v0.1.0 提出時）

更新版を出すときに、同じ回答で通るか／変わったかを判断するための控え。
**Health Connect を有効化する版では、★ の項目を必ず見直すこと。**

| 項目 | 回答 | 根拠 |
|---|---|---|
| ログインの詳細（旧「アプリのアクセス権」） | アクセス制限なし（いいえ） | ログイン・課金・コード入力が無い。App Lock は既定 OFF の端末認証で、審査時に到達を妨げない |
| 対象年齢 | 18歳以上のみ／未成年のブロックを有効 | プライバシーポリシー §8 と一致 |
| コンテンツのレーティング カテゴリ | その他のすべてのアプリの種類 | ゲームでもソーシャル/コミュニケーションでもない（ユーザー間の共有機能が無い） |
| コンテンツのレーティング 回答 | パッケージ内にレーティング関連コンテンツ「あり」／性的コンテンツ「あり」→「挑発的/性的なテーマや話題」→「詳しい記述を伴わない性行為への言及」。他はすべて「いいえ」 | 画面に出るのは分類名と数値のみで、描写・画像は無い。メモ欄の内容は端末内の本人データで共有されない |
| レーティング結果 | ESRB 13+／PEGI 12／IARC Generic 12+／USK 6+ | 対象年齢18歳以上の方が厳しいため矛盾しない |
| データセーフティ ★ | 収集・共有なし | 端末外への送信が無い。解析/広告/クラッシュ SDK 無し。Export/Import は利用者起点のファイル操作 |
| 健康アプリ申告 ★ | 「性と生殖に関する健康」を選択（地域ごとの追加要件は無しと表示された） | 記録対象が性行為と避妊具の使用有無 |
| カテゴリ | ライフスタイル | 主目的が健康管理ではなく私的なライフログ。HC 有効化時に Health & Fitness を再検討 |
| タグ | 設定しない | 性的な内容を示すタグを付けない方針 |
| 外部マーケティング | オフ | Play 外への広告掲載を望まない（内容の性質上） |
| 広告 | 広告を含まない | |

---

## 掲載情報のその他の項目

| 項目 | 内容 |
|---|---|
| アプリのアイコン | 512×512 PNG（`assets/images/play-store-icon-512.png`） |
| フィーチャーグラフィック | 1024×500 PNG（en-US: `assets/images/feature-graphic-1024x500.png`、ja-JP: `assets/images/feature-graphic-1024x500-ja.png`） |
| スクリーンショット（携帯電話） | `assets/store-screenshots/en/`（英語）と `.../ja/`（日本語）に各4枚（今日 / カレンダー / サマリー / 設定）。Pixel 11・1080×2424・ライトテーマで撮影（2026-09-23）。設定画面はプライバシーのセクションが見える位置で、詳細項目の個別名は写っていない。Play は言語ごとに別の画像を設定できるので、ja-JP の掲載情報には `ja/` を使う |
| カテゴリ | ライフスタイル（下記「公開前に決めること・提出すること」参照） |
| ウェブサイト | https://yskms.github.io/solo-plus-us/ （`public/index.html`。以前はプライバシーポリシーへリダイレクトするだけだった） |
| タグ | 追加しない（性的な内容を示すタグは付けない） |
| メールアドレス | yskms.studio@gmail.com（プライバシーポリシー §10 と揃える） |
| プライバシーポリシー | https://yskms.github.io/solo-plus-us/privacy-policy.html |

### 書くときに守ったこと

- **一般ユーザー向けの表現にした**——機能説明に必要な範囲を超えて、性的に露骨な
  用語や描写を載せない。**詳細項目の個別名（orgasm / ejaculation / オーガズム /
  射精）は、正確ではあるが掲載文からは外した**（レビュー指摘、2026-09-23）。
  Play はストア掲載情報のテキストも審査対象にしており、機能名として正確でも
  性的キーワードとして拾われうる。全項目はアプリ内で確認できるため、本文で
  列挙する必要はない
- **医療上の診断・治療・改善効果を主張していない**——本アプリは医療機器ではなく、
  記録内容に基づく医療上の判断や助言も行わない
- **実装していないことを書いていない**——同期・共有・パートナーとの共同利用・
  通知・バックグラウンド動作はいずれも非対応（§25）
- **v1.0 では Health Connect 機能を提供せず、健康データ権限も要求しない**
  （D-55）。将来有効化する際は、掲載情報・Health apps declaration・データ
  セーフティを同時に更新する
- **本文・翻訳・スクリーンショット・アイコン・フィーチャーグラフィックで
  表現を揃える**——Play はテキストだけでなく画像もメタデータとして審査する
- **「無料」を強調しすぎない**——アプリ内購入も広告も無いので事実だが、
  将来 Export を有料化する等の変更があると齟齬が出るため、本文では
  「追加の費用もかからない」程度にとどめた

### 公開前に決めること・提出すること

- **カテゴリ（要判断）**：`Health & Fitness` と `Lifestyle` のどちらか。
  **v1.0 の主目的は健康管理ではなく私的なライフログなので `Lifestyle` が
  実態に近い。** Health Connect を有効化して健康データとの連携を提供する
  時点で、`Health & Fitness` への変更を再検討する（カテゴリは後から変更
  できる）。なお、カテゴリの選択は審査要件を避けるための手段ではない——
  下記の Health apps declaration はカテゴリに関係なく必須
- **Health apps declaration（提出必須）**：**Google Play で公開するすべての
  デベロッパーが対象**で、クローズドテスト・オープンテスト・製品版のいずれの
  トラックも含む。健康機能が無いアプリも「健康機能を提供していない」ことを
  申告する必要がある（2026-09-24 に
  https://support.google.com/googleplay/android-developer/answer/14738291
  で確認。例外はシステムサービスと private app のみ）。v1.0 で
  「Reproductive and Sexual Health」と「健康機能なし」のどちらを選ぶかは、
  Play Console に表示される最新の定義とアプリの実態に沿って判断する
  ——v1.0 は HC 権限を持たないため §25.1 の「審査トリガー」には該当しない
  想定だが、性的活動の記録という内容自体を健康機能と判断される可能性は残る。
  v1.0.x で Health Connect を有効化する際は、必ず申告内容を更新する
- **スクリーンショットの内容**：詳細項目の設定画面（「記録の項目」）には
  個別の項目名が表示されるため、初回掲載では使わない。載せる場合は、露骨な
  項目名が画面内に入らない構図にすること（レビュー指摘、2026-09-23）
- **フィーチャーグラフィック**：en-US は英語のタグライン
  （`Private. Offline. Yours.`）、ja-JP は日本語のタグライン
  （「記録は、端末の中だけに。」）を入れた言語別素材を使用する
- **データセーフティ**：収集・共有なしで申告できる想定。Export/Import は
  利用者自身の操作によるファイル出力で、アプリからの送信ではない
