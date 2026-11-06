/**
 * Add Activity's date/time chooser (§11.4): year / month / day / hour /
 * minute reels, always shown on the screen and kept compact (the selected
 * row plus a sliver of its neighbours), replacing the old chained native
 * dialogs on Android and the bottom sheet on iOS. Every turn of a reel
 * reports a new value straight away (no OK / Done step).
 *
 * Nothing is corrected while turning (`lib/dateTimeWheel` explains why): a
 * time after "now" can be chosen, and so can a day the month doesn't have
 * (Nov 31). The reels never snap or shrink under the finger (that fought it
 * and froze the screen); `app/record.tsx` checks both when saving. Every
 * column but the year is an endless reel (23 above 0, 31 above 1) that
 * doesn't touch the other fields.
 *
 * It's a plain in-tree view, so `contexts/AppLock.tsx`'s overlay covers it
 * like the rest of the screen and nothing needs to be dismissed from code
 * when the app locks.
 *
 * The value is the five wall-clock numbers (not a `Date`, which can't hold
 * Nov 31), so a "digit carrier" works as well as a real instant.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { radius, spacing, useTheme } from '../constants/theme';
import {
  type WheelField,
  type WheelFields,
  isLoopingWheelField,
  sameWheelFields,
  setWheelField,
  wheelFieldValues,
} from '../lib/dateTimeWheel';
import type { TimeFormat } from '../types/Settings';
import { WHEEL_ITEM_HEIGHT, WHEEL_PEEK, WheelColumn, type WheelItem } from './WheelColumn';

interface DateTimeWheelProps {
  value: WheelFields;
  /** "Now": only decides where the year column ends. */
  now: Date;
  timeFormat: TimeFormat;
  onChange: (fields: WheelFields) => void;
}

// Year has four digits; the rest are one or two.
const COLUMNS: { field: WheelField; flex: number }[] = [
  { field: 'year', flex: 1.5 },
  { field: 'month', flex: 1 },
  { field: 'day', flex: 1 },
  { field: 'hour', flex: 1.2 },
  { field: 'minute', flex: 1 },
];

export function DateTimeWheel({ value, now, timeFormat, onChange }: DateTimeWheelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
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
    const next = setWheelField(value, field, n);
    // Settling back on the value already shown isn't a change.
    if (!sameWheelFields(next, value)) onChange(next);
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
          const items: WheelItem[] = wheelFieldValues(field, value, now).map((n) => ({
            value: n,
            label: itemLabel(field, n),
          }));
          return (
            <WheelColumn
              key={field}
              items={items}
              selectedValue={value[field]}
              onSelect={(n) => select(field, n)}
              label={fieldLabels[field]}
              flex={flex}
              loop={isLoopingWheelField(field)}
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
    top: WHEEL_PEEK,
    height: WHEEL_ITEM_HEIGHT,
    borderRadius: radius.sm,
  },
});
