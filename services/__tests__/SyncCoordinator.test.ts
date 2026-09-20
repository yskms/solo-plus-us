/**
 * 基本設計 v0.11 §9.12 の mutex そのもの（DB非依存）を検証する。
 * SyncWorker/破壊的操作と組み合わせた end-to-end の検証は
 * `test/__tests__/syncCoordinator.integration.test.ts` 側。
 *
 * `suspend`/`resume` は本番コードから直接呼ばれないよう export していない
 * （`runExclusive` 経由のみ、§9.12/SyncCoordinator.ts のコメント参照）。
 * ここでの単体テストは `__testHooks` 経由でこの2つの性質を個別に検証する。
 */
import { isSuspended, trackExternalCall, runExclusive, __resetSyncCoordinatorForTests, __testHooks } from '../SyncCoordinator';

beforeEach(() => {
  __resetSyncCoordinatorForTests();
});

describe('isSuspended / __testHooks.suspend / __testHooks.resume', () => {
  it('starts out not suspended', () => {
    expect(isSuspended()).toBe(false);
  });

  it('suspend() sets isSuspended() to true; resume() clears it', async () => {
    await __testHooks.suspend();
    expect(isSuspended()).toBe(true);
    __testHooks.resume();
    expect(isSuspended()).toBe(false);
  });

  it('suspend() resolves immediately when nothing is in-flight', async () => {
    await expect(__testHooks.suspend()).resolves.toBeUndefined();
  });
});

describe('suspend() waiting for in-flight external calls (§17.3 I12/I13/I20)', () => {
  it('does not resolve until the tracked external call settles (successfully)', async () => {
    let resolveCall!: () => void;
    const callPromise = new Promise<void>((resolve) => {
      resolveCall = resolve;
    });
    const tracked = trackExternalCall(() => callPromise);

    let suspendResolved = false;
    const suspendPromise = __testHooks.suspend().then(() => {
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
    const suspendPromise = __testHooks.suspend().then(() => {
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
    void __testHooks.suspend(); // deliberately not awaited
    expect(isSuspended()).toBe(true);
    void tracked; // keep referenced; this call is intentionally left hanging for the test
  });

  it('waits for ALL currently in-flight calls, not just the first one registered (multiple concurrent trackExternalCall)', async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const first = trackExternalCall(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const second = trackExternalCall(
      () =>
        new Promise<void>((resolve) => {
          resolveSecond = resolve;
        }),
    );

    let suspendResolved = false;
    const suspendPromise = __testHooks.suspend().then(() => {
      suspendResolved = true;
    });

    resolveFirst();
    await first;
    await Promise.resolve();
    expect(suspendResolved).toBe(false); // the second call is still in flight

    resolveSecond();
    await second;
    await suspendPromise;
    expect(suspendResolved).toBe(true);
  });

  it('a second external call started after suspend() was called is irrelevant to that suspend() — it only waits for what was in-flight at call time', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const trackedFirst = trackExternalCall(() => first);

    const suspendPromise = __testHooks.suspend();
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

  it('still resumes even if the operation throws (never leaves the worker stuck suspended after a failed destructive op)', async () => {
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

  describe('serialization (§9.12/D-46-style concurrency; 2回目のレビューで指摘)', () => {
    it('runs two concurrent runExclusive calls one at a time, never overlapping', async () => {
      const events: string[] = [];
      let resolveA!: () => void;
      let aStarted!: () => void;
      const aStartedPromise = new Promise<void>((resolve) => {
        aStarted = resolve;
      });
      const a = runExclusive(async () => {
        events.push('A start');
        aStarted();
        await new Promise<void>((resolve) => {
          resolveA = resolve;
        });
        events.push('A end');
      });
      const b = runExclusive(async () => {
        events.push('B start');
        events.push('B end');
      });

      await aStartedPromise; // wait for an actual signal, not a guessed microtask-tick count
      expect(events).toEqual(['A start']); // B must not have started yet — A hasn't finished

      resolveA();
      await a;
      await b;

      expect(events).toEqual(['A start', 'A end', 'B start', 'B end']);
    });

    it("the earlier operation's resume() does not un-suspend the worker while the later, queued operation is running", async () => {
      let resolveA!: () => void;
      let aStarted!: () => void;
      const aStartedPromise = new Promise<void>((resolve) => {
        aStarted = resolve;
      });
      const a = runExclusive(() => {
        aStarted();
        return new Promise<void>((resolve) => {
          resolveA = resolve;
        });
      });
      const b = runExclusive(async () => {
        // By the time B's body runs, A has already finished and called its
        // own resume() — isSuspended() must still be true because B is now
        // the one holding the mutex.
        expect(isSuspended()).toBe(true);
      });

      await aStartedPromise;
      resolveA();
      await a;
      await b;
    });

    it('a later call still runs (and resumes normally) after an earlier one throws', async () => {
      const a = runExclusive(async () => {
        throw new Error('A failed');
      });
      let bRan = false;
      const b = runExclusive(async () => {
        bRan = true;
      });

      await expect(a).rejects.toThrow('A failed');
      await b;
      expect(bRan).toBe(true);
      expect(isSuspended()).toBe(false);
    });
  });
});
