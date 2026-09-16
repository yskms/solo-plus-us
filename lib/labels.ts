import type { ActivityContext } from '../types/Activity';

/** UI/UX §3: never distinguish Solo/Partnered by color alone — every use of these pairs with this label. */
export function contextLabel(context: ActivityContext): string {
  return context === 'solo' ? 'Solo' : 'Partnered';
}

export function contextCaption(context: ActivityContext): string {
  return context === 'solo' ? 'Personal activity' : 'With someone';
}
