/**
 * The iOS date/time picker sheet shared by `app/record.tsx` and
 * `app/activity/[id].tsx` (D-50) — a plain absolutely-positioned `View`,
 * deliberately NOT React Native's `<Modal>`. See `contexts/AppLock.tsx`'s
 * doc comment: a native modal presentation runs outside the view
 * hierarchy the App Lock overlay covers, so it wouldn't be covered by it.
 * Render this as a direct sibling of the screen's main content (inside
 * the same `SafeAreaView`), not nested inside a `ScrollView`, so its
 * `position: 'absolute'` fills that container.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing } from '../constants/theme';

interface DateTimePickerSheetProps {
  visible: boolean;
  value: Date;
  maximumDate?: Date;
  onChange: (date: Date) => void;
  onCancel: () => void;
  onDone: () => void;
}

export function DateTimePickerSheet({ visible, value, maximumDate, onChange, onCancel, onDone }: DateTimePickerSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (Platform.OS !== 'ios' || !visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel={t('dateTimePickerSheet.dismiss')}
      />
      {/* accessibilityViewIsModal: without it, VoiceOver can still reach the
          content underneath while this sheet is open — it isn't a real
          OS-level modal (see file doc comment), so nothing else marks it
          as the only reachable content. */}
      <View style={[styles.sheet, { backgroundColor: colors.surface }]} accessibilityViewIsModal>
        <View style={styles.header}>
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={{ color: colors.textSecondary, fontSize: 16 }}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable onPress={onDone} hitSlop={8}>
            <Text style={{ color: colors.solo, fontSize: 16, fontWeight: '700' }}>{t('common.done')}</Text>
          </Pressable>
        </View>
        <DateTimePicker
          value={value}
          mode="datetime"
          display="spinner"
          maximumDate={maximumDate}
          onChange={(event, date) => {
            if (date) onChange(date);
          }}
        />
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
});
