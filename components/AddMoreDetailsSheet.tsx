/**
 * 要件定義書 §6.3「その他の項目を追加」という逃げ道 — 設定で OFF にした
 * 項目にも、その場でこの記録限りアクセスできるようにする（永続化しない、
 * `lib/activityDetailsFields.ts` の `revealed` セット）。
 *
 * `DateTimePickerSheet` と同じ理由で、React Native の `<Modal>` ではなく
 * 素の絶対配置 `View`（`contexts/AppLock.tsx` 参照：ネイティブモーダルは
 * App Lock オーバーレイのビュー階層の外側で描画されるため、覆えない）。
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';
import type { ActivityDetailField } from '../lib/activityDetailsFields';

interface AddMoreDetailsSheetProps {
  visible: boolean;
  hiddenFields: readonly { field: ActivityDetailField; label: string }[];
  onReveal: (field: ActivityDetailField) => void;
  onClose: () => void;
}

export function AddMoreDetailsSheet({ visible, hiddenFields, onReveal, onClose }: AddMoreDetailsSheetProps) {
  const { colors } = useTheme();
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      />
      <View style={[styles.sheet, { backgroundColor: colors.surface }]} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Add more details</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={{ color: colors.solo, fontSize: 16, fontWeight: '700' }}>Done</Text>
          </Pressable>
        </View>
        {hiddenFields.map(({ field, label }) => (
          <Pressable
            key={field}
            onPress={() => onReveal(field)}
            style={({ pressed }) => [styles.row, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
            accessibilityRole="button"
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{label}</Text>
            <Text style={[styles.plus, { color: colors.solo }]}>+</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.lg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  title: { fontSize: 16, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: minTouchTarget,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  plus: { fontSize: 20, fontWeight: '700' },
});
