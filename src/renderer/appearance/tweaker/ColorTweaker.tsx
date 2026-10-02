/**
 * The developer colour tweaker: a floating panel, dragged by its header, that edits one preset's
 * fourteen roles live over the running app. Knobs move every neutral at once; each role takes a
 * hex or opens a colour picker. Copy gives the preset's `PRESETS` entry to paste into `appearance/themes.ts`.
 * Loaded only in an unpackaged developer run (`ColorTweakerHost.tsx`).
 */
import type { ClipboardEvent, CSSProperties, JSX, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../ui/icons.tsx";
import { type AnyRole, hex, SHADOW_PLACES, Scheme, type Shadow, type ShadowPlace, shadowColor } from "../themes.ts";
import {
  drivenVariables,
  IDENTITY_KNOBS,
  isDetail,
  KNOB_SPECS,
  type KnobKey,
  type Knobs,
  LABEL_TYPE,
  LABEL_TYPE_KEYS,
  LOGO_WIDTH,
  pastedColors,
  ROLE_GROUPS,
  ROLE_LABEL,
  readability,
  SHADOW_AUTO,
  SHADOW_LABEL,
  SHADOW_SPECS,
  shadowText,
  shownColor,
  shownShadow,
} from "./tweaker.ts";
import { ColorPicker } from "./ColorPicker.tsx";
import { TWEAKER_CSS } from "./tweaker-style.ts";
import { useIsolation } from "./use-isolation.ts";
import { usePanelDrag } from "./use-panel-drag.ts";
import { type Tweaker, useTweaker } from "./use-tweaker.ts";

/** How long a copy button says it copied. */
const COPIED_MS = 1200;
/** The gradient a knob's track shows. */
function knobTrack(key: KnobKey, k: Knobs): string {
  if (key === "tintHue") return "linear-gradient(to right in oklch longer hue, oklch(0.7 0.14 0), oklch(0.7 0.14 360))";
  if (key === "tint") return `linear-gradient(to right, oklch(0.55 0 0), oklch(0.55 0.14 ${k.tintHue}))`;
  if (key === "saturation") return "linear-gradient(to right, oklch(0.55 0 0), oklch(0.55 0.2 250))";
  if (key === "lift") return "linear-gradient(to right, #000, #fff)";
  return "linear-gradient(to right, #2a2a2e, #2a2a2e 40%, #55555c)";
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  track: string;
  shown: string;
  onChange(value: number): void;
  onReset?(): void;
}): JSX.Element {
  return (
    <label className="ct-slider" onDoubleClick={props.onReset}>
      <span className="ct-slider-label">{props.label}</span>
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        style={{ "--track": props.track } as CSSProperties}
        onChange={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <output>{props.shown}</output>
    </label>
  );
}

function KnobSliders({ t }: { t: Tweaker }): JSX.Element {
  return (
    <>
      {KNOB_SPECS.map(({ key, label, min, max, step }) => (
        <Slider
          key={key}
          label={label}
          value={t.knobs[key]}
          min={min}
          max={max}
          step={step}
          track={knobTrack(key, t.knobs)}
          shown={key === "tintHue" ? `${t.knobs[key]}°` : String(t.knobs[key])}
          onChange={(value) => t.setKnob(key, value)}
          onReset={() => t.setKnob(key, IDENTITY_KNOBS[key])}
        />
      ))}
    </>
  );
}

/** A typed hex, with or without its `#`, as `#rrggbb`. */
const typedHex = (text: string): string | undefined => hex(text.trim().replace(/^#?/, "#"));

/** A colour typed as hex: kept as typed until it is a colour, then set. */
function HexInput({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = Boolean(typedHex(text));
  return (
    <input
      className="ct-hex"
      aria-label={`${label} hex`}
      aria-invalid={!valid}
      spellCheck={false}
      value={text}
      onChange={(e) => {
        setText(e.currentTarget.value);
        const color = typedHex(e.currentTarget.value);
        if (color && /^#?[\da-f]{6}$/i.test(e.currentTarget.value.trim())) onChange(color);
      }}
      onBlur={() => {
        const color = typedHex(text);
        if (color) onChange(color);
        else setText(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/** The contrast a role reads at where it is drawn, flagged below what WCAG AA asks of it. */
function ReadBadge({ t, role }: { t: Tweaker; role: AnyRole }): JSX.Element | null {
  const read = readability(t.palette, role);
  if (!read) return null;
  const low = read.ratio < read.minimum;
  const title = `Worst contrast where it is drawn; AA asks ${read.minimum}:1. Drawn exactly as set.`;
  return (
    <span className="ct-badge" data-low={low || undefined} title={title}>
      {read.ratio.toFixed(1)}
    </span>
  );
}

function RoleRow(props: { t: Tweaker; role: AnyRole; open: boolean; onToggle(): void }): JSX.Element {
  const { t, role, open } = props;
  const color = shownColor(t.palette, role);
  const designed = shownColor(t.preset.colors, role);
  const changed = t.palette[role] !== t.preset.colors[role];
  const auto = !t.palette[role];
  // A detail the preset sets itself can be handed back to the app.
  const toAuto = isDetail(role) && !auto && !changed;
  const label = ROLE_LABEL[role];
  const swatch = changed ? `linear-gradient(90deg, ${designed} 50%, ${color} 50%)` : color;
  return (
    <>
      <div
        className="ct-role"
        data-role={role}
        data-changed={changed || undefined}
        data-auto={auto || undefined}
        data-open={open || undefined}
      >
        <button
          type="button"
          className="ct-swatch"
          style={{ background: swatch }}
          aria-label={`Pick ${label}`}
          aria-expanded={open}
          onClick={props.onToggle}
        />
        <span
          className="ct-role-name"
          onMouseEnter={(e) => {
            e.currentTarget.title = `${role} → ${drivenVariables(t.palette, role).join(", ")}`;
          }}
        >
          {label}
        </span>
        <ReadBadge t={t} role={role} />
        <HexInput label={label} value={color} onChange={(v) => t.setColor(role, v)} />
        <button
          type="button"
          className="ct-btn ct-icon"
          aria-label={`Locate ${label}`}
          title="Hover to flash where this color is used"
          onPointerEnter={() => t.setLocating(role)}
          onPointerLeave={() => t.setLocating(null)}
        >
          <Icon name="eye" size={14} />
        </button>
        <button
          type="button"
          className="ct-btn ct-icon"
          aria-label={toAuto ? `Make ${label} auto` : `Reset ${label}`}
          disabled={!changed && !toAuto}
          onClick={() => (toAuto ? t.setColor(role, undefined) : t.resetRole(role))}
        >
          <Icon name="undo" size={13} />
        </button>
      </div>
      {open && <ColorPicker color={color} onChange={(v) => t.setColor(role, v)} />}
    </>
  );
}

/** The track a shadow measure's slider shows. */
const SHADOW_TRACK = "linear-gradient(to right, #2a2a2e, #55555c)";

/** One place's shadow: its colour and opacity in the swatch, a hex, and its measures when open. */
function ShadowRow(props: { t: Tweaker; place: ShadowPlace; open: boolean; onToggle(): void }): JSX.Element {
  const { t, place, open } = props;
  const own = t.palette.shadows?.[place];
  const shadow = shownShadow(t.palette, place);
  const changed = shadowText(own) !== shadowText(t.preset.colors.shadows?.[place]);
  // A shadow the preset sets itself can be handed back to the place.
  const toAuto = !changed && Boolean(own);
  const { label, title } = SHADOW_LABEL[place];
  const set = (next: Partial<Shadow>): void => t.setShadow(place, { ...shadow, ...next });
  const tint = shadowColor(shadow);
  return (
    <>
      <div
        className="ct-role"
        data-shadow={place}
        data-changed={changed || undefined}
        data-auto={!own || undefined}
        data-open={open || undefined}
        title={title}
      >
        <button
          type="button"
          className="ct-swatch"
          style={{ background: `linear-gradient(${tint}, ${tint}), #ffffff` }}
          aria-label={`Edit ${label} shadow`}
          aria-expanded={open}
          onClick={props.onToggle}
        />
        <span className="ct-role-name">{label}</span>
        <span className="ct-badge">{shadow.alpha}%</span>
        <HexInput label={`${label} shadow`} value={shadow.color} onChange={(color) => set({ color })} />
        <button
          type="button"
          className="ct-btn ct-icon"
          aria-label={toAuto ? `Make ${label} shadow auto` : `Reset ${label} shadow`}
          disabled={!changed && !toAuto}
          onClick={() => (toAuto ? t.setShadow(place, undefined) : t.resetShadow(place))}
        >
          <Icon name="undo" size={13} />
        </button>
      </div>
      {open && (
        <div className="ct-shadow">
          {SHADOW_SPECS.map(({ key, label: measure, min, max, unit }) => (
            <Slider
              key={key}
              label={measure}
              value={shadow[key]}
              min={min}
              max={max}
              step={1}
              track={SHADOW_TRACK}
              shown={`${shadow[key]}${unit}`}
              onChange={(value) => set({ [key]: value })}
              onReset={() => set({ [key]: SHADOW_AUTO[place][key] })}
            />
          ))}
          <ColorPicker color={shadow.color} onChange={(color) => set({ color })} />
        </div>
      )}
    </>
  );
}

function ShadowRows({ t }: { t: Tweaker }): JSX.Element {
  const [open, setOpen] = useState<ShadowPlace | null>(null);
  return (
    <section>
      <div className="ct-section">Shadows</div>
      {SHADOW_PLACES.map((place) => (
        <ShadowRow
          key={place}
          t={t}
          place={place}
          open={open === place}
          onToggle={() => setOpen(open === place ? null : place)}
        />
      ))}
    </section>
  );
}

/** A button that copies `text()` and says so for a moment. */
function CopyButton(props: { label: string; title: string; text(): string; primary?: boolean }): JSX.Element {
  const { label, title, text, primary } = props;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (): void => {
    navigator.clipboard.writeText(text()).then(
      () => setCopied(true),
      () => {},
    );
  };
  return (
    <button type="button" className="ct-btn" title={title} data-primary={primary || undefined} onClick={copy}>
      <Icon name={copied ? "check" : "copy"} size={13} />
      {copied ? "Copied" : label}
    </button>
  );
}

function Toolbar({ t }: { t: Tweaker }): JSX.Element {
  const release = (): void => t.setComparing(false);
  return (
    <div className="ct-row">
      <button
        type="button"
        className="ct-btn"
        title="Hold to see the designed colors"
        onPointerDown={() => t.setComparing(true)}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
      >
        <Icon name="eye" size={13} />
        Before
      </button>
      <button type="button" className="ct-btn ct-icon" aria-label="Undo" disabled={!t.canUndo} onClick={t.undo}>
        <Icon name="undo" size={14} />
      </button>
      <button
        type="button"
        className="ct-btn ct-icon"
        data-mirror
        aria-label="Redo"
        disabled={!t.canRedo}
        onClick={t.redo}
      >
        <Icon name="undo" size={14} />
      </button>
      <button
        type="button"
        className="ct-btn ct-icon"
        aria-label="Reset all"
        title="Reset every color to the preset's"
        disabled={!t.changedCount}
        onClick={t.resetAll}
      >
        <Icon name="reload" size={14} />
      </button>
      <span className="ct-grow" />
      <CopyButton label="Diff" title="Copy the changed colors as text" text={t.changes} />
      <CopyButton label="Code" title="Copy the preset() entries for themes.ts" text={t.code} primary />
    </div>
  );
}

function ThemeBar({ t }: { t: Tweaker }): JSX.Element {
  const scheme = t.preset.scheme;
  return (
    <div className="ct-row">
      <select
        className="ct-select"
        aria-label="Theme"
        value={t.preset.id}
        onChange={(e) => t.openPreset(e.currentTarget.value)}
      >
        {t.presets
          .filter((p) => p.scheme === scheme)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {t.memory.drafts[p.id] ? " •" : ""}
            </option>
          ))}
      </select>
      <div className="ct-seg">
        {[Scheme.Light, Scheme.Dark].map((s) => (
          <button key={s} type="button" aria-pressed={scheme === s} onClick={() => t.openScheme(s)}>
            {s === Scheme.Light ? "Light" : "Dark"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The wordmark's width, the same in every theme; double-click returns it to the design. */
function LogoWidth({ t }: { t: Tweaker }): JSX.Element {
  const width = t.memory.logoWidth ?? LOGO_WIDTH.base;
  return (
    <Slider
      label="Logo size"
      value={width}
      min={LOGO_WIDTH.min}
      max={LOGO_WIDTH.max}
      step={1}
      track={SHADOW_TRACK}
      shown={`${width}px`}
      onChange={(value) => t.setLogoWidth(value === LOGO_WIDTH.base ? null : value)}
      onReset={() => t.setLogoWidth(null)}
    />
  );
}

/**
 * The sidebar labels' and chat header title's type, the same in every theme: double-click returns a
 * measure to the design, the heading's reset returns them all.
 */
function LabelType({ t }: { t: Tweaker }): JSX.Element {
  const moved = Object.keys(t.memory.labelType).length > 0;
  return (
    <>
      <div className="ct-section ct-section-row">
        Sidebar labels and header title
        <button
          type="button"
          className="ct-btn ct-icon"
          aria-label="Reset label type"
          title="Return size, letter spacing and weight to the design"
          disabled={!moved}
          onClick={t.resetLabelType}
        >
          <Icon name="undo" size={13} />
        </button>
      </div>
      {LABEL_TYPE_KEYS.map((key) => {
        const { label, base, min, max, step, unit } = LABEL_TYPE[key];
        const value = t.memory.labelType[key] ?? base;
        return (
          <Slider
            key={key}
            label={label}
            value={value}
            min={min}
            max={max}
            step={step}
            track={SHADOW_TRACK}
            shown={`${value}${unit}`}
            onChange={(next) => t.setLabelType(key, next)}
            onReset={() => t.setLabelType(key, null)}
          />
        );
      })}
    </>
  );
}

function Roles({ t }: { t: Tweaker }): JSX.Element {
  const [open, setOpen] = useState<AnyRole | null>(null);
  return (
    <>
      {ROLE_GROUPS.map((group) => (
        <section key={group.label}>
          <div className="ct-section">{group.label}</div>
          {group.roles.map((role) => (
            <RoleRow
              key={role}
              t={t}
              role={role}
              open={open === role}
              onToggle={() => setOpen(open === role ? null : role)}
            />
          ))}
          {group.roles.includes("logo") && <LogoWidth t={t} />}
          {group.roles.includes("foreground") && <LabelType t={t} />}
        </section>
      ))}
    </>
  );
}

/** ⌘Z and ⇧⌘Z undo and redo, except in a hex field, which keeps its own text undo. */
function onPanelKey(event: KeyboardEvent, t: Tweaker): void {
  const command = event.metaKey || event.ctrlKey;
  const inText = (event.target as Element).matches(".ct-hex");
  if (!command || event.key.toLowerCase() !== "z" || inText) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.shiftKey) t.redo();
  else t.undo();
}

/** A pasted `preset(...)` entry or `role: #hex` lines load into the draft. */
function onPanelPaste(event: ClipboardEvent, t: Tweaker): void {
  const colors = pastedColors(event.clipboardData.getData("text/plain"));
  if (!colors) return;
  event.preventDefault();
  t.setColors(colors);
}

export default function ColorTweaker({ onClose }: { onClose(): void }): JSX.Element {
  const t = useTweaker();
  const panel = useRef<HTMLDivElement>(null);
  const drag = usePanelDrag(panel, t.memory, t.place);
  useIsolation(panel);
  const collapsed = t.memory.collapsed;
  return createPortal(
    <>
      <style>{TWEAKER_CSS}</style>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the panel takes focus so its keys and pastes reach it */}
      <div
        ref={panel}
        data-color-tweaker
        data-collapsed={collapsed || undefined}
        data-dragging={drag.dragging || undefined}
        aria-label="Color tweaker"
        // A live region is never marked outside an open popover, so pressing the panel leaves it open.
        aria-live="off"
        tabIndex={-1}
        style={{ left: drag.at.x, top: drag.at.y, maxHeight: drag.maxHeight }}
        onKeyDown={(e) => onPanelKey(e, t)}
        onPaste={(e) => onPanelPaste(e, t)}
      >
        <header className="ct-head" onPointerDown={drag.start}>
          <Icon name="palette" size={14} />
          <span className="ct-title">
            {t.preset.name}
            <span>{t.preset.scheme}</span>
          </span>
          {t.changedCount > 0 && <span className="ct-count">{t.changedCount} changed</span>}
          <button
            type="button"
            className="ct-btn ct-icon"
            aria-label={collapsed ? "Expand color tweaker" : "Collapse color tweaker"}
            onClick={() => t.setCollapsed(!collapsed)}
          >
            <Icon name={collapsed ? "plus" : "minus"} size={14} />
          </button>
          <button type="button" className="ct-btn ct-icon" aria-label="Close color tweaker" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </header>
        {!collapsed && (
          <div className="ct-body">
            <ThemeBar t={t} />
            <Toolbar t={t} />
            <div className="ct-section">Knobs</div>
            <KnobSliders t={t} />
            <Roles t={t} />
            <ShadowRows t={t} />
            <p className="ct-hint">
              <kbd>⌥⌘C</kbd> shows or hides this. Double-click a knob to reset it. Paste a copied preset or{" "}
              <kbd>role: #hex</kbd> lines to load them.
            </p>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
