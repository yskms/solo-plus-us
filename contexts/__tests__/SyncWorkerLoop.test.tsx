/**
 * 基本設計 v0.11 §9.5.4 — AppState 配線（`useSyncWorkerLoop`）の検証。
 * `services/SyncWorker` 自体の claim/finalize ロジックは
 * `test/__tests__/syncWorker.integration.test.ts` 等で検証済みなので、
 * ここでは「いつ `drainDueJobs` を呼ぶか」の配線（マウント時・AppState
 * 遷移・revision 変化・周期実行・unmount 時のクリーンアップ）に絞る。
 * `lib/__tests__/screenMask.ts` の `useScreenMask` テストと同じ構造。
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';

const mockUseDatabase = jest.fn();
const mockUseDataRevision = jest.fn();
const mockDrainDueJobs = jest.fn();

jest.mock('../DatabaseContext', () => ({
  useDatabase: () => mockUseDatabase(),
}));
jest.mock('../DataRevision', () => ({
  useDataRevision: () => mockUseDataRevision(),
}));
jest.mock('../../services/SyncWorker', () => ({
  drainDueJobs: (...args: unknown[]) => mockDrainDueJobs(...args),
}));

import { useSyncWorkerLoop, shouldTriggerDrainOnAppStateChange } from '../SyncWorkerLoop';

const FAKE_DB = { fake: 'db' };

function setAppState(status: AppStateStatus) {
  Object.defineProperty(AppState, 'currentState', { value: status, configurable: true });
}

function TestHost({ tick }: { tick?: number }) {
  void tick; // present only so a re-render can be forced from the test without changing hook behavior
  useSyncWorkerLoop();
  return null;
}

describe('shouldTriggerDrainOnAppStateChange', () => {
  it('is true only for a transition INTO active', () => {
    expect(shouldTriggerDrainOnAppStateChange('background', 'active')).toBe(true);
    expect(shouldTriggerDrainOnAppStateChange('inactive', 'active')).toBe(true);
  });

  it('is false when already active, or moving to a non-active status', () => {
    expect(shouldTriggerDrainOnAppStateChange('active', 'active')).toBe(false);
    expect(shouldTriggerDrainOnAppStateChange('active', 'background')).toBe(false);
    expect(shouldTriggerDrainOnAppStateChange('background', 'inactive')).toBe(false);
  });
});

describe('useSyncWorkerLoop', () => {
  const originalAppState = AppState.currentState;

  beforeEach(() => {
    jest.useFakeTimers();
    mockUseDatabase.mockReturnValue(FAKE_DB);
    mockUseDataRevision.mockReturnValue({ revision: 0, bump: jest.fn() });
    mockDrainDueJobs.mockReset().mockResolvedValue({ processedCount: 0, stoppedReason: 'drained' });
  });

  afterEach(() => {
    jest.useRealTimers();
    setAppState(originalAppState);
  });

  it('drains once on mount when the app is already active', () => {
    setAppState('active');
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost));
    });

    expect(mockDrainDueJobs).toHaveBeenCalledTimes(1);
    expect(mockDrainDueJobs).toHaveBeenCalledWith(FAKE_DB, 'health_connect', { shouldContinue: expect.any(Function) });

    act(() => {
      renderer.unmount();
    });
  });

  it('does not drain on mount when the app is backgrounded', () => {
    setAppState('background');
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost));
    });

    expect(mockDrainDueJobs).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  it('drains again on a background→active transition, but not on active→background', () => {
    setAppState('background');
    let renderer: ReturnType<typeof create>;
    let listener!: (status: AppStateStatus) => void;
    const addSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      listener = handler as (status: AppStateStatus) => void;
      return { remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>;
    });

    act(() => {
      renderer = create(React.createElement(TestHost));
    });
    expect(mockDrainDueJobs).not.toHaveBeenCalled(); // backgrounded at mount

    act(() => {
      listener('active');
    });
    expect(mockDrainDueJobs).toHaveBeenCalledTimes(1);

    act(() => {
      listener('background');
    });
    expect(mockDrainDueJobs).toHaveBeenCalledTimes(1); // unchanged — active→background doesn't trigger a new drain

    act(() => {
      renderer.unmount();
    });
    addSpy.mockRestore();
  });

  it("shouldContinue passed to drainDueJobs reflects the current AppState — false once backgrounded", async () => {
    setAppState('active');
    let listener!: (status: AppStateStatus) => void;
    const addSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      listener = handler as (status: AppStateStatus) => void;
      return { remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>;
    });

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost));
    });

    const { shouldContinue } = mockDrainDueJobs.mock.calls[0][2];
    expect(shouldContinue()).toBe(true);

    act(() => {
      listener('background');
    });
    expect(shouldContinue()).toBe(false); // §9.5.4: an in-flight cycle checks this on its next loop iteration

    act(() => {
      renderer.unmount();
    });
    addSpy.mockRestore();
  });

  it('subscribes to AppState on mount and unsubscribes on unmount', () => {
    setAppState('active');
    const removeSpy = jest.fn();
    const addSpy = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: removeSpy } as ReturnType<
      typeof AppState.addEventListener
    >);

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost));
    });
    expect(addSpy).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.unmount();
    });
    expect(removeSpy).toHaveBeenCalledTimes(1);
    addSpy.mockRestore();
  });

  it('drains again on a DataRevision bump (e.g. after recording/editing/deleting an Activity)', () => {
    setAppState('active');
    const addSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>);

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost, { tick: 0 }));
    });
    expect(mockDrainDueJobs).toHaveBeenCalledTimes(1); // initial mount drain

    mockUseDataRevision.mockReturnValue({ revision: 1, bump: jest.fn() });
    act(() => {
      renderer.update(React.createElement(TestHost, { tick: 1 }));
    });
    expect(mockDrainDueJobs).toHaveBeenCalledTimes(2);

    act(() => {
      renderer.unmount();
    });
    addSpy.mockRestore();
  });

  it('drains periodically while mounted, and stops once unmounted', () => {
    setAppState('active');
    const addSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>);

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(TestHost));
    });
    expect(mockDrainDueJobs).toHaveBeenCalledTimes(1); // initial mount drain

    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(mockDrainDueJobs).toHaveBeenCalledTimes(2);

    act(() => {
      renderer.unmount();
    });
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockDrainDueJobs).toHaveBeenCalledTimes(2); // no further calls after unmount
    addSpy.mockRestore();
  });

  it('logs but does not throw when drainDueJobs rejects', async () => {
    setAppState('active');
    const addSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>);
    mockDrainDueJobs.mockRejectedValue(new Error('boom'));

    let renderer: ReturnType<typeof create>;
    expect(() => {
      act(() => {
        renderer = create(React.createElement(TestHost));
      });
    }).not.toThrow();

    // Let the rejected promise's .catch() handler run.
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      renderer.unmount();
    });
    addSpy.mockRestore();
  });
});
