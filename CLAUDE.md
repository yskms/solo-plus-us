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

### Android のダーク/ライト切替まわりの落とし穴

画面遷移中に一瞬見える帯や、テーマ切替の反映漏れは `contentStyle`（React Navigation
の各画面コンテナ）や `useColorScheme()` のオーバーライドだけでは直らないことがある。
原因はそれより下のネイティブ層（`android:windowBackground`、`AppCompatDelegate` の
Day/Night モード、ステータスバー）にあることが多く、`values-night/colors.xml` や
`Appearance.setColorScheme()`、`expo-system-ui` での対応が必要になる。色の定数は
`constants/theme.ts`・`plugins/withAndroidNightColors.js`・`app.json` の3箇所に
手動同期が必要（自動参照する手段が無い）。詳細と発見の経緯は README「Phase 3
実装状況 > Appearance」参照。
