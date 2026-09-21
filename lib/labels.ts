import type { TFunction } from 'i18next';
import type { ActivityContext } from '../types/Activity';

/** UI/UX §3: never distinguish Solo/Partnered by color alone — every use of these pairs with this label. */
export function contextLabel(t: TFunction, context: ActivityContext): string {
  return context === 'solo' ? t('activityContext.solo.label') : t('activityContext.partnered.label');
}

export function contextCaption(t: TFunction, context: ActivityContext): string {
  return context === 'solo' ? t('activityContext.solo.caption') : t('activityContext.partnered.caption');
}
