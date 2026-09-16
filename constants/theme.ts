/**
 * Design tokens for Solo + Us.
 *
 * Source: docs/Solo + Us_UI-UX Specification v0.11.md §3 (Color Tokens) and
 * the "Dark Palette" addendum. Do not hardcode colors outside this file —
 * screens should read from `useTheme()`.
 *
 * Rule: Solo / Partnered must never be distinguished by color alone. Always
 * pair a color with a label or icon (see §3 "Semantic usage").
 */
import { useColorScheme } from 'react-native';

export interface ThemeColors {
  solo: string;
  partnered: string;
  intersection: string;

  background: string;
  surface: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  border: string;
  destructive: string;
}

export const lightColors: ThemeColors = {
  solo: '#2E7D6B',
  partnered: '#F4A699',
  intersection: '#3E5F58',

  background: '#F8F7FA',
  surface: '#FFFFFF',

  textPrimary: '#1F2937',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',

  border: '#E7E7EA',
  destructive: '#B84A4A',
};

export const darkColors: ThemeColors = {
  solo: '#4FA890',
  partnered: '#F0B2A6',
  intersection: '#7FB3A6',

  background: '#121615',
  surface: '#1B211F',

  textPrimary: '#F2F4F3',
  textSecondary: '#A8B0AD',
  textTertiary: '#79827F',

  border: '#2C3532',
  destructive: '#E0827F',
};

/** Type hierarchy from §4 Typography. Sizes in points. */
export const typography = {
  displayNumber: { fontSize: 44, fontWeight: '700' as const },
  screenTitle: { fontSize: 30, fontWeight: '700' as const },
  sectionTitle: { fontSize: 14, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  secondary: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
};

/** Minimum touch target from §23 Accessibility. */
export const minTouchTarget = 44;

export function useTheme(): { colors: ThemeColors; scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { colors: scheme === 'dark' ? darkColors : lightColors, scheme };
}
