import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, minTouchTarget } from '../constants/theme';
import { ActivityBadge } from './ActivityBadge';
import { formatMonthDay } from '../lib/relativeDate';
import { contextLabel } from '../lib/labels';
import type { Activity } from '../types/Activity';

export function ActivityRow({ activity }: { activity: Activity }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  // Text grows with the OS font size setting (fontSize × fontScale), so the
  // fixed column has to grow with it too — otherwise numberOfLines={1} below
  // turns the original wrapping bug into a truncated "12月…" at larger sizes.
  // At accessibility sizes even a scaled column leaves the badge ~1 character
  // wide, so the date moves above the badge instead (STACKED_FONT_SCALE).
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACKED_FONT_SCALE;
  const dateText = (
    <Text
      style={[styles.date, { width: stacked ? undefined : DATE_COLUMN_WIDTH * fontScale, color: colors.textSecondary }]}
      numberOfLines={stacked ? undefined : 1}
    >
      {formatMonthDay(t, activity.occurredLocalDate)}
    </Text>
  );
  return (
    <Pressable
      onPress={() => router.push(`/activity/${activity.id}`)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1, minHeight: minTouchTarget }]}
      accessibilityRole="button"
      accessibilityLabel={t('components.activityRow.a11yLabel', {
        context: contextLabel(t, activity.context),
        date: formatMonthDay(t, activity.occurredLocalDate),
      })}
    >
      {!stacked && dateText}
      <View style={{ flex: 1 }}>
        {stacked && dateText}
        <ActivityBadge context={activity.context} />
      </View>
      <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
    </Pressable>
  );
}

/**
 * Fixed (not content-sized) so the badges line up across rows; scaled by
 * fontScale at render time. Sized for the widest Japanese date ("12月31日")
 * at fontScale 1 on iOS, whose font is wider than Android's — 52 was enough
 * on Android but wrapped "9月29日" onto two lines on iOS.
 */
const DATE_COLUMN_WIDTH = 68;

/**
 * iOS's first accessibility text size (AX1) is ~1.65×; the standard sizes top
 * out at ~1.35× (XXXL), which still fits side by side on a 375pt-wide phone.
 */
const STACKED_FONT_SCALE = 1.6;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  date: { fontSize: 14 },
  chevron: { fontSize: 18 },
});
