# Health Connect 有効化版のリリース準備（申告文の下書き・審査の懸念・チェックリスト）

- 読むタイミング: `production-with-health-connect` で Health Connect 対応版（v1.0.x）を出す準備をするとき。Play Console の健康アプリ申告に Health Connect のデータ型の説明を書くとき、データセーフティ・掲載文・カテゴリを見直すとき
- 経緯: v1.0 は D-55 により `without-health-connect` で配布した。v1.0.4（versionCode 8）は 2026-11-09 に公開済みで、いずれも HC 権限なし。HC 対応版の準備は 2026-11-09 に `feat/health-connect-release` で着手し、同日 `main` へマージ・push した（プライバシーポリシー §4 の追記が、GitHub Pages に公開されたことも確認済み）
- 申告文は Google に提出する内容で、秘密情報ではない（公開リポジトリに置いてよい）

## 現状の Play Console（2026-11-09 に確認）

- 「アプリのコンテンツ」>「健康アプリ」のフォームは、ステップ1「アプリの健康関連の機能」（「性と生殖に関する健康」と「その他」にチェック済み）と、ステップ2「地域ごとの要件」の2段。**Health Connect のデータ型ごとの説明を書く画面は出ていない**（HC 権限入りのビルドを使っていないため、とみられるが、条件は公式ページに書かれていない）
- したがって Health Connect の申告は**未記入**。HC 権限入りの AAB をリリースに載せる段階で、Console が求めてくる可能性が高い（未確認）
- 公式の記述（Android Developers「Declare access to Health Connect data types」）: 申告は「公開の準備の中で」行う。扱うデータ型が変わるアップデートでも必要。提出した内容は「アプリ審査の一部として」審査される。承認状況をどの画面で見るかは、公式に書かれていない
- 公式ヘルプによると、センシティブな権限の審査には数週間かかることがある
- **2026-11-09、HC 版の AAB（9 (1.0.5)）を内部テストへ上げたあとの状態**: 内部テストのトラックには、申告を求める表示は何も出なかった。一方、「健康アプリ」のフォームを開くと、先頭に「このアプリは android.permission.health.WRITE_SEXUAL_ACTIVITY 権限を使用するため、健康アプリのポリシー要件を満たす必要があります」という案内が出るようになった（権限入りの AAB が登録されたため）。フォームはこの時点でも「ステップ 1/2」（アプリの健康関連の機能 → 地域ごとの要件）で、**Health Connect のデータ型ごとの説明欄は、まだ見ていない**
- **2026-11-10、ステップ1から「次へ」を押した結果**: ステップ2「地域ごとの要件」には「現時点では、このアプリでは、健康に関する申告について地域ごとの要件となる情報を提供する必要はありません」とだけ出て、Health Connect のデータ型の説明欄は**出なかった**。つまり、内部テストに権限入りの AAB を上げただけでは、この画面に HC の欄は現れない。公式ページ（Android Developers の declare-access と Play Console ヘルプ 14738291）は、HC の欄が出る条件を書いていない。両ページとも「機能を選んで次へ → 次の画面でデータ型ごとに説明」と書くだけで、トラックやリリース作成画面との関係には触れていない。**欄が出るのは本番リリースの作成か公開の概要の段階かもしれないが、未確認**。この画面で「保存」を押さないこと（権限なしの 1.0.4 に対する申告を、意図せず更新しうる）
- **2026-11-10、本番トラックでリリースの下書き（9 (1.0.5)）を作った結果**: 「プレビューして確認する」の画面にも「公開の概要」にも、健康アプリの申告や Health Connect を求める警告・エラーは出なかった。「公開の概要」は「変更内容を審査に送信できるようになりました」と表示した。つまり Console は、送信の段階でも HC の申告を強制しない。**だからこそ、送る前にデータセーフティ・掲載文・カテゴリを自分で合わせておく必要がある**（Console は不一致を事前に教えてくれない。2026-10-01 の否承認と同じ型の失敗を避ける）
- **公開済みの v1.0.4 のフォームは、HC 版の準備ができる前に変更しない**（不要な再審査を避ける）。申告は、HC 版の本番リリースと**同時に**「公開の概要」から送る（申告だけを先に送ると、本番に出ている 1.0.4 は権限を持たないので、申告と実態がずれる）。それまでは「下書きとして保存」にとどめる

## 審査で懸念される点

Play Console ヘルプ「Android Health Permissions: Guidance and FAQs」より。

- 生殖に関する健康の項目は**強い審査の対象**: 「ユーザー向けの機能(例: 妊活の記録、慢性疾患の管理)に、そのデータが必要であることを示す必要がある」
- 承認済みの用途として挙がるのは、フィットネス・ウェルネス・コーチング、特典、企業の福利厚生、医療、被験者調査、ヘルス連携のゲームなど。**性に関する記録のためという用途は載っていない**。`SexualActivity` が強い審査の対象に当たるかは、公式に明記がない(「Reproductive and sexual health」に分類されているので、当たるとみて準備する)
- 却下の例として「Needed for app functionality.」のような広すぎる説明が挙がっている。却下理由の定番は、説明の不足、承認済みの用途とのずれ、必要以上の権限の要求
- 守りになる点: 要求するのは `WRITE_SEXUAL_ACTIVITY` の1つだけ、READ なし、既定 OFF の明示同意制、送るのは日時と Protection だけ、端末外のサーバーへ送らない、広告なし
- **過去の教訓（2026-10-01）**: 掲載文の機能(気分の記録)が健康アプリ申告に無く、「申告の内容が正確ではありません」で否承認された。HC 版では、掲載文・プライバシーポリシー・rationale 画面・申告の4つで、書く機能と送るデータをそろえる

## 申告文の下書き

Health Connect のデータ型ごとの説明欄に貼る想定。実際の欄の文字数や言語は、Console に出てから合わせる。**書くのは、アプリ自身の動作（利用者が有効にしたときだけ、記録の写しを Health Connect に書き込む）と、その目的、読まないこと、削除と残り方に絞っている。** rationale 画面の文言・プライバシーポリシー §4 と矛盾しないこと。

### データ型: SexualActivity（書き込みのみ）

en:

```
Solo + Us is a private activity log that works offline. If the user explicitly turns on "Sync to Health Connect" in Settings (it is off by default), the app writes one Sexual activity record for each entry the user has logged. A record contains only the date and time of the entry and the optional "protection used" value (protected, unprotected, or unknown). The purpose is to let users who want it keep a copy of their own log in Health Connect, together with the rest of their health data on the device. In Health Connect, the user decides which apps may read it and can view or delete it at any time.
The app only writes. It requests no read permission and never reads anything back from Health Connect. No other detail (context, outcome, mood, duration, or notes) is written. When the user deletes an entry in the app, the app also deletes the corresponding Health Connect record. The user can turn sync off at any time in Settings. The data is not sent to any server or third party and is not used for advertising. Records already saved in Health Connect remain there, under the user's control, even if the app is uninstalled.
```

ja:

```
Solo + Us は、端末の中だけで使う私的な記録アプリです。利用者が設定で「Health Connect に同期」を明示的に有効にした場合に限り（既定は無効）、記録した項目ごとに性行為(Sexual activity)のレコードを1件書き込みます。レコードに含まれるのは、記録の日時と、任意項目の「避妊具等の使用有無」(あり・なし・不明)だけです。目的は、希望する利用者が、自分の記録の写しを、端末上のほかの健康データと同じ Health Connect にまとめて置けるようにすることです。Health Connect の中では、どのアプリに読み取りを許可するかを利用者が決め、いつでも確認・削除できます。
アプリは書き込みのみを行い、読み取り権限は要求せず、Health Connect から何も読み込みません。それ以外の詳細（状況、結果、気分、時間、メモ）は書き込みません。アプリ内で記録を削除すると、対応する Health Connect のレコードも削除します。同期は設定からいつでも無効にできます。データはサーバーや第三者へ送信せず、広告にも使用しません。Health Connect に保存済みの記録は、アプリをアンインストールしても、利用者の管理下で Health Connect に残ります。
```

確認が要る点:

- **特定の種類のアプリ（周期管理アプリなど）を例に挙げない**（2026-11-09 の判断）。自分のアプリの機能ではない用途を書くと、実態とずれたときに「申告の内容が正確ではない」と見られうる（2026-10-01 の否承認と同種のリスク）。書くのは、アプリ自身の機能（希望する利用者が、自分の記録の写しを Health Connect に置けるようにする。読み取りは許可したアプリだけ、確認・削除は利用者が Health Connect で行う）に限る。「他のアプリが読めること」は Health Connect 自体の説明であって、このアプリの機能ではないので、主役にしない（2026-11-09 の指摘）。書き込みだけの連携では、利益は Health Connect の側にしか無い。それを偽らず、「写しを置く」という自分の動作と目的で書く。確認できた事実（Health Connect が Sexual activity を「Cycle tracking」に分類していること）は、Console に聞かれたときの補足に使う。「例」が必要と Console に言われたら、そのとき足す
- 「サーバーへ送らない」は、`docs/store-listing.md` のデータセーフティの回答（収集・共有なし）と同じ根拠。Health Connect への書き込みを Data safety でどう申告するかは、下の「見直す項目」参照

## HC 版を出す前のアプリ側の確認

- [x] `with-health-connect` の R8 入り release APK をエミュレータで動かす（2026-11-09 に実施。結果は下の節。**App Lock・書き出し/読み込みは再実行していない**）
- [x] D-54 の Protection 既定値が、Health Connect に PROTECTED として届くか（2026-11-09 に確認。下の節）
- [x] **AAB** の Manifest に `android.permission.health.WRITE_SEXUAL_ACTIVITY` が**あること**、ほかの `health.*` が無いこと（2026-11-09 に確認。versionCode 9・1.0.5。README「v1.0.5 の Health Connect 対応版ビルド」）
- [x] 権限の rationale 画面の文言が `public/privacy-policy.html` §4 と一致していること（2026-11-09 に Pixel 3 で、権限画面のリンクから開いて確認。**ポリシーの公開（`main` へのマージと push）は、まだ**）
- [x] オンボーディングの「Health connection is optional」が HC 版で表示されること（2026-11-09 に確認）
- [x] versionCode が 9 以降で、`production` と `production-with-health-connect` の共有が正しく進むこと（2026-11-09 に `8 から 9` で確認）

## 2026-11-09 の確認結果（エミュレータ Filto_API_36、Android 16、release APK）

方法: `EXPO_PUBLIC_HEALTH_CONNECT_ENABLED=1 npx expo prebuild -p android --no-install`（`--clean` なしと指定したが、`android/` は作り直された）→ 同じ環境変数を付けて `cd android && nice -n 10 ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`（7分44秒）。debug 署名、versionCode 8・versionName 1.0.4（`app.json` は未変更）。**環境変数は JS バンドルのインライン展開にも要るので、gradle の実行にも付ける。**

確認できたこと:

- 起動直後からの操作で、logcat に `FATAL EXCEPTION`・`has been rejected`・`NoSuchMethodError` 等は出なかった（R8 由来の不具合なし）
- APK の権限は `INTERNET`・`USE_BIOMETRIC`・`USE_FINGERPRINT`・`VIBRATE`・`health.WRITE_SEXUAL_ACTIVITY`（と自前・Play の2件）。ほかの `health.*` は無い
- オンボーディングに「Health connection is optional」が出る。Settings に HEALTH セクションが出る。既定は OFF（Not connected）
- 権限ダイアログは「Allow "Solo + Us" to write: **Sexual activity**」の1項目だけ。READ の項目は出ない。ダイアログにプライバシーポリシーへのリンクがある
- 許可後は Connected。Partnered（Protection の既定値を Yes、**表示トグルは OFF のまま**）は、Health Connect 側で **Protected** になった。Solo は Protection の指定なしで届いた
- Health Connect 自体が、Sexual activity を「**Cycle tracking**」のカテゴリに分類している（申告文の「周期管理アプリ」という用途の説明の裏づけになる）
- アプリで記録を削除すると、Health Connect 側のレコードも消えた
- OFF にすると Not connected に戻る
- **アプリをアンインストールしても、Health Connect に書いた記録は残る**（エミュレータで確認。記録1件を同期 → `adb uninstall` → Health Connect の Data and access > Sexual activity に「Solo + Us」の記録が残っていた。App permissions は 3 から 2 に減り、権限は取り消された）。公式の説明とも一致する。`public/privacy-policy.html` §4 と rationale 画面の文言に、この旨を2026-11-09 に追記した（rationale の文言は `plugins/withHealthConnectPermissionsRationale.js`。ネイティブの文字列なので、反映は次のビルドから）
- 新しい日時入力（数字＋矢印）は、release ビルドでも正常に表示された

気づいた点（変更していない）:

- **削除の反映が遅れた。** 削除の約10秒後と約30秒後の確認では Health Connect 側にまだ残っていて、アプリを前面に戻した直後（Last synced 9:39 PM）に消えた。アプリが背景にある間は削除の同期が進まず、前面に戻ると進んだ可能性がある（推測。確認していない）。プライバシーポリシーの「Health Connect に残ることがある」旨の記述と、設定画面の注記（「アプリを閉じると削除は止まり、次に開いたとき再開する」）の範囲内の挙動
- **記録1件の削除の確認ダイアログは「This will remove the record from this app.」だけで、Health Connect からも削除されることに触れていなかった。** 2026-11-09 に、Android の HC ビルドだけ「同期が有効な場合は、Health Connect からも削除されます」を足した（`app/activity/[id].tsx` の `confirmDelete`、キー `activityDetail.deleteConfirmMessageHealthConnect`）。ビルドのフラグだけで出し分け、同期の実行時の状態は読まない（`settings/activity-details.tsx` の注記と同じ方式）。型チェック・jest・`check-i18n` は通した。**実機・エミュレータでダイアログを表示しての確認は、まだ**

確認していないこと: App Lock、書き出し・読み込み、Android 13、Pixel 11、Play 経由で配信される AAB、置換復元後の再同期（rationale 画面・Android 12・実機・削除ダイアログは、下の Pixel 3 の節で確認した）。

## 2026-11-09 の確認結果（Pixel 3、Android 12、Health Connect は別アプリ、release APK 1.0.5）

方法: 現在のブランチから、HC 有効の release APK（`EXPO_PUBLIC_HEALTH_CONNECT_ENABLED=1`、arm64、debug 署名、versionCode 9）をビルドし、端末に入っていた開発用 1.0.1（debug 署名）へ `adb install -r` で上書きした（アンインストールしていない。データは保たれる）。この APK には、削除ダイアログと rationale 画面の新しい文言が入っている。**Android 12 のアプリ画面は `FLAG_SECURE` でスクリーンショットが取れない**（CLAUDE.md の既知の制約）。アプリ内は `uiautomator dump` で文字と座標を読んで操作し、Health Connect 側（別アプリ）はスクリーンショットで確認した。

- 起動・操作中、logcat に `FATAL EXCEPTION`・`has been rejected`・`NoSuchMethodError` 等は出なかった。日本語表示で正常
- 権限画面（Health Connect アプリ側）は「「Solo + Us」に書き込みを許可する: 性行為」の1項目だけ。読み取りの項目は無い。画面のプライバシーポリシーのリンクから **rationale 画面が開き、新しい文言**（アンインストールしても Health Connect 側で削除するまで残る）が表示された。プライバシーポリシー §4 と矛盾しない
- 同期: 2件が届いた。Partnered（避妊の既定値「あり」、表示トグルは OFF のまま）は「避妊具使用」付き、Solo は付かない（D-54 の確認は、Android 12 でも成立）
- **削除ダイアログに新しい文言**（「このアプリから記録が削除されます。Health Connect への同期が有効な場合は、Health Connect からも削除されます。」）が出る
- 削除の同期: アプリで削除した記録は、Health Connect 側から消えた。削除の約25秒後に開いた一覧には、まだ残って見えた（古い画面の再表示とみられる。Health Connect アプリを開き直すと消えていた）。**アプリが前面か背景かで遅れが変わる、という推測は、確認できていない**
- 切断（同期 OFF）は「未接続」に戻る。テストで入れた記録はすべて削除し、Health Connect 側の「月経周期の追跡」に、性行為の項目が残っていないことを確認した

確認していないこと（Pixel 3 の範囲）: 英語表示の削除ダイアログ、Protection 既定値の「未記録」への復元を目視で確認すること（スクリーンショットが取れないため、「未記録」を押したことしか分からない）、Play 経由で入れた版。

## HC 版で見直す Play Console の項目

- [ ] **健康アプリ申告**: Health Connect のデータ型の説明(上の下書き)。ステップ1の「性と生殖に関する健康」はそのまま
- [ ] **データセーフティ（判断済み 2026-11-10: 「ヘルス情報」を共有ありで申告。Console への入力は未）**。**現在の回答は「収集・共有なし」**（v1.0.x は HC なし）。公式ヘルプ「Provide information for Google Play's Data safety section」（answer/10787469）の記述:
  - 「収集(collect)」は「アプリから端末の外へデータを送ること」。端末内だけの処理は申告不要。HC への書き込みは端末の外へ出ないので、**収集には当たらない**
  - 「共有(share)」は「アプリが集めたデータを第三者へ渡すこと」。ただし「**端末上の別のアプリへの転送**」は、端末の外へ送らなくても共有として申告が要る、と明記されている
  - 共有の除外条件に「利用者が自分で起こした操作で、利用者がデータの共有を当然に予期できる場合、または目立つアプリ内の説明と同意がある場合」がある
  - **ページには Health Connect への言及が無く、HC への書き込みが「端末上の別のアプリへの転送」に当たるかは、書かれていない。** 除外条件が端末内の転送にも使えるかも、書かれていない
  - 健康系の区分は「Health info」(病歴や症状など)と「Fitness info」だけ。性的活動や生殖に関する区分は無い
  - **推奨: 保守側に倒して申告する。** 「Health info」を「共有」「任意(利用者が有効にしたときだけ)」「目的: アプリの機能」で申告する案。理由: ①HC に書いた記録は、読み取りを許可した他のアプリから読める ②2026-10-01 の否承認は、**健康アプリ申告**（データセーフティではない）で実態より少なく申告していたことが原因だった。同種の失敗を避ける ③多めに申告して指摘されるより、少なく申告して「不正確」とされる方が重い。弱点: ストアに「データを共有」と表示される（掲載文の「収集・共有なし」の趣旨とずれる）。**Console の実際のフォームの文言を見て最終判断する**（フォームのほうが明確かもしれない）。暗号化・削除要求の設問は、端末の外へ送らない場合に適用されるかが、ページに書かれていない
  - **2026-11-10 に追加で確認した事実**（ヘルプ answer/10787469 の日本語版）: 「デバイス上での別のアプリへの転送」は共有の一種で、「アプリがユーザーのデバイス外にデータを送信しない場合でも、データ セーフティ セクションの申告でデータ共有を開示する必要があります」と明記されている。「サードパーティ」は「ファースト パーティとそのサービス プロバイダ以外の組織」と定義され、Google の Health Connect が該当するかは書かれていない。共有の免除には「ユーザーが開始した特定のアクションに基づき、ユーザーが共有を合理的に予期している場合、または認識しやすいアプリ内の開示と同意に基づく場合」があり、HC 同期（既定オフ・設定で有効化・権限ダイアログ）はこれに当てはまりうる。ただし HC への言及はページに無く、免除が使えるかは確定できない。フォームの定義文（「共有」は「デバイス上でまたはデバイスから、サードパーティに転送すること」）も同様
  - **判断（2026-11-10）: 「ヘルス情報」を「共有」で申告する。** 確認できていない事実: Health Connect への継続的な自動書き込みに、共有申告の免除が適用されるか（公式ページに HC の言及が無い）。確認できた事実: 端末内の別アプリへの転送は、原則として共有に該当する。**免除を前提とせず、共有ありとして申告する**（事実と開発者の判断を区別して書く。「あり」が常に偽にならない、とまでは言い切らない。データセーフティは定義と免除規定に基づく申告で、単なる転送の有無の申告ではないため）。過剰申告が取り締まられるかは公式に書かれていないので、「あり」が安全だとも断定しない
  - **免除が成り立つかの材料**（2026-11-10、コードと公式ポリシーで確認）: HC 同期は既定オフで、設定で「Sync to Health Connect」をオンにすると、Android の権限ダイアログ（rationale 付き）を経て有効になる。**オンにしたあとは、記録・編集・削除のたびに自動で HC へ書く**（書き込みごとの操作は無い。有効化時に既存の記録を自動で送ることもしない。送るのは「RE-SYNC」の明示操作のとき）。このため「ユーザーが開始した特定のアクション」の枝は弱く、残るのは「認識しやすいアプリ内の開示と同意」の枝。ユーザーデータポリシーの Prominent Disclosure は「ユーザーの合理的な予期の範囲外」の場合に課される条件付きの要件で、同期をオンにするという明示的な操作は予期の範囲内と主張しやすい。ただし、設定画面の説明文は切り替えスイッチの下の小さな注記で、権限要求の「直前に」出る開示ではない。要件の字面（権限要求の直前の開示、通常の利用で設定への移動を要しない）を満たすとは言い切れない
  - **戻す条件**: 「共有なし」へ戻すのは、HC への書き込みが共有に当たらないという公式の根拠が得られたときか、HC 審査の結果などで共有扱いが不要と確認できたときに限る。理由なく戻すと、実態の変化との説明がつかない
  - **将来の強化案（未実施。1.0.5 では不要と判断、2026-11-10 のレビュー）**: 現状は、設定画面から同期をオンにし、Android の権限ダイアログ（rationale に「記録ごとに」と明記）で許可を取っており、追加の確認ダイアログは必須と言えない。操作が増える弊害もある。先に見るべきは、設定画面の説明が足りているか。今の説明（`aboutWhatIsSynced`/`aboutWhatStaysLocal`）は「何が保存されるか」だけで、**オンにすると以後の新規・編集・削除が自動で反映される**ことは書かれていない（rationale と削除確認には出る）。次のバージョンで、この1文を説明に足すことを検討する（ja.json/en.json の変更のみで済む。ダイアログは足さない）。あわせて、**有効にする前の記録は自動では送られない**（送るのは「Sync everything to Health Connect」の明示操作のとき）ことも、設定画面の説明で明確にしたい（2026-11-10 のレビュー）。掲載文には書いてある
  - **既存記録の送信の仕様（2026-11-10 にコードで確認。D-34、`services/HealthSyncResyncService.ts`）**: HC を有効にしても、過去の記録は何も送られない（同期ジョブは、記録の追加・編集・削除のときにだけ作られる）。設定 > Health Connect の「Sync everything to Health Connect」を押すと、**今同期中でない記録を、過去の全履歴を含めてまとめて送る**（対象件数を見せる確認ダイアログを経由。HC に既にあるものは置き換え、「Don't sync」で除外した記録は送らない）。初めて有効にした直後に押せば全履歴を送れるのは、意図した振る舞い（`HealthSyncResyncService.ts` 冒頭）。ただし、この入口の説明文（`resyncExplanation`）は「復元後などに再送する」場面しか書いておらず、**初回の有効化後に過去分を送れることが見つけにくい**
  - **改善案（未実施、要判断）**: 同期をオンにした直後に、1つのダイアログで次を出す。①書く内容（日時と避妊具等の使用有無）、以後は記録のたびに自動で書くこと、他のアプリが読めること ②「既存の N 件も今送りますか？」（送る／あとで）。置換復元後の `offerResync`（`app/settings/data.tsx`）と同じ形で作れる。過去分の送信の見つけやすさ、自動反映の周知、免除の根拠（Prominent Disclosure）が一度に良くなる。コード変更なので、versionCode が上がり、ビルド・実機確認のやり直しが要る。HC 審査（権限とデータ型）の対象は変わらない
  - **Console のフォームの順序（2026-11-10 のレビュー指摘）**: ステップ2で「はい」を選ぶと、同じステップ2に、転送時の暗号化・アカウントの作成方法・データ削除のリクエスト方法の設問が出るのが通常（「いいえ」で進んだ前回は出なかった）。ステップ4の「必須か任意か」「エフェメラル処理」は収集についての設問で、共有だけのときは出ないことがある。目的は収集と共有で別々に聞かれる。画面に出なければ答えなくてよい。暗号化は、端末内のやり取りだけなので、実態を超えて「はい」と答えない（文言を見てから決める）
  - **実際のステップ2の設問（2026-11-10、「はい」を選んだ直後）**: ①「アプリで収集するユーザーデータはすべて、転送時に暗号化されますか？」（はい/いいえ）②「アカウントの作成方法」（選択肢の末尾に「ユーザーによるアカウントの作成をアプリで許可していない」）。データ削除のリクエスト方法の設問は、このステップ2には出なかった。公式ヘルプは、暗号化を「デバイスからサーバーへのデータの流れを保護するため」の措置と定義し、端末内だけのデータがこの設問の対象かは書いていない。**回答: ①「いいえ」（サーバーへ送らず、端末内の受け渡しなので、暗号化を主張しない）②「アカウントの作成を許可していない」**。「いいえ」のときにストアに何が表示されるかは公式に書かれていない（ステップ5のプレビューで確認する）
- [ ] **ストアの掲載文**: Health Connect の連携を書くなら、書いた機能と送るデータが申告と一致すること。`docs/store-listing.md` の「HC を有効化する版では、★ の項目を必ず見直す」
- [ ] **カテゴリ**: Lifestyle のままか、Health & Fitness に変えるか（`docs/store-listing.md`「公開前に決めること」）
- [ ] **プライバシーポリシー**: 公式は、Play のストアページに載せるものと、Health Connect の権限画面から開くものが同一であることを求める。現行の §4 は HC 版を前提に書かれている

## 出典

- Android Developers「Declare access to Health Connect data types」: https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access
- Android Developers「Publish your health app on Google Play」: https://developer.android.com/health-and-fitness/health-connect/publish
- Play Console ヘルプ「Provide information for the Health apps declaration form」: https://support.google.com/googleplay/android-developer/answer/14738291
- Play Console ヘルプ「Android Health Permissions: Guidance and FAQs」: https://support.google.com/googleplay/android-developer/answer/12991134
- Play Console ヘルプ「Health Content and Services」(Console の案内に載っていたリンク。HC の欄が出る条件は書かれていない): https://support.google.com/googleplay/android-developer/answer/16679511
