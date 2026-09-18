/**
 * UI/UX §5 Navigation: three tabs (Today / Calendar / Insights), swipeable
 * between as well as tap-to-switch. Icons use @expo/vector-icons (Ionicons),
 * matching this team's other Expo Router apps (filto-app).
 *
 * Built on `react-native-pager-view` instead of Expo Router's `Tabs` (React
 * Navigation bottom-tabs under the hood): that navigator only switches tabs
 * on tap, with no swipe gesture. Calendar and Insights are rendered
 * directly as pager pages here (from `screens/`, not `app/(tabs)/`) rather
 * than as separate `Tabs.Screen` routes, so `/calendar` and `/insights`
 * don't exist as their own routes any more — a deep link or `router.push`
 * to either would have silently rendered this same Today-first layout
 * regardless of the path, which is worse than the route not existing.
 * Today stays as `app/(tabs)/index.tsx` since `(tabs)` still needs an index
 * route for `router.replace('/(tabs)')` (onboarding/privacy.tsx) and
 * `unstable_settings.initialRouteName` (app/_layout.tsx) to resolve.
 *
 * Each screen takes an `isActive` prop in place of the `useFocusEffect` it
 * used to get from being its own React Navigation screen — see
 * app/(tabs)/index.tsx. `isActive` alone only tracks which pager page is
 * showing, though: it stays `true` while this whole `(tabs)` group loses
 * focus to a pushed screen (record, activity/[id], settings/*) and regains
 * it, so a save/edit/delete there wouldn't otherwise trigger a reload on
 * return. `routeFocused` (via `useFocusEffect` on this layout itself, the
 * screen actually registered in the root Stack) covers that — screens
 * reload when `isActive && routeFocused`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useTheme, minTouchTarget } from '../../constants/theme';
import TodayScreen from './index';
import CalendarScreen from '../../screens/CalendarScreen';
import InsightsScreen from '../../screens/InsightsScreen';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { title: string; icon: IoniconName; iconOutline: IoniconName }[] = [
  { title: 'Today', icon: 'today', iconOutline: 'today-outline' },
  { title: 'Calendar', icon: 'calendar', iconOutline: 'calendar-outline' },
  { title: 'Insights', icon: 'stats-chart', iconOutline: 'stats-chart-outline' },
];

export default function TabLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<PagerView>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [routeFocused, setRouteFocused] = useState(true);

  const goToPage = useCallback((index: number) => {
    pagerRef.current?.setPage(index);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setRouteFocused(true);
      return () => setRouteFocused(false);
    }, []),
  );

  // Android hardware/gesture back: Expo Router's `Tabs` defaults to
  // `backBehavior: 'firstRoute'`, so pressing back from Calendar or
  // Insights returns to Today instead of exiting the app. `PagerView` has
  // no equivalent, so this reproduces it — only while `(tabs)` itself is
  // focused (not when a pushed screen like record/activity is on top,
  // which should get its own default back behavior).
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (activeIndex !== 0) {
          goToPage(0);
          return true;
        }
        return false;
      });
      return () => subscription.remove();
    }, [activeIndex, goToPage]),
  );

  const isActive = routeFocused && activeIndex === 0;
  const isCalendarActive = routeFocused && activeIndex === 1;
  const isInsightsActive = routeFocused && activeIndex === 2;

  return (
    <View style={styles.container}>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        onPageSelected={(event) => setActiveIndex(event.nativeEvent.position)}
      >
        <View key="today" style={styles.page}>
          <TodayScreen isActive={isActive} />
        </View>
        <View key="calendar" style={styles.page}>
          <CalendarScreen isActive={isCalendarActive} />
        </View>
        <View key="insights" style={styles.page}>
          <InsightsScreen isActive={isInsightsActive} />
        </View>
      </PagerView>

      <View
        style={[
          styles.tabBar,
          { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom },
        ]}
        accessibilityRole="tablist"
      >
        {TABS.map((tab, index) => {
          const focused = activeIndex === index;
          const color = focused ? colors.solo : colors.textTertiary;
          return (
            <Pressable
              key={tab.title}
              onPress={() => goToPage(index)}
              style={styles.tabButton}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.title}
            >
              <Ionicons name={focused ? tab.icon : tab.iconOutline} size={24} color={color} />
              <Text style={[styles.tabLabel, { color }]}>{tab.title}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pager: { flex: 1 },
  page: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabButton: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
    gap: 2,
  },
  tabLabel: { fontSize: 11, fontWeight: '600' },
});
