/**
 * 基本設計 §9.11・要件定義書 §25.1 — このビルドが Health Connect 権限を
 * Manifest に含む（`with-health-connect`）かどうか。既定値は「無効」
 * （opt-in、`=== '1'` のときだけ有効）——`app.config.js` の doc comment
 * 参照（レビュー指摘、2026-09-21：未設定を有効扱いにすると env 指定漏れが
 * 安全側に倒れない）。**この判定式を変えるときは `app.config.js` の同じ式も
 * 同時に直すこと**——JS 側は babel の定数畳み込みが効くようこの関数を
 * `require` する形にしているが、`app.config.js`（素の Node プロセス）とは
 * 別ランタイムなので import で共有できず、式自体が2箇所に存在する。
 */
export function isHealthConnectBuildEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HEALTH_CONNECT_ENABLED === '1';
}
