# Solo + Us

> Your intimate life, over time.

Solo / Partnered な性的活動を長期間記録し、自分自身の変化を振り返るための Private Wellness アプリ。

評価しない・急かさない・端末内に留める。NoFap アプリでも Sex Diary でもなく、
**Personal Health Data の一種として淡々と記録し続けられること**を中心価値とする。

## ステータス

設計フェーズ（実装未着手）。現在は `docs/` の設計文書のみ。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [要件定義書 v0.1](docs/Solo%20+%20Us_要件定義書%20v0.1.md) | プロダクト思想・記録項目・Privacy 方針・MVP 範囲 |
| [基本設計 v0.1](docs/Solo%20+%20Us_基本設計%20v0.1.md) | 技術構成・データモデル・SQLite スキーマ・同期設計 |
| [UI/UX Specification v0.1](docs/Solo%20+%20Us_UI-UX%20Specification%20v0.1.md) | ブランド・カラートークン・画面仕様・文言ルール |

`docs/old/` は検討履歴であり仕様ではない。

## 想定スタック

React Native + Expo Router / SQLite（暗号化）/ Android: Health Connect

## 設計原則

1. Activity の保存は常にローカル DB を最優先する
2. 外部 API 障害で Activity を失わない
3. Solo / Partnered の区別を外部 Health 仕様に依存させない
4. 過去データとの互換性を最優先する
5. Activity 記録の操作数を増やさない
