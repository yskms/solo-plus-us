/**
 * One scrolling "reel" column of `components/DateTimeWheel.tsx`: a
 * `ScrollView` that snaps to rows, with the selected row in the middle of
 * `WHEEL_VISIBLE_ROWS`. Plain JS (no native picker), so it sits inside the
 * screen's own view tree like any other content.
 *
 * Controlled: `selectedValue` is the source of truth. A scroll that settles
 * on a row calls `onSelect`; if the parent then picks a different value
 * (clamped to "not in the future", or a day shortened by a shorter month),
 * the column scrolls to it. `scrollIndexRef` is where the column is
 * *physically* scrolled to, which is what the sync effect compares
 * `selectedIndex` against; `syncTick` re-runs that comparison after every
 * settle, because a clamp can leave `selectedIndex` unchanged while the
 * user has scrolled away from it.
 *
 * Accessibility: the column is one `adjustable` element (swipe up/down or
 * volume keys to step) rather than 24-60 separately focusable rows.
 */
import React, { useEffect, useReducer, useRef } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/theme';

export const WHEEL_ITEM_HEIGHT = 36;
export const WHEEL_VISIBLE_ROWS = 5;
const PADDING = WHEEL_ITEM_HEIGHT * Math.floor(WHEEL_VISIBLE_ROWS / 2);
// iOS reports the release velocity in `onScrollEndDrag`; below this the list
// isn't going to coast, so no `onMomentumScrollEnd` can be relied on to follow.
const STILL_VELOCITY = 0.05;

export interface WheelItem {
  value: number;
  label: string;
  /** false = shown dimmed (choosing it would just snap back, e.g. a future time) */
  selectable: boolean;
}

interface WheelColumnProps {
  items: WheelItem[];
  selectedValue: number;
  onSelect: (value: number) => void;
  /** Spoken by screen readers ("Year", "Hour"…) */
  label: string;
  /** Relative width in the row of columns */
  flex?: number;
}

export function WheelColumn({ items, selectedValue, onSelect, label, flex = 1 }: WheelColumnProps) {
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const found = items.findIndex((item) => item.value === selectedValue);
  const selectedIndex = found < 0 ? 0 : found;
  const scrollIndexRef = useRef(selectedIndex);
  const didInitialScrollRef = useRef(false);
  const [syncTick, bumpSyncTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (scrollIndexRef.current === selectedIndex) return;
    scrollIndexRef.current = selectedIndex;
    scrollRef.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_HEIGHT, animated: true });
  }, [selectedIndex, syncTick]);

  const commit = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), items.length - 1);
    scrollIndexRef.current = clamped;
    onSelect(items[clamped].value);
    bumpSyncTick();
  };

  const settleAt = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const index = Math.round(y / WHEEL_ITEM_HEIGHT);
    // A slow drag released between rows can stop where `snapToInterval` never
    // pulled it (seen on Android), leaving the text off-center from the band.
    if (Math.abs(y - index * WHEEL_ITEM_HEIGHT) > 1) {
      scrollRef.current?.scrollTo({ y: index * WHEEL_ITEM_HEIGHT, animated: true });
    }
    commit(index);
  };

  const goTo = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), items.length - 1);
    scrollRef.current?.scrollTo({ y: clamped * WHEEL_ITEM_HEIGHT, animated: true });
    commit(clamped);
  };

  return (
    <View
      style={[styles.column, { flex }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: items[selectedIndex]?.label }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') goTo(selectedIndex + 1);
        else if (event.nativeEvent.actionName === 'decrement') goTo(selectedIndex - 1);
      }}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{ paddingVertical: PADDING }}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        onContentSizeChange={() => {
          // The very first layout: start on the selected row (no animation).
          if (didInitialScrollRef.current) return;
          didInitialScrollRef.current = true;
          scrollRef.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_HEIGHT, animated: false });
        }}
        onMomentumScrollEnd={settleAt}
        onScrollEndDrag={(event) => {
          const velocity = event.nativeEvent.velocity?.y;
          if (velocity !== undefined && Math.abs(velocity) < STILL_VELOCITY) settleAt(event);
        }}
      >
        {items.map((item, index) => (
          <Pressable
            key={item.value}
            style={styles.row}
            onPress={() => goTo(index)}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            <Text
              style={[
                styles.text,
                index === selectedIndex
                  ? { color: colors.textPrimary, fontWeight: '700' }
                  : { color: colors.textSecondary },
                !item.selectable && styles.dimmed,
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ROWS },
  scroll: { flex: 1 },
  row: { height: WHEEL_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 18, fontVariant: ['tabular-nums'] },
  dimmed: { opacity: 0.3 },
});
