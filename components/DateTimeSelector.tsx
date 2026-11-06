/**
 * Add Activity's date/time chooser (§11.4): year / month / day / hour /
 * minute side by side, always shown on the screen. Each column is a number
 * with a flat arrow above and below it:
 *
 * - the arrows step the value by one (the minute by `MINUTE_STEP`);
 * - tapping the number opens a tall list of choices next to it
 *   (`components/OptionListPopover.tsx`) and picking a row closes it.
 *
 * There is no scrolling reel and nothing snaps or re-aligns after a scroll:
 * the wheels this replaces had exactly that, and on Android it swung and
 * froze (D-56, D-57). Don't build a scroll-and-settle behaviour back in. Every
 * change is a tap, so correcting a value on the spot is fine
 * (`lib/dateTimeFields.ts`: a day past the end of the month is pulled back when
 * the year or month changes). Every change reports its new value straight
 * away (no OK / Done step).
 *
 * The list is a plain in-tree view (not a native `<Modal>`), so
 * `contexts/AppLock.tsx`'s overlay covers it like the rest of the screen. It
 * has to be drawn by the *screen*, outside this component's own box (a list
 * inside it would be clipped, and on Android a touch outside a parent's
 * bounds never arrives), so this is a hook: render `selector` where the
 * columns go and `popover` as a sibling of the screen's main content, and
 * hide that content from screen readers while `isListOpen`.
 *
 * The value is the five wall-clock numbers (not a `Date`), so a "digit
 * carrier" works as well as a real instant.
 */
import React, { useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { minTouchTarget, radius, spacing, useTheme } from '../constants/theme';
import {
  type DateTimeField,
  type DateTimeFields,
  dateTimeFieldValues,
  sameDateTimeFields,
  setDateTimeField,
  stepDateTimeField,
} from '../lib/dateTimeFields';
import type { TimeFormat } from '../types/Settings';
import { OptionListPopover, type WindowRect } from './OptionListPopover';

interface Options {
  value: DateTimeFields;
  /** "Now": only decides where the year list ends. */
  now: Date;
  timeFormat: TimeFormat;
  onChange: (fields: DateTimeFields) => void;
}

// Year has four digits; the rest are one or two and share the same width.
const COLUMNS: { field: DateTimeField; flex: number }[] = [
  { field: 'year', flex: 1.5 },
  { field: 'month', flex: 1 },
  { field: 'day', flex: 1 },
  { field: 'hour', flex: 1 },
  { field: 'minute', flex: 1 },
];

export function useDateTimeSelector({ value, now, timeFormat, onChange }: Options) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [openList, setOpenList] = useState<{ field: DateTimeField; anchor: WindowRect } | null>(null);
  const anchorRefs = useRef<Partial<Record<DateTimeField, View | null>>>({});

  // Literal keys (not `dateTimeSelector.${field}`) so `npm run check-i18n` can see them.
  const fieldLabels: Record<DateTimeField, string> = {
    year: t('dateTimeSelector.year'),
    month: t('dateTimeSelector.month'),
    day: t('dateTimeSelector.day'),
    hour: t('dateTimeSelector.hour'),
    minute: t('dateTimeSelector.minute'),
  };

  const itemLabel = (field: DateTimeField, n: number): string => {
    if (field === 'hour') {
      if (timeFormat === '24h') return String(n).padStart(2, '0');
      return t('dateTimeSelector.hour12', {
        period: n < 12 ? t('common.am') : t('common.pm'),
        hour: n % 12 === 0 ? 12 : n % 12,
      });
    }
    if (field === 'minute') return String(n).padStart(2, '0');
    return String(n);
  };

  const change = (next: DateTimeFields) => {
    // Picking the value already shown isn't a change.
    if (!sameDateTimeFields(next, value)) onChange(next);
  };

  const openFieldList = (field: DateTimeField) => {
    if (openList) return;
    anchorRefs.current[field]?.measureInWindow((x, y, width, height) => {
      setOpenList({ field, anchor: { x, y, width, height } });
    });
  };

  const selector = (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {COLUMNS.map(({ field, flex }) => (
          <Text key={field} style={[styles.header, { flex, color: colors.textTertiary }]} importantForAccessibility="no">
            {fieldLabels[field]}
          </Text>
        ))}
      </View>
      <View style={styles.columns}>
        {COLUMNS.map(({ field, flex }) => (
          <View key={field} style={[styles.column, { flex }]}>
            <ArrowButton
              direction="up"
              color={colors.textTertiary}
              label={t('dateTimeSelector.increase', { field: fieldLabels[field] })}
              onPress={() => change(stepDateTimeField(value, field, 1, now))}
            />
            <Pressable
              ref={(node) => {
                anchorRefs.current[field] = node;
              }}
              collapsable={false}
              onPress={() => openFieldList(field)}
              style={({ pressed }) => [
                styles.valueBox,
                { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={fieldLabels[field]}
              accessibilityValue={{ text: itemLabel(field, value[field]) }}
              accessibilityHint={t('dateTimeSelector.listHint')}
            >
              <Text style={[styles.valueText, { color: colors.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                {itemLabel(field, value[field])}
              </Text>
            </Pressable>
            <ArrowButton
              direction="down"
              color={colors.textTertiary}
              label={t('dateTimeSelector.decrease', { field: fieldLabels[field] })}
              onPress={() => change(stepDateTimeField(value, field, -1, now))}
            />
          </View>
        ))}
      </View>
    </View>
  );

  const popover = openList ? (
    <OptionListPopover
      anchor={openList.anchor}
      items={dateTimeFieldValues(openList.field, value, now).map((n) => ({
        value: n,
        label: itemLabel(openList.field, n),
      }))}
      selectedValue={value[openList.field]}
      label={fieldLabels[openList.field]}
      closeLabel={t('dateTimeSelector.closeList')}
      onSelect={(n) => {
        change(setDateTimeField(value, openList.field, n));
        setOpenList(null);
      }}
      onClose={() => setOpenList(null)}
    />
  ) : null;

  return { selector, popover, isListOpen: openList !== null };
}

// 16 (tried 16 / 18 / 20 side by side): small enough to stay out of the way of the numbers.
const ARROW_SIZE = 16;

/** A subtle chevron (Ionicons, like the tab bar) as a full-size tap target. */
function ArrowButton({
  direction,
  color,
  label,
  onPress,
}: {
  direction: 'up' | 'down';
  color: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.arrowButton, { opacity: pressed ? 0.5 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* Hidden from screen readers: the button's own label is what they read. */}
      <Ionicons
        name={direction === 'up' ? 'chevron-up' : 'chevron-down'}
        size={ARROW_SIZE}
        color={color}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', gap: spacing.xs },
  headerRow: { flexDirection: 'row' },
  header: { fontSize: 12, textAlign: 'center' },
  columns: { flexDirection: 'row' },
  column: { alignItems: 'stretch', paddingHorizontal: 2 },
  arrowButton: { height: minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  valueBox: {
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 2,
  },
  valueText: { fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
