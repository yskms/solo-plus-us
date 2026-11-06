/**
 * A tall list of choices that opens over the screen next to the number that
 * was tapped (`components/DateTimeSelector.tsx`): pick a row and it closes.
 *
 * It is a plain absolutely-positioned `View` that fills its parent, NOT React
 * Native's `<Modal>`. A native modal runs outside the view hierarchy that the
 * App Lock overlay covers, so a locked app would still show it (see
 * `contexts/AppLock.tsx`'s doc comment). Render it as a direct sibling of the
 * screen's main content, inside the screen's root container, not inside a
 * `ScrollView` or a view with `overflow: 'hidden'`.
 *
 * Nothing here snaps, corrects or re-scrolls a list: it is an ordinary
 * `ScrollView` that is put on the selected row once when it opens (instantly),
 * and a row is picked by tapping it. The scrolling wheels this replaces had
 * a correction after every scroll, which fought the finger and froze the
 * screen (D-57). Don't add one back.
 *
 * Accessibility: `accessibilityViewIsModal` keeps VoiceOver on the list; the
 * caller hides the content behind it from screen readers (Android has no
 * equivalent). The Android back button closes the list instead of the screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { minTouchTarget, radius, useTheme } from '../constants/theme';

/** A rectangle in window coordinates (what `measureInWindow` reports). */
export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OptionListItem {
  value: number;
  label: string;
}

interface OptionListPopoverProps {
  /** Where the tapped number is on the screen; the list opens around it. */
  anchor: WindowRect;
  items: OptionListItem[];
  selectedValue: number;
  /** Spoken by screen readers when the list opens ("Hour"…) */
  label: string;
  /** Spoken for the dim area behind the list, which closes it when tapped. */
  closeLabel: string;
  onSelect: (value: number) => void;
  onClose: () => void;
}

const ROW_HEIGHT = minTouchTarget;
// Space kept between the list and the edges of the safe area.
const EDGE_MARGIN = 12;
const LIST_PADDING = 4;
const MIN_WIDTH = 96;
// Tall enough for a month or a minute list (12 rows) in one piece; the longer
// day, hour and year lists scroll.
const MAX_HEIGHT = 12 * ROW_HEIGHT + 2 * LIST_PADDING;

export function OptionListPopover({
  anchor,
  items,
  selectedValue,
  label,
  closeLabel,
  onSelect,
  onClose,
}: OptionListPopoverProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const rootRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const didInitialScrollRef = useRef(false);
  // Where this view is in the window: the anchor is in window coordinates, and
  // the screen it covers is not necessarily at the window's origin (a modal).
  const [host, setHost] = useState<WindowRect | null>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCloseRef.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === selectedValue),
  );
  const contentHeight = items.length * ROW_HEIGHT + 2 * LIST_PADDING;

  // The list stays inside the safe area: on Android the window runs under the
  // status and navigation bars, and this view (absolute, so it ignores the
  // screen's own padding) covers them too.
  let frame: { left: number; top: number; width: number; height: number } | null = null;
  if (host) {
    const minLeft = insets.left + EDGE_MARGIN;
    const maxRight = host.width - insets.right - EDGE_MARGIN;
    const minTop = insets.top + EDGE_MARGIN;
    const maxBottom = host.height - insets.bottom - EDGE_MARGIN;
    const height = Math.min(contentHeight, MAX_HEIGHT, maxBottom - minTop);
    const width = Math.min(Math.max(anchor.width + 24, MIN_WIDTH), maxRight - minLeft);
    const centerX = anchor.x - host.x + anchor.width / 2;
    const centerY = anchor.y - host.y + anchor.height / 2;
    frame = {
      width,
      height,
      left: clamp(centerX - width / 2, minLeft, maxRight - width),
      top: clamp(centerY - height / 2, minTop, maxBottom - height),
    };
  }

  // Put the selected row in the middle of the list, once, with no animation.
  const scrollToSelected = (height: number) => {
    if (didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    const y = clamp(
      LIST_PADDING + selectedIndex * ROW_HEIGHT + ROW_HEIGHT / 2 - height / 2,
      0,
      Math.max(0, contentHeight - height),
    );
    scrollRef.current?.scrollTo({ y, animated: false });
  };

  return (
    <View
      ref={rootRef}
      style={StyleSheet.absoluteFill}
      collapsable={false}
      accessibilityViewIsModal
      onLayout={() => {
        rootRef.current?.measureInWindow((x, y, width, height) => setHost({ x, y, width, height }));
      }}
    >
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
      />
      {frame && (
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border },
            { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
          ]}
        >
          <ScrollView
            ref={scrollRef}
            accessibilityLabel={label}
            contentContainerStyle={{ padding: LIST_PADDING }}
            persistentScrollbar
            nestedScrollEnabled
            onContentSizeChange={() => frame && scrollToSelected(frame.height)}
          >
            {items.map((item) => {
              const selected = item.value === selectedValue;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => onSelect(item.value)}
                  style={({ pressed }) => [
                    styles.row,
                    selected && { backgroundColor: colors.border },
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[
                      styles.text,
                      { color: colors.textPrimary },
                      selected && { fontWeight: '700' },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: {
    position: 'absolute',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  row: { height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  text: { fontSize: 18, fontVariant: ['tabular-nums'] },
});
