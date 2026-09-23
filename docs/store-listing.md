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

## 掲載情報のその他の項目

| 項目 | 内容 |
|---|---|
| アプリのアイコン | 512×512 PNG（`assets/images/play-store-icon-512.png`） |
| フィーチャーグラフィック | 1024×500 PNG（`assets/images/feature-graphic-1024x500.png`） |
| スクリーンショット（携帯電話） | `assets/store-screenshots/` の4枚（今日 / カレンダー / サマリー / 設定）。Pixel 11・1080×2424・ライトテーマ・英語表示で撮影（2026-09-23）。設定画面は PRIVACY セクションが見える位置で、詳細項目の個別名は写っていない |
| カテゴリ | **要判断**（下記「公開前に決めること・提出すること」参照） |
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
- **フィーチャーグラフィックの日本語版**：現行素材は英語のタグライン
  （`Private. Offline. Yours.`）入り。ja-JP の掲載情報を追加する際は、
  日本語版を用意するか、文字を含まない素材に差し替えるかを決める
  （Play は言語ごとに別素材を設定できる）
- **データセーフティ**：収集・共有なしで申告できる想定。Export/Import は
  利用者自身の操作によるファイル出力で、アプリからの送信ではない
