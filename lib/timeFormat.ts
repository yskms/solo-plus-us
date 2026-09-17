/**
 * §5.5 `preferences.timeFormat` display — the persisted setting decides
 * 12h vs 24h, never a hardcoded choice (v1 has no per-screen override).
 */
import { isValidLocalTime } from './datetime';
import { ValidationError } from './errors';
import type { TimeFormat } from '../types/Settings';

export function formatLocalTime(localTime: string, format: TimeFormat): string {
  if (!isValidLocalTime(localTime)) {
    throw new ValidationError(`Not a valid local time: ${localTime}`);
  }
  const [h, m] = localTime.split(':').map(Number);
  const mm = String(m).padStart(2, '0');
  if (format === '24h') {
    return `${String(h).padStart(2, '0')}:${mm}`;
  }
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${mm} ${period}`;
}
