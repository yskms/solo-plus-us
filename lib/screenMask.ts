/**
 * 基本設計 §18「画面マスク」／要件定義書 §21 Discreet Mode。
 *
 * **2026-09-18 に方針を反転した**（CLAUDE.md「スクリーンショットに関する
 * 方針」参照）。以前は Recent Apps プレビュー非表示とスクリーンショット／
 * 画面収録ブロックの両方を常時オン・設定不可としていたが、ユーザーから
 * 「本人が自分のデータをスクショしたい正当な理由（長期グラフの保存、
 * 医師への共有、バグ報告、端末間の一時共有）まで奪うのはやりすぎ」との
 * 指摘を受け、以下のように分離した：
 *
 * - **Recent Apps／App Switcher プレビューの非表示**：常時オン、設定不可
 *   （事故による意図しない露出を防ぐ、判断の余地のない保護）。
 * - **スクリーンショット／画面収録のブロック**：オプトイン、既定 OFF
 *   （`privacy.blockScreenshots`、本人の意図した操作は本人に委ねる）。
 *
 * Android は API 33（Tiramisu）以降でなければこの2つを分離する OS API が
 * 無い（`FLAG_SECURE` が両方を不可分に処理する）。API 33 未満では
 * Recent Apps 非表示を優先し、副作用としてスクリーンショットも常時
 * ブロックされたままになる——ユーザーと相談のうえ受け入れた妥協
 * （CLAUDE.md 参照）。
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
 * `setRecentsScreenshotEnabledAsync(false)`（Android API 33+ のみ、
 * `node_modules/expo-screen-capture` への自前パッチ・patch-package で
 * 永続化）：`Activity.setRecentsScreenshotEnabled(false)` を呼ぶだけの
 * 新規ネイティブ関数。Recent Apps のサムネイルだけを無効化し、
 * スクリーンショット・画面収録には一切影響しない——`FLAG_SECURE` と違い
 * 完全に独立した保護。真偽値の単純な設定であり、`preventScreenCaptureAsync`
 * のような key ベースの排他制御は不要（呼ぶたびに同じ状態を再設定するだけ
 * で、何度呼んでも安全）。
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
 * Android の `FLAG_SECURE`（API 33 未満の Recent Apps 非表示・常時経路）も
 * `setRecentsScreenshotEnabled`（API 33+ の Recent Apps 非表示・常時経路）も
 * `currentActivity`/`window` 単位のため、`configChanges` で吸収されない
 * 構成変更で Activity が再生成されると保護が失われ、再適用されない
 * （起動時に一度呼ぶだけでは「常時オン」の保証にならない）。
 * `useScreenMask()` は **Android に限り**、`AppState` が `active` に戻る
 * たびに再適用する——API 33+ では `setRecentsScreenshotEnabledAsync(false)`
 * を単純に再呼び出し（真偽値なので key 管理は不要）、API 33 未満では
 * 従来通り**新しい key**で `preventScreenCaptureAsync` を呼び直す
 * （`attemptScreenMask()` 自身のキャッシュは意図的にバイパスする）。
 *
 * `applyScreenshotBlock()`（オプトイン設定の適用、`contexts/ScreenshotBlock.tsx`
 * から呼ばれる）は iOS と Android API 33+ でのみ意味を持つ（Android API 33
 * 未満では既に上記の常時経路でブロックされているため no-op）。有効化の
 * たびに新しい key を発行して `activeScreenshotBlockKeys` に積み、Android
 * の Activity 再生成後の再適用にも同じ関数をそのまま使う（真偽値の
 * `setRecentsScreenshotEnabledAsync` と違い、こちらは key ベースの API な
 * ので、同じ key を再利用すると理由1の「失敗後の再試行が無反応になる」
 * バグを再び踏む）。無効化時は、有効化中に発行した**すべての** key を
 * 解放する——1つでも残っていると `expo-screen-capture` 内部の
 * `activeTags.size` が 0 に達せず、`allowScreenCapture()` が二度と
 * ネイティブへ到達しなくなる（常時経路が同じ Set を使い回して意図的に
 * key を解放しないのと対称的に、こちらは正しく「オフにできる」ことが
 * 要件なので、発行した key を必ず自分で追跡・解放する）。
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
 * 足したくなっても、絶対に行わないこと（`applyScreenshotBlock` の
 * 再適用も Android 限定にしているのはこれが理由）。
 *
 * **既知の限界（README・設計判断記録 D-47 にも記載）**
 * - Android API 33 未満では「Block Screenshots」設定は事実上 ON 固定
 *   （無効化不可）——Recent Apps 非表示の副作用として常にブロックされる
 * - `preventScreenCaptureAsync` に渡す常時経路の再適用ごとの key は
 *   `allowScreenCaptureAsync` で回収されない（このアプリは一度も呼ばない）
 *   ため、Android API 33 未満の `activeTags` は `active` に戻るたびに
 *   増え続ける一方通行になる。現状の設計（常時オン、無効化しない）では
 *   実害は無いばかりか望ましい方向だが、将来この経路に「一時的に許可する」
 *   機能が必要になった場合、この `Set` が空になることは二度と無いため
 *   `allowScreenCaptureAsync` はネイティブへ到達しなくなる——設計上の
 *   既知の一方通行として記録しておく
 * - Activity が再生成されてから、この `AppState` リスナーが発火し非同期の
 *   ネイティブ呼び出しが着地するまでの間は保護が外れている。この窓は
 *   JS からは詰められない
 * - `attemptScreenMask()` はメモ化されているため、`hide-app-preview.tsx`
 *   が表示するのは起動時一度きりの結果である。この再適用（`active` 復帰
 *   のたびの再試行）が後から失敗しても、`logError` に残るだけで設定画面
 *   の表示（✓ のまま）には一切反映されない
 * - `setRecentsScreenshotEnabled`/`Activity.setRecentsScreenshotEnabled`
 *   自体は実機（Android 13+）で「Recent Apps のサムネイルが実際に隠れる」
 *   ことまでは確認済み（README 参照）だが、Activity 再生成後の再適用が
 *   実機で確実に着地するかは未確認
 */
import { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { logError } from './log';

const APP_SWITCHER_BLUR_INTENSITY = 0.99;

/** Android 13 (Tiramisu) is when `Activity.setRecentsScreenshotEnabled` — the API that lets Recent Apps hiding and screenshot blocking be separated — became available. */
function isAndroidRecentsApiAvailable(): boolean {
  return Platform.OS === 'android' && Platform.Version >= 33;
}

/**
 * `reason` is a stable code, not display text — `lib/` stays free of an
 * i18n dependency (see `lib/timeFormat.ts`'s doc comment on why `t` is
 * passed in rather than imported elsewhere in this codebase; here there's
 * no natural component-call-site to thread `t` through, so the display
 * mapping lives entirely at the one render site,
 * `app/settings/hide-app-preview.tsx`, via its `errors.screenMask.*` keys).
 */
export type ScreenMaskUnavailableReason = 'blur-failed' | 'hide-preview-failed' | 'support-check-failed' | 'not-available';
export type ScreenMaskResult = { active: true } | { active: false; reason: ScreenMaskUnavailableReason };

/** Always-on Recent Apps / App Switcher preview hiding — not a preference, see file doc comment. */
async function runScreenMaskAttempt(): Promise<ScreenMaskResult> {
  if (Platform.OS === 'ios') {
    try {
      await ScreenCapture.enableAppSwitcherProtectionAsync(APP_SWITCHER_BLUR_INTENSITY);
    } catch (error) {
      logError('enableAppSwitcherProtectionAsync failed', error);
      return { active: false, reason: 'blur-failed' };
    }
    return { active: true };
  }

  if (Platform.OS === 'android') {
    if (isAndroidRecentsApiAvailable()) {
      try {
        await ScreenCapture.setRecentsScreenshotEnabledAsync(false);
      } catch (error) {
        logError('setRecentsScreenshotEnabledAsync failed', error);
        return { active: false, reason: 'hide-preview-failed' };
      }
      return { active: true };
    }

    // Below API 33, there's no split API — FLAG_SECURE via
    // preventScreenCaptureAsync is the only way to hide Recent Apps, and
    // it couples in blocking screenshots/recording too (accepted
    // trade-off, see file doc comment).
    let available: boolean;
    try {
      available = await ScreenCapture.isAvailableAsync();
    } catch (error) {
      logError('ScreenCapture.isAvailableAsync failed', error);
      return { active: false, reason: 'support-check-failed' };
    }
    if (!available) {
      return { active: false, reason: 'not-available' };
    }
    try {
      await ScreenCapture.preventScreenCaptureAsync();
    } catch (error) {
      logError('preventScreenCaptureAsync failed', error);
      return { active: false, reason: 'hide-preview-failed' };
    }
    return { active: true };
  }

  return { active: false, reason: 'not-available' };
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
 * this part specifically. Android only — the always-on Recent Apps
 * protection is Activity-bound and needs reapplying after Activity
 * recreation; iOS's equivalent is process-lifetime, not Activity-bound
 * (see file doc comment on why iOS must never gain this reapply logic).
 */
export function handleAppStateChangeForReapply(next: AppStateStatus): void {
  if (next !== 'active') return;
  if (isAndroidRecentsApiAvailable()) {
    // Plain boolean, not key-based — safe to call again unconditionally.
    ScreenCapture.setRecentsScreenshotEnabledAsync(false).catch((error) =>
      logError('setRecentsScreenshotEnabledAsync (reapply on resume) failed', error),
    );
    return;
  }
  // A fresh key every call is deliberate — see this file's doc comment on
  // why reusing a key would silently short-circuit and never reach native
  // again. `Date.now()` alone is millisecond-precision, not guaranteed
  // unique if `active` somehow fires twice within the same millisecond
  // (unlikely in practice, but a monotonic counter suffix costs nothing).
  ScreenCapture.preventScreenCaptureAsync(`screen-mask-reapply-${Date.now()}-${reapplyKeyCounter++}`).catch((error) =>
    logError('preventScreenCaptureAsync (reapply on resume) failed', error),
  );
}

/**
 * Fire-and-forget setup, called once app startup has reached `ready` —
 * see `attemptScreenMask` for the version that reports its own result,
 * used by the settings screen. Also reapplies Android's Recent Apps
 * protection on every return to `active`, bypassing `attemptScreenMask`'s
 * cache on purpose (see this file's doc comment on Activity recreation).
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

/**
 * `privacy.blockScreenshots` opt-in — iOS and Android API 33+ only. On
 * Android below API 33, this is a deliberate no-op: screenshots are
 * already blocked as a side effect of the always-on Recent Apps
 * protection there (see file doc comment), so there's nothing left for
 * this setting to independently control.
 *
 * Tracks every key it has ever issued so disabling can release all of
 * them — see file doc comment on why a single fixed key wouldn't
 * actually let this be turned back off.
 */
let activeScreenshotBlockKeys: string[] = [];
let screenshotBlockKeyCounter = 0;

/**
 * Deliberately does NOT catch its own failures — unlike the always-on
 * path (`attemptScreenMask`), this is called both from a place that
 * needs to know about failure (`contexts/ScreenshotBlock.tsx`'s
 * `setEnabled`, which must not tell the Settings screen "saved" when the
 * native call actually failed — D-47: never claim a protection is
 * active without a genuine confirmed attempt) and from places that are
 * intentionally best-effort (the initial apply at startup, and Android's
 * resume reapply below) — those call sites catch and log around their
 * own calls instead.
 */
export async function applyScreenshotBlock(enabled: boolean): Promise<void> {
  if (Platform.OS !== 'ios' && !isAndroidRecentsApiAvailable()) return;

  if (enabled) {
    if (Platform.OS === 'ios' && activeScreenshotBlockKeys.length > 0) {
      // Already active — must never call preventScreenCaptureAsync (→
      // preventScreenshots()) a second time without disabling first, see
      // file doc comment on the broken layer hierarchy this causes on
      // iOS. Only Android's resume reapply needs a fresh key on every
      // "still enabled" call; iOS never needs reapplying at all.
      return;
    }
    const key = `privacy-block-screenshots-${Date.now()}-${screenshotBlockKeyCounter++}`;
    // Tracked only *after* the native call actually succeeds — pushing
    // it first would make a failed enable look identical to a
    // successful one to the next call: on iOS the "already active"
    // guard above would then silently no-op every retry (a key sitting
    // in this array for an attempt that never actually landed), and on
    // Android a later disable would try to release a key native never
    // really held. If this call throws, the key is simply never
    // tracked, matching D-47's rule of never claiming an untested
    // protection is active.
    try {
      await ScreenCapture.preventScreenCaptureAsync(key);
    } catch (error) {
      // expo-screen-capture's own preventScreenCaptureAsync adds `key`
      // to its internal activeTags Set *before* calling native, and
      // never removes it on failure (the same quirk this file's top
      // doc comment already covers for the always-on path — see reason
      // 1). Left alone, that stray key never goes away: a later
      // successful enable adds a second key we DO track, but disabling
      // only releases the ones we tracked, so activeTags.size never
      // reaches 0 and allowScreenCapture() never reaches native again
      // — the switch would show off while screenshots stay blocked
      // until the app restarts. Releasing the same key here keeps the
      // SDK's internal Set in sync with ours: a failed attempt leaves
      // no residue in either (found in review — the plain per-call
      // mocks elsewhere in this file's test couldn't catch it, since
      // they don't model activeTags; see the dedicated stateful-mock
      // tests that do).
      await ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
      throw error;
    }
    activeScreenshotBlockKeys.push(key);
    return;
  }

  const keys = activeScreenshotBlockKeys;
  activeScreenshotBlockKeys = [];
  await Promise.all(keys.map((key) => ScreenCapture.allowScreenCaptureAsync(key)));
}

/** Only for tests that need a clean slate between cases. */
export function __resetScreenshotBlockForTests(): void {
  activeScreenshotBlockKeys = [];
}

/**
 * Keeps `privacy.blockScreenshots` reapplied on Android after Activity
 * recreation, for as long as `enabled` is true — same concern as
 * `useScreenMask`'s own reapply, same reason this must never run on iOS
 * (see file doc comment). Best-effort: catches and logs its own
 * failures rather than propagating them, since there's no UI in this
 * path to report to (contrast `contexts/ScreenshotBlock.tsx`'s
 * `setEnabled`, which lets `applyScreenshotBlock` throw so the Settings
 * screen can react).
 *
 * Does NOT apply the initial value on mount — that's the caller's job
 * (`contexts/ScreenshotBlock.tsx`, which needs to know if it succeeded).
 * `enabled` is read through a ref inside the AppState listener so the
 * listener always reads the latest value without needing to resubscribe
 * on every change (same pattern `contexts/AppLock.tsx` uses for its own
 * AppState listener).
 */
export function useScreenshotBlock(enabled: boolean): void {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (!enabledRef.current) return;
      applyScreenshotBlock(true).catch((error) =>
        logError('applyScreenshotBlock (reapply on resume) failed', error),
      );
    });
    return () => subscription.remove();
  }, []);
}
