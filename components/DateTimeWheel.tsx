/**
 * Add Activity's date/time chooser (§11.4): year / month / day / hour /
 * minute reels shown in the screen itself, replacing the old chained native
 * dialogs on Android and the bottom sheet on iOS. Every turn of a reel
 * reports a new value straight away (no OK / Done step), and nothing here
 * can produce a time after `max`.
 *
 * It's a plain in-tree view, so `contexts/AppLock.tsx`'s overlay covers it
 * like the rest of the screen and nothing needs to be dismissed from code
 * when the app locks.
 *
 * Only the wall-clock digits of `value` are read (via `lib/dateTimeWheel`),
 * so a "digit carrier" `Date` works as well as a real instant.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { radius, spacing, useTheme } from '../constants/theme';
import { sameMinute } from '../lib/datetime';
import {
  type WheelField,
  isWheelItemSelectable,
  setWheelField,
  toWheelFields,
  wheelFieldValues,
} from '../lib/dateTimeWheel';
import type { TimeFormat } from '../types/Settings';
import { WHEEL_ITEM_HEIGHT, WHEEL_VISIBLE_ROWS, WheelColumn, type WheelItem } from './WheelColumn';

interface DateTimeWheelProps {
  value: Date;
  /** Upper bound ("now"); later times can't be chosen. */
  max: Date;
  timeFormat: TimeFormat;
  onChange: (date: Date) => void;
}

// Year has four digits; the rest are one or two.
const COLUMNS: { field: WheelField; flex: number }[] = [
  { field: 'year', flex: 1.5 },
  { field: 'month', flex: 1 },
  { field: 'day', flex: 1 },
  { field: 'hour', flex: 1.2 },
  { field: 'minute', flex: 1 },
];

export function DateTimeWheel({ value, max, timeFormat, onChange }: DateTimeWheelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const fields = toWheelFields(value);
  // Literal keys (not `dateTimeWheel.${field}`) so `npm run check-i18n` can see them.
  const fieldLabels: Record<WheelField, string> = {
    year: t('dateTimeWheel.year'),
    month: t('dateTimeWheel.month'),
    day: t('dateTimeWheel.day'),
    hour: t('dateTimeWheel.hour'),
    minute: t('dateTimeWheel.minute'),
  };

  const itemLabel = (field: WheelField, n: number): string => {
    if (field === 'hour') {
      if (timeFormat === '24h') return String(n).padStart(2, '0');
      return t('dateTimeWheel.hour12', { period: n < 12 ? t('common.am') : t('common.pm'), hour: n % 12 === 0 ? 12 : n % 12 });
    }
    if (field === 'minute') return String(n).padStart(2, '0');
    return String(n);
  };

  const select = (field: WheelField, n: number) => {
    const next = setWheelField(value, field, n, max);
    // Settling back on the minute already shown (or being clamped onto it) isn't a change.
    if (!sameMinute(next, value)) onChange(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {COLUMNS.map(({ field, flex }) => (
          <Text key={field} style={[styles.header, { flex, color: colors.textTertiary }]} importantForAccessibility="no">
            {fieldLabels[field]}
          </Text>
        ))}
      </View>
      <View style={[styles.wheels, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View pointerEvents="none" style={[styles.band, { backgroundColor: colors.border }]} />
        {COLUMNS.map(({ field, flex }) => {
          const items: WheelItem[] = wheelFieldValues(field, value, max).map((n) => ({
            value: n,
            label: itemLabel(field, n),
            selectable: isWheelItemSelectable(value, field, n, max),
          }));
          return (
            <WheelColumn
              key={field}
              items={items}
              selectedValue={fields[field]}
              onSelect={(n) => select(field, n)}
              label={fieldLabels[field]}
              flex={flex}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', gap: spacing.xs },
  headerRow: { flexDirection: 'row' },
  header: { fontSize: 12, textAlign: 'center' },
  wheels: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    left: spacing.xs,
    right: spacing.xs,
    top: WHEEL_ITEM_HEIGHT * Math.floor(WHEEL_VISIBLE_ROWS / 2),
    height: WHEEL_ITEM_HEIGHT,
    borderRadius: radius.sm,
  },
});
