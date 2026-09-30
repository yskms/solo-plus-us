# Solo + Us — Claude 向けメモ

## ローカル iOS ビルドは M4 MacBook Air 移行後にブロック解除済み（2026-09-30 確認）

旧 Mac（Xcode 26.3）では `expo-modules-jsi` の `swift-tools-version: 6.2`
まわりのコンパイラ不具合で `expo run:ios` が失敗していた。**2026-09-28 の
M4 MacBook Air 移行後（macOS 27.0 / Xcode 27.0）はこの不具合が再現しない**
ことを 2026-09-30 に確認済み——今後のセッションでこの制約を前提に判断
しないこと（経緯の詳細は git 履歴参照）。EAS build
は引き続き明示的な許可なしに実行しない（ビルド枠が貴重）。

**実機確認が必要なタスクでは：** Android・iOS ともにローカルで検証可能に
なった。iOS はシミュレータで `xcodebuild` のビルド成功に加え、
`simctl install`/`launch` でのシミュレータ起動・Metro 接続・JS バンドルの
描画（オンボーディング画面表示）を Debug 構成・Release 構成の両方で
確認済み（2026-09-30、下記「iOS 27 (UIScene) 対応」の対応後）。
**実機（物理 iPhone）はまだ未確認**——シミュレータでの確認のみである
ことに注意。**実機確認はリリース申請前の仕上げとして TestFlight 経由で行う
方針**（ユーザー決定、2026-09-30。iOS の EAS ローカルビルド・申請は他
プロジェクトで経験済み）——それまではシミュレータで確認できることは
シミュレータで確認し、「実機未確認」を TestFlight 配布のブロッカーとして
扱わないこと。`expo run:ios`（CLI 経由の自動フロー）もまだ未確認——
DeviceHub.app 関連の既知の問題が出うる（グローバル CLAUDE.md 参照）
ため、都度 `xcodebuild` + `simctl install`/`launch` の直接操作で
代替できる（`xcrun simctl` がシミュレータに対して無反応になった場合の
対処は、Solo + Us 固有の事象ではないためグローバル CLAUDE.md 参照）。

## iOS 27 (UIScene) 対応

**Xcode 27 (iOS 27 SDK) 向けにビルドしたアプリは、UIScene ライフサイクルに
対応していないと起動直後にクラッシュする**（EXC_BREAKPOINT/SIGTRAP、
クラッシュログのスタックトレースに
`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` が出る）。
Expo 57 / React Native 0.86 時点では Expo・RN 本体ともに公式のシーン対応が
未実装のため、`plugins/withIosSceneDelegate.js`（`filto-app` リポジトリの
同名プラグインを移植）で `AppDelegate.swift`/`SceneDelegate.swift` へ
手動でシーン対応を注入している（`app.json` の `plugins` に登録済み）。
2026-09-30 に、このプラグイン適用後にシミュレータで（Debug・Release
構成の両方、コールドスタート・URL 経由の起動を含め）クラッシュせず
起動〜 JS バンドル描画まで進むことを確認済み。**物理 iPhone 実機での
確認はまだ行っていない。**

- **`ios/` は `expo prebuild` の自動生成物（gitignore 対象）。修正は必ず
  `plugins/withIosSceneDelegate.js` 側に加えること**——`ios/` を直接編集
  しても次の `prebuild` で消える
- **filto-app からの移植時、Swift 6.2 の「import のアクセスレベル」機能
  (SE-0409) により追加の修正が必要だった**：このプロジェクトの Expo
  テンプレートが生成する `AppDelegate.swift` は `internal import Expo` と
  明示指定しており、`expo-modules-autolinking` が生成する
  `ExpoModulesProvider.swift`（アプリのターゲットに直接コンパイルされる）は
  `internal import ExpoModulesCore` を明示指定している。移植元の
  `SceneDelegate.swift` テンプレートはこれらを暗黙アクセスレベル
  （`import Expo`/`import ExpoModulesCore`）で書いていたため、同一
  モジュール内で「同じモジュールを異なる暗黙アクセスレベルで import」と
  判定されコンパイルエラーになった（`ambiguous implicit access level for
  import of 'Expo'/'ExpoModulesCore'`）。`internal import` に揃えて解決
  済み——**このプラグインを別プロジェクトへ移植する際や、Expo/RN の
  バージョンを上げた際は、`AppDelegate.swift`・自動生成の
  `ExpoModulesProvider.swift` 側の import 指定と、この
  プラグインの `SCENE_DELEGATE_SOURCE` 側の import 指定が一致しているか
  確認すること**（`grep -rn "^import\|^internal import" ios/SoloUs/*.swift`
  等で比較できる）
- Expo が公式に UIScene 対応した場合は、このプラグインと
  `SceneDelegate.swift` を撤去し、公式の仕組みに乗り換えること
- **既知の制約：コールドスタート（未起動状態）でのディープリンクの URL が
  JS 側の `Linking.getInitialURL()` に渡らない**（ウォームスタートは問題
  ない）。2026-09-30 時点でアプリ内にディープリンク機能は無いため実害は
  無いが、ウィジェット・通知・共有シート等で `soloplusus://` を使い始める
  場合は要注意。根拠・再現手順は `plugins/withIosSceneDelegate.js` の
  `willConnectTo` 内コメント参照
- **App Lock・App Switcher ぼかし・`AppState` 依存の同期/言語処理は、
  シーン方式でも影響しないとソースコード上（静的確認のみ）で確認済み**
  （2026-09-30）——いずれも `UIApplicationDelegate` のコールバックではなく
  `NotificationCenter` 経由で `UIApplication` レベルの通知を購読しており、
  この種の通知はシーン方式でも引き続き発行されるため。実機での
  バックグラウンド/フォアグラウンド遷移の目視確認はまだ行っていない

### schema.ts を変更した後の実機テストは、既存アプリを一度アンインストールすること

v1 は未リリースのため D-11「ALTER TABLE のみ」はまだ適用されず、
`database/schema.ts` を直接編集する方針（README 各所に記載）。これは
「新規インストール前提」の設計であり、**過去に一度でもインストールした
実機/エミュレータの DB ファイルは、`schema.ts` に後から追加された列を
自動では持たない**（`adb install -r` はアプリデータを保持したまま
アップグレードするため、DB ファイルは古いスキーマのまま残る）。

実際に、D-51（`health_sync.sync_state` 列追加）より前からテストに使って
いた Pixel 11 に最新ビルドを `-r` で上書きインストールしたところ、
`table health_sync has no column named sync_state` という SQLite
エラーが `SyncWorker` の finalize で発生し続けた（Settings 画面の
接続ステータスが不安定に見えるなど、無関係に見える副作用も伴った——
Health Connect Settings UI 実装時に実際に踏んだ）。

**`schema.ts` を変更した回のブランチ/コミットを実機でテストする際は、
`adb uninstall <applicationId>` してから `adb install` し直すこと。**
`-r`（保持アップグレード）で踏むと、コードのバグと勘違いして無駄に
調査することになる。

### adb での実機 UI 操作時、LogBox の警告バナーがタップを奪うことがある

開発ビルドで LogBox の警告バナー（「Open debugger to view warnings」等）が画面下部に
出ている間、`adb shell input tap` でその帯と重なる位置（Save ボタン等）をタップしても
**ネイティブの overlay に吸われて何も起こらない**——ログも出ず、画面遷移もしない。
一見「保存処理がサイレントに失敗している」ように見えるため、これを実際のアプリの
不具合と誤診しかけたことがある（Activity Detail の DATE & TIME 編集、2026-09-21）。
adb でのタップが理由なく無反応に見えたら、まず `uiautomator dump` でバナーの有無を
確認し、バナーの「X」を閉じてから再現し直すこと。

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

### Health Connect 同期の排他制御（`SyncWorker`/`SyncCoordinator`/`SyncWorkerLoop`）

`services/SyncWorker.ts` は「v1 はプロセス内単一ワーカー」（§6.2/D-36）を
前提に書かれているが、**この前提はコード自身では守られず、呼び出し側が
守る責務**になっている。実際に一度、この前提が壊れて
「cannot start a transaction within a transaction」（`db.transaction` の
衝突）と「claim が解放されずに次回起動まで残る」の両方を実機相当の
再現で踏んだ（`contexts/SyncWorkerLoop.tsx` のレビュー時）。

- **drain のトリガを増やすときは、必ず `contexts/SyncWorkerLoop.tsx` の
  `drainingRef`/`rerunRequestedRef` による直列化を経由すること。**
  `drainDueJobs` を独自のタイマーやイベントから直接呼ぶコードを新設しない。
- **破壊的操作（置換復元・全削除・HC切断等）は必ず
  `SyncCoordinator.runExclusive` 経由で呼ぶこと。** そして
  `runExclusive` に渡す関数の**内側**から `drainDueJobs`/`useSyncWorkerLoop`
  相当の処理を呼ばないこと——`SyncCoordinator` の直列化キューは同一
  呼び出しスタック内でのネストに対応できず、デッドロックする
  （`services/SyncCoordinator.ts` の「直列化」節参照）。

Settings UI（HC の ON/OFF・手動再試行/破棄）を実装する際は、新しい
drain トリガや破壊的操作を追加することになるため、この2点を必ず踏まえる
こと。詳細な経緯は README「Phase 4 実装状況」のレビュー履歴参照。

### `react-native-health-connect` は iOS で「呼ぶと必ず throw する Proxy」

`node_modules/react-native-health-connect/lib/commonjs/index.js` は iOS/未対応
プラットフォーム向けに `HealthConnectModule` を「どのメソッドを呼んでも
`throw` する `Proxy`」にしている（`moduleProxy`）。つまり
`HealthConnectService.isAvailable()`/`ensureInitialized()` 等は iOS では
**毎回確実に reject する**——一時的なエラーではなく恒常的な状態。

これを他の非同期処理（特に DB 読み取り）と同じ `Promise.all` に入れると、
その `Promise.all` 全体が常に失敗扱いになる。Settings > Health Connect 画面
（`app/settings/health-connect.tsx`）の初版でこの事故を実際に踏んだ——DB
読み取り4件とまとめていたため、iOS では毎回「何も同期されていない」ように
見えるだけでなく、未処理の delete job が残っていても件数が0件に見え、
§10.5「未処理が残っている間は件数を表示し続ける」に違反していた。

- Health Connect のネイティブ呼び出しは、DB 読み取りとは別の `try/catch`
  に分離すること（`services/SyncWorker.ts` の `drainDueJobs` が
  `ensureInitialized()` の reject を個別に扱っているのと同じ形）。
- 根本的な対策は `app/settings/index.tsx` の HEALTH セクションを
  `Platform.OS === 'android'` でガードすること——Health Connect は
  Android 専用機能（§9.11）なので、iOS でこの画面自体を表示しない。

### package.json にあるのに未リンクなネイティブモジュール（Gradle デーモンのキャッシュ）

`expo-application`/`expo-constants` は Phase 1 から `package.json` の
dependencies にあったが、実際には一度もネイティブ側でリンクされておらず、
2026-09-21（Settings > Version 表示で `expo-application` を初めて使おうと
した際）まで気づかれていなかった。`npx expo-modules-autolinking resolve -p
android --json` を直接実行すると両方とも解決対象に含まれるのに、Android の
通常のネイティブビルド（`expo run:android`・`./gradlew installDebug`）を
何度実行しても効果が無かった。

**原因は Gradle デーモンの再利用**：`expo-modules-autolinking` の解決結果は
Gradle の settings 評価フェーズでキャッシュされる。デーモンが起動したまま
だと、依存関係の解決結果が古いまま使い回されることがある（今回は長時間
（2日以上）起動しっぱなしだった `expo run:android` プロセスが影響していた
可能性が高い）。

**新しいネイティブモジュール（native code を持つ Expo モジュール）を
package.json に追加した／既存の未使用モジュールを初めて import した際、
通常のビルドで一見成功していてもリンクされていないことがある。** 疑わしい
場合は、ビルド前に一度 `cd android && ./gradlew --stop` で Gradle デーモンを
止めてから再ビルドすること。`android/build/generated/autolinking/
autolinking.json`（React Native コミュニティ側の legacy autolinking 設定）
は Expo モジュールのリンク状況の確認には使えない——別物なので確認先を
間違えないこと。確実な確認方法は、対象モジュールの値だけが変わる形で
JS 側のフォールバック値と native 側の値を意図的に食い違わせ（例：
`app.json` の `version` を一時的に別の値へ変更して JS だけリロードし、
native から読んだ値が変わらないことを見る）、実際に native 経由で
読めているかを実機で確認すること——見た目の値が同じだと「動いているように
見えるだけ」で気づけない。

### Android のダーク/ライト切替まわりの落とし穴

画面遷移中に一瞬見える帯や、テーマ切替の反映漏れは `contentStyle`（React Navigation
の各画面コンテナ）や `useColorScheme()` のオーバーライドだけでは直らないことがある。
原因はそれより下のネイティブ層（`android:windowBackground`、`AppCompatDelegate` の
Day/Night モード、ステータスバー）にあることが多く、`values-night/colors.xml` や
`Appearance.setColorScheme()`、`expo-system-ui` での対応が必要になる。色の定数は
`constants/theme.ts`・`plugins/withAndroidNightColors.js`・`app.json` の3箇所に
手動同期が必要（自動参照する手段が無い）。詳細と発見の経緯は README「Phase 3
実装状況 > Appearance」参照。

### ローカルで Health Connect を触るには `.env.local` が必要（既定は無効）

`npm run android`/`expo start` は**既定で without-health-connect
（HC 無効）**。`cp .env.local.example .env.local` しないと、Settings に
HEALTH セクション自体が出ない（機能が無いのではなく、意図的にビルドごと
隠している——詳細は次の節）。schema.ts 変更後のアンインストールと同じく、
「コードのバグでは？」と無駄に調査する前にまずこれを疑うこと。

### リリースビルド分離（`without-health-connect`/`with-health-connect`）はネイティブモジュールを除去しない

§9.11/§25.1 の実装（`app.config.js`・`lib/healthConnectBuild.ts`・
`eas.json`）は、`EXPO_PUBLIC_HEALTH_CONNECT_ENABLED` で **Manifest の
permission（`android.permission.health.WRITE_SEXUAL_ACTIVITY`）と
`withHealthConnectPermissionsRationale` plugin だけ** を切り替えている。
`react-native-health-connect` ネイティブモジュール自体は両ビルドとも
リンクされたまま——これは手抜きではなく意図的な設計判断。**既定値
（env 未設定）は「無効」**（`=== '1'` のときだけ有効、opt-in）——当初は
「未設定 = 有効」だったが、env 指定を忘れた/新しい build profile が
黙って permission 入りに倒れるのは危険側だとレビューで指摘され直した
（`app.config.js`・`lib/healthConnectBuild.ts` の doc comment参照）。
ローカルの `expo run:android`/`expo start` を HC 込みで使いたい場合は
`.env.local.example` を `.env.local` にコピーすること。

- Health apps declaration の提出トリガーは「配布 AAB の Manifest に
  health permission が含まれているか」であって、ネイティブモジュールの
  リンク有無ではない（§9.11 本文）。permission を切れば要件は満たされる。
  ただしライブラリ自身の `<queries><package android:name="com.google.
  android.apps.healthdata" /></queries>` は without ビルドでも Manifest に
  残る（審査トリガーになる permission ではないので問題無いが、「HC の痕跡が
  完全に消える」わけではない——レビュー指摘、2026-09-21）。
- ネイティブモジュールの物理除外（autolinking の `exclude`）は、
  Gradle デーモンのキャッシュ問題（本ファイル「package.json にあるのに
  未リンクなネイティブモジュール」の節）を踏むリスクの割に実益が無い
  ため、あえてやっていない。**「ネイティブモジュールも除外すべきでは」
  という直感で `exclude` 設定を足すような変更はしないこと**——上記の
  理由で不要かつリスクだけが増える。

**「行を隠せば実行時参照は起こり得ない」は誤りだった（レビュー指摘、
2026-09-21・実装当日に発見）。** 当初 `app/settings/index.tsx` が
`isHealthConnectBuildEnabled()` で HEALTH 行を隠すだけで十分だと考えたが、
以下の2経路で破られる：

1. **同一 applicationId での with→without 入れ替え。** `healthConnect.
   enabled` は暗号化 DB の設定として永続化され、アプリの入れ替え
   （`adb install -r` 相当のアップグレード）では消えない。以前
   with-health-connect ビルドで ON にしていた端末へ without ビルドを
   重ねると、`getActiveProviders`（`services/ActivityService.ts`）が
   health_connect を active と返し続け、`drainDueJobs` が permission の無い
   ビルドでジョブを claim しては失敗させ続ける——しかもそれを見る/止める
   UI（`health-connect.tsx`）は行が隠れていて到達不能。
2. **deep link での直接到達。** `app/settings/index.tsx` が行を隠しても、
   `soloplusus://settings/health-connect` は Expo Router のルートとして
   常に開ける。ON トグルを押すと `healthConnect.enabled = true` が書き込め
   てしまう（iOS は同じ「行を隠すだけ」だが、そちらはネイティブ呼び出しが
   必ず throw する Proxy なので安全側に倒れる——ビルドフラグのケースは
   ネイティブモジュールが生きたまま応答するため、同じロジックが通用しない）。

**対処（両方実装済み）：**
- `services/ActivityService.ts` の `reconcileHealthConnectBuildFlag()` を
  `contexts/DatabaseContext.tsx` の DB 接続確立直後（アプリへ公開する前）に
  1回呼び、`!isHealthConnectBuildEnabled()` なら `healthConnect.enabled` を
  false に是正する（この時点では SyncWorker は構造上まだ起動しえないため
  `SyncCoordinator.runExclusive` は不要——「初期化は runExclusive で
  包んでいない」と同じ理由。呼び出しは try/catch で握り、失敗しても DB
  接続自体は開いたまま起動を続ける——`ensureLocaleDefaultsPersisted` の
  ような「失敗したら以降の表示が壊れる」処理とは重みが違うため）。
- `app/settings/health-connect.tsx` の default export は薄いラッパーで、
  `!isHealthConnectBuildEnabled()` なら中身（全 hooks を持つ
  `HealthConnectSettingsScreenInner`）をマウントせず
  `<Redirect href="/settings" />`（`expo-router`）を返す（2回目のレビュー
  指摘で `useEffect`+`router.replace` の自作から差し替え——コンポーネント
  分割なら形式的にも Rules of Hooks 違反にならない）。

**ただし `reconcileHealthConnectBuildFlag` が解決するのは「provider が
active のまま止まる」「トグル画面が到達不能」の2点だけで、with-health-
connect ビルドで積まれた delete ジョブ自体が消えるわけではない
（3回目のレビュー指摘、2026-09-21）。** permission が無いビルドではその
ジョブを HC へ送る手段が無いため、jobs テーブルには残り続ける
（`drainDueJobs` の provider-disabled 早期 return で claim されないだけ
——§10.5 の「無効化中もジョブは保持される」と同じ扱い）。
`app/settings/delete-data.tsx` の全削除完了メッセージは、
`!isHealthConnectBuildEnabled()` のときだけ「このバージョンでは送信できない
（HC 対応版に更新されれば自動的に再開する）」という文言に分岐させている
——`healthConnect.enabled` が既に false なのに旧来の「Settings › Health
Connect で再接続してください」を出すと、到達不能な画面へ誘導することになる
ため。**with→without の入れ替えは、実際の配布（Play では片方のみ）ではなく
主にローカルでのビルド取り違え対策として作った経路であり、「ジョブが
いつか必ず送信される」ところまでは保証しない**——保証するのは「壊れた
UI 状態や誤った案内を出さない」ところまで。

「行を隠すだけで到達不能」という単純化は、**設定が他の経路（アップグレード・
deep link・将来の Import 等）で変わりうる場合は成立しない**——今後同種の
ビルドフラグ分岐を足すときは、UI を隠すことと「その状態に実際になれない」
ことを混同しないこと。

**`EXPO_PUBLIC_*` は `expo start`/`expo run:android` の dev-client 経由の
ライブリロードでは、shell の export だけでは反映されない（実機で実際に
踏んだ、2026-09-21）。** `app.config.js`（prebuild 時、素の Node プロセスが
`process.env` を読むだけ）は shell export で問題なく動くが、JS 側
（`lib/healthConnectBuild.ts` 等、bundle に埋め込まれる値）は別の仕組み
（`expo/virtual/env`、実体は `.env`/`.env.local`/`.env.development`/
`.env.development.local` からのみ値を取る require-context）を経由しており、
dev-client のライブ bundle ではこれが優先され、shell export した値が
反映されない（`undefined` になる）。**`npx expo export`（＝`eas build` が
実際に使う本番相当の静的バンドル生成)では shell export だけで正しく
リテラルへインライン展開される**（`return false;` まで定数畳み込みされる
ことを実際に確認済み）——つまり `eas.json` の `env` を使うリリースビルドは
問題なく動く。ローカルで dev-client 接続のまま JS 側の分岐だけを試したい
場合は、`.env.local`（gitignore 済み）に書いてから `expo start --clear`
すること。`app.config.js` と JS 側の判定で挙動が食い違って見えたら、まず
これを疑うこと。

### App Store での実名表示は許容済み（既決事項——リスクとして再提起しない）

Apple の Individual（個人）アカウントでは、App Store のストアページに法的氏名
（Masashi Yasaka）が表示される（Filto・UTC NOW で既に同じ状態）。
**ユーザーはこれを繰り返し許容済み**（2026-09-30 に改めて明言）——iOS リリースは
既存の Individual アカウントでそのまま行う。Organization アカウントへの切り替えや
表記の匿名化を提案しないこと。`public/privacy-policy.html` §10 の管理者表記は
Google Play の表示名に合わせた `yskms.studio` のままでよい（ストアの実名表示との
差異も問題にしない）。

### 多言語対応（i18n）——`lib/` は `t` を引数で受け取る、`t()` のキーに厳密な型は付けていない

日本語 + 英語対応（`i18next`/`react-i18next`）を実装済み（設計判断記録 D-53、
D-48 のスコープ外指定を撤回）。翻訳リソースは `locales/en.json`/`locales/ja.json`。

- **`lib/` 配下の関数は `i18next` singleton を直接 import せず、呼び出し元
  （コンポーネントの `useTranslation()`）から `TFunction` を引数で渡す**
  （`lib/timeFormat.ts`・`lib/relativeDate.ts`・`lib/calendarGrid.ts`・
  `lib/statistics.ts`・`lib/labels.ts`・`lib/activityDetailsFields.ts` 等）。
  `lib/` を i18n/React に直接依存させない、このコードベースの「依存を明示的に
  渡す」作法（`SqlExecutor` を毎回渡す等）に合わせている。新しく `lib/` に
  表示文字列を返す関数を足すときもこのパターンを踏襲すること。
- **`t()` のキー引数に `locales/en.json` から生成した厳密な型は付けていない**
  （一度 `types/i18next.d.ts` で試みて撤回済み——react-i18next のオーバーロード
  解決が、このリソースツリーの規模（150キー超）で特定の呼び出しを誤ったオーバー
  ロードに解決し、正しいコードに対して的外れなコンパイルエラーを出すように
  なった）。**`t('...')` に typo があってもコンパイルは通る**——キーの整合性は
  型ではなく `npm run check-i18n`（`scripts/checkI18nKeys.js`）で検出すること。
  全ソースの `t('...')` 呼び出しを `locales/en.json`/`ja.json` の実キーと
  突き合わせ、未定義キー・翻訳漏れ・複数形の `_one`/`_other` 片側欠けを検出する
  （新しいキーを大量に追加した後は、このコマンドを一度走らせて確認する。
  CI には組み込んでいない——手動実行が前提）。
- 複数形は i18next の `count` + `_one`/`_other` 接尾辞（CLDR plural rules）に
  委ねている——日本語は常に "other" カテゴリのみだが、`locales/ja.json` 側も
  **`_other` 接尾辞を省略せず付けている**（`statistics.days_other` 等。21キー
  すべてこの形）。**注：接尾辞なしのキーでも i18next は解決できる**（未接尾辞
  キーへのフォールバックが実装されている——実際に確認済み）ので、これは
  必須ではなく規約上の選択——`en.json` 側は `_one`/`_other` を書き分ける
  必要があるため、`ja.json` 側も明示的に揃えることで「このキーは複数形
  対応済み」と一目で分かるようにしている。
  `en.json` 側は `_one`/`_other` の両方が必要。どちらかの言語だけ追加して
  もう片方を書き忘れる、という抜け漏れに注意。
- **`Intl.PluralRules` は、この Android 実機（Pixel 11）の Hermes では
  `undefined`（`lib/i18n/index.ts` で実機確認・2026-09-21）。** `lib/datetime.ts`
  が既に指摘している「Hermes の Intl サポートは部分的」の実例がもう1つ増えた形——
  これが無いと i18next の複数形解決が、言語に関わらず「`count === 1` なら
  `_one`」という素朴な規則にフォールバックし、`ja.json` に `_one` が存在しない
  ため `fallbackLng: 'en'` で英語の `_one` 文言が出てしまう（**count が 1 の
  ときだけ**発生し、2以上では両言語とも `_other` に着地するため気づきにくい
  ——実際、`tsc`/`jest` はどちらも Node の `Intl.PluralRules` を使うため通過し、
  実機でしか再現しなかった）。`@formatjs/intl-pluralrules` のポリフィルを
  `lib/i18n/index.ts` で `Intl.PluralRules` 未定義時のみ `require`
  （Jest の ESM 未対応な `polyfill.js` を静的 import すると壊れるため、
  静的 `import` ではなく実行時ガード付き `require` にしている）で読み込んで
  解決済み。**新しい複数形キー（`_one`/`_other`）を追加したときは、`tsc`/
  `jest` だけでなく実機（または実機相当）で count=1 のケースを一度目視
  確認すること**——このクラスのバグは静的解析では検出できない。
- `services/importValidation.ts` の個別フィールド検証メッセージ（約25種類）は
  意図的に未翻訳——壊れた backup JSON のスキーマ違反を説明する開発者向けの
  技術的詳細で、通常の UI 文言よりログ出力に近いと判断した（設計判断記録 D-53）。
  周囲の「このファイルはバックアップに見えません」等の文言は翻訳済み。

### 戻るボタンが前画面のルート名（例: `(tabs)`）を表示してしまう問題

iOS の戻るボタンは、前の画面の `Stack.Screen` に `title` が未設定だと
ルート名をそのまま表示・読み上げる——通常表示・長押しの履歴メニュー・
VoiceOver のいずれも同じフォールバック先になる。`app/_layout.tsx` の
`<Stack.Screen name="(tabs)">` に `title: 'Solo + Us'` を明示して解消済み
（2026-09-30、シミュレーターの長押しメニューで実際に `"Solo + Us"` と
表示されることを確認済み）。

同ファイルの `headerBackButtonDisplayMode: 'minimal'`（Stack 全体で戻る
ボタンの文字を常に非表示にする設定）とは役割が別——`minimal` は見た目の
調整で、長押しメニュー・VoiceOver の表示元には効かない。新しく
`Stack.Screen` を追加する際、`title` を省略すると同じ問題が再発するので
注意（役割の違いは `app/_layout.tsx` 内のコメント参照）。

### 記録トースト（UndoSnackbar）とボトムタブの重なり

`components/UndoSnackbar.tsx` はルート直下（`(tabs)` の外）に描画され、
以前は下端固定位置（`bottom: 24`）だったためボトムタブ（自前実装、
`app/(tabs)/_layout.tsx`）と重なっていた。`contexts/TabBarHeight.tsx` で
タブバーの実測高さを共有し、その分だけ底上げして解消済み（2026-09-30、
シミュレーターで記録保存して確認済み）。`(tabs)` 以外の画面（`record`・
`activity/[id]`）ではタブバー分の高さが残ったままトーストが高めに出る
既知の制約はレビューで許容済み——詳細と理由は
`contexts/TabBarHeight.tsx` の doc comment 参照。
