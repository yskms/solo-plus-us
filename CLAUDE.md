# Solo + Us — Claude 向けメモ

## 詳細ドキュメントの案内

詳細は `docs/` にある。下表の作業をするときだけ該当ファイルを読む（先読み・通読はしない。`@import` は使わない）。
各節のスタブには禁止事項・設計制約を残してあり、経緯・検証記録・原文は docs 側にある。
節の見出しを変えるときは、コード・README・docs が節名で参照しているので、旧見出しを `grep -rn` で探し、参照元を確認して一緒に更新する。

| 作業 | 読むファイル |
|---|---|
| iOS のビルド・TestFlight、UIScene、戻るボタン・UndoSnackbar | `docs/ios-notes.md` |
| Health Connect の同期・切断・全削除、ビルド分離、`EXPO_PUBLIC_*` | `docs/health-connect-dev-notes.md` |
| Health Connect 対応版のリリース準備（健康アプリ申告の HC 欄、審査の懸念、データセーフティ・掲載文・カテゴリの見直し） | `docs/health-connect-release.md` |
| ネイティブモジュール追加、Android のリリースビルド・AAB 確認、R8、ダーク/ライト切替 | `docs/android-build-notes.md` |
| `schema.ts`/migration を変えた後の実機テスト、adb のタップ無反応 | `docs/device-testing-notes.md` |
| `t()`・翻訳キー・複数形 | `docs/i18n-notes.md` |
| ストア掲載・紹介ページの文面、審査対応 | `docs/store-listing.md`、`docs/app-store-listing.md` |
| 仕様・設計判断 | README「ドキュメント」の表（設計判断記録 v0.11 が正本） |

## ローカル iOS ビルドは M4 MacBook Air 移行後にブロック解除済み（2026-09-30 確認）

旧 Mac（Xcode 26.3）の `expo run:ios` 失敗は、M4 移行後（macOS 27.0 / Xcode 27.0）は再現しない。この制約を前提に判断しないこと。Android・iOS ともにローカルで検証できる。

- **EAS の実行許可：** `eas build` は `--local` を含め、ユーザーが明示的に実行を指示した場合のみ
  実行する。`eas submit` も明示的な指示が必要。「TestFlight に上げて」はビルドと提出の両方の
  明示的な指示として扱ってよい。「リリースビルドを作って」はビルドのみの許可で、提出の許可は含まない。
  「iPhone 8 で確認したい」だけでは実行許可とみなさず、実行前に確認する。
  `expo prebuild`・`expo run:*`・`xcodebuild`・`./gradlew` はこの制限の対象外。
  理由：ビルド枠が貴重なことに加え、リリース用ビルド・提出操作は明示指示で実施する方針のため
- **iOS の実機確認は TestFlight 経由**（iPhone 8 は Xcode で直接ペアリングできない。グローバル CLAUDE.md 参照）。
  EAS の実行許可を得たうえで `eas build --local -p ios --profile production`、`eas submit -p ios --path <ipa>`
- `expo run:ios` は未確認（DeviceHub.app 関連の既知の問題。グローバル CLAUDE.md 参照）。代わりに `xcodebuild` + `simctl install`/`launch` を使う

検証記録: `docs/ios-notes.md`

## iOS 27 (UIScene) 対応

Xcode 27（iOS 27 SDK）向けは UIScene 未対応だと起動直後にクラッシュする。`plugins/withIosSceneDelegate.js`（`app.json` に登録済み）が `AppDelegate.swift`/`SceneDelegate.swift` へ注入している。

- **`ios/` は `expo prebuild` の自動生成物。修正は必ず plugin 側に加える**（直接編集は次の `prebuild` で消える）
- **import のアクセスレベルを揃える**（SE-0409）：`AppDelegate.swift`・`ExpoModulesProvider.swift` の `internal import` と、plugin の `SCENE_DELEGATE_SOURCE` が食い違うとコンパイルエラー。移植時や Expo/RN の更新時に確認する（コマンド: `docs/ios-notes.md`）
- **公式の `enableSceneSupport` への乗り換えは、ユーザーの指示があるまで実施しない。** 併用不可（先に plugin と `app.json` の登録を外す）。このプロジェクトでの検証は未実施。SDK 58 では不要になる
- **既知の制約：コールドスタートのディープリンクの URL が `Linking.getInitialURL()` に渡らない。** ウィジェット・通知・共有シート等で `soloplusus://` を使い始める場合は要注意

経緯・検証記録・乗り換えの条件: `docs/ios-notes.md`

### DBスキーマ変更後の実機テストはmigrationを確認する（アンインストールに注意）

Android 版は公開済みで、D-11（基本設計 §7.1）が効いている。**スキーマ変更は `SCHEMA_V1_STATEMENTS`（`database/schema.ts`）を直接編集せず、新しい migration として足す**（`database/migrations/` に追加し、`database/connection.ts` の `MIGRATIONS` に登録する。直接編集した内容は、migration 001 が走る新規インストールにしか入らない）。D-11 の制約は、前方向のみ、列追加は `ALTER TABLE ADD COLUMN` のみ、改名・型変更・CHECK 変更は新テーブル作成 → コピー → 差し替えを migration のトランザクション内で行う。

- **アップグレードの確認は、アンインストールせず、旧版の上に `adb install -r` で入れて行う**（データを保持したまま migration が走る）。旧版は、同じ署名で入る自分の開発ビルド（旧コミット）を使う。Play 版は署名が違うので、`-r` では入らない
- アンインストールが要るのは、開発中の migration を書き換えたとき（端末が旧版を適用済み）、migration を含むブランチから含まないブランチへ切り替えたとき（`SchemaTooNewError` で DB を開けない）、新規インストール経路の確認、直接編集した古いブランチで `no column named …` が出たときだけ
- **`adb uninstall` はアプリのデータと DB 暗号鍵を消し、戻せない**（OS バックアップも無効、D-07）。**実使用の記録がある端末（Play 版を入れている端末を含む）では、安易に実行しない。** 必要なら先に Export（JSON）で書き出し、共有シートは保存の成否を返さないので、保存先にファイルがあることを確認してから実行する。JSON で復元できるのは記録（Activity）と、記録項目・表示・言語の設定だけ。App Lock・スクリーンショット・Health Connect の設定と同期状態は戻らず、CSV は復元に使えない

経緯（D-51）、公開前の方針、Export の復元範囲の詳細: `docs/device-testing-notes.md`

### adb での実機 UI 操作時、LogBox の警告バナーがタップを奪うことがある

開発ビルドで LogBox の警告バナーが画面下部に出ていると、重なる位置（Save ボタン等）への `adb shell input tap` は何も起こらない。アプリの不具合と誤診しないこと。タップが理由なく無反応なら、まず `uiautomator dump` でバナーを確認し、「X」で閉じてから再現する。経緯: `docs/device-testing-notes.md`

### スクリーンショットに関する方針

スクリーンショットおよび画面録画は、デフォルトでは禁止しないこと。

プライバシー保護は、Recent Apps（アプリ履歴）のプレビューなどによる**意図しない情報露出を防ぐこと**を目的とし、ユーザー自身が意図して行うスクリーンショットや画面録画まで制限しない。

スクリーンショットの禁止機能を実装する場合は、ユーザーが任意で有効化できるプライバシー設定として提供すること。

「センシティブな情報を扱うアプリだから」という理由だけで、`FLAG_SECURE` 等を使用してスクリーンショットや画面録画を一律に禁止しないこと。

**Android の既知の制約**：Recent Apps プレビューの非表示だけを行う API
（`Activity.setRecentsScreenshotEnabled(false)`）は Android 13（API 33）以降にしか
無い。API 24〜32（Android 7.0〜12L）では `FLAG_SECURE` しか手段が無く、これは
スクリーンショット・画面録画のブロックと不可分（Recent Apps 非表示を有効にすると
必ずスクリーンショットも道連れでブロックされる）。ユーザーと相談のうえ、この
OS バージョン帯では「Recent Apps 非表示」を優先し、副作用として「Block Screenshots」
設定が事実上 ON 固定（無効化不可）になることを受け入れる方針とした（2026-09-18）。
詳細は README「Phase 3 実装状況 > 画面マスク」参照。

### 日時 picker の「digit carrier」パターン（`app/activity/[id].tsx`）

`app/activity/[id].tsx` の日時編集で picker に渡す `Date` は、実際の瞬間ではなく
「年月日・時分の数字を運ぶだけの入れ物」として扱っている（`toLocalDate`・
`nowAsZonedDigits`。詳細は `lib/datetime.ts` の `resolveOccurredAtEdit` の doc
comment）。ネイティブ picker はタイムゾーンを意識できず、渡した `Date` を常に
**端末の現在ゾーン**として表示・編集するため、「実際の瞬間を渡せばシンプルになる」
という一見自然な簡略化（`parseStrictUtcIso(activity.occurredAtUtc)` を直接渡す等）は
誤りで、記録時のゾーンと端末の現在ゾーンが異なる場合に表示・保存がずれる不具合を
再発させる。変更する際は必ず `resolveOccurredAtEdit`／`nowAsZonedDigits` の doc
comment を先に読むこと。

### Add Activity の日時は「数字＋矢印＋一覧」（`components/DateTimeSelector.tsx`）、記録済みの編集（`[id].tsx`）はネイティブ picker のまま

`app/record.tsx` の日時は、年・月・日・時・分の5列を画面内に直接置く。各列は「数字（タップするとその場で縦長の一覧が開く）」と、その上下の小さな矢印（Ionicons の chevron、タップで1ずつ）（2026-11-06、D-57）。2026-11-04 に入れたスクロール式のホイールは廃止した。Android には日時を一度に選べるネイティブ部品が無く、date → time の連鎖ダイアログで画面が切り替わって煩わしかったのが、画面内に置く理由。

- **スクロールしたあとに行へ寄せる仕組み（スナップ・補正・行の繰り返しによる循環・`scrollTo` の連鎖）を二度と作らない。** ホイールは Android（Pixel 3）で、行の途中で離すと補正が補正を呼んで揺れ続け、固まった。対策を2回重ねても結論が出ず、仕組みごと廃止した（D-56、D-57）。一覧（`components/OptionListPopover.tsx`）は普通の `ScrollView` で、開いたときに選択行へ1回だけ瞬時に置き、行はタップで選ぶ。自動で寄せる処理を足さない
- **ネイティブ picker・ダイアログ・シートへ戻さない。** 「画面内の小さな選択リスト」はこの禁止の対象外（禁止の理由は、連鎖ダイアログで画面が切り替わること）。ただし **React Native の `<Modal>` は使わない**。別ウィンドウで出るので、App Lock のオーバーレイに覆われず、ロック中でも見える。一覧は、画面全体に重ねる View（`useDateTimeSelector` の `popover`）として `record.tsx` が描き、安全領域の内側に収める（Android は edge-to-edge で、ナビゲーションバーの裏まで画面が伸びる）。開いている間は、Android の戻るボタンが画面でなく一覧を閉じ、背後を `importantForAccessibility` / `accessibilityElementsHidden` で読み上げから外す。ライブラリも足さない
- 常時表示で、開閉のリンクを足し直さない（既定の「Solo/Partnered を1タップ」にタップを足さない、§11.4）。操作するまで `customFields` は `null`（「Just now」）で、記録は Solo/Partnered を押した瞬間の時刻。上に「たった今」や選んだ日時の文字は出さない（最初に操作した瞬間に行が現れて、全体が押し下げられる）
- 「Just now」の間、数字は時計に追従する（5秒ごとに分が変わったかを見る）。**一覧が開いている間は止める**（開いた数字が下で変わる）。この追従を外すと、表示の時刻と実際に記録される時刻がずれる
- 画面の内容は縦方向の中央に寄せている。そのため「現在時刻を使う」の行は**数字の下**に置き、**常にレイアウトに残して表示（opacity）だけを切り替える**（出し入れすると、最初の1タップで内容全体の高さが変わる）
- **分は5分刻み**（`MINUTE_STEP`）。刻みに乗らない分（「Just now」の 14:37 など）は表示のまま、矢印で上は 14:40、下は 14:35 へ寄る（±5 にすると刻みに乗らない）。1分単位の修正は、記録後の編集画面（ネイティブ picker）でできる
- **月・日・時・分は矢印で循環する（23 の次は 0）。繰り上げはしない**（時が 23 から 0 になっても日は変わらない）。日の一覧と矢印は、その月の日数まで。**唯一の連動として、年か月を変えたとき、新しい月に無い日は月末へ寄せる**（3/31 → 11月で 30、2/29 → 平年で 28。`setDateTimeField`）。タップの瞬間に直すので、スクロールのような競合は起きない。値は `Date` でなく5つの数値（`lib/dateTimeFields.ts`）。`Date` の `setMonth` は 31日 → 翌月へ繰り上がる。年は 2000 から現在の年の10年先まで
- **未来の日時は選べる（2026-11-06、D-56）。値を「今」へ戻すクランプ、未来の行を薄く表示する処理、`record()` の `clampToNow` を戻さない**（黙って「今」で記録される）。代わりに、**未来の日時で Solo/Partnered を押したときだけ**確認アラートを出す（`record()`。「Just now」では出さない）。カレンダーの未来日に「この日に追加」を出さないことと、`[id].tsx` が未来を選べないことは、そのまま
- 日付は「昨日・今日」ではなく年・月・日の数字（カレンダーから過去日で開いたとき、相対表記だと分かりにくいため）
- `app/activity/[id].tsx` は `hooks/useNativeDateTimePicker.ts` のまま。部品は数字しか読まないので「digit carrier」にも載せられ、将来統一できるが、記録ゾーンの扱い（上の節）を確認してから

仕様: README「日時編集 UI」冒頭の注記

`SyncWorker` は「プロセス内単一ワーカー」（§6.2/D-36）が前提だが、これはコード自身では守られず、呼び出し側が守る責務。

- **drain のトリガを増やすときは、必ず `contexts/SyncWorkerLoop.tsx` の `drainingRef`/`rerunRequestedRef` による直列化を経由する。** `drainDueJobs` を独自のタイマーやイベントから直接呼ばない
- **破壊的操作（置換復元・全削除・HC切断等）は必ず `SyncCoordinator.runExclusive` 経由で呼ぶ。** `runExclusive` に渡す関数の内側から `drainDueJobs`/`useSyncWorkerLoop` 相当を呼ばない（直列化キューがネストでデッドロックする。`services/SyncCoordinator.ts` の「直列化」節）

Settings UI など新しい drain トリガや破壊的操作を足すときは、この2点を必ず踏まえる。経緯: README「Phase 4 実装状況」、`docs/health-connect-dev-notes.md`

### `react-native-health-connect` は iOS で「呼ぶと必ず throw する Proxy」

iOS ではモジュールが「どのメソッドを呼んでも `throw` する `Proxy`」で、`HealthConnectService.isAvailable()`/`ensureInitialized()` 等は**毎回確実に reject する**（恒常的な状態）。DB 読み取りなど他の非同期処理と同じ `Promise.all` に入れない（全体が常に失敗する。初版で踏んだ）。

- HC のネイティブ呼び出しは、DB 読み取りとは別の `try/catch` に分離する（`SyncWorker.drainDueJobs` の `ensureInitialized()` の扱いと同じ形）
- 根本対策は `app/settings/index.tsx` の HEALTH セクションを `Platform.OS === 'android'` でガードすること（HC は Android 専用機能、§9.11）

経緯（§10.5 違反）: `docs/health-connect-dev-notes.md`

### HC 同期をオンにする前の確認ダイアログ（`app/settings/health-connect.tsx` の `confirmEnableConsent`）は外さない・順序を変えない

同期のスイッチをオンにすると、**Health Connect の権限要求より前に**、書く内容・以後は記録のたびに自動で書くこと・他のアプリが読めること・残り方を示す確認ダイアログを出す。Play のユーザーデータポリシー（Prominent Disclosure & Consent）が、権限要求を直前のアプリ内の開示と対にすることを求めるため。データセーフティで「ヘルス情報を共有」と申告し、共有の免除の根拠にもしている。

- 「簡素化」のためにこの確認を外す、権限要求の後ろへ動かす、枠外タップ・戻るボタンを同意として扱う、のいずれもしない
- 有効化の後に出す「過去の記録も送りますか？」（`offerExistingRecords`）は別物。「あとで」でも以後の自動同期は有効のまま。件数は有効化の**後**でないと 0 になる（`countPendingResync` が `healthConnect.enabled` を見る）ので、順序を入れ替えない

経緯・確認結果: `docs/health-connect-release.md`

### package.json にあるのに未リンクなネイティブモジュール（Gradle デーモンのキャッシュ）

新しい（native code を持つ）Expo モジュールを `package.json` に追加した／未使用だったモジュールを初めて import したときは、通常のビルドが成功してもリンクされていないことがある（Gradle デーモンが autolinking の解決結果を古いまま使い回すため）。疑わしければ `cd android && ./gradlew --stop` してから再ビルドする。リンクの確認に `android/build/generated/autolinking/autolinking.json` は使えない（別物）。確認手順・経緯: `docs/android-build-notes.md`

### Android のダーク/ライト切替まわりの落とし穴

遷移中の帯やテーマ切替の反映漏れは、`contentStyle` や `useColorScheme()` では直らず、ネイティブ層（`android:windowBackground`、`AppCompatDelegate` の Day/Night、ステータスバー）が原因のことが多い。**色の定数は `constants/theme.ts`・`plugins/withAndroidNightColors.js`・`app.json` の3箇所に手動同期が必要**（自動参照する手段が無い）。詳細: README「Phase 3 実装状況 > Appearance」、`docs/android-build-notes.md`

### ローカルで Health Connect を触るには `.env.local` が必要（既定は無効）

`npm run android`/`expo start` は**既定で without-health-connect
（HC 無効）**。`cp .env.local.example .env.local` しないと、Settings に
HEALTH セクション自体が出ない（機能が無いのではなく、意図的にビルドごと
隠している。詳細は次の節）。DB スキーマ変更後の実機テストの落とし穴と同じく、
「コードのバグでは？」と無駄に調査する前にまずこれを疑うこと。

### リリースビルド分離（`without-health-connect`/`with-health-connect`）はネイティブモジュールを除去しない

`EXPO_PUBLIC_HEALTH_CONNECT_ENABLED` で切り替わるのは Manifest の permission（`android.permission.health.WRITE_SEXUAL_ACTIVITY`）と `withHealthConnectPermissionsRationale` plugin だけ。`react-native-health-connect` ネイティブモジュールは両ビルドともリンクされたまま（意図的な設計判断）。

- **既定値（env 未設定）は「無効」**（`=== '1'` のときだけ有効）。有効扱いに戻さない。判定式は `app.config.js` と `lib/healthConnectBuild.ts` の2箇所にあるので、両方直す
- **autolinking の `exclude` でネイティブモジュールを除外しない。** 審査のトリガーは Manifest の permission で、除外は実益が無くリスクだけが増える
- **「行を隠せば実行時参照は起こり得ない」は誤り。** with→without の入れ替えと deep link で到達する（対処: `reconcileHealthConnectBuildFlag()` と `health-connect.tsx` の `<Redirect>`。保証するのは壊れた UI・誤った案内を出さないところまで）。同種のビルドフラグ分岐を足すときも、UI を隠すことと「その状態になれない」ことを混同しない
- `EXPO_PUBLIC_*` は dev-client のライブリロードでは shell の export が JS 側に反映されない。`.env.local` に書いて `expo start --clear`

詳細・経緯: `docs/health-connect-dev-notes.md`

### ストア掲載のアセットを更新したら、提出済みのビルドにも同じ画像が入っているか確認する

Play 版 v1.0（versionCode 2）は、アイコン差し替え前にビルドした AAB を提出し、「インストールされたアイコンが掲載情報と異なる」で却下された（2026-10-06。経緯: `docs/store-listing.md` の「Play Console 申告の記録」）。`assets/images/` のアイコン類を変えたら、掲載情報の更新だけで済ませず、**そのアイコンを含むビルドを作り直して提出すること**。審査前に、インストールしたアプリのランチャーアイコンを掲載情報の画像と見比べる。

**Play のストアの名前は、端末上のアプリ名「Solo + Us」（`app.json` の `name`）と意図的に違う**
（en「Solo + Us: Sex Tracker」、ja「Solo + Us: 性行為・自慰行為の記録」。2026-10-31 に決定。
先頭は一致している）。上の 2026-10-06 の却下は、原因がアプリ内アイコンで、名前ではなかった。
名前をそろえようとして `app.json` の `name` を変えたり、ストアの名前を戻したりしない。

### App Store での実名表示は許容済み（既決事項——リスクとして再提起しない）

Apple の Individual（個人）アカウントでは、App Store のストアページに法的氏名
（Masashi Yasaka）が表示される（Filto・UTC NOW で既に同じ状態）。
**ユーザーはこれを繰り返し許容済み**（2026-09-30 に改めて明言）——iOS リリースは
既存の Individual アカウントでそのまま行う。Organization アカウントへの切り替えや
表記の匿名化を提案しないこと。`public/privacy-policy.html` §10 の管理者表記は
Google Play の表示名に合わせた `yskms.studio` のままでよい（ストアの実名表示との
差異も問題にしない）。

### 紹介ページ: ルート（`public/index.html`）は Android 用、`/ios/`（`public/ios/index.html`）は iOS 用。`/ios/` の文面は Apple の決着まで変えない。HTML コメントに審査の事情を書かない

ルート（`/solo-plus-us/`）は Play のストア掲載情報の「ウェブサイト」欄。`/solo-plus-us/ios/` は
App Store Connect の「サポート URL」と「マーケティング URL」（日本語のローカライズも）。
HTML コメントはそのまま配信されて誰でもソースで読めるので、**審査の状況・Apple の指摘・
判断の経緯をコメントに書かない**。経緯と判断は `docs/app-store-listing.md` の「紹介ページとサポート URL」の節。

- **2026-10-31 に URL を分けた**（このアプリは Android が主）。ルートは性行為・自慰行為を
  名指しで書く（`docs/store-listing.md` の Play の掲載文と揃える）。**`/ios/` は、Apple が
  指摘中の文面（名指しをしない「intimate life」の言い方）のまま。Apple の決着まで、
  title・description・本文を書き足さず、言い換えない。ルートの名指しの文面を `/ios/` へ
  写さない。** 手順と理由は `docs/app-store-listing.md` の「紹介ページの URL を分ける」
- 申告したコンテンツレーティング（「詳しい記述を伴わない性行為への言及」）より踏み込んだ
  表現（描写・画像）は書かない
- Android 用の日本語ページ（`/ja/`）は作ってよい。App Store のリンクと、JSON-LD の
  `operatingSystem` の `"iOS, Android"` は、iOS が公開されてから `/ios/` に足す（ルートには足さない）
- og・JSON-LD の description は meta description と同じ文にしておく（両ページとも、片方だけ
  直さない）
- Google Play のバッジは `/ios/` にも載せたままでよい（ユーザーが許容済み。理由と、外す条件は
  `docs/app-store-listing.md`）

### 多言語対応（i18n）——`lib/` は `t` を引数で受け取る、`t()` のキーに厳密な型は付けていない

日本語 + 英語（`i18next`/`react-i18next`、D-53）。リソースは `locales/en.json`/`locales/ja.json`。

- **`lib/` 配下の関数は `i18next` を直接 import せず、呼び出し元の `useTranslation()` から `TFunction` を引数で渡す**（新しい関数も踏襲する）
- **`t()` のキーに厳密な型は付けていない**（試して撤回済み）。typo はコンパイルを通るので、`npm run check-i18n`（手動実行）で確認する
- 複数形は `count` + `_one`/`_other`。`en.json` は両方が必要。`ja.json` は `_other` 付きが規約（接尾辞なしでも解決できるので必須ではない）
- **Hermes には `Intl.PluralRules` が無い。** `lib/i18n/index.ts` がポリフィルを実行時ガード付き `require` で読み込んでいる（静的 `import` にしない）。**複数形キーを足したら、実機で count=1 のケースを目視確認する**（`tsc`/`jest` では検出できない）
- `services/importValidation.ts` の検証メッセージ（約25種類）は意図的に未翻訳
- **日本語の「Health Connect」は、次のアプリ更新で、カタカナ「ヘルスコネクト」に一括で統一する予定**（公式の日本語名。ストアの掲載文は 2026-11-13 にカタカナ化済み）。**それまで、日本語の文言の HC 表記は既存の「Health Connect」に揃え、一部だけカタカナにしない**（混在を避ける）。範囲と注意: `docs/health-connect-release.md`「次のアプリ更新で入れること」

理由・経緯: `docs/i18n-notes.md`

### 戻るボタンが前画面のルート名（例: `(tabs)`）を表示してしまう問題

iOS の戻るボタン（通常表示・長押しの履歴メニュー・VoiceOver）は、前画面の `Stack.Screen` に `title` が
未設定だとルート名を表示・読み上げる。**新しく `Stack.Screen` を追加するときは `title` を付ける。**
`headerBackButtonDisplayMode: 'minimal'` とは役割が別で、長押しメニュー・VoiceOver には効かない
（`app/_layout.tsx` 内のコメント参照）。原文（確認日 2026-09-30 を含む）: `docs/ios-notes.md`

### 記録トースト（UndoSnackbar）とボトムタブの重なり

`components/UndoSnackbar.tsx` はルート直下（`(tabs)` の外）に描画されるため、`contexts/TabBarHeight.tsx` で
共有したタブバーの実測高さの分だけ底上げしている。`(tabs)` 以外の画面でトーストが高めに出るのは、
既知の制約としてレビューで許容済み（`contexts/TabBarHeight.tsx` の doc comment 参照）。原文（確認日 2026-09-30 を含む）: `docs/ios-notes.md`

### Android リリースビルド（`eas build --local`）の注意

`eas build`・`eas submit` の実行許可は、「ローカル iOS ビルドは M4 MacBook Air 移行後にブロック解除済み」の節の「EAS の実行許可」に従う。

- **`versionCode` は手で上げない。** `production` の `autoIncrement: true` がビルド時に +1 する。手で上げると二重に上がる（1.0.1 で 4 → 5 の実例）。ビルド後は `app.json` の差分をコミットして AAB と揃える。iOS の `buildNumber` は別管理
- `eas` は PATH に無いので `npx --yes eas-cli@25.3.0 build --local …` で実行する
- **リリース前に、AAB の Manifest に `android.permission.health.*` が無いことを毎回確認する**（手順: `docs/android-build-notes.md`）

### Android R8（難読化・最適化・縮小）——`plugins/withAndroidR8.js` は外さない・簡略化しない

2027年2月から、Play は DEX が 10MB 超のアプリに難読化・最適化・縮小の各率 25% 以上を求める。plugin なしの DEX は約 46MB、ありで約 9.9MB（10MB に近い。依存を足して超えると各率が要件の対象になる）。理由は `plugins/withAndroidR8.js` 冒頭のコメント、実測は README「Android R8 の有効化」。外さないもの：

- **`proguard-android-optimize.txt` への置き換えと `plugins/android-r8-rules.pro` はセット。** keep を外すと、リリースビルドだけで起動直後に `NullPointerException`（debug・`tsc`・`jest` では出ない）。`-dontoptimize` へ戻さない。keep を `Field`・`Required` の2つに絞らない
- **AGP は plugin が 8.12.3 に指定している。** RN 固定の 8.12.0 では Play の最適化率・縮小率が `-` になる。RN・Expo の更新や 8.12.4 以降の登場時は `AGP_VERSION` を見直す
- **`shrinkResources` は無効のまま。** JS から `require()` した画像が消される恐れがある
- `org.gradle.jvmargs` の 4GB 指定を戻さない（AAB のバンドルが `Java heap space` で落ちうる）
- **R8 の不具合はリリースの実行時にしか出ない。** Expo・RN・ライブラリ・plugin を更新したら、R8 入りの release APK をエミュレータで動かして確認する（手順と、`with-health-connect` の確認結果: `docs/android-build-notes.md`）
