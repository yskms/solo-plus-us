/**
 * §18 画面マスク（設計判断記録 D-47）。2026-09-18 の方針反転
 * （CLAUDE.md「スクリーンショットに関する方針」）後の挙動：Recent Apps／
 * App Switcher プレビュー非表示は常時オン（`attemptScreenMask`/
 * `useScreenMask`）、スクリーンショット／画面収録ブロックはオプトイン
 * （`applyScreenshotBlock`/`useScreenshotBlock`）。`expo-screen-capture`
 * はネイティブモジュールのため、実際の呼び出しは検証できない——ここで
 * 検証するのはこのファイル自身の分岐（OS・Android の API レベルによる
 * 呼び出し先の切り替え、失敗時の結果、メモ化、key の発行・回収）だけで
 * あり、モックした関数が実機で本当に同じ形で動くかは実機でしか確認
 * できない。
 *
 * `react-test-renderer` は React 19 で公式に非推奨だが、`useScreenMask`/
 * `useScreenshotBlock` 自体（副作用・購読・unmount のクリーンアップ）を
 * 検証するにはコンポーネントをマウントする必要があり、react/react-native
 * と同じバージョンで既に依存ツリーに存在する分だけ
 * `@testing-library/react-native` を新規追加するより軽いと判断した。
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { AppState, Platform } from 'react-native';

const mockPreventScreenCaptureAsync = jest.fn();
const mockAllowScreenCaptureAsync = jest.fn();
const mockEnableAppSwitcherProtectionAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();
const mockSetRecentsScreenshotEnabledAsync = jest.fn();

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: (...args: unknown[]) => mockPreventScreenCaptureAsync(...args),
  allowScreenCaptureAsync: (...args: unknown[]) => mockAllowScreenCaptureAsync(...args),
  enableAppSwitcherProtectionAsync: (...args: unknown[]) => mockEnableAppSwitcherProtectionAsync(...args),
  isAvailableAsync: (...args: unknown[]) => mockIsAvailableAsync(...args),
  setRecentsScreenshotEnabledAsync: (...args: unknown[]) => mockSetRecentsScreenshotEnabledAsync(...args),
}));

import {
  attemptScreenMask,
  applyScreenshotBlock,
  handleAppStateChangeForReapply,
  useScreenMask,
  useScreenshotBlock,
  __resetScreenMaskForTests,
  __resetScreenshotBlockForTests,
} from '../screenMask';

function setPlatform(os: 'ios' | 'android', version?: number) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  if (version !== undefined) {
    Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
  }
}

describe('attemptScreenMask', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  beforeEach(() => {
    __resetScreenMaskForTests();
    mockPreventScreenCaptureAsync.mockReset().mockResolvedValue(undefined);
    mockEnableAppSwitcherProtectionAsync.mockReset().mockResolvedValue(undefined);
    mockIsAvailableAsync.mockReset().mockResolvedValue(true);
    mockSetRecentsScreenshotEnabledAsync.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
  });

  it('on iOS, only blurs the app switcher — never touches preventScreenCaptureAsync (that is now the opt-in toggle)', async () => {
    setPlatform('ios');
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: true });
    expect(mockEnableAppSwitcherProtectionAsync).toHaveBeenCalledWith(0.99);
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it('reports failure with a reason when enableAppSwitcherProtectionAsync rejects (iOS)', async () => {
    setPlatform('ios');
    mockEnableAppSwitcherProtectionAsync.mockRejectedValue(new Error('boom'));
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: false, reason: 'could not blur the app switcher preview' });
  });

  it('on Android API 33+, only calls setRecentsScreenshotEnabledAsync — never FLAG_SECURE', async () => {
    setPlatform('android', 33);
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: true });
    expect(mockSetRecentsScreenshotEnabledAsync).toHaveBeenCalledWith(false);
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled();
    expect(mockIsAvailableAsync).not.toHaveBeenCalled();
  });

  it('reports failure with a reason when setRecentsScreenshotEnabledAsync rejects (Android API 33+)', async () => {
    setPlatform('android', 33);
    mockSetRecentsScreenshotEnabledAsync.mockRejectedValue(new Error('boom'));
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: false, reason: 'could not hide the Recent Apps preview' });
  });

  it('on Android below API 33, falls back to FLAG_SECURE (couples screenshot blocking)', async () => {
    setPlatform('android', 32);
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: true });
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(mockSetRecentsScreenshotEnabledAsync).not.toHaveBeenCalled();
  });

  it('reports failure with a reason when isAvailableAsync resolves false (Android below API 33)', async () => {
    setPlatform('android', 32);
    mockIsAvailableAsync.mockResolvedValue(false);
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: false, reason: 'not available on this device' });
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it('reports failure with a reason when isAvailableAsync itself rejects (Android below API 33)', async () => {
    setPlatform('android', 32);
    mockIsAvailableAsync.mockRejectedValue(new Error('boom'));
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: false, reason: 'support could not be checked on this device' });
  });

  it('reports failure with a reason when preventScreenCaptureAsync rejects (Android below API 33)', async () => {
    setPlatform('android', 32);
    mockPreventScreenCaptureAsync.mockRejectedValue(new Error('boom'));
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: false, reason: 'could not hide the Recent Apps preview' });
  });

  it('memoizes: a second call never invokes the native functions again, even after a failure', async () => {
    setPlatform('android', 32);
    mockPreventScreenCaptureAsync.mockRejectedValue(new Error('boom'));
    const first = await attemptScreenMask();
    const second = await attemptScreenMask();
    expect(first).toEqual(second);
    expect(mockIsAvailableAsync).toHaveBeenCalledTimes(1);
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh attempt after __resetScreenMaskForTests', async () => {
    setPlatform('android', 32);
    mockPreventScreenCaptureAsync.mockRejectedValueOnce(new Error('boom'));
    const first = await attemptScreenMask();
    expect(first).toEqual({ active: false, reason: 'could not hide the Recent Apps preview' });

    __resetScreenMaskForTests();
    mockPreventScreenCaptureAsync.mockResolvedValueOnce(undefined);
    const second = await attemptScreenMask();
    expect(second).toEqual({ active: true });
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(2);
  });
});

describe('handleAppStateChangeForReapply', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  beforeEach(() => {
    mockPreventScreenCaptureAsync.mockReset().mockResolvedValue(undefined);
    mockSetRecentsScreenshotEnabledAsync.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
  });

  it('ignores every AppState status other than active', () => {
    setPlatform('android', 32);
    for (const status of ['background', 'inactive', 'unknown', 'extension'] as const) {
      handleAppStateChangeForReapply(status);
    }
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled();
    expect(mockSetRecentsScreenshotEnabledAsync).not.toHaveBeenCalled();
  });

  it('below API 33, reapplies FLAG_SECURE with a fresh key each time active fires, never reusing one', () => {
    setPlatform('android', 32);
    handleAppStateChangeForReapply('active');
    handleAppStateChangeForReapply('active');
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(2);
    const [firstKey] = mockPreventScreenCaptureAsync.mock.calls[0];
    const [secondKey] = mockPreventScreenCaptureAsync.mock.calls[1];
    expect(firstKey).toMatch(/^screen-mask-reapply-/);
    // Not the SDK's 'default' key — reusing that is exactly what makes a
    // failed attempt silently short-circuit to success on retry (see this
    // file's doc comment / attemptScreenMask's memoization).
    expect(firstKey).not.toBe('default');
    expect(firstKey).not.toBe(secondKey);
  });

  it('at API 33+, reapplies via setRecentsScreenshotEnabledAsync(false) instead — no key needed', () => {
    setPlatform('android', 33);
    handleAppStateChangeForReapply('active');
    handleAppStateChangeForReapply('active');
    expect(mockSetRecentsScreenshotEnabledAsync).toHaveBeenCalledTimes(2);
    expect(mockSetRecentsScreenshotEnabledAsync).toHaveBeenCalledWith(false);
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled();
  });
});

describe('applyScreenshotBlock', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  beforeEach(() => {
    __resetScreenshotBlockForTests();
    mockPreventScreenCaptureAsync.mockReset().mockResolvedValue(undefined);
    mockAllowScreenCaptureAsync.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
  });

  it('on iOS, enabling calls preventScreenCaptureAsync with a fresh key', async () => {
    setPlatform('ios');
    await applyScreenshotBlock(true);
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(mockPreventScreenCaptureAsync.mock.calls[0][0]).toMatch(/^privacy-block-screenshots-/);
  });

  it('on Android below API 33, is a no-op — already forced on by the always-on path', async () => {
    setPlatform('android', 32);
    await applyScreenshotBlock(true);
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled();
    await applyScreenshotBlock(false);
    expect(mockAllowScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it('on Android API 33+, enabling calls preventScreenCaptureAsync with a fresh key', async () => {
    setPlatform('android', 33);
    await applyScreenshotBlock(true);
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(1);
  });

  it('on Android, disabling releases every key issued while enabled, not just the latest', async () => {
    // Android is the only platform where a second `true` call while
    // already enabled actually reaches native again (resume reapply) —
    // see the iOS-specific guard test below.
    setPlatform('android', 33);
    await applyScreenshotBlock(true);
    await applyScreenshotBlock(true); // simulates a reapply-on-resume while already enabled
    const [key1] = mockPreventScreenCaptureAsync.mock.calls[0];
    const [key2] = mockPreventScreenCaptureAsync.mock.calls[1];
    expect(key1).not.toBe(key2);

    await applyScreenshotBlock(false);
    const releasedKeys = mockAllowScreenCaptureAsync.mock.calls.map(([key]) => key);
    expect(releasedKeys).toEqual(expect.arrayContaining([key1, key2]));
    expect(releasedKeys).toHaveLength(2);
  });

  it('on iOS, a second enable call while already enabled never reaches native — calling preventScreenCaptureAsync twice without disabling breaks the layer hierarchy (see file doc comment)', async () => {
    setPlatform('ios');
    await applyScreenshotBlock(true);
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(1);

    await applyScreenshotBlock(true); // must be a no-op, not a fresh key
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(1);

    await applyScreenshotBlock(false);
    expect(mockAllowScreenCaptureAsync).toHaveBeenCalledTimes(1);
  });

  it('propagates a native failure to the caller instead of swallowing it — callers that need to know (contexts/ScreenshotBlock.tsx) rely on this', async () => {
    setPlatform('ios');
    mockPreventScreenCaptureAsync.mockRejectedValue(new Error('boom'));
    await expect(applyScreenshotBlock(true)).rejects.toThrow('boom');
  });

  it('on iOS, a failed enable does not block the next retry from reaching native — the key must not be tracked unless the call actually succeeded', async () => {
    setPlatform('ios');
    mockPreventScreenCaptureAsync.mockRejectedValueOnce(new Error('boom'));
    await expect(applyScreenshotBlock(true)).rejects.toThrow('boom');

    // If the failed attempt's key had been tracked anyway, the "already
    // active" guard (see the test above this describe block) would make
    // this second call a silent no-op instead of retrying.
    mockPreventScreenCaptureAsync.mockResolvedValueOnce(undefined);
    await applyScreenshotBlock(true);
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(2);
  });

  it('disabling with nothing enabled does not call allowScreenCaptureAsync at all', async () => {
    setPlatform('ios');
    await applyScreenshotBlock(false);
    expect(mockAllowScreenCaptureAsync).not.toHaveBeenCalled();
  });
});

describe('applyScreenshotBlock against a stateful activeTags-like mock', () => {
  // The plain per-call jest.fn() mocks used elsewhere in this file treat
  // every prevent/allow call as reaching native directly. That can't
  // reproduce the real bug found in review: expo-screen-capture's own
  // preventScreenCaptureAsync/allowScreenCaptureAsync manage an internal
  // `activeTags` Set — a key is added to it *before* the native call and
  // never removed on failure, and `allowScreenCaptureAsync` only reaches
  // native once that Set is empty. Without releasing a failed attempt's
  // key from that Set ourselves, it lingers forever: a later successful
  // enable's key is the only one we track, so disabling never actually
  // empties the SDK's Set and native `allowScreenCapture()` never runs
  // again — the switch shows off while screenshots stay blocked. This
  // mock models that Set so the fix (`allowScreenCaptureAsync` on a
  // failed prevent, to release the stray key) is actually exercised.
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;
  let activeTags: Set<string>;
  let nativePreventCalls = 0;
  let nativeAllowCalls = 0;
  let nextPreventShouldFail = false;

  beforeEach(() => {
    __resetScreenshotBlockForTests();
    activeTags = new Set();
    nativePreventCalls = 0;
    nativeAllowCalls = 0;
    nextPreventShouldFail = false;

    mockPreventScreenCaptureAsync.mockReset().mockImplementation(async (key: unknown = 'default') => {
      const k = key as string;
      if (!activeTags.has(k)) {
        activeTags.add(k);
        nativePreventCalls++;
        if (nextPreventShouldFail) {
          nextPreventShouldFail = false;
          throw new Error('native prevent failed');
        }
      }
    });
    mockAllowScreenCaptureAsync.mockReset().mockImplementation(async (key: unknown = 'default') => {
      activeTags.delete(key as string);
      if (activeTags.size === 0) {
        nativeAllowCalls++;
      }
    });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
  });

  it('releases a failed attempt’s key from activeTags, so a later disable still reaches native allow', async () => {
    setPlatform('ios');
    nextPreventShouldFail = true;
    await expect(applyScreenshotBlock(true)).rejects.toThrow('native prevent failed');
    // The fix itself: the failed key was released (not left stray), so
    // activeTags is empty again — and releasing it, since the Set went
    // from 1 back to 0, already reached native allow once (harmless:
    // the real native `preventScreenCapture()` for that key never got
    // as far as actually setting FLAG_SECURE before throwing).
    expect(activeTags.size).toBe(0);
    expect(nativeAllowCalls).toBe(1);

    await applyScreenshotBlock(true); // succeeds this time
    expect(activeTags.size).toBe(1);

    await applyScreenshotBlock(false);
    expect(activeTags.size).toBe(0);
    // The critical assertion: this disable's allow call must reach
    // native a *second* time. Without the fix, the failed attempt's key
    // would still be sitting in activeTags, so this call would never
    // see the Set reach 0 — nativeAllowCalls would stay at 1 forever,
    // meaning screenshots stay blocked even though the switch shows off.
    expect(nativeAllowCalls).toBe(2);
  });

  it('on Android API 33+, the same fix applies — a failed attempt’s key doesn’t block a later disable from reaching native', async () => {
    setPlatform('android', 33);
    nextPreventShouldFail = true;
    await expect(applyScreenshotBlock(true)).rejects.toThrow('native prevent failed');

    await applyScreenshotBlock(true);
    await applyScreenshotBlock(false);
    expect(activeTags.size).toBe(0);
    expect(nativeAllowCalls).toBe(2);
  });
});

describe('useScreenMask', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  function TestHost({ ready }: { ready: boolean }) {
    useScreenMask(ready);
    return null;
  }

  beforeEach(() => {
    __resetScreenMaskForTests();
    mockPreventScreenCaptureAsync.mockReset().mockResolvedValue(undefined);
    mockEnableAppSwitcherProtectionAsync.mockReset().mockResolvedValue(undefined);
    mockIsAvailableAsync.mockReset().mockResolvedValue(true);
    mockSetRecentsScreenshotEnabledAsync.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
  });

  it('does nothing until ready is true', () => {
    setPlatform('android', 33);
    const addSpy = jest.spyOn(AppState, 'addEventListener');

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost, { ready: false }));
    });
    expect(mockSetRecentsScreenshotEnabledAsync).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled(); // the ready gate must also hold off the AppState subscription, not just attemptScreenMask

    act(() => {
      renderer.unmount();
    });
    addSpy.mockRestore();
  });

  it('on Android, subscribes to AppState with handleAppStateChangeForReapply itself and unsubscribes on unmount', () => {
    setPlatform('android', 33);
    const addSpy = jest.spyOn(AppState, 'addEventListener');
    const removeSpy = jest.fn();
    addSpy.mockReturnValue({ remove: removeSpy } as ReturnType<typeof AppState.addEventListener>);

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost, { ready: true }));
    });
    // The exact handler, not just "some function" — pins the subscription
    // to handleAppStateChangeForReapply specifically, so swapping in an
    // inline closure with different (or missing) reapply behavior would
    // fail this test.
    expect(addSpy).toHaveBeenCalledWith('change', handleAppStateChangeForReapply);

    act(() => {
      renderer.unmount();
    });
    expect(removeSpy).toHaveBeenCalledTimes(1);
    addSpy.mockRestore();
  });

  it('on iOS, never subscribes to AppState — reapplying there is harmful, not just unnecessary (see file doc comment)', () => {
    setPlatform('ios');
    const addSpy = jest.spyOn(AppState, 'addEventListener');

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost, { ready: true }));
    });
    expect(addSpy).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
    addSpy.mockRestore();
  });
});

describe('useScreenshotBlock', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  function TestHost({ enabled }: { enabled: boolean }) {
    useScreenshotBlock(enabled);
    return null;
  }

  beforeEach(() => {
    __resetScreenshotBlockForTests();
    mockPreventScreenCaptureAsync.mockReset().mockResolvedValue(undefined);
    mockAllowScreenCaptureAsync.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
  });

  it('does not apply anything on mount — the initial value is the caller’s (ScreenshotBlockProvider’s) job', () => {
    setPlatform('ios');
    act(() => {
      create(React.createElement(TestHost, { enabled: true }));
    });
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it('does not apply anything when the enabled prop changes — only ScreenshotBlockProvider.setEnabled applies user-driven changes', () => {
    setPlatform('ios');
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost, { enabled: false }));
    });

    act(() => {
      renderer.update(React.createElement(TestHost, { enabled: true }));
    });
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled();

    act(() => {
      renderer.update(React.createElement(TestHost, { enabled: false }));
    });
    expect(mockAllowScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it('on Android, reapplies on resume only while enabled is true', () => {
    setPlatform('android', 33);
    let capturedListener: ((status: string) => void) | undefined;
    const addSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      capturedListener = listener as (status: string) => void;
      return { remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>;
    });

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost, { enabled: false }));
    });
    mockPreventScreenCaptureAsync.mockClear();

    act(() => {
      capturedListener?.('active');
    });
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled(); // not enabled — must not reapply

    act(() => {
      renderer.update(React.createElement(TestHost, { enabled: true }));
    });
    mockPreventScreenCaptureAsync.mockClear();

    act(() => {
      capturedListener?.('active');
    });
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(1); // enabled — reapplies

    act(() => {
      renderer.unmount();
    });
    addSpy.mockRestore();
  });

  it('on iOS, never subscribes to AppState (same reason as useScreenMask)', () => {
    setPlatform('ios');
    const addSpy = jest.spyOn(AppState, 'addEventListener');

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost, { enabled: true }));
    });
    expect(addSpy).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
    addSpy.mockRestore();
  });
});
