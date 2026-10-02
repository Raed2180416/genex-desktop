/** Shared quiet accent fill for secondary calls to action. Geometry belongs to the caller. */
export function accentChipClass(): string {
  return [
    "border-0 bg-accent-primary/12 text-foreground",
    "transition-colors duration-(--duration-quick)",
    "hover:bg-accent-primary/20",
  ].join(" ");
}
