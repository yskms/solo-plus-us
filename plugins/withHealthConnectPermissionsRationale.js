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
 * ならない」（公式ドキュメント）。ホスト済みのプライバシーポリシーページは
 * まだ存在しない（ストア申請は §18 の Phase 4 最終ステップ）ため、暫定的に
 * アプリ内蔵の静的な説明画面（WebView で外部URLを読み込まない）として
 * 実装している。**実際のプライバシーポリシーを公開する際は、この画面の
 * 文言をそのポリシーと一致させること。**
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
 * このファイルがマニフェストと Kotlin ソースの両方を変更する
 * （`withHealthConnectPermissionsRationaleManifest` / `...Source`）。
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const ACTIVITY_NAME = '.PermissionsRationaleActivity';
const ALIAS_NAME = 'ViewPermissionUsageActivity';

const RATIONALE_ACTIVITY_KOTLIN = `package com.yskms.soloplusus

import android.app.Activity
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.ScrollView
import android.widget.TextView

/**
 * Health Connect の permission rationale 画面（Android 13-: intent-filter
 * 直接起動 / Android 14+: activity-alias ViewPermissionUsageActivity 経由）。
 * 外部 URL を読み込む WebView ではなく、アプリ内蔵の静的テキストで表示する
 * 理由は plugins/withHealthConnectPermissionsRationale.js のコメントを参照。
 */
class PermissionsRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // AppTheme (Theme.AppCompat.DayNight.NoActionBar) makes the window
    // background follow Day/Night automatically, but a hardcoded text color
    // does not — resolve it from the current theme instead of hardcoding
    // black (would be unreadable against the dark windowBackground in Night
    // mode; see CLAUDE.md's Android Day/Night pitfalls note).
    val textColor = TypedValue().let {
      theme.resolveAttribute(android.R.attr.textColorPrimary, it, true)
      it.data
    }

    val text = TextView(this).apply {
      text = "Solo + Us can optionally save the date, time, and whether " +
        "protection was used for each record to Health Connect, so other " +
        "health apps you choose can read it there.\\n\\n" +
        "Solo + Us never reads anything back from Health Connect, and no " +
        "other detail (context, outcome, mood, or notes) ever leaves this " +
        "app.\\n\\n" +
        "You can turn this off at any time in Solo + Us > Settings > Health Connect."
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

const withHealthConnectPermissionsRationale = (config) => {
  config = withHealthConnectPermissionsRationaleManifest(config);
  config = withHealthConnectPermissionsRationaleSource(config);
  return config;
};

module.exports = withHealthConnectPermissionsRationale;
