import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { clampTo, sameMinute } from '../lib/datetime';
import { openAndroidPicker } from '../lib/androidDateTimePicker';
import { logError } from '../lib/log';

/**
 * The date/time-picker state machine shared by `app/record.tsx` (Add
 * Activity) and `app/activity/[id].tsx` (Activity Detail's post-hoc edit,
 * D-50) — extracted because `contexts/AppLock.tsx`'s doc comment treats
 * their App Lock handling as one shared invariant both screens must keep
 * ("its iOS sheet is a plain absolutely-positioned `View`... Android's
 * dialog... is dismissed the moment `AppState` leaves `active`"). Keeping
 * that logic in two independently-edited copies risked exactly the drift
 * that comment warns about — a future fix to one screen quietly not
 * reaching the other.
 *
 * `getBase` and `getMax` both return values in whatever shared
 * representation the caller uses for `customInstant` — either a real
 * instant (`app/record.tsx`: both are always "now") or a digit carrier
 * (`app/activity/[id].tsx`: `getBase` reads the already-recorded local
 * date/time; `getMax` is `nowAsZonedDigits(activity.timezoneId)` — "now",
 * expressed as digits in the record's own zone. See that function's doc
 * comment in `lib/datetime.ts` for why comparing against *real* "now"
 * would be wrong there). Whichever representation is used, `getBase` and
 * `getMax` must agree, since `open`/`confirmIos` below compare them
 * directly. Once `customInstant` is set, it's reused as the base for any
 * further re-opening, same as before this was a hook.
 */
export function useNativeDateTimePicker(getBase: () => Date, getMax: () => Date, isLocked: () => boolean) {
  const [customInstant, setCustomInstant] = useState<Date | null>(null);
  const [iosPickerVisible, setIosPickerVisible] = useState(false);
  const [pendingInstant, setPendingInstant] = useState<Date | null>(null);
  const [pickerBase, setPickerBase] = useState<Date | null>(null);

  // Closes any open picker the moment the app leaves `active` (backgrounded,
  // or a system overlay like the App Lock biometric prompt makes it
  // `inactive`), rather than leaving it open across a lock — see
  // `contexts/AppLock.tsx`'s doc comment. `DateTimePickerAndroid.dismiss`
  // is safe to call even when no dialog of that mode is currently open
  // (no-op).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      if (Platform.OS === 'android') {
        DateTimePickerAndroid.dismiss('date').catch((error) => logError('Dismissing date picker failed', error));
        DateTimePickerAndroid.dismiss('time').catch((error) => logError('Dismissing time picker failed', error));
      } else {
        setIosPickerVisible(false);
      }
    });
    return () => subscription.remove();
  }, []);

  const open = () => {
    if (isLocked()) return; // shouldn't be reachable (both screens sit behind the lock overlay), but guards the picker itself against ever opening while locked
    const base = customInstant ?? getBase();
    if (Platform.OS === 'android') {
      openAndroidPicker(base, getMax(), isLocked, setCustomInstant);
    } else {
      setPickerBase(base);
      setPendingInstant(base);
      setIosPickerVisible(true);
    }
  };

  const confirmIos = () => {
    if (!isLocked() && pendingInstant && pickerBase && !sameMinute(pendingInstant, pickerBase)) {
      setCustomInstant(clampTo(pendingInstant, getMax()));
    }
    setIosPickerVisible(false);
  };

  const cancelIos = () => setIosPickerVisible(false);

  // Stable identity (unlike `open`/`confirmIos`/`cancelIos`, which close
  // over state that legitimately changes) — `app/activity/[id].tsx`'s
  // `load` includes this in a `useCallback` dependency array, where a
  // reference that changed every render would defeat the
  // `useFocusEffect(useCallback(...))` pairing it's used with.
  const reset = useCallback(() => setCustomInstant(null), []);

  return {
    customInstant,
    iosPickerVisible,
    pendingInstant,
    setPendingInstant,
    open,
    confirmIos,
    cancelIos,
    reset,
  };
}
