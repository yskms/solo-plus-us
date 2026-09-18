/**
 * §18 画面マスク（設計判断記録 D-47）。`expo-screen-capture` はネイティブ
 * モジュールのため、実際の呼び出しは検証できない——ここで検証するのは
 * `attemptScreenMask()` 自身の分岐（`isAvailableAsync` の失敗・
 * `preventScreenCaptureAsync`/`enableAppSwitcherProtectionAsync` の失敗、
 * 成功時の結果、そしてメモ化）と、`useScreenMask` の Android 再適用ロジック
 * （`AppState` の購読・`active` 以外は無視・key でメモ化をバイパスする・
 * unmount 時の unsubscribe）だけであり、モックした関数が実機で本当に
 * 同じ形で動くかは実機でしか確認できない。
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { AppState, Platform } from 'react-native';

const mockPreventScreenCaptureAsync = jest.fn();
const mockEnableAppSwitcherProtectionAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: (...args: unknown[]) => mockPreventScreenCaptureAsync(...args),
  enableAppSwitcherProtectionAsync: (...args: unknown[]) => mockEnableAppSwitcherProtectionAsync(...args),
  isAvailableAsync: (...args: unknown[]) => mockIsAvailableAsync(...args),
}));

import { attemptScreenMask, handleAppStateChangeForReapply, useScreenMask, __resetScreenMaskForTests } from '../screenMask';

describe('attemptScreenMask', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    __resetScreenMaskForTests();
    mockPreventScreenCaptureAsync.mockReset().mockResolvedValue(undefined);
    mockEnableAppSwitcherProtectionAsync.mockReset().mockResolvedValue(undefined);
    mockIsAvailableAsync.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('reports success on iOS when every step resolves', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: true });
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(mockEnableAppSwitcherProtectionAsync).toHaveBeenCalledWith(0.99);
  });

  it('reports success on Android without calling the iOS-only app switcher API', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: true });
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(mockEnableAppSwitcherProtectionAsync).not.toHaveBeenCalled();
  });

  it('reports failure with a reason when isAvailableAsync resolves false', async () => {
    mockIsAvailableAsync.mockResolvedValue(false);
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: false, reason: 'not available on this device' });
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it('reports failure with a reason when isAvailableAsync itself rejects', async () => {
    mockIsAvailableAsync.mockRejectedValue(new Error('boom'));
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: false, reason: 'support could not be checked on this device' });
  });

  it('reports failure with a reason when preventScreenCaptureAsync rejects', async () => {
    mockPreventScreenCaptureAsync.mockRejectedValue(new Error('boom'));
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: false, reason: 'could not block screenshots and screen recording' });
  });

  it('reports failure with a reason when enableAppSwitcherProtectionAsync rejects (iOS only)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    mockEnableAppSwitcherProtectionAsync.mockRejectedValue(new Error('boom'));
    const result = await attemptScreenMask();
    expect(result).toEqual({ active: false, reason: 'could not blur the app switcher preview' });
  });

  it('memoizes: a second call never invokes the native functions again, even after a failure', async () => {
    mockPreventScreenCaptureAsync.mockRejectedValue(new Error('boom'));
    const first = await attemptScreenMask();
    const second = await attemptScreenMask();
    expect(first).toEqual(second);
    expect(mockIsAvailableAsync).toHaveBeenCalledTimes(1);
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh attempt after __resetScreenMaskForTests', async () => {
    mockPreventScreenCaptureAsync.mockRejectedValueOnce(new Error('boom'));
    const first = await attemptScreenMask();
    expect(first).toEqual({ active: false, reason: 'could not block screenshots and screen recording' });

    __resetScreenMaskForTests();
    mockPreventScreenCaptureAsync.mockResolvedValueOnce(undefined);
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const second = await attemptScreenMask();
    expect(second).toEqual({ active: true });
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(2);
  });
});

describe('handleAppStateChangeForReapply', () => {
  beforeEach(() => {
    mockPreventScreenCaptureAsync.mockReset().mockResolvedValue(undefined);
  });

  it('ignores every AppState status other than active', () => {
    for (const status of ['background', 'inactive', 'unknown', 'extension'] as const) {
      handleAppStateChangeForReapply(status);
    }
    expect(mockPreventScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it('reapplies with a fresh key each time active fires, never reusing one', () => {
    handleAppStateChangeForReapply('active');
    handleAppStateChangeForReapply('active');
    expect(mockPreventScreenCaptureAsync).toHaveBeenCalledTimes(2);
    const [firstKey] = mockPreventScreenCaptureAsync.mock.calls[0];
    const [secondKey] = mockPreventScreenCaptureAsync.mock.calls[1];
    expect(firstKey).toMatch(/^screen-mask-reapply-/);
    expect(secondKey).toMatch(/^screen-mask-reapply-/);
    // Not the SDK's 'default' key — reusing that is exactly what makes a
    // failed attempt silently short-circuit to success on retry (see this
    // file's doc comment / attemptScreenMask's memoization).
    expect(firstKey).not.toBe('default');
  });
});

describe('useScreenMask', () => {
  const originalOS = Platform.OS;

  function TestHost({ ready }: { ready: boolean }) {
    useScreenMask(ready);
    return null;
  }

  beforeEach(() => {
    __resetScreenMaskForTests();
    mockPreventScreenCaptureAsync.mockReset().mockResolvedValue(undefined);
    mockEnableAppSwitcherProtectionAsync.mockReset().mockResolvedValue(undefined);
    mockIsAvailableAsync.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('does nothing until ready is true', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost, { ready: false }));
    });
    expect(mockIsAvailableAsync).not.toHaveBeenCalled();
    act(() => {
      renderer.unmount();
    });
  });

  it('on Android, subscribes to AppState and unsubscribes on unmount', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const addSpy = jest.spyOn(AppState, 'addEventListener');
    const removeSpy = jest.fn();
    addSpy.mockReturnValue({ remove: removeSpy } as ReturnType<typeof AppState.addEventListener>);

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost, { ready: true }));
    });
    expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));

    act(() => {
      renderer.unmount();
    });
    expect(removeSpy).toHaveBeenCalledTimes(1);
    addSpy.mockRestore();
  });

  it('on iOS, never subscribes to AppState — reapplying there is harmful, not just unnecessary (see file doc comment)', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
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
