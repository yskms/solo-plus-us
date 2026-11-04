# 多言語対応（i18n）の理由と経緯

- 読むタイミング: `t()`・翻訳キー・複数形（`_one`/`_other`）を触るとき、`lib/` に表示文字列を返す関数を足すとき、`lib/i18n/index.ts` や `scripts/checkI18nKeys.js` を変えるとき
- 元の場所: `CLAUDE.md` の「多言語対応（i18n）」の節（見出しは、後ろに「`lib/` は `t` を引数で受け取る、`t()` のキーに厳密な型は付けていない」と続く。2026-11-03 に移動）。区切り線より下は原文のまま。ただし、見出しの `#` の数だけ `##` にそろえた（見出しの文言は変えていない）
- 注記（参照元）: `scripts/checkI18nKeys.js` と `types/i18next.d.ts` は、「多言語対応（i18n）」の節を「CLAUDE.md の i18n の節」として参照している。「`ja.json` は `_other` 付きでも接尾辞なしでも有効」という記述は、`CLAUDE.md` のスタブにも残している

---

## 多言語対応（i18n）——`lib/` は `t` を引数で受け取る、`t()` のキーに厳密な型は付けていない

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
