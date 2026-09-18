/**
 * §18 画面マスク（設計判断記録 D-47）。`expo-screen-capture` はネイティブ
 * モジュールのため、実際の呼び出しは検証できない——ここで検証するのは
 * `attemptScreenMask()` 自身の分岐（`isAvailableAsync` の失敗・
 * `preventScreenCaptureAsync`/`enableAppSwitcherProtectionAsync` の失敗、
 * 成功時の結果、そしてメモ化）だけであり、モックした関数が実機で本当に
 * 同じ形で失敗するかは実機でしか確認できない。
 */
import { Platform } from 'react-native';

const mockPreventScreenCaptureAsync = jest.fn();
const mockEnableAppSwitcherProtectionAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: (...args: unknown[]) => mockPreventScreenCaptureAsync(...args),
  enableAppSwitcherProtectionAsync: (...args: unknown[]) => mockEnableAppSwitcherProtectionAsync(...args),
  isAvailableAsync: (...args: unknown[]) => mockIsAvailableAsync(...args),
}));

import { attemptScreenMask, __resetScreenMaskForTests } from '../screenMask';

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
