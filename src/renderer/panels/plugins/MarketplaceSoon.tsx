/** The Marketplace before it opens: its title, Coming soon, and a shelf of empty plugin slots. */
import type { JSX } from "react";
import { useId } from "react";
import { PLUGINS_WORDS } from "../../words.ts";

const WORDS = PLUGINS_WORDS.marketplace;

/** The shelf's size, its slots and the gap between them, in the drawing's own units. */
const SHELF = { width: 720, height: 132, slot: 56, gap: 20, columns: 9, rows: 2 } as const;
/** Where the arriving plugin sits: column, row. */
const ARRIVING = [4, 1] as const;

/** A few kinds of plugin the shelf hints at, as stroke glyphs on a 24-unit grid, by slot. */
const GLYPHS: ReadonlyArray<{ at: readonly [number, number]; d: string }> = [
  { at: [1, 0], d: "M12 3 4 7.5v9L12 21l8-4.5v-9zM4 7.5 12 12l8-4.5M12 12v9" },
  { at: [4, 0], d: "M4 10v4h3.5L12 18V6L7.5 10zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" },
  {
    at: [7, 0],
    d: "M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5zM4 17l5-4.5 4 3.5 3-2.5 4 3.5",
  },
  { at: [2, 1], d: "M15.2 7a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0zM5.5 20c.8-4 3.4-6 6.5-6s5.7 2 6.5 6" },
  {
    at: [6, 1],
    d: "M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
  },
];

const slotX = (column: number): number =>
  (SHELF.width - (SHELF.columns * SHELF.slot + (SHELF.columns - 1) * SHELF.gap)) / 2 +
  column * (SHELF.slot + SHELF.gap);
const slotY = (row: number): number => row * (SHELF.slot + SHELF.gap);

/** The drawing: rows of empty slots fading out at both ends, a few holding a faint glyph, one arriving. */
function Shelf(): JSX.Element {
  const id = useId();
  const slots = Array.from(
    { length: SHELF.columns * SHELF.rows },
    (_, i) => [i % SHELF.columns, Math.floor(i / SHELF.columns)] as const,
  );
  const [ax, ay] = [slotX(ARRIVING[0]), slotY(ARRIVING[1])];
  return (
    <svg className="marketplace-shelf" viewBox={`0 0 ${SHELF.width} ${SHELF.height}`} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-fade`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.16" stopColor="#fff" />
          <stop offset="0.84" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-mask`}>
          <rect width={SHELF.width} height={SHELF.height} fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`}>
        {slots
          .filter(([c, r]) => c !== ARRIVING[0] || r !== ARRIVING[1])
          .map(([c, r]) => (
            <rect
              key={`${c}-${r}`}
              className="marketplace-slot"
              x={slotX(c)}
              y={slotY(r)}
              width={SHELF.slot}
              height={SHELF.slot}
              rx="14"
            />
          ))}
        {GLYPHS.map(({ at: [c, r], d }) => (
          <path
            key={d}
            className="marketplace-glyph"
            d={d}
            transform={`translate(${slotX(c) + 15} ${slotY(r) + 15}) scale(1.08)`}
          />
        ))}
        <g className="marketplace-arriving">
          <rect x={ax} y={ay} width={SHELF.slot} height={SHELF.slot} rx="14" />
          <path d={`M${ax + SHELF.slot / 2} ${ay + 18}v20M${ax + 18} ${ay + SHELF.slot / 2}h20`} />
        </g>
      </g>
    </svg>
  );
}

/** The Marketplace while it has nothing to offer yet: Coming soon, the shelf and one line. */
export function MarketplaceSoon(): JSX.Element {
  return (
    <section className="extensions-section" data-marketplace-soon="" aria-label={WORDS.title}>
      <div className="extensions-section-heading extensions-section-heading-plain">
        <h2>{WORDS.title}</h2>
        <span className="marketplace-badge">{WORDS.soon}</span>
      </div>
      <div className="marketplace-soon">
        <Shelf />
        <p>{WORDS.text}</p>
      </div>
    </section>
  );
}
