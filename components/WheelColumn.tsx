/**
 * One scrolling "reel" column of `components/DateTimeWheel.tsx`: a
 * `ScrollView` that snaps to rows, with the selected row in the middle and
 * only `WHEEL_PEEK` of the rows above and below showing, just enough to
 * read as a reel that can be turned. Plain JS (no native picker), so it
 * sits inside the screen's own view tree like any other content.
 *
 * Controlled: `selectedValue` is the source of truth. A scroll that settles
 * on a row calls `onSelect`; if the parent then picks a different value
 * (the clock moving the minute, or "Use now instead"), the column scrolls
 * to it. `scrollIndexRef` is where the column is *physically*
 * scrolled to, which is what the sync effect compares `selectedIndex`
 * against; `syncTick` re-runs that comparison after every settle.
 *
 * `loop` makes the reel endless (23 above 0): the rows are repeated and the
 * reel always rests on the middle copy, see `lib/wheelLoop.ts`. After a
 * settle on another copy it jumps to the same row of the middle copy
 * *without animation* (the rows are identical, so nothing visible happens).
 * Don't animate that jump.
 *
 * Never scroll a reel programmatically with `animated: true` (every
 * `scrollTo` here is instant). On Android an animated `scrollTo` makes the
 * ScrollView report "scroll ended" (also when it is restarted or interrupted),
 * and reacting to that with another correction starts it again, forever: on a
 * Pixel 3 the reel re-issued the same `scrollTo` every 50 ms and crept 0.3 px
 * per round, and in other runs swung between two rows for seconds, each round
 * re-rendering the whole screen (it froze). An instant `scrollTo` onto a row's
 * exact position is a fixed point: the next "ended" event finds the reel
 * already on the row and does nothing.
 *
 * iOS snaps natively (`snapToInterval`). Android doesn't: `settleAt` moves a
 * reel that stopped between rows (a slow release) onto the nearest one, so
 * there is only one thing that scrolls a reel at rest. Whether Android's own
 * snap had a part in the swinging was not separated out; keep it off.
 *
 * The rows are `React.memo`'d on purpose: every settle re-renders the whole
 * screen, and with a few hundred rows (looping reels repeat theirs) that
 * used to be the cost of each turn. Keep the props of `WheelRow` primitive.
 *
 * Accessibility: the column is one `adjustable` element (swipe up/down or
 * volume keys to step) rather than 24-60 separately focusable rows.
 */
import React, { memo, useCallback, useEffect, useReducer, useRef } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../constants/theme';
import { homeIndex, loopCopies, loopHomeStart, wrapIndex } from '../lib/wheelLoop';

export const WHEEL_ITEM_HEIGHT = 34;
/** How much of the neighbouring rows shows above and below the selected one. */
export const WHEEL_PEEK = 16;
// iOS reports the release velocity in `onScrollEndDrag`; below this the list
// isn't going to coast, so no `onMomentumScrollEnd` can be relied on to follow.
const STILL_VELOCITY = 0.05;
// Only iOS snaps natively; see the file comment.
const NATIVE_SNAP = Platform.OS === 'ios';

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
  // The scroll offset of the last "ended" event `settleAt` acted on; reset by a
  // new drag. Skipping a repeat of the same offset is only right while the
  // reel is moved by nothing but a drag (and our own instant corrections,
  // which end on a row's exact offset): if another path ever scrolls the reel
  // and ends up reporting an offset it had before, clear this there too.
  const handledYRef = useRef<number | null>(null);
  const [syncTick, bumpSyncTick] = useReducer((count: number) => count + 1, 0);

  // Instant, on purpose: see the file comment.
  const scrollToRow = (row: number) => {
    scrollRef.current?.scrollTo({ y: row * WHEEL_ITEM_HEIGHT, animated: false });
  };

  // The parent picked a value the reel isn't on (the clock moving the minute,
  // "Use now instead"): put the reel on that row of the middle copy.
  useEffect(() => {
    const target = homeStart + selectedIndex;
    if (scrollIndexRef.current === target) return;
    scrollIndexRef.current = target;
    scrollToRow(target);
  }, [selectedIndex, syncTick, loop, n, homeStart]);

  const commit = (row: number) => {
    const clamped = Math.min(Math.max(row, 0), copies * n - 1);
    scrollIndexRef.current = clamped;
    onSelect(items[wrapIndex(clamped, n)].value);
    bumpSyncTick();
  };

  // `fromDragEnd`: called when the finger lifted with no speed, not when the scroll stopped.
  const settleAt = (event: NativeSyntheticEvent<NativeScrollEvent>, fromDragEnd = false) => {
    const y = event.nativeEvent.contentOffset.y;
    const row = Math.round(y / WHEEL_ITEM_HEIGHT);
    // How far the reel stopped from the exact position of its nearest row. On
    // Android nothing snaps it (see the file comment), and a slow release
    // between rows leaves the text off-center from the band.
    const offCenter = Math.abs(y - row * WHEEL_ITEM_HEIGHT) > 1;
    // iOS snaps a reel released between rows by itself and reports the stop
    // afterwards: leave that to it rather than scrolling against its animation.
    if (fromDragEnd && NATIVE_SNAP && offCenter) return;
    const home = loop ? homeIndex(row, n) : row;
    // The end of a scroll is reported more than once, some of them late, with
    // the offset from before our correction. The same offset as the last one we
    // handled (and not a new drag since): already dealt with.
    if (handledYRef.current !== null && Math.abs(y - handledYRef.current) < 0.01) return;
    // Already exactly on the row we last committed: nothing to do.
    if (!offCenter && home === row && row === scrollIndexRef.current) return;
    handledYRef.current = y;
    // Onto the nearest row (exactly) of the middle copy, in one instant step;
    // for a looping reel that is also the jump back from another copy.
    if (home !== row || offCenter) scrollToRow(home);
    commit(home);
  };

  const goTo = (row: number) => {
    const clamped = Math.min(Math.max(row, 0), copies * n - 1);
    const home = loop ? homeIndex(clamped, n) : clamped;
    scrollToRow(home);
    commit(home);
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
        snapToInterval={NATIVE_SNAP ? WHEEL_ITEM_HEIGHT : undefined}
        decelerationRate="fast"
        nestedScrollEnabled
        onContentSizeChange={() => {
          // The very first layout: start on the selected row (no animation).
          if (didInitialScrollRef.current) return;
          didInitialScrollRef.current = true;
          scrollIndexRef.current = homeStart + selectedIndex;
          scrollToRow(homeStart + selectedIndex);
        }}
        onScrollBeginDrag={() => {
          handledYRef.current = null;
        }}
        onMomentumScrollEnd={(event) => settleAt(event)}
        onScrollEndDrag={(event) => {
          const velocity = event.nativeEvent.velocity?.y;
          if (velocity !== undefined && Math.abs(velocity) < STILL_VELOCITY) settleAt(event, true);
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
