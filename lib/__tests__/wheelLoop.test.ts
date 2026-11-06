import { homeIndex, loopCopies, loopHomeStart, wrapIndex } from '../wheelLoop';

describe('loopCopies', () => {
  it('is odd, at least 3, and renders enough rows to survive a hard fling', () => {
    for (const n of [12, 24, 31, 60]) {
      const copies = loopCopies(n);
      expect(copies % 2).toBe(1);
      expect(copies).toBeGreaterThanOrEqual(3);
      expect(copies * n).toBeGreaterThanOrEqual(120);
    }
  });

  it('month (12), day (31), hour (24) and minute (60) sizes', () => {
    expect(loopCopies(12)).toBe(11);
    expect(loopCopies(31)).toBe(5);
    expect(loopCopies(24)).toBe(5);
    expect(loopCopies(60)).toBe(3);
  });
});

describe('loopHomeStart', () => {
  it('is the first row of the middle copy', () => {
    expect(loopHomeStart(24)).toBe(48); // copies 0,1 | 2 | 3,4
    expect(loopHomeStart(60)).toBe(60); // copy 0 | 1 | 2
    expect(loopHomeStart(31)).toBe(62); // copies 0,1 | 2 | 3,4
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
