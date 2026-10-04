import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The named type-scale roles from `app/globals.css` (AG-893).
 *
 * tailwind-merge has to be TOLD about them, and the failure without this is
 * silent and total: it classifies any unknown `text-*` class as a colour, so
 * `cn("text-micro", "text-foreground")` decided the two conflicted and dropped
 * the size entirely. Nothing errored - the text simply rendered at whatever
 * size it inherited, which is exactly the kind of drift the scale exists to
 * end. Any role added to the scale is added here in the same commit.
 */
const TYPE_SCALE_ROLES = [
  "text-micro",
  "text-body-sm",
  "text-chat",
  "text-step",
  "text-status",
  "text-chat-sub",
  "text-reply-h1",
  "text-reply-h2",
  "text-feature-body",
  "text-name",
  "text-composer",
  "text-strip",
  "text-feature-title",
  "text-dialog-body",
  "text-dialog-sub",
  "text-card-title",
  "text-nav",
  "text-heading",
  "text-title",
  "text-display-sm",
  "text-display-md",
  "text-tools-hero-mobile",
  "text-display-lg",
  "text-display-xl",
  "text-display-2xl",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [...TYPE_SCALE_ROLES],
    },
  },
});

/** Class names joined, a later Tailwind class winning over an earlier one it conflicts with. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
