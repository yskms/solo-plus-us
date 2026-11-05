import { homeIndex, loopCopies, loopHomeStart, shortestLoopDelta, wrapIndex } from '../wheelLoop';

describe('loopCopies', () => {
  it('is odd, at least 3, and renders enough rows to survive a hard fling', () => {
    for (const n of [12, 24, 60]) {
      const copies = loopCopies(n);
      expect(copies % 2).toBe(1);
      expect(copies).toBeGreaterThanOrEqual(3);
      expect(copies * n).toBeGreaterThanOrEqual(120);
    }
  });

  it('hour (24) and minute (60) sizes', () => {
    expect(loopCopies(24)).toBe(5);
    expect(loopCopies(60)).toBe(3);
  });
});

describe('loopHomeStart', () => {
  it('is the first row of the middle copy', () => {
    expect(loopHomeStart(24)).toBe(48); // copies 0,1 | 2 | 3,4
    expect(loopHomeStart(60)).toBe(60); // copy 0 | 1 | 2
  });
});

describe('wrapIndex', () => {
  it('wraps both ways', () => {
    expect(wrapIndex(0, 24)).toBe(0);
    expect(wrapIndex(24, 24)).toBe(0);
    expect(wrapIndex(47, 24)).toBe(23);
    expect(wrapIndex(-1, 24)).toBe(23);
    expect(wrapIndex(-25, 24)).toBe(23);
  });
});

describe('homeIndex', () => {
  it('maps any copy onto the same row of the middle copy', () => {
    expect(homeIndex(3, 24)).toBe(48 + 3);
    expect(homeIndex(48 + 3, 24)).toBe(48 + 3);
    expect(homeIndex(119, 24)).toBe(48 + 23);
    expect(homeIndex(0, 60)).toBe(60);
    expect(homeIndex(179, 60)).toBe(60 + 59);
  });
});

describe('shortestLoopDelta', () => {
  it('goes across the seam when that is shorter (23 -> 0 is one row forward)', () => {
    expect(shortestLoopDelta(23, 0, 24)).toBe(1);
    expect(shortestLoopDelta(0, 23, 24)).toBe(-1);
    expect(shortestLoopDelta(58, 1, 60)).toBe(3);
  });

  it('goes straight when that is shorter', () => {
    expect(shortestLoopDelta(10, 12, 24)).toBe(2);
    expect(shortestLoopDelta(12, 10, 24)).toBe(-2);
  });

  it('is 0 for the same row, and a tie goes forward', () => {
    expect(shortestLoopDelta(5, 5, 24)).toBe(0);
    expect(shortestLoopDelta(0, 12, 24)).toBe(12);
  });
});
