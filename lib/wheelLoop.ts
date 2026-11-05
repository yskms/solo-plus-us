/**
 * Index arithmetic for a wrap-around reel (`components/WheelColumn.tsx`'s
 * `loop` mode, used for hour and minute). Free of React so it can be
 * unit-tested.
 *
 * A looping reel is a plain `ScrollView` holding several identical copies of
 * its rows one after another. The reel always rests on the *middle* copy:
 * whenever it settles on a row of another copy, it is moved (without
 * animation, so nobody sees it) to the same row of the middle copy. That is
 * what makes it feel endless while only ever rendering a few hundred rows.
 *
 * "logical" = the row's position in the list of values (0..n-1);
 * "physical" = the row's position in the repeated list (0..copies*n-1).
 */

/** At least this many rows are rendered, so a hard fling can't reach the end of the list. */
const MIN_LOOP_ROWS = 120;

/** An odd number of copies (so one is in the middle), at least 3, enough for `MIN_LOOP_ROWS`. */
export function loopCopies(n: number): number {
  let copies = 3;
  while (copies * n < MIN_LOOP_ROWS) copies += 2;
  return copies;
}

/** Physical index of the first row of the middle copy. */
export function loopHomeStart(n: number): number {
  return Math.floor(loopCopies(n) / 2) * n;
}

/** Position within the list of values (always 0..n-1, also for negative input). */
export function wrapIndex(physical: number, n: number): number {
  return ((physical % n) + n) % n;
}

/** Physical index of the same row in the middle copy. */
export function homeIndex(physical: number, n: number): number {
  return loopHomeStart(n) + wrapIndex(physical, n);
}

/** Signed number of rows from logical `from` to logical `to` by the shorter way round (a tie goes forward). */
export function shortestLoopDelta(from: number, to: number, n: number): number {
  const forward = wrapIndex(to - from, n);
  return forward > n / 2 ? forward - n : forward;
}
