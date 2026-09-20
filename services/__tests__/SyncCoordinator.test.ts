/**
 * 基本設計 v0.11 §9.12 の mutex そのもの（DB非依存）を検証する。
 * SyncWorker/破壊的操作と組み合わせた end-to-end の検証は
 * `test/__tests__/syncCoordinator.integration.test.ts` 側。
 */
import {
  isSuspended,
  suspend,
  resume,
  trackExternalCall,
  runExclusive,
  __resetSyncCoordinatorForTests,
} from '../SyncCoordinator';

beforeEach(() => {
  __resetSyncCoordinatorForTests();
});

describe('isSuspended / suspend / resume', () => {
  it('starts out not suspended', () => {
    expect(isSuspended()).toBe(false);
  });

  it('suspend() sets isSuspended() to true; resume() clears it', async () => {
    await suspend();
    expect(isSuspended()).toBe(true);
    resume();
    expect(isSuspended()).toBe(false);
  });

  it('suspend() resolves immediately when nothing is in-flight', async () => {
    await expect(suspend()).resolves.toBeUndefined();
  });
});

describe('suspend() waiting for an in-flight external call (§17.3 I12/I13/I20)', () => {
  it('does not resolve until the tracked external call settles (successfully)', async () => {
    let resolveCall!: () => void;
    const callPromise = new Promise<void>((resolve) => {
      resolveCall = resolve;
    });
    const tracked = trackExternalCall(() => callPromise);

    let suspendResolved = false;
    const suspendPromise = suspend().then(() => {
      suspendResolved = true;
    });

    await Promise.resolve(); // let microtasks settle
    expect(suspendResolved).toBe(false); // I20: must not return to normal while unsettled

    resolveCall();
    await tracked;
    await suspendPromise;
    expect(suspendResolved).toBe(true);
  });

  it('does not resolve until the tracked external call settles (rejection) — suspend() does not throw', async () => {
    let rejectCall!: (error: Error) => void;
    const callPromise = new Promise<void>((_resolve, reject) => {
      rejectCall = reject;
    });
    const tracked = trackExternalCall(() => callPromise).catch(() => {});

    let suspendResolved = false;
    const suspendPromise = suspend().then(() => {
      suspendResolved = true;
    });

    await Promise.resolve();
    expect(suspendResolved).toBe(false);

    rejectCall(new Error('boom'));
    await tracked;
    await suspendPromise; // must not reject just because the tracked call rejected
    expect(suspendResolved).toBe(true);
  });

  it('isSuspended() is already true the instant suspend() is called, before it resolves (I14: no new claim in the gap)', () => {
    const tracked = trackExternalCall(() => new Promise(() => {})); // never settles
    void suspend(); // deliberately not awaited
    expect(isSuspended()).toBe(true);
    void tracked; // keep referenced; this call is intentionally left hanging for the test
  });

  it('a second external call started after suspend() was called is irrelevant to that suspend() — it only waits for what was in-flight at call time', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const trackedFirst = trackExternalCall(() => first);

    const suspendPromise = suspend();
    resolveFirst();
    await trackedFirst;
    await suspendPromise; // resolves once the *first* call settles — no second call was registered
    expect(isSuspended()).toBe(true);
  });
});

describe('runExclusive', () => {
  it('suspends, runs the operation, then resumes — in that order', async () => {
    const order: string[] = [];
    const result = await runExclusive(async () => {
      order.push(isSuspended() ? 'operation (suspended)' : 'operation (NOT suspended — bug)');
      return 'ok';
    });
    order.push(isSuspended() ? 'after (still suspended — bug)' : 'after (resumed)');

    expect(result).toBe('ok');
    expect(order).toEqual(['operation (suspended)', 'after (resumed)']);
  });

  it('still resumes even if the operation throws (I21-adjacent: never leaves the worker stuck suspended after a failed destructive op)', async () => {
    await expect(
      runExclusive(async () => {
        throw new Error('destructive operation failed');
      }),
    ).rejects.toThrow('destructive operation failed');

    expect(isSuspended()).toBe(false);
  });

  it('waits for an in-flight external call before running the operation', async () => {
    let resolveCall!: () => void;
    const callPromise = new Promise<void>((resolve) => {
      resolveCall = resolve;
    });
    const tracked = trackExternalCall(() => callPromise);

    let operationRan = false;
    const exclusive = runExclusive(async () => {
      operationRan = true;
    });

    await Promise.resolve();
    expect(operationRan).toBe(false); // must wait for the in-flight call first

    resolveCall();
    await tracked;
    await exclusive;
    expect(operationRan).toBe(true);
  });
});
