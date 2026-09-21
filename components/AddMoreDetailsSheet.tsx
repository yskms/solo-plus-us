/**
 * 要件定義書 §6.3「その他の項目を追加」という逃げ道 — 設定で OFF にした
 * 項目にも、その場でこの記録限りアクセスできるようにする（永続化しない、
 * `lib/activityDetailsFields.ts` の `revealed` セット）。
 *
 * `DateTimePickerSheet` と同じ理由で、React Native の `<Modal>` ではなく
 * 素の絶対配置 `View`（`contexts/AppLock.tsx` 参照：ネイティブモーダルは
 * App Lock オーバーレイのビュー階層の外側で描画されるため、覆えない）。
 * **ただし `DateTimePickerSheet` は iOS 専用（`Platform.OS !== 'ios'` で
 * 早期 return）でハードウェアバックに遭遇しないのに対し、このシートは
 * Android でも表示される。** `<Modal>` を使わない判断だけを引き継いで
 * ハードウェアバックの処理を引き継がないと、バックキーでシートではなく
 * Activity Detail 画面自体が pop してしまう（編集中の入力も失われる）ため、
 * `contexts/AppLock.tsx` と同じパターンで明示的に処理する。同じ理由で、
 * このシートが表示されている間は背後のフォームを TalkBack が読み上げ・
 * 操作できないよう、呼び出し側（`app/activity/[id].tsx`）で背後の
 * コンテンツに `importantForAccessibility="no-hide-descendants"` を当てる
 * こと。
 */
import React, { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';
import { activityDetailFieldLabel, type ActivityDetailField } from '../lib/activityDetailsFields';

interface AddMoreDetailsSheetProps {
  visible: boolean;
  hiddenFields: readonly { field: ActivityDetailField }[];
  onReveal: (field: ActivityDetailField) => void;
  onClose: () => void;
}

export function AddMoreDetailsSheet({ visible, hiddenFields, onReveal, onClose }: AddMoreDetailsSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [visible, onClose]);

  // Revealing the last hidden field empties the list out from under this
  // sheet (`hiddenFields` is derived by the caller from the same `revealed`
  // set this sheet's onPress just grew) — close rather than leave a
  // header-and-Done-only sheet with nothing to add.
  useEffect(() => {
    if (visible && hiddenFields.length === 0) onClose();
  }, [visible, hiddenFields.length, onClose]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('addMoreDetailsSheet.dismiss')}
      />
      <View style={[styles.sheet, { backgroundColor: colors.surface }]} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t('addMoreDetailsSheet.title')}</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={{ color: colors.solo, fontSize: 16, fontWeight: '700' }}>{t('common.done')}</Text>
          </Pressable>
        </View>
        {hiddenFields.map(({ field }) => (
          <Pressable
            key={field}
            onPress={() => onReveal(field)}
            style={({ pressed }) => [styles.row, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
            accessibilityRole="button"
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{activityDetailFieldLabel(t, field)}</Text>
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
