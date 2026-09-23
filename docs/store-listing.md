# Google Play ストア掲載情報の草案（v1.0 / without-health-connect）

Play Console の「ストアの掲載情報」にそのまま貼れる形で書いた草案。
文字数制限は Play の仕様（アプリ名30・簡単な説明80・詳しい説明4000）。
**Health Connect は v1.0 のビルドに含まれないため、どちらの言語でも
一切触れていない**（D-55）。承認後の v1.0.x で有効化する際に追記する。

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
Details are always optional and never asked for while recording. Turn on just the ones you care about — orgasm, ejaculation, protection, duration, mood before and after, and a free-text note — and add them later, on the days you want to. You can also set a default value so a detail is filled in for you.

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
詳細項目の入力は常に任意で、記録のときに尋ねられることはありません。オーガズム、射精、避妊、所要時間、前後の気分、自由記入のメモから、気になるものだけをオンにして、記録したい日にだけ書き足せます。既定値を設定して、自動で入力させることもできます。

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
| アプリのアイコン | 512×512 PNG（`assets/images/` のアイコン素材から書き出す） |
| フィーチャーグラフィック | 1024×500 PNG（**未作成**） |
| スクリーンショット（携帯電話） | 最低2枚・推奨4〜8枚。候補：今日 / カレンダー / サマリー / 記録の項目（設定） |
| カテゴリ | ヘルスケア / フィットネス（Health & Fitness） |
| タグ | 追加しない（性的な内容を示すタグは付けない） |
| メールアドレス | yskms.studio@gmail.com（プライバシーポリシー §10 と揃える） |
| プライバシーポリシー | https://yskms.github.io/solo-plus-us/privacy-policy.html |

### 書くときに守ったこと

- **性的に露骨な表現を避けた**——Play のポリシー上、露骨な表現はストア掲載情報の
  審査対象になる。機能の説明に徹し、行為そのものの描写はしていない
- **「医療」「健康管理」として効能を主張していない**——医療系の主張は追加の審査
  要件を招く
- **実装していないことを書いていない**——同期・共有・パートナーとの共同利用・
  通知・バックグラウンド動作はいずれも非対応（§25）
- **「無料」を強調しすぎない**——アプリ内購入も広告も無いので事実だが、
  将来 Export を有料化する等の変更があると齟齬が出るため、本文では
  「追加の費用もかからない」程度にとどめた
