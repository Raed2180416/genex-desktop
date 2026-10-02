/**
 * Keyboard movement along a row of options (tabs, a menu's rows, a segmented control): the arrows
 * of the row's axis step one place and wrap around, Home and End jump to the ends.
 */

/** Which arrows step along a row. */
export const RovingAxis = {
  Vertical: "vertical",
  Horizontal: "horizontal",
  /** Both pairs: left and up go back, right and down go forward. */
  Both: "both",
} as const;
export type RovingAxis = (typeof RovingAxis)[keyof typeof RovingAxis];

const BACK = -1;
const FORWARD = 1;
const VERTICAL: ReadonlyArray<[string, number]> = [
  ["ArrowUp", BACK],
  ["ArrowDown", FORWARD],
];
const HORIZONTAL: ReadonlyArray<[string, number]> = [
  ["ArrowLeft", BACK],
  ["ArrowRight", FORWARD],
];
const STEPS: Record<RovingAxis, ReadonlyMap<string, number>> = {
  [RovingAxis.Vertical]: new Map(VERTICAL),
  [RovingAxis.Horizontal]: new Map(HORIZONTAL),
  [RovingAxis.Both]: new Map([...HORIZONTAL, ...VERTICAL]),
};

/** Does this key move along a row of this axis? */
export const isRovingKey = (key: string, axis: RovingAxis): boolean =>
  key === "Home" || key === "End" || STEPS[axis].has(key);

/**
 * The index a key moves to from `current` in a row of `count`, or null for a key that does not
 * move. Stepping wraps around; from no current place (-1) a forward step lands on the first.
 */
export function rovingTarget(key: string, current: number, count: number, axis: RovingAxis): number | null {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const step = STEPS[axis].get(key);
  if (step === undefined) return null;
  return (current + step + count) % count;
}
