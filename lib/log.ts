/**
 * §8.7 — "Activity の内容をログ・クラッシュレポートへ送らない." `console.error`
 * still reaches the device's native log (logcat/os_log) in release builds,
 * not just the dev console — and several caught errors here carry values
 * derived from Activity input in their message (e.g. `ValidationError`'s
 * "occurredAtUtc must have :00 seconds: 2026-09-14T...").
 *
 * Use this instead of calling `console.error` directly wherever the error
 * being logged might originate from Activity data.
 */
export function logError(context: string, error: unknown): void {
  if (__DEV__) {
    console.error(context, error);
    return;
  }
  const name = error instanceof Error ? error.name : 'UnknownError';
  console.error(`${context}: ${name}`);
}
