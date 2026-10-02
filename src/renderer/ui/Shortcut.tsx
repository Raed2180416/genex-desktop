import type { ReactNode } from "react";
/** Shared, quiet shortcut hint used in tooltips and keyboard-driven dialogs. */
export function Shortcut({ children }: { children: ReactNode }) {
  const keys = typeof children === "string" ? children.match(/[⌘⌃⌥⇧]|[^⌘⌃⌥⇧]+/g) : null;
  return <kbd className="shortcut">{keys ? keys.map((key, i) => <span key={i}>{key}</span>) : children}</kbd>;
}
