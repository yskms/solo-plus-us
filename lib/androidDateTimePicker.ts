import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { clampTo, sameMinute } from './datetime';

/**
 * Android has no combined date+time control, so date and time are two
 * chained native dialogs (the imperative API — a declarative/inline
 * picker would otherwise stay permanently on-screen on this platform).
 * `maximumDate` on the date dialog only blocks picking a day past `max`;
 * the time dialog that follows has no date context and would happily
 * accept e.g. 23:00 on today's date even if `max` is 09:00 today,
 * producing a result past `max`. Clamping the combined result to `max`
 * is what actually prevents that.
 *
 * `max` is NOT necessarily *real* "now" — `current`/`max` just need to be
 * expressed in the same terms as each other (both digit carriers in the
 * record's own zone, as in `app/activity/[id].tsx`'s call — see
 * `nowAsZonedDigits`'s doc comment in `lib/datetime.ts` for why that
 * matters; real instants would work equally). `current`,
 * `pickedDate`/`pickedTime`, and `combined` below are always in that same
 * shared representation as `max`, so comparing their `.getTime()`s
 * against each other is internally consistent even when none of them are
 * a real instant.
 *
 * Used by `app/activity/[id].tsx` (Activity Detail's post-hoc edit) via
 * `hooks/useNativeDateTimePicker.ts`; `app/record.tsx` used it too before
 * moving to `components/DateTimeSelector.tsx`.
 */
export function openAndroidPicker(current: Date, max: Date, isLocked: () => boolean, onPicked: (date: Date) => void) {
  DateTimePickerAndroid.open({
    value: current,
    mode: 'date',
    maximumDate: max,
    onChange: (dateEvent, pickedDate) => {
      if (dateEvent.type !== 'set' || !pickedDate) return;
      // Checked before opening the second dialog too, not just in the
      // time dialog's own callback below: without this, confirming the
      // date while locked would still pop the time dialog on top of the
      // lock screen.
      if (isLocked()) return;
      DateTimePickerAndroid.open({
        value: current,
        mode: 'time',
        onChange: (timeEvent, pickedTime) => {
          if (timeEvent.type !== 'set' || !pickedTime) return;
          if (isLocked()) return;
          const combined = new Date(pickedDate);
          // DST gap edge case: if the chosen wall-clock time doesn't
          // exist because a DST transition skips over it, `setHours`
          // silently shifts it forward by the gap rather than rejecting
          // it. Not verified on a real device in a DST-observing
          // timezone, so left as a known limitation rather than a
          // dedicated check.
          combined.setHours(pickedTime.getHours(), pickedTime.getMinutes(), 0, 0);
          const clamped = clampTo(combined, max);
          if (sameMinute(clamped, current)) return; // confirmed without actually changing it
          onPicked(clamped);
        },
      });
    },
  });
}
