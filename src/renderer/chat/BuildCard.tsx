import type { ComponentProps, JSX, ReactNode } from "react";
import { Icon } from "../ui/icons.tsx";

const MESSAGE = { open: "Open in Builds" } as const;

/** What opening the card does: its click, and the run it opens when it names one. */
export interface BuildCardOpen {
  onClick: () => void;
  runId?: string;
}

/**
 * The chat's one card for a build, running or finished: its picture, a title and one line, and
 * what sits on the right. Given `open`, the title is a button stretched over the whole card, so the
 * card itself opens the build on Builds; whatever sits on the right (Play) stays its own target.
 */
export function BuildCard({
  picture,
  title,
  line,
  aside,
  open,
  ...props
}: {
  /** the build's picture, omitted until one exists */
  picture?: ReactNode;
  title: string;
  /** the one line under the title */
  line?: ReactNode;
  /** what sits on the right: the clock, or Play */
  aside?: ReactNode;
  open?: BuildCardOpen;
} & Omit<ComponentProps<"div">, "title" | "className">): JSX.Element {
  return (
    <div {...props} className="build-card flex min-w-0 items-center gap-3 rounded-card bg-composer p-2">
      {picture}
      <div
        className={`build-card-text flex min-h-[55px] min-w-0 flex-1 flex-col justify-center ${picture ? "" : "ps-2"}`}
      >
        {open ? (
          <button
            type="button"
            title={MESSAGE.open}
            data-open-build={open.runId}
            onClick={open.onClick}
            className="build-card-open text-chat text-ink"
          >
            <span className="truncate">{title}</span>
            <Icon name="chevron-right" size={12} strokeWidth={2} />
          </button>
        ) : (
          <p className="m-0 truncate text-chat text-ink">{title}</p>
        )}
        {line}
      </div>
      {aside}
    </div>
  );
}
