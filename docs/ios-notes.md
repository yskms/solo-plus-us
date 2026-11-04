# iOS 固有の事項（ビルド・UIScene・戻るボタン・UndoSnackbar）

- 読むタイミング: iOS のローカルビルドや TestFlight 実機確認の手順を決めるとき、UIScene 対応（`plugins/withIosSceneDelegate.js`、`enableSceneSupport` への乗り換え）を触るとき、Stack の戻るボタンの表示や UndoSnackbar とタブバーの重なりを触るとき
- 元の場所: `CLAUDE.md` の「ローカル iOS ビルドは M4 MacBook Air 移行後にブロック解除済み」「iOS 27 (UIScene) 対応」「戻るボタンが前画面のルート名（例: `(tabs)`）を表示してしまう問題」「記録トースト（UndoSnackbar）とボトムタブの重なり」の4節（2026-11-03 に移動）。区切り線より下は原文のまま。ただし、各節が兄弟の節になるよう、見出しの `#` の数だけそろえた（見出しの文言は変えていない）
- 注記（EAS の実行許可）: 「ローカル iOS ビルド…」の節にある「EAS build は引き続き明示的な許可なしに実行しない（ビルド枠が貴重）」の一文は、2026-11-03 に `CLAUDE.md` の同名の節で「EAS の実行許可」として明確化した。実行許可の基準は `CLAUDE.md` を優先する
- 注記（乗り換え）: 「iOS 27 (UIScene) 対応」の節にある `enableSceneSupport` への乗り換えは、ユーザーの指示があるまで実施しない。この禁止は `CLAUDE.md` のスタブにも残している

---

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
**物理 iPhone（iPhone 8 / iOS 16.7）では TestFlight 経由で確認済み**
（2026-10-01、ビルド 0.1.0 (2)）：Touch ID での解除・バックグラウンド復帰時の
ロック・App Switcher のぼかし・記録などの基本操作・Google Drive からの
インポート。**iOS の実機確認は TestFlight 経由で行う**（iPhone 8 は Xcode で
直接ペアリングできない——グローバル CLAUDE.md 参照）。ビルドは
`eas build --local -p ios --profile production`、提出は `eas submit -p ios
--path <ipa>`（`eas.json` の `submit.production.ios.ascAppId` 設定済みのため
対話なしで通る）。`expo run:ios`（CLI 経由の自動フロー）もまだ未確認——
DeviceHub.app 関連の既知の問題が出うる（グローバル CLAUDE.md 参照）
ため、都度 `xcodebuild` + `simctl install`/`launch` の直接操作で
代替できる（`xcrun simctl` がシミュレータに対して無反応になった場合の
対処は、Solo + Us 固有の事象ではないためグローバル CLAUDE.md 参照）。

## iOS 27 (UIScene) 対応

**Xcode 27 (iOS 27 SDK) 向けにビルドしたアプリは、UIScene ライフサイクルに
対応していないと起動直後にクラッシュする**（EXC_BREAKPOINT/SIGTRAP、
クラッシュログのスタックトレースに
`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` が出る）。
2026-09-30 の作成時点では、Expo・RN 本体に公式のシーン対応が無かったため、
`plugins/withIosSceneDelegate.js`（`filto-app` リポジトリの同名プラグインを
移植）で `AppDelegate.swift`/`SceneDelegate.swift` へ手動でシーン対応を
注入している（`app.json` の `plugins` に登録済み）。その後、公式の手段が
入った（下記）。
2026-09-30 に、このプラグイン適用後にシミュレータで（Debug・Release
構成の両方、コールドスタート・URL 経由の起動を含め）クラッシュせず
起動〜 JS バンドル描画まで進むことを確認済み。2026-10-01 に物理 iPhone
（iPhone 8、TestFlight）でもクラッシュせず動作することを確認済み。

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
- **公式の対応手段は既にある（2026-10-31 に判明）が、このプロジェクトはまだ乗り換えて
  いない。** `app.json` の `expo-build-properties`（既に登録済み）の `ios` に
  `enableSceneSupport: true` を足す方法で、`expo` 57.0.23 以上・`expo-build-properties`
  57.0.20 以上が条件（公式ガイド: github.com/expo/fyi の `ios-scene-lifecycle.md`）。
  このプロジェクトは `expo` 57.0.23・`expo-build-properties` 57.0.21 で条件を満たす
  （2026-10-31 時点。ただし検証したのは `expo` 57.0.31 で、57.0.23〜57.0.30 は未確認）。
  検証用の新規プロジェクト（`expo` 57.0.31・`expo-build-properties` 57.0.22）の
  iOS 27 シミュレータでは、Release の起動・URL（コールドスタート含む）・バックグラウンド
  復帰と、`expo-dev-client` 入りの Debug の起動・Metro 接続まで確認済み（2026-10-31。
  設定を外すと症状どおり落ちることも確認）。**このプロジェクト自体**でのビルド・起動・
  TestFlight 実機確認は未実施。乗り換えは `ios/` の起動処理を変える変更なので、
  **ユーザーの指示があるまで実施しない**。乗り換えるときは、併用できない
  （公式は `UIApplicationSceneManifest` が既にあるとエラーにする）ので、先に
  `plugins/withIosSceneDelegate.js` と `app.json` の登録を外す。SDK 58 に上げたら、
  どちらも不要（`enableSceneSupport` は警告が出るだけ）
- **既知の制約：コールドスタート（未起動状態）でのディープリンクの URL が
  JS 側の `Linking.getInitialURL()` に渡らない**（ウォームスタートは問題
  ない）。2026-09-30 時点でアプリ内にディープリンク機能は無いため実害は
  無いが、ウィジェット・通知・共有シート等で `soloplusus://` を使い始める
  場合は要注意。根拠・再現手順は `plugins/withIosSceneDelegate.js` の
  `willConnectTo` 内コメント参照。公式の `enableSceneSupport` 構成（`expo` 57.0.31、
  検証用プロジェクト）では、コールドスタートの URL が `getInitialURL()` に届くことを
  確認済み（2026-10-31）。乗り換えれば、この制約は解消する見込み。ただし、このプロジェクトの
  `expo` 57.0.23 では未確認なので、乗り換えたら、アプリを終了して `xcrun simctl openurl` で
  開き、`getInitialURL()` に届くかを確かめる
- **App Lock・App Switcher ぼかし・`AppState` 依存の同期/言語処理は、
  シーン方式でも影響しないとソースコード上（静的確認のみ）で確認済み**
  （2026-09-30）——いずれも `UIApplicationDelegate` のコールバックではなく
  `NotificationCenter` 経由で `UIApplication` レベルの通知を購読しており、
  この種の通知はシーン方式でも引き続き発行されるため。2026-10-01 に
  iPhone 8 実機（TestFlight）でバックグラウンド復帰時のロックと App Switcher
  のぼかしを目視確認済み

## 戻るボタンが前画面のルート名（例: `(tabs)`）を表示してしまう問題

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

## 記録トースト（UndoSnackbar）とボトムタブの重なり

`components/UndoSnackbar.tsx` はルート直下（`(tabs)` の外）に描画され、
以前は下端固定位置（`bottom: 24`）だったためボトムタブ（自前実装、
`app/(tabs)/_layout.tsx`）と重なっていた。`contexts/TabBarHeight.tsx` で
タブバーの実測高さを共有し、その分だけ底上げして解消済み（2026-09-30、
シミュレーターで記録保存して確認済み）。`(tabs)` 以外の画面（`record`・
`activity/[id]`）ではタブバー分の高さが残ったままトーストが高めに出る
既知の制約はレビューで許容済み——詳細と理由は
`contexts/TabBarHeight.tsx` の doc comment 参照。
