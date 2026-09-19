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
再発させる。この事後編集機能は D-50（設計判断記録）の追加後、4回のレビューで
タイムゾーン絡みの不具合が3回続けて見つかっており、変更する際は必ず
`resolveOccurredAtEdit`／`nowAsZonedDigits` の doc comment を先に読むこと。

### Android のダーク/ライト切替まわりの落とし穴

画面遷移中に一瞬見える帯や、テーマ切替の反映漏れは `contentStyle`（React Navigation
の各画面コンテナ）や `useColorScheme()` のオーバーライドだけでは直らないことがある。
原因はそれより下のネイティブ層（`android:windowBackground`、`AppCompatDelegate` の
Day/Night モード、ステータスバー）にあることが多く、`values-night/colors.xml` や
`Appearance.setColorScheme()`、`expo-system-ui` での対応が必要になる。色の定数は
`constants/theme.ts`・`plugins/withAndroidNightColors.js`・`app.json` の3箇所に
手動同期が必要（自動参照する手段が無い）。詳細と発見の経緯は README「Phase 3
実装状況 > Appearance」参照。
