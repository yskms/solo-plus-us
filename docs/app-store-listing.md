# App Store 掲載情報の草案（iOS v1.0.0）

App Store Connect の「iOS アプリ バージョン 1.0」ページと「アプリ情報」に
そのまま貼れる形で書いた草案。Google Play 版（[store-listing.md](store-listing.md)）
の文面と方針を引き継ぎ、iOS で実装が異なる点だけを書き換えている。

- **書くときの方針は Play 版と同じ**（store-listing.md「書くときに守ったこと」）
  ——詳細項目の個別名（オーガズム / 射精）を出さない、医療効果を主張しない、
  実装していないこと（同期・共有・通知など）を書かない
- **iOS で書き換えた点**：「アプリ履歴でのプレビュー非表示」→「App Switcher での
  ぼかし」、「指紋 / 顔」→「Face ID / Touch ID」。Health Connect は iOS に
  存在しないため、どちらの言語でも一切触れない
- 文字数制限は App Store の仕様（名前30・サブタイトル30・プロモーション用
  テキスト170・概要4000・キーワード100）

---

## en-US（主言語）

### 名前（30文字以内）

```
Solo + Us
```

### サブタイトル（30文字以内）

```
Your private intimacy log
```

（25文字）

### プロモーション用テキスト（170文字以内）

審査なしでいつでも差し替えられる欄。

```
Record in a single tap. Everything stays on your device in an encrypted database. No account, no ads, no tracking.
```

（114文字）

### 概要（4000文字以内）

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
- Encrypted local database, excluded from iCloud backup
- App Lock with Face ID, Touch ID or your passcode
- The app is blurred in the app switcher
- Optional screenshot blocking
- No account, no ads, no tracking

YOUR DATA IS YOURS
Export a full JSON backup at any time, or a CSV for your own analysis. Import a backup to restore your records, either adding only new entries or replacing everything. Nothing is locked in, and nothing costs extra.

Available in English and Japanese.
```

### キーワード（100文字以内、カンマ区切り）

アプリ名・カテゴリ名と重複する語は入れない（Apple が別途インデックスする）。
性的に露骨な語は入れない。

```
private,journal,diary,log,tracker,intimacy,wellness,couple,relationship,encrypted,offline,lock
```

（94文字）

---

## ja（追加のローカリゼーション）

### 名前

```
Solo + Us
```

### サブタイトル（30文字以内）

```
性の記録を、自分だけのものに
```

（14文字）

### プロモーション用テキスト（170文字以内）

```
1タップで記録。データはすべて端末の中で暗号化して保存します。アカウント登録も、広告も、トラッキングもありません。
```

（57文字）

### 概要（4000文字以内）

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
・暗号化されたローカルデータベース（iCloud バックアップの対象外）
・Face ID / Touch ID / パスコードによるアプリロック
・App Switcher（アプリの切り替え画面）でアプリをぼかして表示
・スクリーンショットのブロック（任意）
・アカウント登録なし、広告なし、トラッキングなし

データはあなたのもの
いつでも JSON で完全なバックアップを書き出せます。分析用に CSV で書き出すこともできます。バックアップからの復元にも対応しており、新しい記録だけを追加するか、すべて置き換えるかを選べます。データを囲い込むことはせず、追加の費用もかかりません。

日本語と英語に対応しています。
```

### キーワード（100文字以内）

```
日記,記録,ログ,プライベート,ウェルネス,パートナー,カップル,暗号化,オフライン,ロック,セルフケア
```

（52文字）

---

## バージョン情報・アプリ情報のその他の項目

| 項目 | 内容 |
|---|---|
| サポート URL | https://yskms.github.io/solo-plus-us/ |
| マーケティング URL | （空欄でよい） |
| プライバシーポリシー URL | https://yskms.github.io/solo-plus-us/privacy-policy.html |
| 著作権 | `2026 Masashi Yasaka`（App Store の販売元表示と揃える。実名表示は許容済み——CLAUDE.md 参照） |
| プライマリカテゴリ | ライフスタイル（Play 版と同じ判断） |
| セカンダリカテゴリ | 設定しない |
| 価格 | 無料（アプリ内課金なし） |
| スクリーンショット | 未作成——下記「スクリーンショット」参照 |

### App のプライバシー（栄養ラベル）

**「データを収集していない」**で申告する想定。端末外への送信が無く、解析・広告・
クラッシュ収集の SDK も入っていない。Export/Import は利用者自身の操作による
ファイル出力で、アプリからの送信ではない（Play のデータセーフティと同じ判断）。

### 年齢制限（要判断）

App Store Connect の年齢制限の質問票に答えて決まる。内容は Play 版の
コンテンツレーティングと同じ考え方で答える（性的なテーマへの言及はあるが、
描写・画像は無い）。**プライバシーポリシー §8 と Play の対象年齢は18歳以上**
なので、質問票の結果がそれより低くなった場合は、上書き設定で 18+ にそろえる
ことを推奨（申請時にユーザーと確認する）。

### App Review に関する情報

| 項目 | 内容 |
|---|---|
| サインイン情報 | 「サインインが必要です」のチェックを外す（ログイン機能が無い） |
| 連絡先 | 名・姓・電話番号・メールを入力（審査担当者からの連絡用で、公開されない） |

メモ（審査担当者向け）：

```
Solo + Us is a private, offline log of the user's own intimate activity (solo or partnered). It has no account, no server and no network features; all data stays on the device in an encrypted SQLite database (SQLCipher).

No sign-in is required. App Lock is off by default, so every screen is reachable right after the first-launch privacy introduction. The app never displays sexual images or explicit descriptions — it records only a category (Solo/Partnered), a date and time, and optional details the user chooses.
```

### 輸出コンプライアンス（暗号化）

SQLCipher（AES）を OpenSSL 実装で使うため、「標準的な暗号化アルゴリズム
（Apple の OS 内の暗号化を使用していない）」に当たる。**フランスで配信する場合
のみ**フランスの暗号化申告書が必要（2026-10-01、TestFlight ビルド 0.1.0 (2) で
この区分で回答済み）。iOS でフランスを配信国に含めるかは申請時に決める。

### スクリーンショット

- 必須サイズは iPhone 6.5 インチ（1242×2688 / 1284×2778）または 6.9 インチ。
  シミュレータで撮影する
- Play 版と同じ4画面（今日 / カレンダー / サマリー / 設定）を、en と ja の
  両方で用意する。設定画面は「記録の項目」の個別名が写らない構図にする
  （store-listing.md「公開前に決めること・提出すること」参照）
