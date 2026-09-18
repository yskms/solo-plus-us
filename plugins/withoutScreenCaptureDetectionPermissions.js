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
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const PERMISSIONS_TO_REMOVE = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.DETECT_SCREEN_CAPTURE',
];

const withoutScreenCaptureDetectionPermissions = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    for (const name of PERMISSIONS_TO_REMOVE) {
      manifest['uses-permission'].push({
        $: { 'android:name': name, 'tools:node': 'remove' },
      });
    }
    return config;
  });
};

module.exports = withoutScreenCaptureDetectionPermissions;
