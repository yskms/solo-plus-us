# Health Connect 有効化版のリリース準備（申告文の下書き・審査の懸念・チェックリスト）

- 読むタイミング: `production-with-health-connect` で Health Connect 対応版（v1.0.x）を出す準備をするとき。Play Console の健康アプリ申告に Health Connect のデータ型の説明を書くとき、データセーフティ・掲載文・カテゴリを見直すとき
- 経緯: v1.0 は D-55 により `without-health-connect` で配布した。v1.0.4（versionCode 8）は 2026-11-09 に公開済みで、いずれも HC 権限なし。HC 対応版の準備は 2026-11-09 に `feat/health-connect-release` で着手した
- 申告文は Google に提出する内容で、秘密情報ではない（公開リポジトリに置いてよい）

## 現状の Play Console（2026-11-09 に確認）

- 「アプリのコンテンツ」>「健康アプリ」のフォームは、ステップ1「アプリの健康関連の機能」（「性と生殖に関する健康」と「その他」にチェック済み）と、ステップ2「地域ごとの要件」の2段。**Health Connect のデータ型ごとの説明を書く画面は出ていない**（HC 権限入りのビルドを使っていないため、とみられるが、条件は公式ページに書かれていない）
- したがって Health Connect の申告は**未記入**。HC 権限入りの AAB をリリースに載せる段階で、Console が求めてくる可能性が高い（未確認）
- 公式の記述（Android Developers「Declare access to Health Connect data types」）: 申告は「公開の準備の中で」行う。扱うデータ型が変わるアップデートでも必要。提出した内容は「アプリ審査の一部として」審査される。承認状況をどの画面で見るかは、公式に書かれていない
- 公式ヘルプによると、センシティブな権限の審査には数週間かかることがある
- **公開済みの v1.0.4 のフォームは、HC 版の準備ができる前に変更しない**（不要な再審査を避ける）

## 審査で懸念される点

Play Console ヘルプ「Android Health Permissions: Guidance and FAQs」より。

- 生殖に関する健康の項目は**強い審査の対象**: 「ユーザー向けの機能(例: 妊活の記録、慢性疾患の管理)に、そのデータが必要であることを示す必要がある」
- 承認済みの用途として挙がるのは、フィットネス・ウェルネス・コーチング、特典、企業の福利厚生、医療、被験者調査、ヘルス連携のゲームなど。**性に関する記録のためという用途は載っていない**。`SexualActivity` が強い審査の対象に当たるかは、公式に明記がない(「Reproductive and sexual health」に分類されているので、当たるとみて準備する)
- 却下の例として「Needed for app functionality.」のような広すぎる説明が挙がっている。却下理由の定番は、説明の不足、承認済みの用途とのずれ、必要以上の権限の要求
- 守りになる点: 要求するのは `WRITE_SEXUAL_ACTIVITY` の1つだけ、READ なし、既定 OFF の明示同意制、送るのは日時と Protection だけ、端末外のサーバーへ送らない、広告なし
- **過去の教訓（2026-10-01）**: 掲載文の機能(気分の記録)が健康アプリ申告に無く、「申告の内容が正確ではありません」で否承認された。HC 版では、掲載文・プライバシーポリシー・rationale 画面・申告の4つで、書く機能と送るデータをそろえる

## 申告文の下書き

Health Connect のデータ型ごとの説明欄に貼る想定。実際の欄の文字数や言語は、Console に出てから合わせる。**「利用者向けの機能」は、rationale 画面の文言（「あなたが選んだ他のヘルスケアアプリからもこの情報を読み取れるようになります」）と同じ趣旨に絞っている。**

### データ型: SexualActivity（書き込みのみ）

en:

```
Solo + Us is a private activity log that works offline. If the user explicitly turns on "Sync to Health Connect" in Settings (it is off by default), the app writes one Sexual activity record for each entry the user has logged. A record contains only the date and time of the entry and the optional "protection used" value (protected, unprotected, or unknown). This lets users keep their own log in the other health apps they choose, for example cycle-tracking apps that read this data type from Health Connect, without entering the same entry twice.
The app only writes. It requests no read permission and never reads anything back from Health Connect. No other detail (context, outcome, mood, duration, or notes) is written. When the user deletes an entry in the app, the app also deletes the corresponding Health Connect record. The user can turn sync off at any time in Settings. The data is not sent to any server or third party and is not used for advertising.
```

ja:

```
Solo + Us は、端末の中だけで使う私的な記録アプリです。利用者が設定で「Health Connect に同期」を明示的に有効にした場合に限り（既定は無効）、記録した項目ごとに性行為(Sexual activity)のレコードを1件書き込みます。レコードに含まれるのは、記録の日時と、任意項目の「避妊具等の使用有無」(あり・なし・不明)だけです。これにより、利用者が選んだ他のヘルスケアアプリ（例: Health Connect からこのデータ型を読み取る周期管理アプリ）でも、同じ記録を二重に入力せずに使えます。
アプリは書き込みのみを行い、読み取り権限は要求せず、Health Connect から何も読み込みません。それ以外の詳細（状況、結果、気分、時間、メモ）は書き込みません。アプリ内で記録を削除すると、対応する Health Connect のレコードも削除します。同期は設定からいつでも無効にできます。データはサーバーや第三者へ送信せず、広告にも使用しません。
```

確認が要る点:

- 「周期管理アプリ」の例は、利用者向けの機能として挙げる想定の用途。意図と合っているか、提出前に利用者が確認する
- 「サーバーへ送らない」は、`docs/store-listing.md` のデータセーフティの回答（収集・共有なし）と同じ根拠。Health Connect への書き込みを Data safety でどう申告するかは、下の「見直す項目」参照

## HC 版を出す前のアプリ側の確認

- [ ] `with-health-connect` の R8 入り release APK をエミュレータで動かす（手順: `docs/android-build-notes.md` の R8 の節）。オンボーディング、記録、App Lock、書き出し・読み込みに加えて、Settings > Health Connect の有効化、権限ダイアログ、同期、削除の同期、切断まで。logcat の `FATAL EXCEPTION`・`has been rejected` を探す
- [ ] D-54 の Protection 既定値が、Health Connect に PROTECTED として届くか（README「Quick Record の詳細項目の既定値」の未確認事項）
- [ ] AAB の Manifest に `android.permission.health.WRITE_SEXUAL_ACTIVITY` が**あること**、ほかの `health.*` が無いこと（いつもと逆の確認）
- [ ] 権限の rationale 画面の文言が `public/privacy-policy.html` §4 と一致していること
- [ ] オンボーディングの「Health connection is optional」が HC 版で表示されること
- [ ] versionCode が 9 以降で、`production` と `production-with-health-connect` の共有が正しく進むこと（`autoIncrement` は手で上げない）

## HC 版で見直す Play Console の項目

- [ ] **健康アプリ申告**: Health Connect のデータ型の説明(上の下書き)。ステップ1の「性と生殖に関する健康」はそのまま
- [ ] **データセーフティ**: Health Connect への書き込みをどう申告するかは、公式の2ページ(「Android Health Permissions」「Publish your health app」)に書かれていない。Data safety の「健康情報」の説明ページ(support.google.com/googleplay/android-developer/answer/10787469)で確認する。**現在の回答は「収集・共有なし」**
- [ ] **ストアの掲載文**: Health Connect の連携を書くなら、書いた機能と送るデータが申告と一致すること。`docs/store-listing.md` の「HC を有効化する版では、★ の項目を必ず見直す」
- [ ] **カテゴリ**: Lifestyle のままか、Health & Fitness に変えるか（`docs/store-listing.md`「公開前に決めること」）
- [ ] **プライバシーポリシー**: 公式は、Play のストアページに載せるものと、Health Connect の権限画面から開くものが同一であることを求める。現行の §4 は HC 版を前提に書かれている

## 出典

- Android Developers「Declare access to Health Connect data types」: https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access
- Android Developers「Publish your health app on Google Play」: https://developer.android.com/health-and-fitness/health-connect/publish
- Play Console ヘルプ「Provide information for the Health apps declaration form」: https://support.google.com/googleplay/android-developer/answer/14738291
- Play Console ヘルプ「Android Health Permissions: Guidance and FAQs」: https://support.google.com/googleplay/android-developer/answer/12991134
