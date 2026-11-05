/**
 * One scrolling "reel" column of `components/DateTimeWheel.tsx`: a
 * `ScrollView` that snaps to rows, with the selected row in the middle and
 * only `WHEEL_PEEK` of the rows above and below showing, just enough to
 * read as a reel that can be turned. Plain JS (no native picker), so it
 * sits inside the screen's own view tree like any other content.
 *
 * Controlled: `selectedValue` is the source of truth. A scroll that settles
 * on a row calls `onSelect`; if the parent then picks a different value
 * (a day shortened by a shorter month, or the clock moving the minute), the
 * column scrolls to it. `scrollIndexRef` is where the column is *physically*
 * scrolled to, which is what the sync effect compares `selectedIndex`
 * against; `syncTick` re-runs that comparison after every settle.
 *
 * `loop` makes the reel endless (23 above 0): the rows are repeated and the
 * reel always rests on the middle copy, see `lib/wheelLoop.ts`. After a
 * settle on another copy it jumps to the same row of the middle copy
 * *without animation* (the rows are identical, so nothing visible happens).
 * Don't animate that jump.
 *
 * The rows are `React.memo`'d on purpose: every settle re-renders the whole
 * screen, and with a few hundred rows (looping reels repeat theirs) that
 * used to be the cost of each turn. Keep the props of `WheelRow` primitive.
 *
 * Accessibility: the column is one `adjustable` element (swipe up/down or
 * volume keys to step) rather than 24-60 separately focusable rows.
 */
import React, { memo, useCallback, useEffect, useReducer, useRef } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/theme';
import { homeIndex, loopCopies, loopHomeStart, shortestLoopDelta, wrapIndex } from '../lib/wheelLoop';

export const WHEEL_ITEM_HEIGHT = 34;
/** How much of the neighbouring rows shows above and below the selected one. */
export const WHEEL_PEEK = 16;
// iOS reports the release velocity in `onScrollEndDrag`; below this the list
// isn't going to coast, so no `onMomentumScrollEnd` can be relied on to follow.
const STILL_VELOCITY = 0.05;

export interface WheelItem {
  value: number;
  label: string;
}

interface WheelColumnProps {
  items: WheelItem[];
  selectedValue: number;
  onSelect: (value: number) => void;
  /** Spoken by screen readers ("Year", "Hour"…) */
  label: string;
  /** Relative width in the row of columns */
  flex?: number;
  /** Endless reel: the first row follows the last one and vice versa. */
  loop?: boolean;
}

interface WheelRowProps {
  row: number;
  label: string;
  selected: boolean;
  selectedColor: string;
  color: string;
  onPressRow: (row: number) => void;
}

const WheelRow = memo(function WheelRow({ row, label, selected, selectedColor, color, onPressRow }: WheelRowProps) {
  return (
    <Pressable
      style={styles.row}
      onPress={() => onPressRow(row)}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Text style={[styles.text, selected ? { color: selectedColor, fontWeight: '700' } : { color }]}>{label}</Text>
    </Pressable>
  );
});

export function WheelColumn({ items, selectedValue, onSelect, label, flex = 1, loop = false }: WheelColumnProps) {
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const n = items.length;
  const copies = loop ? loopCopies(n) : 1;
  // Physical index of logical row 0 in the copy the reel rests on.
  const homeStart = loop ? loopHomeStart(n) : 0;
  const found = items.findIndex((item) => item.value === selectedValue);
  const selectedIndex = found < 0 ? 0 : found; // logical
  const scrollIndexRef = useRef(homeStart + selectedIndex); // physical
  const didInitialScrollRef = useRef(false);
  const [syncTick, bumpSyncTick] = useReducer((count: number) => count + 1, 0);

  const scrollToRow = (row: number, animated: boolean) => {
    scrollRef.current?.scrollTo({ y: row * WHEEL_ITEM_HEIGHT, animated });
  };

  useEffect(() => {
    const current = scrollIndexRef.current;
    if (!loop) {
      if (current === selectedIndex) return;
      scrollIndexRef.current = selectedIndex;
      scrollToRow(selectedIndex, true);
      return;
    }
    const currentLogical = wrapIndex(current, n);
    if (currentLogical === selectedIndex) return;
    // Park on the middle copy first (invisible), then take the shorter way round.
    const parked = homeStart + currentLogical;
    if (parked !== current) scrollToRow(parked, false);
    const target = parked + shortestLoopDelta(currentLogical, selectedIndex, n);
    scrollIndexRef.current = target;
    scrollToRow(target, true);
  }, [selectedIndex, syncTick, loop, n, homeStart]);

  const commit = (row: number) => {
    const clamped = Math.min(Math.max(row, 0), copies * n - 1);
    scrollIndexRef.current = clamped;
    onSelect(items[wrapIndex(clamped, n)].value);
    bumpSyncTick();
  };

  const settleAt = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const row = Math.round(y / WHEEL_ITEM_HEIGHT);
    // A slow drag released between rows can stop where `snapToInterval` never
    // pulled it (seen on Android), leaving the text off-center from the band.
    const offCenter = Math.abs(y - row * WHEEL_ITEM_HEIGHT) > 1;
    if (loop) {
      const home = homeIndex(row, n);
      if (home !== row) scrollToRow(home, false);
      else if (offCenter) scrollToRow(row, true);
      commit(home);
      return;
    }
    if (offCenter) scrollToRow(row, true);
    commit(row);
  };

  const goTo = (row: number) => {
    const clamped = Math.min(Math.max(row, 0), copies * n - 1);
    scrollToRow(clamped, true);
    commit(clamped);
  };

  // `WheelRow` is memoized, so it gets one stable callback that reads the latest `goTo`.
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  const onPressRow = useCallback((row: number) => goToRef.current(row), []);

  // The row the reel is scrolled to: for a looping reel that may be on another copy.
  const currentRow = () => (loop ? scrollIndexRef.current : selectedIndex);

  return (
    <View
      style={[styles.column, { flex }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: items[selectedIndex]?.label }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') goTo(currentRow() + 1);
        else if (event.nativeEvent.actionName === 'decrement') goTo(currentRow() - 1);
      }}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{ paddingVertical: WHEEL_PEEK }}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        onContentSizeChange={() => {
          // The very first layout: start on the selected row (no animation).
          if (didInitialScrollRef.current) return;
          didInitialScrollRef.current = true;
          scrollIndexRef.current = homeStart + selectedIndex;
          scrollToRow(homeStart + selectedIndex, false);
        }}
        onMomentumScrollEnd={settleAt}
        onScrollEndDrag={(event) => {
          const velocity = event.nativeEvent.velocity?.y;
          if (velocity !== undefined && Math.abs(velocity) < STILL_VELOCITY) settleAt(event);
        }}
      >
        {Array.from({ length: copies * n }, (_, row) => (
          <WheelRow
            key={row}
            row={row}
            label={items[row % n].label}
            selected={row % n === selectedIndex}
            selectedColor={colors.textPrimary}
            color={colors.textSecondary}
            onPressRow={onPressRow}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { height: WHEEL_ITEM_HEIGHT + 2 * WHEEL_PEEK },
  scroll: { flex: 1 },
  row: { height: WHEEL_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 18, fontVariant: ['tabular-nums'] },
});
