# Solo + Us

> Your intimate life, over time.

Solo / Partnered な性的活動を長期間記録し、自分自身の変化を振り返るための Private Wellness アプリ。

評価しない・急かさない・端末内に留める。NoFap アプリでも Sex Diary でもなく、
**Personal Health Data の一種として淡々と記録し続けられること**を中心価値とする。

## ステータス

設計フェーズ（実装未着手）。設計文書は **v0.5** で実装着手前の確定版になっている。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [設計判断記録 v0.5](docs/Solo%20+%20Us_設計判断記録%20v0.5.md) | **確定した設計判断（決定・理由・却下した案）。矛盾時はこれを優先する** |
| [要件定義書 v0.5](docs/Solo%20+%20Us_要件定義書%20v0.5.md) | プロダクト思想・記録項目・セキュリティ要件・MVP 範囲 |
| [基本設計 v0.5](docs/Solo%20+%20Us_基本設計%20v0.5.md) | 技術構成・データモデル・スキーマ・暗号化・同期設計・Import/Export |
| [UI/UX Specification v0.5](docs/Solo%20+%20Us_UI-UX%20Specification%20v0.5.md) | ブランド・カラートークン・画面仕様・文言ルール・A11y 受け入れ基準 |

**文書の優先順位：設計判断記録 > 各設計文書の本文 > 図版。**
`docs/old/` は検討履歴であり仕様ではない。

## 想定スタック

React Native + Expo Router（prebuild / dev client）  
`@op-engineering/op-sqlite`（SQLCipher で暗号化）  
Android: Health Connect

## 設計原則

1. Activity の保存は常にローカル DB を最優先する
2. 外部 API 障害で Activity を失わない
3. Solo / Partnered の区別を外部 Health 仕様に依存させない
4. 過去データとの互換性を最優先する
5. Activity 記録の操作数を増やさない
6. 不正状態は制約で塞ぐより、構造上表現できないようにする
7. 復元手段を機能ではなく安全性の一部として扱う
8. 利用者の属性を推測しない。必要な項目は本人が選ぶ

## 実装着手の前提条件

DB を触るコードを書く前に確定が必要なもの（すべて DB ファイル形式かドライバ選定を決めるため）。

- [x] Activity の分類軸 — `context`（`solo` / `partnered`）
- [x] 日時列の構成と精度 — UTC 正本 + ローカル非正規化列、分単位
- [x] 同期テーブルの分割 — `health_sync` / `health_sync_jobs`
- [x] 暗号化とドライバ選定 — SQLCipher / op-sqlite
- [x] schema version と Migration 方針
- [x] Outcome の分離（orgasm / ejaculation / protection）と統計非昇格
- [x] 同期ワーカーの楽観的並行制御（revision / claim）
- [x] 同期確定処理の3分岐と `recreate` 操作
- [x] アプリ設定の保存先（暗号化 DB 内の `app_settings`）
- [ ] Health Connect ラッパーが `clientRecordId` と `clientRecordVersion` を露出しているか
- [ ] 削除時の「存在しない」を他のエラーと識別できるか

未確定の2件は Health Connect ラッパーの調査項目で、**満たせない場合は HC 同期の v1.0 投入を見送る**。
DB 設計には影響しないため Phase 1 は着手できる。
