/**
 * The Genex Tools promo: a Genex window on the Genex sky. One message asks for a cottage, a well,
 * a tree and village music; Genex makes them (the models materialize on the asset grid, the theme
 * starts playing), then the finished game runs in Live, and the window settles back so the film loops.
 */
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Waveform, waveHeights } from "./assets";
import { C, FPS, FRAMES, H, MONO, SANS, W } from "./theme";

// ── the timeline, in frames at 30 fps ─────────────────────────────────────────────────────
const PROMPT = "A cottage, a well, a tree and village music";
/** The first screen holds still for a moment before anyone types. */
const OPENING_HOLD = 45;
const TYPE_START = OPENING_HOLD;
const FRAMES_PER_CHAR = 1;
const TYPE_END = TYPE_START + Math.ceil(PROMPT.length * FRAMES_PER_CHAR);
const SEND = TYPE_END + 6;
const BUBBLE = SEND + 5;
const CAPTION = BUBBLE + 12;
/** The asset clip starts on its empty grid; `solidAt` is where a model turns from cyan to solid. */
const CLIP_START = CAPTION + 4;
const solidAt = (seconds: number) => CLIP_START + Math.round(seconds * FPS);
const ROWS = [
  { name: "Cottage", icon: "cube", start: CAPTION + 6, done: solidAt(1.13) + 2 },
  { name: "Well", icon: "cube", start: CAPTION + 14, done: solidAt(2.13) + 2 },
  { name: "Oak tree", icon: "cube", start: CAPTION + 22, done: solidAt(3.13) + 2 },
  { name: "Village theme", icon: "bars", start: CAPTION + 30, done: solidAt(3.13) + 24 },
] as const;
const MUSIC = ROWS[3];
const ALL_DONE = MUSIC.done;
const TO_LIVE = ALL_DONE + 18;
const CROSSFADE = 14;
/** The game clip starts a little before Live shows so it is already moving. */
const GAME_START = TO_LIVE - 8;
const TOAST = TO_LIVE + 18;
/** How long Live plays before the window settles back. */
const LIVE_HOLD = 116;
const SETTLE = TO_LIVE + LIVE_HOLD;

// ── the window's geometry ─────────────────────────────────────────────────────────────────
const WIN = { x: 36, y: 30, w: 688, h: 430 };
const CHAT_W = 280;
const STAGE_X = CHAT_W + 1;
const STAGE_PAD = 16;
const VIEW = { x: STAGE_X + STAGE_PAD, y: 52, w: WIN.w - STAGE_X - STAGE_PAD * 2, h: 290 };

const EMPTY_GRID = staticFile("clips/village-empty.jpg");
const ASSET_CLIP = staticFile("clips/village-assets.mp4");
const GAME_CLIP = staticFile("clips/village-game.mp4");

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const fade = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], { ...clamp, easing: ease });
/** 1 while the chat's work shows, easing to 0 as the window settles back for the loop. */
const settle = (frame: number) => 1 - fade(frame, SETTLE, SETTLE + 24);
/** How far the typed line overflows before the composer's left edge has fully faded. */
const FADE_IN_PX = 16;
const cover: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };

function useFonts(): void {
  const [handle] = useState(() => delayRender("Genex fonts"));
  useEffect(() => {
    const faces = [
      new FontFace("Zalando Sans SemiExpanded", `url(${staticFile("fonts/ZalandoSansSemiExpanded-variable.woff2")})`, {
        weight: "200 900",
      }),
      new FontFace("Geist Mono", `url(${staticFile("fonts/GeistMono-variable.woff2")})`, { weight: "100 900" }),
    ];
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => {
        for (const f of loaded) document.fonts.add(f);
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
  }, [handle]);
}

// ── glyphs in the app's line style ────────────────────────────────────────────────────────
function Glyph({ name, size = 18, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "cube")
    return (
      <svg {...common}>
        <path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z" />
        <path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5" />
      </svg>
    );
  if (name === "bars")
    return (
      <svg {...common}>
        <path d="M5 14V10M8.5 17V7M12 20V4M15.5 16V8M19 13.5v-3" />
      </svg>
    );
  if (name === "boxes")
    return (
      <svg {...common}>
        <path d="M7.5 6l4.5 2.6v5L7.5 16.2 3 13.6v-5z" />
        <path d="M3 8.6l4.5 2.6L12 8.6M7.5 11.2v5" />
        <path d="M16.5 8l4.5 2.6v5l-4.5 2.6-4.5-2.6v-5z" />
        <path d="M12 10.6l4.5 2.6 4.5-2.6M16.5 13.2v5" />
      </svg>
    );
  if (name === "check")
    return (
      <svg {...common} strokeWidth={2.2}>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    );
  if (name === "plus")
    return (
      <svg {...common} strokeWidth={2}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  if (name === "up")
    return (
      <svg {...common} strokeWidth={2.2}>
        <path d="M12 19V5M6 11l6-6 6 6" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M8 5.5v13l10-6.5z" fill={color} />
    </svg>
  );
}

// ── the sky behind the window ─────────────────────────────────────────────────────────────
function Sky() {
  const frame = useCurrentFrame();
  const t = (frame / FRAMES) * Math.PI * 2;
  const cloud = (x: number, y: number, r: number, color: string, opacity: number, phase: number): CSSProperties => ({
    position: "absolute",
    left: x + Math.sin(t + phase) * 18,
    top: y + Math.cos(t + phase) * 6,
    width: r * 2,
    height: r * 1.2,
    borderRadius: "50%",
    background: color,
    opacity,
    filter: "blur(38px)",
  });
  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${C.skyDeep} 0%, ${C.skyMid} 48%, ${C.skyBlue} 100%)` }}>
      <div style={cloud(-60, 250, 190, C.skyHaze, 0.5, 0)} />
      <div style={cloud(520, -60, 170, C.skyWhite, 0.22, 1.4)} />
      <div style={cloud(380, 300, 150, C.skyWhite, 0.18, 2.6)} />
      <div style={cloud(120, -80, 140, C.skyHaze, 0.3, 4)} />
    </AbsoluteFill>
  );
}

// ── the chat ──────────────────────────────────────────────────────────────────────────────
function Composer() {
  const frame = useCurrentFrame();
  const typed = PROMPT.slice(0, Math.max(0, Math.floor((frame - TYPE_START) / FRAMES_PER_CHAR)));
  const hasText = frame >= TYPE_START && frame < BUBBLE;
  const shown = frame < BUBBLE ? typed : "";
  const caretOn = Math.floor(frame / 15) % 2 === 0;
  const press = interpolate(frame, [SEND - 2, SEND, SEND + 5], [1, 0.9, 1], clamp);
  // How far the typed line runs past the field: it scrolls left by exactly that, never jumping,
  // and the left edge fades in as it starts to overflow.
  const field = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useLayoutEffect(() => {
    if (field.current && line.current) setOverflow(Math.max(0, line.current.offsetWidth - field.current.clientWidth));
  });
  const edge = 1 - Math.min(1, overflow / FADE_IN_PX);
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        top: 306,
        width: CHAT_W - 24,
        height: 50,
        borderRadius: 25,
        background: C.panel,
        boxShadow: `0 0 0 1px ${C.line}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 9px",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: C.hover,
          display: "grid",
          placeItems: "center",
          color: C.ink2,
          flexShrink: 0,
        }}
      >
        <Glyph name="plus" size={16} />
      </div>
      <div
        ref={field}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          display: "flex",
          // The row is at least the field's width and pinned to its right: short text sits at the
          // left, and longer text overflows off the left edge one character at a time.
          justifyContent: "flex-end",
          maskImage: `linear-gradient(90deg, rgba(0,0,0,${edge}) 0, #000 22px)`,
          fontFamily: SANS,
          fontSize: 15,
          whiteSpace: "nowrap",
          color: hasText ? C.ink : C.ink3,
        }}
      >
        <div style={{ flex: "none", minWidth: "100%", display: "flex" }}>
          <span ref={line} style={{ display: "inline-flex", alignItems: "center" }}>
            <span>{hasText ? shown : "Ask for a change…"}</span>
            {hasText && (
              <span
                style={{
                  width: 1.5,
                  height: 18,
                  marginLeft: 1,
                  background: C.accent,
                  opacity: caretOn ? 1 : 0,
                  flexShrink: 0,
                }}
              />
            )}
          </span>
        </div>
      </div>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: C.ink,
          display: "grid",
          placeItems: "center",
          color: C.canvas,
          transform: `scale(${press})`,
          opacity: hasText ? 1 : 0.35,
          flexShrink: 0,
        }}
      >
        <Glyph name="up" size={16} />
      </div>
    </div>
  );
}

function Bubble() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - BUBBLE, fps, config: { damping: 200 }, durationInFrames: 14 });
  if (frame < BUBBLE) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: WIN.w - CHAT_W + 12,
        top: 50,
        maxWidth: 206,
        padding: "8px 12px",
        borderRadius: 16,
        background: C.soft,
        color: C.ink,
        fontFamily: SANS,
        fontSize: 15,
        lineHeight: "21px",
        opacity: enter * settle(frame),
        transform: `translateY(${(1 - enter) * 40}px)`,
      }}
    >
      {PROMPT}
    </div>
  );
}

/** "Generating" with the light passing over it, as current work shimmers in the app. */
function Shimmer({ text, frame }: { text: string; frame: number }) {
  const x = ((frame % 36) / 36) * 260 - 80;
  return (
    <span
      style={{
        backgroundImage: `linear-gradient(90deg, ${C.ink3} 0%, ${C.ink3} 40%, ${C.ink} 50%, ${C.ink3} 60%, ${C.ink3} 100%)`,
        backgroundSize: "260% 100%",
        backgroundPosition: `${-x}% 0`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }}
    >
      {text}
    </span>
  );
}

function Rows() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const caption = fade(frame, CAPTION, CAPTION + 10) * settle(frame);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 16,
          top: 120,
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: C.accent,
          fontFamily: SANS,
          fontSize: 15,
          opacity: caption,
        }}
      >
        <Glyph name="boxes" size={20} color={C.accent} />
        Genex Tools
      </div>
      {ROWS.map((row, i) => {
        const enter = spring({ frame: frame - row.start, fps, config: { damping: 200 }, durationInFrames: 12 });
        const progress = interpolate(frame, [row.start + 4, row.done], [0, 1], {
          ...clamp,
          easing: Easing.inOut(Easing.quad),
        });
        const done = frame >= row.done;
        const check = spring({ frame: frame - row.done, fps, config: { damping: 14, stiffness: 180 } });
        if (frame < row.start) return null;
        return (
          <div
            key={row.name}
            style={{
              position: "absolute",
              left: 12,
              top: 146 + i * 38,
              width: CHAT_W - 24,
              height: 34,
              padding: "0 10px",
              borderRadius: 11,
              background: C.surface,
              boxShadow: `0 0 0 1px ${C.line}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: SANS,
              fontSize: 15,
              color: C.ink,
              opacity: enter * settle(frame),
              transform: `translateY(${(1 - enter) * 10}px)`,
              overflow: "hidden",
            }}
          >
            <Glyph name={row.icon} size={18} color={done ? C.ink2 : C.accent} />
            <span style={{ flex: 1 }}>{row.name}</span>
            {done ? (
              <span style={{ color: C.green, transform: `scale(${0.4 + 0.6 * check})`, display: "grid" }}>
                <Glyph name="check" size={18} color={C.green} />
              </span>
            ) : (
              <Shimmer text="Generating" frame={frame} />
            )}
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                height: 2,
                width: `${progress * 100}%`,
                background: C.accent,
                opacity: done ? 1 - fade(frame, row.done, row.done + 10) : 0.9,
              }}
            />
          </div>
        );
      })}
    </>
  );
}

// ── the stage ─────────────────────────────────────────────────────────────────────────────
function Tabs({ live }: { live: number }) {
  const pillX = interpolate(live, [0, 1], [58, 0]);
  const pillW = interpolate(live, [0, 1], [76, 54]);
  const tab = (label: string, on: boolean): CSSProperties => ({
    position: "relative",
    width: label === "Live" ? 54 : 76,
    textAlign: "center",
    lineHeight: "28px",
    fontFamily: MONO,
    fontSize: 15,
    color: on ? C.ink : C.ink3,
  });
  return (
    <div style={{ position: "absolute", left: STAGE_X + 14, top: 8, display: "flex", gap: 4 }}>
      <div
        style={{
          position: "absolute",
          left: pillX,
          top: 0,
          width: pillW,
          height: 28,
          borderRadius: 9,
          background: C.hover,
        }}
      />
      <span style={tab("Live", live > 0.5)}>Live</span>
      <span style={tab("Assets", live <= 0.5)}>Assets</span>
    </div>
  );
}

/** The stage's picture: the asset grid, then the game. */
const frameBox: CSSProperties = {
  position: "absolute",
  left: VIEW.x,
  top: VIEW.y,
  width: VIEW.w,
  height: VIEW.h,
  borderRadius: 12,
  overflow: "hidden",
  background: C.surface,
  boxShadow: `0 0 0 1px ${C.line}`,
};

/** A dark glass pill over the picture, for status and the playing theme. */
const glass: CSSProperties = {
  position: "absolute",
  height: 34,
  padding: "0 12px",
  borderRadius: 17,
  background: "rgba(12, 13, 18, 0.62)",
  backdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  gap: 9,
  fontFamily: MONO,
  fontSize: 15,
  color: C.ink,
};

/** The asset grid's status: a pulsing dot while Genex works, then what it made and what it cost. */
function GridStatus() {
  const frame = useCurrentFrame();
  const shown = fade(frame, CAPTION + 6, CAPTION + 16);
  if (frame < CAPTION + 6) return null;
  const done = frame >= ALL_DONE;
  const pulse = 0.45 + 0.55 * Math.abs(Math.sin((frame - CAPTION) * 0.12));
  return (
    <div style={{ ...glass, left: 12, top: 12, opacity: shown }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          background: done ? C.green : C.ink2,
          opacity: done ? 1 : pulse,
        }}
      />
      {done ? "4 assets · 32 credits" : <Shimmer text="Generating…" frame={frame} />}
    </div>
  );
}

const BARS = waveHeights(26);
const GAME_BARS = waveHeights(18);

/** The new theme, starting to play the moment it is made. */
function ThemeChip() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < MUSIC.done) return null;
  const enter = spring({ frame: frame - MUSIC.done, fps, config: { damping: 16, stiffness: 170 } });
  const play = interpolate(frame, [MUSIC.done, MUSIC.done + 150], [0, 1], clamp);
  return (
    <div
      style={{
        ...glass,
        left: 12,
        bottom: 12,
        height: 40,
        borderRadius: 20,
        padding: "0 14px 0 8px",
        opacity: Math.min(1, enter * 1.4),
        transform: `translateY(${(1 - enter) * 12}px)`,
      }}
    >
      <span
        style={{ width: 26, height: 26, borderRadius: 13, background: C.accent, display: "grid", placeItems: "center" }}
      >
        <Glyph name="play" size={12} color={C.canvas} />
      </span>
      <span style={{ fontFamily: SANS, color: C.ink }}>Village theme</span>
      <svg width={120} height={22}>
        <Waveform
          w={120}
          h={22}
          bars={BARS}
          progress={play}
          pulse={frame * 0.35}
          played={C.accent}
          unplayed="rgba(222,224,226,0.3)"
        />
      </svg>
    </div>
  );
}

/** Genex's asset grid: empty at rest, then the cottage, the well and the tree materialize on it. */
function AssetGrid({ opacity }: { opacity: number }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ ...frameBox, opacity }}>
      {frame < CLIP_START && <Img src={EMPTY_GRID} style={cover} />}
      <Sequence from={CLIP_START} layout="none">
        <OffthreadVideo src={ASSET_CLIP} muted style={cover} />
      </Sequence>
      <GridStatus />
      <ThemeChip />
    </div>
  );
}

/** The finished game in Live: the new models in one village, the theme playing. */
function LiveGame({ opacity }: { opacity: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const toast = spring({ frame: frame - TOAST, fps, config: { damping: 200 }, durationInFrames: 14 });
  return (
    <div style={{ ...frameBox, opacity }}>
      <Sequence from={GAME_START} layout="none">
        <OffthreadVideo src={GAME_CLIP} muted style={cover} />
      </Sequence>
      {frame >= TOAST && (
        <div
          style={{
            ...glass,
            left: 12,
            top: 12,
            fontFamily: SANS,
            color: C.ink,
            opacity: toast,
            transform: `translateY(${(1 - toast) * -8}px)`,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 4, background: C.green }} />4 assets in your game
        </div>
      )}
      <div style={{ ...glass, right: 12, bottom: 12, gap: 10 }}>
        <Glyph name="bars" size={16} color={C.accent} />
        <svg width={110} height={20}>
          <Waveform
            w={110}
            h={20}
            bars={GAME_BARS}
            progress={1}
            pulse={frame * 0.6}
            played={C.accent}
            unplayed={C.accent}
          />
        </svg>
      </div>
    </div>
  );
}


/** The empty grid the loop starts on, back again as the window settles. */
function EmptyGrid({ opacity }: { opacity: number }) {
  return (
    <div style={{ ...frameBox, opacity }}>
      <Img src={EMPTY_GRID} style={cover} />
    </div>
  );
}

function Stage() {
  const frame = useCurrentFrame();
  const toLive = fade(frame, TO_LIVE, TO_LIVE + CROSSFADE);
  const back = fade(frame, SETTLE + 6, SETTLE + 26);
  const live = toLive * (1 - back);
  // The grid stays under Live until Live is opaque, then goes: the loop returns to the empty grid.
  const gridShown = frame < TO_LIVE + CROSSFADE;
  return (
    <>
      <Tabs live={live} />
      {frame >= TO_LIVE && <EmptyGrid opacity={back} />}
      {gridShown && <AssetGrid opacity={1} />}
      {frame >= GAME_START && frame < FRAMES && <LiveGame opacity={live} />}
    </>
  );
}

// ── the camera ────────────────────────────────────────────────────────────────────────────
/**
 * Where the camera looks: the whole window at rest, then the composer while typing, the chat and
 * the asset grid as Genex works, close on the game, and back to rest so the loop joins.
 */
const SHOTS: Array<{ at: number; s: number; tx: number; ty: number }> = [
  { at: 0, s: 1, tx: 0, ty: 0 },
  { at: TYPE_START + 2, s: 1, tx: 0, ty: 0 },
  { at: TYPE_START + 30, s: 1.2, tx: -44, ty: -74 },
  { at: CAPTION, s: 1.2, tx: -44, ty: -74 },
  { at: CAPTION + 24, s: 1.1, tx: -44, ty: -30 },
  { at: TO_LIVE - 2, s: 1.1, tx: -44, ty: -30 },
  { at: TO_LIVE + 28, s: 1.3, tx: -176, ty: -86 },
  { at: SETTLE, s: 1.33, tx: -196, ty: -91 },
  { at: SETTLE + 30, s: 1, tx: 0, ty: 0 },
  { at: FRAMES, s: 1, tx: 0, ty: 0 },
];

function camera(frame: number): string {
  const at = SHOTS.map((shot) => shot.at);
  const opts = { ...clamp, easing: Easing.inOut(Easing.cubic) };
  const pick = (key: "s" | "tx" | "ty") => interpolate(frame, at, SHOTS.map((shot) => shot[key]), opts);
  return `translate(${pick("tx")}px, ${pick("ty")}px) scale(${pick("s")})`;
}

// ── the window ────────────────────────────────────────────────────────────────────────────
function Window() {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: WIN.x,
        top: WIN.y,
        width: WIN.w,
        height: WIN.h,
        transform: camera(frame),
        transformOrigin: "0 0",
        borderRadius: 14,
        background: C.canvas,
        boxShadow: "0 24px 70px rgba(6, 10, 40, 0.55), 0 0 0 1px rgba(255,255,255,0.07)",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", left: 16, top: 16, display: "flex", gap: 8 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 11, height: 11, borderRadius: 6, background: c, opacity: 0.9 }} />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 84,
          top: 11,
          fontFamily: SANS,
          fontSize: 15,
          fontWeight: 500,
          color: C.ink,
          lineHeight: "22px",
        }}
      >
        Oakvale
      </div>
      <div style={{ position: "absolute", left: CHAT_W, top: 0, bottom: 0, width: 1, background: C.line }} />
      <Bubble />
      <Rows />
      <Composer />
      <Stage />
    </div>
  );
}

export function GenexPromo() {
  useFonts();
  return (
    <AbsoluteFill style={{ width: W, height: H, overflow: "hidden" }}>
      <Sky />
      <Window />
    </AbsoluteFill>
  );
}
