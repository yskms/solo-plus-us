/**
 * 基本設計 §9.11・要件定義書 §25.1 — リリースビルドの分離
 * （`without-health-connect` / `with-health-connect`）。
 *
 * `app.json` は意図的に「HC 権限を含まない」状態を静的ベースにしている
 * （store 審査の許諾トリガーは Manifest 上の permission の有無であって、
 * ネイティブモジュールのリンク有無ではないため——詳細は CLAUDE.md 参照）。
 * ここでは `EXPO_PUBLIC_HEALTH_CONNECT_ENABLED === '1'` のときだけ、
 * HC 権限と rationale plugin を足し戻す。
 *
 * **既定値は「無効」（opt-in）**——レビュー指摘（2026-09-21）：未設定を
 * 「有効」扱いにすると、env を指定し忘れた/新しく足した EAS build
 * プロファイルが黙って HC permission 入りに倒れる（失敗モードが安全側で
 * ない）。`eas.json` の `development`/`preview` プロファイルは、ローカル
 * 開発の従来挙動を保つため明示的に `"1"` を指定している。ローカルで
 * `expo run:android`/`expo start`（`eas.json` を経由しない）から HC 込みで
 * 試したい場合は `.env.local`（`.env.local.example` 参照）を使うこと——
 * dev-client 経由のライブリロードでは shell export だけでは反映されない
 * （CLAUDE.md 参照）。
 *
 * `EXPO_PUBLIC_` 接頭辞の env var は `app.config.js`（prebuild 時の
 * Node プロセス）と JS バンドル（`lib/healthConnectBuild.ts` 経由、
 * babel-preset-expo によるインライン展開）の両方から同じ名前で読めるが、
 * **判定式そのものは2箇所に別々に書かれている**（JS 側は babel の定数畳み込みが
 * 効くよう、この関数を import する形にできない）。**この判定を変えるときは
 * 両方同時に直すこと**——`lib/healthConnectBuild.ts` の同じ注記も参照。
 */
module.exports = ({ config }) => {
  const healthConnectEnabled = process.env.EXPO_PUBLIC_HEALTH_CONNECT_ENABLED === '1';
  if (!healthConnectEnabled) {
    return config;
  }

  return {
    ...config,
    android: {
      ...config.android,
      // 既存の permissions を上書きしない（将来 app.json に他の permission が
      // 増えたとき、with-health-connect ビルドだけそれが消える事故を防ぐ）。
      permissions: [...(config.android?.permissions ?? []), 'android.permission.health.WRITE_SEXUAL_ACTIVITY'],
    },
    // 挿入位置は機能上意味が無い（config plugin は他プラグインの並びに依存しない
    // 独立した Manifest mod）ため、単純に末尾へ追加する——特定の要素を探して
    // その直後に挿む方式は、探索対象がリネーム/オブジェクト形式化されたときに
    // サイレントに変な位置へ挿入されうる（レビュー指摘）。
    plugins: [...(config.plugins ?? []), './plugins/withHealthConnectPermissionsRationale.js'],
  };
};
