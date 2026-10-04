/**
 * "Ready for your first idea": an old-school computer (monitor on its case, keyboard and mouse)
 * turning once every 9 s, drawn as a blueprint: page-coloured faces, edges in the theme's ink,
 * the edges behind dashed, and only the screen in the accent with a blinking prompt. Opaque, so
 * it is painted back to front: the parts by their depth, then each part's faces that face the
 * camera. On the hand-off to building it turns to face you and its screen boots.
 */
import type { Rgb, WireColors } from "./wire-art.ts";

type Vec3 = [number, number, number];
type Vec2 = [number, number];
type Face = Vec3[];

/** One mark on a face: a filled bar, an outline, or the screen itself. Alpha scales its colour. */
interface Decal {
  pts: Vec3[];
  open?: boolean;
  fill?: { glow: boolean; alpha: number };
  stroke?: { glow: boolean; alpha: number; width: number };
  screen?: boolean;
}
/** A closed solid: its faces, its centre (to tell outward from inward), and marks on its faces. */
interface Solid {
  faces: Face[];
  center: Vec3;
  decals: Array<{ face: number; items: Decal[] }>;
}
/** Parts painted together, ordered by the depth of `c`. */
interface Group {
  solids: Solid[];
  c: Vec3;
}
interface View {
  yaw: number;
  pitch: number;
  scale: number;
  cx: number;
  cy: number;
  dist: number;
  target: Vec3;
}

/** The computer's turn: one every 9 s, starting from a three-quarter view. */
export const COMPUTER_SPIN0 = 0.55;
const COMPUTER_SPIN = (2 * Math.PI) / 9;
/** The camera: a little above, looking at the screen's middle. */
const VIEW: Omit<View, "yaw"> = { pitch: 0.42, scale: 21, cx: 80, cy: 62, dist: 9, target: [0.1, 0.78, 0.32] };
/** Edges, hidden edges (dashed) and cables, as stroke alpha and width. */
const EDGE = { alpha: 0.95, width: 0.8 };
const HIDDEN = { alpha: 0.32, width: 0.6, dash: [1.4, 1.4] };
/** How far the screen leans into the accent from the page, idle and booting. */
const SCREEN_ACCENT = 0.5;
const BOOT_ACCENT = 0.72;
/** How far the screen's text leans from the accent to white. */
const GLOW_LIFT = 0.55;
/** The prompt blinks this many times a second. */
const BLINK_HZ = 1.6;

/** The yaw at `t` seconds into the idea's turn. */
export const computerYaw = (t: number): number => COMPUTER_SPIN0 - COMPUTER_SPIN * t;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k)) as Rgb;
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

function centroid(points: Vec3[]): Vec3 {
  const sum: Vec3 = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) sum[i] += p[i];
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

/** A closed solid through `rings` of equal length: their sides, and the first and last as caps. */
function loft(rings: Vec3[][]): Face[] {
  const faces: Face[] = [[...rings[0]], [...rings[rings.length - 1]]];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r];
    const b = rings[r + 1];
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      faces.push([a[i], a[j], b[j], b[i]]);
    }
  }
  return faces;
}
const rectZ = (x0: number, x1: number, y0: number, y1: number, z: number): Vec3[] => [
  [x0, y0, z],
  [x1, y0, z],
  [x1, y1, z],
  [x0, y1, z],
];
const secX = (x: number, yz: Vec2[]): Vec3[] => yz.map((q) => [x, q[0], q[1]]);

function roundRectZ(x0: number, x1: number, y0: number, y1: number, r: number, z: number): Vec3[] {
  const corners: Vec3[] = [
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
    [x0 + r, y0 + r, Math.PI],
    [x1 - r, y0 + r, 1.5 * Math.PI],
  ];
  const points: Vec3[] = [];
  for (const [x, y, from] of corners)
    for (let i = 0; i <= 4; i++) {
      const a = from + (i / 4) * (Math.PI / 2);
      points.push([x + r * Math.cos(a), y + r * Math.sin(a), z]);
    }
  return points;
}

function solid(faces: Face[], decals: Solid["decals"] = []): Solid {
  return { faces, center: centroid(faces.flat()), decals };
}

function curve(c: [Vec3, Vec3, Vec3, Vec3], n: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    points.push([0, 1, 2].map((k) => w[0] * c[0][k] + w[1] * c[1][k] + w[2] * c[2][k] + w[3] * c[3][k]) as Vec3);
  }
  return points;
}

const bar = (x0: number, x1: number, y0: number, y1: number, z: number, glow: boolean, alpha: number): Decal => ({
  pts: rectZ(x0, x1, y0, y1, z),
  fill: { glow, alpha },
});
const outline = (pts: Vec3[], alpha: number, width: number, open = false): Decal => ({
  pts,
  open,
  stroke: { glow: false, alpha, width },
});

/** The monitor's front: where the screen sits, and how far in front of it its text is. */
const MONITOR_FRONT = 0.4;
const SCREEN: [number, number, number, number, number] = [-0.62, 0.62, 0.66, 1.6, 0.12];
const SCREEN_Z = MONITOR_FRONT + 0.003;
const TEXT_Z = SCREEN_Z + 0.003;

/**
 * What the screen shows: a prompt with its cursor blinking (`cursor`), or, while it boots, a
 * progress bar `boot` of the way full.
 */
function screenDecals(cursor: boolean, boot: number | null): Decal[] {
  const [x0, x1, y0, y1, r] = SCREEN;
  const glass: Decal = { pts: roundRectZ(x0, x1, y0, y1, r, SCREEN_Z), screen: true };
  glass.stroke = { glow: false, alpha: 0.55, width: 0.6 };
  if (boot !== null)
    return [
      glass,
      bar(-0.46, -0.02, 1.3, 1.36, TEXT_Z, true, 0.85),
      { pts: rectZ(-0.46, 0.46, 1.06, 1.16, TEXT_Z), stroke: { glow: true, alpha: 0.9, width: 0.5 } },
      bar(-0.43, -0.43 + 0.86 * boot, 1.085, 1.135, TEXT_Z, true, 0.95),
    ];
  const prompt: Decal = {
    pts: [
      [-0.48, 1.13, TEXT_Z],
      [-0.41, 1.085, TEXT_Z],
      [-0.48, 1.04, TEXT_Z],
    ],
    open: true,
    stroke: { glow: true, alpha: 0.9, width: 0.6 },
  };
  return [
    glass,
    bar(-0.48, -0.06, 1.38, 1.44, TEXT_Z, true, 0.85),
    bar(-0.48, 0.24, 1.24, 1.3, TEXT_Z, true, 0.55),
    prompt,
    ...(cursor ? [bar(-0.35, -0.27, 1.03, 1.14, TEXT_Z, true, 0.95)] : []),
    bar(0.6, 0.67, 0.53, 0.57, TEXT_Z, true, 0.9),
  ];
}

/** The case under the monitor, with its drive slot, power light and vents on the front. */
function caseBox(): Solid {
  const front = 0.703;
  const vent = (x: number) =>
    outline(
      [
        [x, 0.1, front],
        [x, 0.26, front],
      ],
      0.4,
      0.5,
      true,
    );
  return solid(loft([rectZ(-1, 1, 0, 0.36, -0.9), rectZ(-1, 1, 0, 0.36, 0.7)]), [
    {
      face: 1,
      items: [
        outline(rectZ(0.12, 0.86, 0.09, 0.27, front), 0.5, 0.5),
        bar(0.24, 0.74, 0.165, 0.19, front, false, 0.6),
        bar(-0.86, -0.79, 0.12, 0.17, front, true, 0.95),
        vent(-0.62),
        vent(-0.54),
        vent(-0.46),
      ],
    },
  ]);
}

/** A wedge keyboard with four rows of twelve keys and a space bar on its sloped top. */
function keyboard(): Solid {
  const profile: Vec2[] = [
    [0, 0.95],
    [0, 1.6],
    [0.09, 1.6],
    [0.17, 0.95],
  ];
  const at = (u: number, v: number): Vec3 => [-1 + 2 * u, 0.17 - 0.08 * v + 0.004, 0.95 + 0.65 * v];
  const key = (a: number, b: number, va: number, vb: number) =>
    outline([at(a, va), at(b, va), at(b, vb), at(a, vb)], 0.42, 0.45);
  const rows = 4;
  const cols = 12;
  const [u0, u1, v0, v1, gap] = [0.05, 0.95, 0.1, 0.92, 0.18];
  const rh = (v1 - v0) / (rows + 1);
  const cw = (u1 - u0) / cols;
  const keys: Decal[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      keys.push(
        key(
          u0 + c * cw + (cw * gap) / 2,
          u0 + (c + 1) * cw - (cw * gap) / 2,
          v0 + r * rh + (rh * gap) / 2,
          v0 + (r + 1) * rh - (rh * gap) / 2,
        ),
      );
  keys.push(key(0.3, 0.7, v0 + rows * rh + (rh * gap) / 2, v1 - (rh * gap) / 2));
  return solid(loft([secX(-1, profile), secX(1, profile)]), [{ face: 4, items: keys }]);
}

/** A two-button mouse to the keyboard's right. */
function mouse(): Solid {
  const profile: Vec2[] = [
    [0, 1.12],
    [0, 1.46],
    [0.06, 1.46],
    [0.11, 1.34],
    [0.11, 1.2],
    [0.07, 1.12],
  ];
  return solid(loft([secX(1.25, profile), secX(1.47, profile)]), [
    {
      face: 6,
      items: [
        outline(
          [
            [1.25, 0.114, 1.28],
            [1.47, 0.114, 1.28],
          ],
          0.5,
          0.45,
          true,
        ),
        outline(
          [
            [1.36, 0.114, 1.2],
            [1.36, 0.114, 1.28],
          ],
          0.5,
          0.45,
          true,
        ),
      ],
    },
  ]);
}

/** The cables, from the mouse and the keyboard round to the back of the case. */
const CABLES: Decal[] = [
  outline(
    curve(
      [
        [1.36, 0.04, 1.12],
        [1.42, 0, 0.62],
        [1.3, 0, -0.3],
        [0.86, 0.12, -0.9],
      ],
      18,
    ),
    0.38,
    0.6,
    true,
  ),
  outline(
    curve(
      [
        [-0.55, 0.04, 0.95],
        [-1.45, 0, 0.85],
        [-1.4, 0, -0.35],
        [-0.86, 0.12, -0.9],
      ],
      18,
    ),
    0.38,
    0.6,
    true,
  ),
];

/** The parts that never change, made once. */
let parts: { monitor: Face[]; neck: Solid; caseBox: Solid; keyboard: Solid; mouse: Solid } | null = null;
function computerParts() {
  parts ??= {
    monitor: loft([
      rectZ(-0.8, 0.8, 0.46, 1.76, MONITOR_FRONT),
      rectZ(-0.8, 0.8, 0.46, 1.76, 0.15),
      rectZ(-0.5, 0.5, 0.66, 1.56, -0.72),
    ]),
    neck: solid(loft([rectZ(-0.32, 0.32, 0.36, 0.46, -0.4), rectZ(-0.32, 0.32, 0.36, 0.46, 0.05)])),
    caseBox: caseBox(),
    keyboard: keyboard(),
    mouse: mouse(),
  };
  return parts;
}

/** The computer as groups of solids; the screen's decals change with the prompt's blink and the boot. */
function computerScene(cursor: boolean, boot: number | null): Group[] {
  const { monitor, neck, caseBox: base, keyboard: keys, mouse: pointer } = computerParts();
  const screen = solid(monitor, [{ face: 0, items: screenDecals(cursor, boot) }]);
  return [
    { solids: [base, neck, screen], c: [0, 0.8, -0.1] },
    { solids: [keys], c: [0, 0.08, 1.27] },
    { solids: [pointer], c: [1.36, 0.05, 1.29] },
  ];
}

/** A point in the camera's frame: x right, y up, z towards the viewer. */
function inView(p: Vec3, view: View): Vec3 {
  const [x, y, z] = sub(p, view.target);
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}
function onCanvas(p: Vec3, view: View): Vec2 {
  const v = inView(p, view);
  const k = view.dist / (view.dist - v[2]);
  return [view.cx + v[0] * view.scale * k, view.cy - v[1] * view.scale * k];
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Vec3[], view: View, open = false): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = onCanvas(p, view);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (!open) ctx.closePath();
}

/** Does this face of `s` turn towards the camera? */
function facesCamera(face: Face, s: Solid, view: View): boolean {
  const n = cross(sub(face[1], face[0]), sub(face[2], face[0]));
  const middle = centroid(face);
  const outward: Vec3 = dot(n, sub(middle, s.center)) < 0 ? [-n[0], -n[1], -n[2]] : n;
  // Towards the eye: the outward normal against the line from the face to the camera.
  const eye = inView(middle, view);
  const normal = inView(outward, { ...view, target: [0, 0, 0] });
  return dot(normal, sub([0, 0, view.dist], eye)) > 0;
}

/** Every edge of a solid once, with the faces that share it. */
function edgesOf(s: Solid): Array<{ a: Vec3; b: Vec3; faces: number[] }> {
  const byKey = new Map<string, { a: Vec3; b: Vec3; faces: number[] }>();
  s.faces.forEach((face, fi) => {
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      const ka = a.map((v) => v.toFixed(2)).join(",");
      const kb = b.map((v) => v.toFixed(2)).join(",");
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const edge = byKey.get(key) ?? { a, b, faces: [] };
      edge.faces.push(fi);
      byKey.set(key, edge);
    });
  });
  return [...byKey.values()];
}

/** The theme's colours as the computer wears them. */
interface Inks {
  ink: Rgb;
  page: Rgb;
  screen: Rgb;
  glow: Rgb;
}

function drawDecal(ctx: CanvasRenderingContext2D, decal: Decal, view: View, inks: Inks): void {
  tracePath(ctx, decal.pts, view, decal.open);
  if (decal.screen) {
    ctx.fillStyle = rgba(inks.screen, 1);
    ctx.fill();
  } else if (decal.fill) {
    ctx.fillStyle = rgba(decal.fill.glow ? inks.glow : inks.ink, decal.fill.alpha);
    ctx.fill();
  }
  if (!decal.stroke) return;
  ctx.lineWidth = decal.stroke.width;
  ctx.strokeStyle = rgba(decal.stroke.glow ? inks.glow : inks.ink, decal.stroke.alpha);
  ctx.stroke();
}

/** One solid's faces towards the camera, with their marks; answers its edges no shown face holds. */
function drawSolid(ctx: CanvasRenderingContext2D, s: Solid, view: View, inks: Inks): Array<[Vec3, Vec3]> {
  const shown = s.faces.map((face) => facesCamera(face, s, view));
  s.faces.forEach((face, i) => {
    if (!shown[i]) return;
    tracePath(ctx, face, view);
    ctx.fillStyle = rgba(inks.page, 1);
    ctx.fill();
    ctx.lineWidth = EDGE.width;
    ctx.strokeStyle = rgba(inks.ink, EDGE.alpha);
    ctx.stroke();
  });
  for (const { face, items } of s.decals) if (shown[face]) for (const item of items) drawDecal(ctx, item, view, inks);
  return edgesOf(s)
    .filter((edge) => !edge.faces.some((fi) => shown[fi]))
    .map((edge) => [edge.a, edge.b]);
}

/** How the computer is drawn now: its yaw, its prompt's blink, its boot, and its opacity. */
export interface ComputerPose {
  yaw: number;
  /** Seconds, for the prompt's blink. */
  t: number;
  /** How far the boot's progress bar is; null while it is not booting. */
  boot: number | null;
  /** 1 opaque, 0 gone (the hand-off fades it out as the crane rises). */
  alpha: number;
}

/** Paint the computer onto the empty state's canvas, in the theme's `colors` over `page`. */
export function drawComputer(ctx: CanvasRenderingContext2D, pose: ComputerPose, colors: WireColors, page: Rgb): void {
  if (pose.alpha <= 0) return;
  const view: View = { ...VIEW, yaw: pose.yaw };
  const booting = pose.boot !== null;
  const inks: Inks = {
    ink: colors.ink,
    page,
    screen: mix(page, colors.fill, booting ? BOOT_ACCENT : SCREEN_ACCENT),
    glow: mix(colors.fill, [255, 255, 255], GLOW_LIFT),
  };
  const cursor = Math.floor(pose.t * BLINK_HZ) % 2 === 0;
  ctx.save();
  ctx.globalAlpha = pose.alpha;
  for (const cable of CABLES) drawDecal(ctx, cable, view, inks);
  const groups = computerScene(cursor, pose.boot).sort((a, b) => inView(a.c, view)[2] - inView(b.c, view)[2]);
  const hidden = groups.flatMap((group) => group.solids.flatMap((s) => drawSolid(ctx, s, view, inks)));
  ctx.lineWidth = HIDDEN.width;
  ctx.strokeStyle = rgba(inks.ink, HIDDEN.alpha);
  ctx.setLineDash(HIDDEN.dash);
  ctx.beginPath();
  for (const [a, b] of hidden) {
    ctx.moveTo(...onCanvas(a, view));
    ctx.lineTo(...onCanvas(b, view));
  }
  ctx.stroke();
  ctx.restore();
}
