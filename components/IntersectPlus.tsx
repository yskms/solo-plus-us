/**
 * A plain-View rendition of the brand mark (docs/*.png "Intersect Plus"):
 * a solo-teal vertical bar and a partnered-coral horizontal bar
 * overlapping at the center, tinted with `intersection` where they cross.
 * No image asset or SVG library — two rectangles are enough at the sizes
 * this is used at (tab bar, FAB, splash).
 */
import React from 'react';
import { View, type ColorValue } from 'react-native';
import { useTheme } from '../constants/theme';

/**
 * `tint` overrides all three bars with a single flat color. Needed when this
 * sits on a solo-teal background (the record FAB): the default two-tone
 * rendition uses `colors.solo` for the vertical bar, which is invisible
 * against a same-colored background and leaves only the horizontal bar
 * visible, reading as a capsule instead of a plus.
 */
export function IntersectPlus({ size = 24, tint }: { size?: number; tint?: ColorValue }) {
  const { colors } = useTheme();
  const barThickness = Math.round(size * 0.09);
  const verticalColor = tint ?? colors.solo;
  const horizontalColor = tint ?? colors.partnered;
  const intersectionColor = tint ?? colors.intersection;

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: (size - barThickness) / 2,
          top: 0,
          width: barThickness,
          height: size,
          backgroundColor: verticalColor,
          borderRadius: barThickness / 3,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: (size - barThickness) / 2,
          left: 0,
          height: barThickness,
          width: size,
          backgroundColor: horizontalColor,
          borderRadius: barThickness / 3,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: (size - barThickness) / 2,
          top: (size - barThickness) / 2,
          width: barThickness,
          height: barThickness,
          backgroundColor: intersectionColor,
          borderRadius: barThickness / 3,
        }}
      />
    </View>
  );
}
