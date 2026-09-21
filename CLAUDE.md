# Solo + Us — Claude 向けメモ

## ローカル iOS ビルドが現在ブロックされている（`expo run:ios` 不可）

**原因は `op-sqlite`/SQLCipher ではない。** `expo-modules-jsi` が要求する
`swift-tools-version: 6.2` と、ローカルの Xcode 26.3 の Swift/C++ 連携に
コンパイラ不具合があり、`RuntimeScheduler.h` の
`SWIFT_RETURNS_RETAINED`/`SWIFT_RETURNS_UNRETAINED` と
`SWIFT_SHARED_REFERENCE` の組み合わせがコンパイルエラーになる。

- `main` ブランチ・`feat/ios-widget` ブランチの両方で同じエラーを確認済み
  ——ウィジェット追加が原因ではないことも確認済み
- ヘッダーへの修正パッチも効果なし
- 根本解決には Xcode 26.6 以降が必要だが、**macOS Sequoia 15.8 では
  Xcode 26.6 を実行できないため、ローカル更新を提案しない**（ユーザーの
  グローバル CLAUDE.md 方針）
- Xcode 26.6 以降が必要な作業は、OS アップグレードを前提とせず、まず
  クラウドビルド等の代替手段を検討すること（同上）。ただし EAS build は
  明示的な許可なしに実行しない（ビルド枠が貴重）

**実機確認が必要なタスクでは：** Android は実機（USB デバッグ接続）・
エミュレータともにローカルで検証可能。iOS は上記が解決するまでローカル
シミュレータ/実機起動ができない——iOS 側の確認だけを理由にタスクを
止めず、まず Android 側で検証し、iOS は上記の制約を明示したうえで
保留にする。

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

### リリースビルド分離（`without-health-connect`/`with-health-connect`）はネイティブモジュールを除去しない

§9.11/§25.1 の実装（`app.config.js`・`lib/healthConnectBuild.ts`・
`eas.json`）は、`EXPO_PUBLIC_HEALTH_CONNECT_ENABLED` で **Manifest の
permission（`android.permission.health.WRITE_SEXUAL_ACTIVITY`）と
`withHealthConnectPermissionsRationale` plugin だけ** を切り替えている。
`react-native-health-connect` ネイティブモジュール自体は両ビルドとも
リンクされたまま——これは手抜きではなく意図的な設計判断。

- Health apps declaration の提出トリガーは「配布 AAB の Manifest に
  health permission が含まれているか」であって、ネイティブモジュールの
  リンク有無ではない（§9.11 本文）。permission を切れば要件は満たされる。
- 「実行時に HC を参照しない」も、新規のガードコードなしで成立している：
  `services/SyncWorker.ts` の `drainDueJobs` は
  `services/ActivityService.ts` の `getActiveProviders` に
  `'health_connect'` が含まれない限り `HealthConnectService.*` を一切
  呼ばずに早期 return する。この設定は `app/settings/health-connect.tsx`
  の ON トグル以外から true にならず、そのトグル自体は
  `app/settings/index.tsx` が `isHealthConnectBuildEnabled()` で
  ビルドごと非表示にしている——ユーザーが一度も有効化できない以上、
  実行時参照は起こり得ない。
- ネイティブモジュールの物理除外（autolinking の `exclude`）は、
  Gradle デーモンのキャッシュ問題（本ファイル「package.json にあるのに
  未リンクなネイティブモジュール」の節）を踏むリスクの割に実益が無い
  ため、あえてやっていない。**「ネイティブモジュールも除外すべきでは」
  という直感で `exclude` 設定を足すような変更はしないこと**——上記の
  理由で不要かつリスクだけが増える。

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
