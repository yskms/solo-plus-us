/**
 * 基本設計 v0.11 §9.4/§9.11・設計判断記録 D-04/D-19/D-41 — Health Connect は
 * マニフェストに「permissions rationale」を表示する Activity を要求する
 * （Health Connect の permission 画面の「プライバシーポリシー」リンクから
 * 起動される）。Android 13 以前は `androidx.health.ACTION_SHOW_PERMISSIONS_
 * RATIONALE` を処理する専用 Activity、Android 14 以降は
 * `android.intent.action.VIEW_PERMISSION_USAGE` を処理する activity-alias
 * が必要で、**両方とも同じ Activity を指す**（Android 公式ドキュメント
 * https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started
 * より。`react-native-health-connect` の README サンプルは alias の
 * `targetActivity` を `.MainActivity` としているが、公式ドキュメントは
 * `.PermissionsRationaleActivity` を指しており、本実装は公式に合わせた
 * ——MainActivity に同じ intent-filter を重複させると解決が曖昧になるため）。
 *
 * 表示内容は「Play Console に登録するプライバシーポリシーと同一でなければ
 * ならない」（公式ドキュメント）。`public/privacy-policy.html`（GitHub Pages
 * で公開済み）の該当セクションと用語を揃えてある——詳細は下の doc comment
 * 参照。WebView で外部 URL を読み込む形ではなく、引き続きアプリ内蔵の
 * 静的な説明画面として実装している。
 *
 * `app.json` の plugins には `"react-native-health-connect"`（ライブラリ
 * 同梱の config plugin）を意図的に含めていない。同梱 plugin は
 * `.MainActivity` 自身にも同じ `ACTION_SHOW_PERMISSIONS_RATIONALE`
 * intent-filter を追加してしまい、Android 13 以前でこの Activity と
 * MainActivity の両方が同じ暗黙 intent を処理できる状態（解決が曖昧になる、
 * 上記で避けたい状態そのもの）になることを生成済みマニフェストで確認した。
 * permission delegate の自動登録（`HealthConnectPermissionDelegate`）は
 * Expo Modules の autolinking（`expo-module.config.json`、`app.json` の
 * plugins 配列とは別の仕組み）によるものなので、この plugin を外しても
 * 影響しない——マニフェストへの追記はこのファイルだけで完結させる。
 *
 * このファイルがマニフェスト・Kotlin ソース・文言（string リソース、日英）の
 * 3つを変更する（`withHealthConnectPermissionsRationaleManifest` / `...Source` /
 * `...Strings`）。文言を Kotlin に直書きせず Android の string リソース
 * （`values/strings.xml` / `values-ja/strings.xml`）に分けているのは、この
 * 画面が本アプリの React/JS ランタイムの外（Health Connect アプリからの外部
 * 起動）で表示されるため、`preferences.language`（アプリ内の言語設定、
 * `contexts/Language.tsx`）を参照できないから——**端末の OS 言語設定に
 * そのまま追従する**（Android の通常のリソース解決任せ）。これはアプリ内
 * 言語設定と異なる軸になるが、他の一切のアプリの権限ダイアログ・システム
 * 画面と同じく妥当な制約として受け入れている（設計判断記録 D-53 参照）。
 *
 * 文言は「Play Console に登録するプライバシーポリシーと同一でなければ
 * ならない」（Health Connect 公式ドキュメント）——日本語版は
 * `public/privacy-policy.html` の `#doc-ja` セクション「4. Health Connect
 * との連携」と同じ用語（「日時」「Protection（避妊具等の使用有無）」等）で
 * 揃えてある。**このプライバシーポリシーの該当セクションを書き換える際は、
 * この文言も一致するよう合わせて更新すること。**
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, withStringsXml, AndroidConfig } = require('@expo/config-plugins');

const ACTIVITY_NAME = '.PermissionsRationaleActivity';
const ALIAS_NAME = 'ViewPermissionUsageActivity';
const STRING_NAME = 'health_connect_rationale';

// public/privacy-policy.html の #doc-en 「4. Health Connect Integration」と
// 用語を揃えること。`\\n\\n` はリテラルな2文字（バックスラッシュ+n）——
// Android の string リソースは Kotlin/Java と同じ規則でこれを改行として
// 解釈するが、実際の改行バイトをそのまま埋め込むと aapt が空白1個に
// 正規化してしまう（段落間の空行が消える）ため、意図的にエスケープ表記の
// ままにしている。
const RATIONALE_TEXT_EN =
  'Solo + Us can optionally save the date, time, and whether protection was used for each record to Health Connect, ' +
  'so other health apps you choose can read it there.\\n\\n' +
  'Solo + Us never reads anything back from Health Connect, and no other detail (context, outcome, mood, or notes) ' +
  'ever leaves this app.\\n\\n' +
  'You can turn this off at any time in Solo + Us > Settings > Health Connect.';

// public/privacy-policy.html の #doc-ja「4. Health Connect との連携」と
// 用語を揃えること（「日時」「Protection（避妊具等の使用有無）」等）。
// `\\n\\n` については上の RATIONALE_TEXT_EN の注記を参照。
const RATIONALE_TEXT_JA =
  'Solo + Us は、記録ごとに「日時」と「Protection（避妊具等の使用有無）」を、あなたが有効にした場合に限り Health Connect に保存できます。' +
  'これにより、あなたが選んだ他のヘルスケアアプリからもこの情報を読み取れるようになります。\\n\\n' +
  'Solo + Us が Health Connect から情報を読み込むことはなく、それ以外の詳細（Solo / Partnered の区別、Orgasm / Ejaculation、気分、メモなど）がこのアプリの外に出ることもありません。\\n\\n' +
  'この連携は、Solo + Us の 設定 > Health Connect からいつでもオフにできます。';

const RATIONALE_ACTIVITY_KOTLIN = `package com.yskms.soloplusus

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.ScrollView
import android.widget.TextView

/**
 * Health Connect の permission rationale 画面（Android 13-: intent-filter
 * 直接起動 / Android 14+: activity-alias ViewPermissionUsageActivity 経由）。
 * 外部 URL を読み込む WebView ではなく、アプリ内蔵の静的テキストで表示する
 * 理由は plugins/withHealthConnectPermissionsRationale.js のコメントを参照。
 * 文言は R.string.${STRING_NAME}（values/・values-ja/ の strings.xml）——
 * 端末の OS 言語設定にそのまま追従する（同ファイルの doc comment 参照）。
 */
class PermissionsRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // AppTheme (Theme.AppCompat.DayNight.NoActionBar) makes the window
    // background follow Day/Night automatically, but a hardcoded text color
    // does not — resolve it from the current theme instead of hardcoding
    // black (would be unreadable against the dark windowBackground in Night
    // mode; see CLAUDE.md's Android Day/Night pitfalls note).
    //
    // NOT theme.resolveAttribute(attr, typedValue, true) + typedValue.data
    // — on this theme, ?android:attr/textColorPrimary resolves to a
    // ColorStateList, not a flat color, so resolveAttribute() returns
    // TYPE_REFERENCE and .data holds the raw resource id, not an ARGB
    // int. Reinterpreting that id as a color produces a near-transparent
    // value (its top byte lands as the alpha channel) — the text was
    // being drawn, just fully invisible against the window background
    // (confirmed on-device: sampled pixels in the text's bounds matched
    // the background color exactly, no blending at all). obtainStyledAttributes()
    // resolves the same attribute through a TypedArray, which correctly
    // follows a ColorStateList reference down to its default color.
    val textColorAttrs = obtainStyledAttributes(intArrayOf(android.R.attr.textColorPrimary))
    val textColor = textColorAttrs.getColor(0, android.graphics.Color.WHITE)
    textColorAttrs.recycle()

    val text = TextView(this).apply {
      text = getString(R.string.${STRING_NAME})
      textSize = 16f
      setTextColor(textColor)
      setPadding(48, 48, 48, 48)
      gravity = Gravity.START
    }

    setContentView(ScrollView(this).apply { addView(text) })
  }
}
`;

const withHealthConnectPermissionsRationaleManifest = (config) => {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;

    application.activity = application.activity ?? [];
    const hasRationaleActivity = application.activity.some((a) => a.$?.['android:name'] === ACTIVITY_NAME);
    if (!hasRationaleActivity) {
      application.activity.push({
        $: {
          'android:name': ACTIVITY_NAME,
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE' } }],
          },
        ],
      });
    }

    application['activity-alias'] = application['activity-alias'] ?? [];
    const hasAlias = application['activity-alias'].some((a) => a.$?.['android:name'] === ALIAS_NAME);
    if (!hasAlias) {
      application['activity-alias'].push({
        $: {
          'android:name': ALIAS_NAME,
          'android:exported': 'true',
          'android:targetActivity': ACTIVITY_NAME,
          'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
            category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }],
          },
        ],
      });
    }

    return config;
  });
};

const withHealthConnectPermissionsRationaleSource = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packagePath = config.android?.package?.replace(/\./g, '/');
      const javaDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java', packagePath);
      fs.mkdirSync(javaDir, { intermediates: true, recursive: true });
      fs.writeFileSync(path.join(javaDir, 'PermissionsRationaleActivity.kt'), RATIONALE_ACTIVITY_KOTLIN, 'utf-8');
      return config;
    },
  ]);
};

// Default (English) locale — merged into the existing generated
// values/strings.xml (app_name etc.) via the proper AndroidConfig mod,
// rather than a raw file write, so it doesn't clobber Expo's own entries.
const withHealthConnectPermissionsRationaleStringsEn = (config) => {
  return withStringsXml(config, (config) => {
    config.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: STRING_NAME }, _: RATIONALE_TEXT_EN }],
      config.modResults,
    );
    return config;
  });
};

// values-ja/strings.xml has no Expo-generated content to merge with
// (Expo only writes the default values/strings.xml), so this is a plain
// file write, same pattern as plugins/withAndroidNightColors.js's
// values-night/colors.xml — and the same constraint that implies: unlike
// `...StringsEn` above (which merges via `withStringsXml`/`setStringItem`
// and so can coexist with other plugins writing more entries into the
// same file), a second plugin writing its own `values-ja/strings.xml`
// would silently clobber this one instead of merging. If a future ja
// string needs adding outside this file, add it to the XML template
// below rather than introducing a second `values-ja/strings.xml` writer.
const withHealthConnectPermissionsRationaleStringsJa = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const valuesJaDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/values-ja');
      fs.mkdirSync(valuesJaDir, { recursive: true });
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- plugins/withHealthConnectPermissionsRationale.js が生成。public/privacy-policy.html の #doc-ja と用語を揃えること。 -->
<resources>
  <string name="${STRING_NAME}">${escapeXml(RATIONALE_TEXT_JA)}</string>
</resources>
`;
      fs.writeFileSync(path.join(valuesJaDir, 'strings.xml'), xml, 'utf-8');
      return config;
    },
  ]);
};

// NOT `&apos;`/`&quot;` for the apostrophe/quote cases (found in review) —
// aapt2 parses the *resolved* string resource text, after XML entities
// have already been turned back into literal characters, so an `&apos;`
// in the source XML still leaves aapt2 looking at an unescaped `'` and
// fails the build ("Apostrophe not preceded by \\"). Android string
// resources need the backslash-escape (`\'`/`\"`) at that layer, on top
// of (not instead of) the XML-level `&`/`<`/`>` escaping — the two are
// different escaping systems that happen to both apply here.
//
// Deliberately does NOT also escape a literal `\` (found in review, round
// 2): RATIONALE_TEXT_EN/JA's own `\n` paragraph breaks are already the
// correct 2-character Android escape sequence (backslash + "n" — see
// their doc comments), and a blanket `\` → `\\` pass here would double
// that backslash into `\\n`, which Android reads as a literal backslash
// followed by "n", not a newline — exactly the regression this comment
// replaces (caught in review: the on-device text had literally printed
// "\n" between paragraphs, not visible in the earlier check because that
// build predated this file's edit — `expo prebuild` hadn't re-run yet).
// This function's inputs are hand-authored constants in this same file,
// not arbitrary/external text, so the only backslashes they will ever
// contain are those intentional `\n` sequences — there is currently no
// case where a literal standalone `\` needs protecting. If a future edit
// to RATIONALE_TEXT_EN/JA ever needs one, escape it by hand at the
// source (`\\`) rather than reintroducing a blanket replace here.
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

const withHealthConnectPermissionsRationale = (config) => {
  config = withHealthConnectPermissionsRationaleManifest(config);
  config = withHealthConnectPermissionsRationaleSource(config);
  config = withHealthConnectPermissionsRationaleStringsEn(config);
  config = withHealthConnectPermissionsRationaleStringsJa(config);
  return config;
};

module.exports = withHealthConnectPermissionsRationale;
