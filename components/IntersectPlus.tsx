/**
 * A plain-View rendition of the brand mark (docs/*.png "Intersect Plus"):
 * a solo-teal vertical bar and a partnered-coral horizontal bar
 * overlapping at the center, tinted with `intersection` where they cross.
 * No image asset or SVG library — two rectangles are enough at the sizes
 * this is used at (tab bar, FAB, splash).
 */
import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../constants/theme';

export function IntersectPlus({ size = 24 }: { size?: number }) {
  const { colors } = useTheme();
  const barThickness = Math.round(size * 0.32);

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: (size - barThickness) / 2,
          top: 0,
          width: barThickness,
          height: size,
          backgroundColor: colors.solo,
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
          backgroundColor: colors.partnered,
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
          backgroundColor: colors.intersection,
          borderRadius: barThickness / 3,
        }}
      />
    </View>
  );
}
