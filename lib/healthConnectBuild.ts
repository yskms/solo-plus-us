/**
 * 基本設計 §9.11・要件定義書 §25.1 — このビルドが Health Connect 権限を
 * Manifest に含む（`with-health-connect`）かどうか。`app.config.js` と
 * 同じ `EXPO_PUBLIC_HEALTH_CONNECT_ENABLED` を読むことで、Manifest 側の
 * 判定と JS 側の判定がずれないようにしている（詳細は `app.config.js` の
 * doc comment参照）。
 */
export function isHealthConnectBuildEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HEALTH_CONNECT_ENABLED !== '0';
}
