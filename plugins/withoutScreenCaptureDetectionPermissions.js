/**
 * 設計判断記録 D-47 追記 — expo-screen-capture（画面マスク、lib/screenMask.ts）
 * が autolinking で持ち込む、この app が一切使わない機能のための Android
 * パーミッションを取り除く。
 *
 * node_modules/expo-screen-capture/android/.../AndroidManifest.xml は
 * READ_EXTERNAL_STORAGE（maxSdk 32）・READ_MEDIA_IMAGES（sdk 33）・
 * DETECT_SCREEN_CAPTURE（sdk 34+）を宣言している。これらはすべて
 * addScreenshotListener/getPermissionsAsync/requestPermissionsAsync
 * （スクリーンショット「検知」機能）専用で、この app が呼んでいるのは
 * preventScreenCaptureAsync/enableAppSwitcherProtectionAsync（「防止」の方）
 * だけである。使わない機能のために「写真の読み取り」パーミッションが
 * 増えるのは、§8 の「記録内容を外に出さない」姿勢や
 * plugins/withAndroidNoBackup.js の方針と整合しない——Play Console の
 * データセーフティ申告やストア表示上のパーミッション一覧にも出る。
 *
 * **READ_EXTERNAL_STORAGE はここでは除去しない。** expo-screen-capture
 * だけでなく expo-file-system（android/src/main/AndroidManifest.xml）も
 * 同じ `android.permission.READ_EXTERNAL_STORAGE`（maxSdk 32）を宣言して
 * おり、`Export/Import` の Android セーフティ Export
 * （services/SafetyExportService.ts、StorageAccessFramework 経由）が
 * API ≤ 32 端末で依存している可能性がある。`uses-permission` の
 * マージキーは `android:name` のみで属性は見ないため、ここで
 * `tools:node="remove"` を足すと expo-file-system 側の宣言も道連れで
 * 消える（もしくは既存の `tools:replace` エントリと衝突してマニフェスト
 * マージ自体が失敗する）——2回目のレビューで、実際に `expo prebuild`
 * した生成マニフェストにこの衝突が出力されていることが確認された。
 * `android:maxSdkVersion="32"` 付きなので Android 13+ ではそもそも要求
 * されず、ストア表示上の実害も小さい。READ_MEDIA_IMAGES・
 * DETECT_SCREEN_CAPTURE は expo-screen-capture のみが宣言しており、
 * この衝突は無い（生成マニフェストで確認済み）。
 *
 * `tools:node="remove"` は、この app 自身の Manifest 側で同じパーミッション
 * を宣言し直すことで、Android のマニフェストマージ時にライブラリ側の宣言を
 * 打ち消す標準的な方法（plugins/withAndroidNoBackup.js とは別の仕組みだが、
 * 同じ「サードパーティのデフォルトを Config Plugin で上書きする」という
 * 考え方）。
 *
 * **これは manifest の宣言だけを取り除く。** ネイティブ側
 * （ScreenCaptureModule.kt の OnCreate）は API 34 未満で
 * ScreenshotEventEmitter を無条件に生成し、MediaStore.Images への
 * ContentObserver を常時登録する——これは Kotlin の実装であり、Config
 * Plugin からは変更できない。その onChange ハンドラは呼ばれるたびに
 * hasPermissions() を確認し、権限が無ければ Log.e を出すだけで例外は
 * 投げない（ScreenShotEventEmitter.kt）。実際にスクリーンショットが撮られる
 * 経路は preventScreenCaptureAsync（FLAG_SECURE）で塞いでいるため、この
 * observer が実際に発火することは通常無い想定——万一発火してもクラッシュ
 * しない、無害なログ出力のみの既知の制限として受け入れる（サードパーティ
 * モジュールへのパッチは行わない）。
 *
 * 冪等：`android/` を消さずに（`--clean` なしで） `expo prebuild` を
 * 再実行しても、同じ `android:name` の remove エントリが重複して積まれ
 * ないよう、追加前に既存エントリの有無を確認する。
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const PERMISSIONS_TO_REMOVE = ['android.permission.READ_MEDIA_IMAGES', 'android.permission.DETECT_SCREEN_CAPTURE'];

function hasRemoveEntry(usesPermission, name) {
  return usesPermission.some((entry) => entry.$?.['android:name'] === name && entry.$?.['tools:node'] === 'remove');
}

const withoutScreenCaptureDetectionPermissions = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    for (const name of PERMISSIONS_TO_REMOVE) {
      if (hasRemoveEntry(manifest['uses-permission'], name)) continue;
      manifest['uses-permission'].push({
        $: { 'android:name': name, 'tools:node': 'remove' },
      });
    }
    return config;
  });
};

module.exports = withoutScreenCaptureDetectionPermissions;
