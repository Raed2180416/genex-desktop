/**
 * Things that come and go in place. What arrives opens: its height grows from nothing while it
 * fades in, so what sits after it — or, with the chat following its newest line, everything above
 * — glides instead of jumping. What leaves closes the same way, keeping its last content and its
 * place until it is gone. Only height and opacity move (theme.css `.presence`), and Reduce Motion
 * shows every change at once. The rules are `presence-list.ts`.
 */
import { type AnimationEvent, type JSX, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "./cn.ts";
import { prefersReducedMotion } from "./media-queries.ts";
import { CLOSE_MS, OPEN_MS } from "./motion.ts";
import { type PresenceItem, PresencePhase, presenceDone, presenceList } from "./presence-list.ts";

/** How much longer than its motion an item may take before it settles anyway (its motion never ran). */
const SETTLE_SLACK_MS = 200;
/** The animations whose end settles an item: the height's, which the fade never outlasts. */
const SETTLING_ANIMATIONS: ReadonlySet<string> = new Set(["presence-open", "presence-close"]);

/** One child: its key, which says whether it is still the same thing, and what it draws. */
export interface PresenceChild {
  key: string;
  node: ReactNode;
}

type Shown = PresenceItem<ReactNode>;
const itemsOf = (children: readonly PresenceChild[]) => children.map(({ key, node }) => ({ key, value: node }));

/**
 * The items on screen for `children`: derived while rendering, so an arrival or a departure is
 * drawn in the same frame as the change that caused it.
 */
function usePresence(children: readonly PresenceChild[], still: boolean, handedOver?: (key: string) => boolean) {
  const [state, setState] = useState(() => ({
    from: children,
    still,
    items: presenceList<ReactNode>([], itemsOf(children), false),
  }));
  let items = state.items;
  if (state.from !== children || state.still !== still) {
    // Still now or a moment ago (the content it was waiting for arrives with it): nothing moves.
    const animate = !still && !state.still && !prefersReducedMotion();
    items = presenceList(state.items, itemsOf(children), animate, handedOver);
    setState({ from: children, still, items });
  }
  const settle = useCallback(
    (key: string) => setState((current) => ({ ...current, items: presenceDone(current.items, key) })),
    [],
  );
  return { items, settle };
}

/**
 * Settles whatever is still moving once its motion should be over, should its animation never end
 * (a page that is not drawn runs none). The timer restarts only when what moves changes.
 */
function useSettleFallback(items: readonly Shown[], settle: (key: string) => void): void {
  const moving = items.filter((item) => item.phase !== PresencePhase.Shown);
  const keys = useRef<string[]>([]);
  keys.current = moving.map((item) => item.key);
  const signature = moving.map((item) => `${item.phase} ${item.key}`).join("\n");
  useEffect(() => {
    if (!signature) return;
    const timer = setTimeout(() => {
      for (const key of keys.current) settle(key);
    }, Math.max(OPEN_MS, CLOSE_MS) + SETTLE_SLACK_MS);
    return () => clearTimeout(timer);
  }, [signature, settle]);
}

/**
 * Each child in place, opening as it arrives and closing as it leaves; a child keyed anew replaces
 * the one before it, which closes above it as it opens. The first content shows at once: mount a
 * new `Presence` (key it) where nothing should arrive, such as another chat being opened.
 */
export function Presence({
  children,
  className,
  still = false,
  handedOver,
}: {
  children: readonly PresenceChild[];
  /** Classes for every child's box: its spacing, and where its own content needs a frame. */
  className?: string;
  /** While true (what it shows is still loading), and as it ends, changes show at once. */
  still?: boolean;
  /** Children that leave because something else took their place there: they go at once. */
  handedOver?: (key: string) => boolean;
}): JSX.Element {
  const { items, settle } = usePresence(children, still, handedOver);
  useSettleFallback(items, settle);
  return (
    <>
      {items.map((item) => {
        const leaving = item.phase === PresencePhase.Close;
        return (
          <div
            key={item.key}
            data-presence={item.phase}
            inert={leaving}
            aria-hidden={leaving || undefined}
            onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
              if (event.target === event.currentTarget && SETTLING_ANIMATIONS.has(event.animationName))
                settle(item.key);
            }}
            className={cn("presence", className)}
          >
            {item.value}
          </div>
        );
      })}
    </>
  );
}

/**
 * Whether something is on, or was until `ms` ago, so its leaving can be seen (a chevron fading as
 * the details it opens go); `leaving` while it lingers. Reduce Motion lets it go at once.
 */
export function useLinger(on: boolean, ms: number): { on: boolean; leaving: boolean } {
  const [state, setState] = useState({ was: on, lingering: false });
  if (state.was !== on) setState({ was: on, lingering: !on && !prefersReducedMotion() });
  const lingering = state.was === on ? state.lingering : !on && !prefersReducedMotion();
  useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setState((current) => ({ ...current, lingering: false })), ms);
    return () => clearTimeout(timer);
  }, [lingering, ms]);
  return { on: on || lingering, leaving: !on && lingering };
}
