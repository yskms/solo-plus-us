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
