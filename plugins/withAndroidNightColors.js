/**
 * Appearance トグル（README「Phase 3 実装状況 > Appearance」参照）実装時に発見。
 *
 * `android/app/src/main/res/values-night/colors.xml` は Expo の既定生成では
 * 空（`<resources/>`）のままで、`styles.xml` の `AppTheme` が
 * `android:windowBackground` に参照する `@color/activityBackground` は
 * `values/colors.xml`（ライト、`#F8F7FA`）にしか定義が無い。そのため
 * `AppCompatDelegate` が Night モードでも、ウィンドウ自体の背景色はライトの
 * まま——画面遷移中（プッシュ/スワイプバック）に `contentStyle` の色が
 * 届かない、両画面の外側のネイティブ背景として一瞬見えていた「白い帯」の
 * 真因はここ。`contentStyle`（JS 側、各画面のコンテナ）ではなく、この
 * ネイティブ側のウィンドウ背景を直接埋める必要がある。
 *
 * `contexts/Appearance.tsx` が `Appearance.setColorScheme()` で
 * `AppCompatDelegate.setDefaultNightMode()` を呼ぶことと対になっている：
 * Night モード自体に切り替える経路はそちらが担い、この plugin は Night
 * モードのときに実際どんな色が出るかを埋める。
 *
 * `constants/theme.ts` の `darkColors.background`（`#121615`）と値を
 * 手動で同期させる必要がある——ビルド時に自動参照する手段が無いため、
 * 値を変えたら両方を直すこと。
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

// constants/theme.ts の darkColors.background と同期させること
const DARK_ACTIVITY_BACKGROUND = '#121615';

const COLORS_NIGHT_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- constants/theme.ts の darkColors.background と同期させること（plugins/withAndroidNightColors.js 参照） -->
<resources>
  <color name="activityBackground">${DARK_ACTIVITY_BACKGROUND}</color>
</resources>
`;

const withAndroidNightColors = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const valuesNightDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/values-night');
      fs.mkdirSync(valuesNightDir, { recursive: true });
      fs.writeFileSync(path.join(valuesNightDir, 'colors.xml'), COLORS_NIGHT_XML, 'utf-8');
      return config;
    },
  ]);
};

module.exports = withAndroidNightColors;
