/**
 * UI/UX §9 Record Confirmation. Rendered once, at the root, above the
 * navigator — see `app/_layout.tsx` — so it survives the Add Activity
 * modal closing and stays visible back on Today.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../constants/theme';
import { contextLabel } from '../lib/labels';
import { useRecordFeedback } from '../contexts/RecordFeedback';

export function UndoSnackbar() {
  const { colors, scheme } = useTheme();
  const { state, undo } = useRecordFeedback();

  if (!state) return null;

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <View
        style={[
          styles.bar,
          { backgroundColor: scheme === 'dark' ? colors.surface : colors.textPrimary, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.message, { color: scheme === 'dark' ? colors.textPrimary : colors.background }]}>
          ✓ {contextLabel(state.activity.context)} activity recorded
        </Text>
        <Pressable onPress={undo} hitSlop={8} accessibilityRole="button" accessibilityLabel="Undo">
          <Text style={[styles.undo, { color: colors.solo }]}>Undo</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  message: { fontSize: 14, fontWeight: '500' },
  undo: { fontSize: 14, fontWeight: '700' },
});
