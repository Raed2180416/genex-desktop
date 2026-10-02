/**
 * The bookkeeping behind things that come and go in place (`Presence.tsx`): what arrives opens,
 * what leaves keeps its place and its last content while it closes, and a slot whose content
 * changes closes the old above the new as the new opens. Pure, so the rules are tested apart from
 * the page.
 */

/** Where an item is in its life on screen. */
export const PresencePhase = {
  /** Arrived, and opening. */
  Open: "open",
  /** On show and still. */
  Shown: "shown",
  /** Gone from the content, and closing before it leaves the page. */
  Close: "close",
} as const;
export type PresencePhase = (typeof PresencePhase)[keyof typeof PresencePhase];

/** One keyed item and where it is in its life. */
export interface PresenceItem<T> {
  key: string;
  value: T;
  phase: PresencePhase;
}

/**
 * The items on screen once the content becomes `next`. Items that stay take their new value;
 * items that left close in their old place (or drop at once without `animate`, or when
 * `handedOver` says something else took their place); new ones open (or simply show without
 * `animate`); an item that comes back while it closes opens again.
 */
export function presenceList<T>(
  previous: readonly PresenceItem<T>[],
  next: readonly { key: string; value: T }[],
  animate: boolean,
  handedOver: (key: string) => boolean = () => false,
): PresenceItem<T>[] {
  const wanted = new Set(next.map((item) => item.key));
  const before = new Map(previous.map((item) => [item.key, item]));
  const arrive = (item: { key: string; value: T }) => arrivedItem(before.get(item.key), item, animate);
  const result: PresenceItem<T>[] = [];
  let taken = 0;
  for (const item of previous) {
    if (wanted.has(item.key)) {
      // Everything wanted up to this item comes first, in the order it is wanted in.
      const upTo = next.findIndex((candidate, index) => index >= taken && candidate.key === item.key);
      const end = upTo < 0 ? next.length : upTo + 1;
      result.push(...next.slice(taken, end).map(arrive));
      taken = Math.max(taken, end);
      continue;
    }
    const leaving = leavingItem(item, animate && !handedOver(item.key));
    if (leaving) result.push(leaving);
  }
  result.push(...next.slice(taken).map(arrive));
  return result;
}

/** An item wanted now: as it was, with its new value, or arriving (again, if it was closing). */
function arrivedItem<T>(
  old: PresenceItem<T> | undefined,
  item: { key: string; value: T },
  animate: boolean,
): PresenceItem<T> {
  if (old && old.phase !== PresencePhase.Close) return { ...old, value: item.value };
  return { ...item, phase: animate ? PresencePhase.Open : PresencePhase.Shown };
}

/** An item no longer wanted: closing where it stands, or gone at once when it may not close. */
function leavingItem<T>(item: PresenceItem<T>, closes: boolean): PresenceItem<T> | null {
  if (!closes) return null;
  return item.phase === PresencePhase.Close ? item : { ...item, phase: PresencePhase.Close };
}

/** The items once `key`'s motion has ended: an opening one is shown, a closing one is gone. */
export function presenceDone<T>(items: PresenceItem<T>[], key: string): PresenceItem<T>[] {
  const item = items.find((candidate) => candidate.key === key);
  if (!item || item.phase === PresencePhase.Shown) return items;
  if (item.phase === PresencePhase.Close) return items.filter((candidate) => candidate !== item);
  return items.map((candidate) => (candidate === item ? { ...item, phase: PresencePhase.Shown } : candidate));
}
