/**
 * 基本設計 §9.11・要件定義書 §25.1 — リリースビルドの分離
 * （`without-health-connect` / `with-health-connect`）。
 *
 * `app.json` は意図的に「HC 権限を含まない」状態を静的ベースにしている
 * （store 審査の許諾トリガーは Manifest 上の permission の有無であって、
 * ネイティブモジュールのリンク有無ではないため——詳細は CLAUDE.md 参照）。
 * ここでは `EXPO_PUBLIC_HEALTH_CONNECT_ENABLED` が `'0'` でない限り
 * （未設定を含む）、HC 権限と rationale plugin を足し戻す。
 *
 * 既定値を「有効」にしているのは、ローカル開発（`eas.json` を経由しない
 * `expo run:android` 等）の挙動を変えないため。リリース時は `eas.json` の
 * 各 build profile が明示的にこの env var を指定する。
 *
 * `EXPO_PUBLIC_` 接頭辞の env var は `app.config.js`（prebuild 時の
 * Node プロセス）と JS バンドル（`lib/healthConnectBuild.ts` 経由、
 * babel-preset-expo によるインライン展開）の両方から同じ名前で読めるため、
 * 2箇所の判定がずれない。
 */
module.exports = ({ config }) => {
  const healthConnectEnabled = process.env.EXPO_PUBLIC_HEALTH_CONNECT_ENABLED !== '0';
  if (!healthConnectEnabled) {
    return config;
  }

  const plugins = [...(config.plugins ?? [])];
  const datetimePickerIndex = plugins.indexOf('@react-native-community/datetimepicker');
  plugins.splice(datetimePickerIndex + 1, 0, './plugins/withHealthConnectPermissionsRationale.js');

  return {
    ...config,
    android: {
      ...config.android,
      permissions: ['android.permission.health.WRITE_SEXUAL_ACTIVITY'],
    },
    plugins,
  };
};
