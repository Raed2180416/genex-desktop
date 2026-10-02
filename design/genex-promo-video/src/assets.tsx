/** The generated theme's waveform. */
import { seeded } from "./theme";

/** Bar heights for a music clip: a phrase that rises, breaks and rises again. */
export function waveHeights(count: number): number[] {
  const rand = seeded(11);
  return Array.from({ length: count }, (_, i) => {
    const phrase = 0.55 + 0.45 * Math.sin((i / count) * Math.PI * 2.2 + 0.4);
    return Math.max(0.14, Math.min(1, phrase * (0.55 + rand() * 0.55)));
  });
}

/** A waveform of rounded bars; bars left of `progress` are played. */
export function Waveform({
  w,
  h,
  bars,
  progress,
  pulse,
  played,
  unplayed,
}: {
  w: number;
  h: number;
  bars: number[];
  progress: number;
  pulse: number;
  played: string;
  unplayed: string;
}) {
  const step = w / bars.length;
  const bw = Math.max(2, step * 0.56);
  return (
    <g>
      {bars.map((b, i) => {
        const beat = 0.86 + 0.14 * Math.sin(pulse * 0.9 + i * 0.7);
        const bh = Math.max(3, b * h * beat);
        const x = i * step + (step - bw) / 2;
        return (
          <rect
            key={i}
            x={x}
            y={(h - bh) / 2}
            width={bw}
            height={bh}
            rx={bw / 2}
            fill={i / bars.length < progress ? played : unplayed}
          />
        );
      })}
    </g>
  );
}
