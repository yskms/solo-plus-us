/**
 * Manifest に `<uses-feature android:name="android.hardware.screen.portrait"
 * android:required="false" />` を足す。
 *
 * 理由（2026-11-20、v1.0.6 を Play Console のリリース画面に出したときに、
 * 「必須のハードウェア機能の申告により、アプリの配信が制限されています」
 * と出て、審査に送信できなかった）: `app.json` の `"orientation": "portrait"` で、
 * Activity に `android:screenOrientation="portrait"` が付く。Android は
 * 「Activity が向きを指定したら、その向きを必須とみなす」ので、aapt が
 * `android.hardware.screen.portrait` を必須の機能として補う（AAB の
 * `aapt2 dump badging` に `uses-implied-feature ... reason='one or more
 * activities have specified a portrait orientation'` と出る）。Play は、縦向きを
 * 持たない端末（デスクトップ、Android XR など）を配信対象から外す。
 *
 * 公式（uses-feature の説明）の対処は、`screenOrientation` で向きを指定していて
 * も、その向きを本当には必須としないなら、同じ機能を `android:required="false"`
 * で明示して、補われた必須を無効にすること。**このアプリは縦向き固定のまま**
 * （`screenOrientation` は変えない）で、スマートフォンでの見え方は変わらない。
 * 変わるのは、Play が縦向きを持たない端末を除外しなくなる点だけで、そうした端末
 * でもアプリは縦向きの画面で開く。
 *
 * 外さない・変えない:
 * - **`required` を `true` にしない・この plugin を外さない。** 外すと、次の
 *   リリースで、Play Console が同じ理由で審査への送信を止める
 * - **向きの固定（`app.json` の `orientation`）を外して解決しようとしない。**
 *   画面は縦向き前提で作ってある。向きの固定を外すと、横向きで画面が崩れる
 *
 * 冪等: `android/` を消さずに `expo prebuild --no-clean` を繰り返しても、同じ
 * 機能の宣言が重複して積まれないよう、追加前に既存の宣言を探す。
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const FEATURE_NAME = 'android.hardware.screen.portrait';

const applyPortraitNotRequired = (manifest) => {
  manifest['uses-feature'] = manifest['uses-feature'] ?? [];
  const existing = manifest['uses-feature'].find((entry) => entry.$?.['android:name'] === FEATURE_NAME);
  if (existing) {
    existing.$ = { ...existing.$, 'android:required': 'false' };
  } else {
    manifest['uses-feature'].push({ $: { 'android:name': FEATURE_NAME, 'android:required': 'false' } });
  }
  return manifest;
};

const withAndroidPortraitNotRequired = (config) => {
  return withAndroidManifest(config, (config) => {
    applyPortraitNotRequired(config.modResults.manifest);
    return config;
  });
};

module.exports = withAndroidPortraitNotRequired;
module.exports.FEATURE_NAME = FEATURE_NAME;
module.exports.applyPortraitNotRequired = applyPortraitNotRequired;
