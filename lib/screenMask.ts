/**
 * 基本設計 §18「画面マスク」／要件定義書 §21 Discreet Mode「Recent Apps 画面
 * のマスク」（v1.0 必須、●）— OS の Recent Apps／App Switcher が撮る
 * スナップショットに、この端末の記録内容を映さない。
 *
 * Always on, not a user preference（設計判断記録 D-47）——この保護は §8 の
 * DB 暗号化・§8.6 のバックアップ除外と同じ「OS レベルの露出を防ぐ、判断の
 * 余地のない保護」の階層に属し、App Lock 自体の enabled/disabled のような
 * 端末所有者の好みの設定ではない。`app/settings/hide-app-preview.tsx` に
 * この前提で「常時オン」を伝える画面を用意しているが、下記の理由で結果を
 * 確認してから表示する。
 *
 * `preventScreenCaptureAsync()`（両 OS）：スクリーンショット・画面収録を
 * ブロックする。Android では**これ単体で** Recent Apps のサムネイルも
 * 空白化される（`FLAG_SECURE`、Android では分離できない副作用）。iOS では
 * App Switcher のマスク自体は `enableAppSwitcherProtectionAsync()` だけで
 * 成立するため、iOS でもこれを呼んでスクリーンショット・画面収録をブロック
 * するのは分離できない副作用ではなく**独立した選択**——設計判断記録 D-47 に
 * 理由を記録済み。
 *
 * `enableAppSwitcherProtectionAsync()`（iOS のみ）：iOS には `FLAG_SECURE`
 * 相当が無いため、App Switcher・バックグラウンド・割り込み（着信・Siri・
 * コントロールセンター等）でネイティブ側がぼかしオーバーレイを出す。
 * このアプリの View 階層で `AppState` を監視して自前でオーバーレイを
 * 描画する必要はない——`contexts/AppLock.tsx` が `inactive` を意図的に
 * 無視しているのと対照的に、この保護自体はネイティブ実装が `inactive` 相当の
 * 遷移を検知して処理する。`blurIntensity` は `1.0` ではなく `0.99` を渡す
 * ——ネイティブ実装（`AnimatedBlurEffectView.swift`）は
 * `UIViewPropertyAnimator.fractionComplete` にこの値をそのまま渡しており、
 * `fractionComplete` を厳密に `1.0` にするとアニメーターが「完了」状態に
 * 遷移し、意図した見た目のまま留まらない可能性があることが知られている
 * （iOS のよくある回避策）。実機未検証（README 参照）。
 *
 * **このモジュール自身が管理する再試行の仕組みが必要な、確認された理由が
 * 2つある**（2回目のレビューで発見、いずれも `node_modules/expo-screen-capture`
 * の実装を直接確認して判明）：
 *
 * 1. `preventScreenCaptureAsync()`/`allowScreenCaptureAsync()` の JS 実装
 *    （`ScreenCapture.js`）は、`key`（既定値 `'default'`）を `await` の**前**に
 *    内部の `Set` へ追加し、失敗時にロールバックしない。したがって一度
 *    reject すると、同じ key での再呼び出しは実際にはネイティブへ到達せず
 *    即座に成功として resolve される——「もう一度呼んで確認する」という
 *    再試行は成立しない。この関数自身の promise を一度だけ生成してキャッシュ
 *    し、以後のすべての呼び出し元（起動時・設定画面での再確認）に同じ結果を
 *    返すことで、ネイティブ呼び出し自体をプロセス内で一度しか行わないように
 *    し、この問題を回避する。
 * 2. iOS の `preventScreenshots()`（`ScreenCaptureModule.swift`）は
 *    `guard let keyWindow = keyWindow else { return }` で、`keyWindow` が
 *    まだ存在しない場合に**何もせず無言で終わる**。この関数を包む
 *    `AsyncFunction` は例外を投げないため、promise は成功として resolve
 *    される——「resolve した」ことは「実際に保護が有効になった」ことの
 *    証明にはならない。`useScreenMask()` を `RootLayout` で `loaded`
 *    （フォント読み込み完了・スプラッシュ非表示直前）を待ってから呼ぶことで
 *    この窓を狭めているが、JS からこれを完全に検証する手段は無い——
 *    `isAvailableAsync()` もネイティブ関数の存在確認のみで、この種の
 *    タイミング起因の失敗は検出しない。`{ active: true }` は
 *    「明示的な失敗を検出しなかった」ことを意味し、「有効化を実機で確認
 *    した」ことを意味しない（README・設計判断記録 D-47 に明記）。
 *
 * Android の `FLAG_SECURE` は `currentActivity.window` 単位で設定される
 * ため、`configChanges` で吸収されない構成変更で Activity が再生成される
 * と保護が失われ、再適用されない（起動時に一度呼ぶだけでは「常時オン」の
 * 保証にならない）。`useScreenMask()` は **Android に限り**、`AppState` が
 * `active` に戻るたびに**新しい key**で `preventScreenCaptureAsync` を
 * 呼び直す——`attemptScreenMask()` 自身のキャッシュは意図的にバイパスする
 * （そちらは「起動時に一度確認した結果」を表すためのものであり、この
 * 再適用は別の目的を持つ）。
 *
 * **iOS へこの再適用ロジックを広げてはならない——「不要」ではなく「有害」**
 * （2回目のレビューで発見）：iOS の `enableAppSwitcherProtection()` は
 * モジュールインスタンス（プロセス寿命）に紐づく NotificationCenter 監視
 * であり Activity 相当の再生成は無いため「不要」という以上に、
 * `preventScreenCaptureAsync`（内部で `preventScreenshots()` を呼ぶ）を
 * 2回目以降に呼ぶと壊れる。`preventScreenshots()` は毎回新しい secure
 * `UITextField` を作り、`originalParent = keyWindow.layer.superlayer` を
 * 記録してから `keyWindow.layer` をその `UITextField` のレイヤの下へ
 * 再親付けする。1回目の呼び出しで `keyWindow.layer` は既に1つ目の
 * `UITextField` のレイヤの下にあるため、2回目の呼び出しの時点で
 * `keyWindow.layer.superlayer` は「本来の親」ではなく「1回目の
 * `UITextField` のレイヤ」を指している——`originalParent` がそれで
 * 上書きされ、`allowScreenshots()` を呼んでも本来の親には戻らない
 * （壊れたレイヤ階層のまま復元不能になる）。iOS 分岐にこの再適用処理を
 * 足したくなっても、絶対に行わないこと。
 *
 * **既知の限界（README・設計判断記録 D-47 にも記載）**
 * - `preventScreenCaptureAsync` に渡す再適用ごとの key は `allowScreenCaptureAsync`
 *   で回収されない（このアプリは一度も呼ばない）ため、Android の
 *   `activeTags` は `active` に戻るたびに増え続ける一方通行になる。現状の
 *   設計（常時オン、無効化しない）では実害は無いばかりか望ましい方向だが、
 *   将来「一時的に許可する」機能が必要になった場合、この `Set` が空になる
 *   ことは二度と無いため `allowScreenCaptureAsync` はネイティブへ到達
 *   しなくなる——設計上の既知の一方通行として記録しておく。
 * - Activity が再生成されてから、この `AppState` リスナーが発火し非同期の
 *   ネイティブ呼び出しが着地するまでの間は `FLAG_SECURE` が外れている。
 *   この窓は JS からは詰められない。
 * - `attemptScreenMask()` はメモ化されているため、`hide-app-preview.tsx`
 *   が表示するのは起動時一度きりの結果である。この再適用（`active` 復帰
 *   のたびの再試行）が後から失敗しても、`logError` に残るだけで設定画面
 *   の表示（✓ のまま）には一切反映されない。
 */
import { useEffect } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { logError } from './log';

const APP_SWITCHER_BLUR_INTENSITY = 0.99;

export type ScreenMaskResult = { active: true } | { active: false; reason: string };

async function runScreenMaskAttempt(): Promise<ScreenMaskResult> {
  let available: boolean;
  try {
    available = await ScreenCapture.isAvailableAsync();
  } catch (error) {
    logError('ScreenCapture.isAvailableAsync failed', error);
    return { active: false, reason: 'support could not be checked on this device' };
  }
  if (!available) {
    return { active: false, reason: 'not available on this device' };
  }

  try {
    await ScreenCapture.preventScreenCaptureAsync();
  } catch (error) {
    logError('preventScreenCaptureAsync failed', error);
    return { active: false, reason: 'could not block screenshots and screen recording' };
  }

  if (Platform.OS === 'ios') {
    try {
      await ScreenCapture.enableAppSwitcherProtectionAsync(APP_SWITCHER_BLUR_INTENSITY);
    } catch (error) {
      logError('enableAppSwitcherProtectionAsync failed', error);
      return { active: false, reason: 'could not blur the app switcher preview' };
    }
  }

  return { active: true };
}

let memoizedAttempt: Promise<ScreenMaskResult> | null = null;

/**
 * Memoized — see this file's doc comment for why re-invoking the
 * underlying SDK functions on a repeat call can't be trusted to mean
 * anything (a failed first attempt makes a second one silently
 * short-circuit to success). The native calls run at most once per
 * process; every caller — the startup effect below, and
 * `hide-app-preview.tsx` checking again later — sees the one real
 * outcome from that single attempt.
 */
export function attemptScreenMask(): Promise<ScreenMaskResult> {
  if (!memoizedAttempt) {
    memoizedAttempt = runScreenMaskAttempt();
  }
  return memoizedAttempt;
}

/** Only for tests that need to force a fresh attempt between cases. */
export function __resetScreenMaskForTests(): void {
  memoizedAttempt = null;
}

let reapplyKeyCounter = 0;

/**
 * Extracted so it's directly testable (see `lib/__tests__/screenMask.test.ts`)
 * without needing to drive the whole `useScreenMask` effect lifecycle for
 * this part specifically. A fresh key every call is deliberate — see this
 * file's doc comment on why reusing a key would silently short-circuit
 * and never reach native again. `Date.now()` alone is millisecond-
 * precision, not guaranteed unique if `active` somehow fires twice within
 * the same millisecond (unlikely in practice, but a monotonic counter
 * suffix costs nothing and removes the possibility entirely rather than
 * leaving it as a theoretical gap).
 */
export function handleAppStateChangeForReapply(next: AppStateStatus): void {
  if (next !== 'active') return;
  ScreenCapture.preventScreenCaptureAsync(`screen-mask-reapply-${Date.now()}-${reapplyKeyCounter++}`).catch((error) =>
    logError('preventScreenCaptureAsync (reapply on resume) failed', error),
  );
}

/**
 * Fire-and-forget setup, called once app startup has reached `ready` —
 * see `attemptScreenMask` for the version that reports its own result,
 * used by the settings screen. Also reapplies Android's FLAG_SECURE on
 * every return to `active`, bypassing `attemptScreenMask`'s cache on
 * purpose (see this file's doc comment on Activity recreation).
 *
 * `ready` (passed as `loaded` from `RootLayout`, true only after fonts
 * are loaded and the splash screen is about to hide) exists specifically
 * to narrow, not eliminate, this file's documented iOS `keyWindow` timing
 * risk — calling any earlier risks `preventScreenshots()`'s silent no-op
 * on a `keyWindow` that doesn't exist yet. `useScreenMask` itself is
 * still called unconditionally (Rules of Hooks) — only the effect inside
 * is gated on `ready`.
 */
export function useScreenMask(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    attemptScreenMask();

    if (Platform.OS !== 'android') return;
    const subscription = AppState.addEventListener('change', handleAppStateChangeForReapply);
    return () => subscription.remove();
  }, [ready]);
}
