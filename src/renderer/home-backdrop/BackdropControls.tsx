/**
 * The home background's controls: the effect, the picture (bundled or added), the marks' colour,
 * and the effect's own settings. Settings → Appearance shows them under a preview; home's own
 * Background button shows them over home itself, where the change is seen as it is made.
 */
import type { ChangeEvent, JSX, ReactNode, SyntheticEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  addBackdropUpload,
  type BackdropPicture,
  BUNDLED_BACKDROPS,
  listBackdropUploads,
  MAX_BACKDROP_UPLOADS,
  removeBackdropUpload,
  subscribeBackdropUploads,
  UploadProblem,
} from "./images.ts";
import {
  ASCII_RAMP_MAX,
  BACKDROP_RANGES,
  BackdropEffect,
  type BackdropColors,
  type BackdropNumber,
  type BackdropSettings,
  backdropDecimals,
  DEFAULT_BACKDROP,
  DEFAULT_BACKDROP_IMAGE,
  DotGrid,
} from "./settings.ts";
import { useAppearance } from "../appearance/store.ts";
import { updateBackdrop } from "./store.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/icons.tsx";
import { Input } from "../ui/input.tsx";
import { prefersReducedMotion } from "../ui/media-queries.ts";
import { ViewSwitcher } from "../ui/view-switcher.tsx";

const MESSAGE = {
  heading: "Home background",
  effect: "Effect",
  picture: "Picture",
  upload: "Upload",
  addedPicture: (n: number) => `Added picture ${n}`,
  remove: (label: string) => `Remove ${label}`,
  reset: "Reset",
  color: "Color",
  colorHex: "Color hex",
  useTheme: "Use theme",
  more: "More settings",
  grid: "Grid",
  characters: "Characters",
  problems: {
    [UploadProblem.TooLarge]: "Choose a picture smaller than 40 MB.",
    [UploadProblem.Unreadable]: "That file could not be read as a picture. Choose a JPG, PNG or WebP.",
    [UploadProblem.Full]: `You have ${MAX_BACKDROP_UPLOADS} pictures. Remove one to add another.`,
    [UploadProblem.Unsaved]: "The picture could not be saved. Free some disk space and try again.",
  } satisfies Record<UploadProblem, string>,
} as const;

const EFFECTS = [
  { key: BackdropEffect.Off, label: "Off" },
  { key: BackdropEffect.Lines, label: "Lines" },
  { key: BackdropEffect.Dots, label: "Dots" },
  { key: BackdropEffect.Ascii, label: "ASCII" },
] as const;
const GRIDS = [
  { key: DotGrid.Regular, label: "Regular" },
  { key: DotGrid.Benday, label: "Ben-Day" },
] as const;

/** Each slider's name. */
const LABELS: Record<BackdropNumber, string> = {
  strength: "Strength",
  blur: "Blur",
  grain: "Grain",
  gamma: "Gamma",
  blackPoint: "Black point",
  whitePoint: "White point",
  lineColumns: "Columns",
  lineRows: "Rows",
  dotStep: "Grid size",
  dotMin: "Smallest dot",
  dotMax: "Largest dot",
  dotAngle: "Angle",
  dotCorner: "Corner radius",
  dotNoise: "Noise",
  threshold: "Threshold",
  asciiColumns: "Columns",
};
/** Under More settings: each effect's finer controls, then the image's preparation. */
const MORE_SLIDERS: Record<BackdropEffect, readonly BackdropNumber[]> = {
  [BackdropEffect.Off]: [],
  [BackdropEffect.Lines]: ["threshold"],
  [BackdropEffect.Dots]: ["threshold", "dotCorner", "dotNoise"],
  [BackdropEffect.Ascii]: ["threshold"],
};
const TONE: readonly BackdropNumber[] = ["blur", "grain", "gamma", "blackPoint", "whitePoint"];
const OWN_SLIDERS: Record<BackdropEffect, readonly BackdropNumber[]> = {
  [BackdropEffect.Off]: [],
  [BackdropEffect.Lines]: ["lineColumns", "lineRows"],
  [BackdropEffect.Dots]: ["dotStep", "dotMin", "dotMax", "dotAngle"],
  [BackdropEffect.Ascii]: ["asciiColumns"],
};
const PICTURE_TYPES = "image/png,image/jpeg,image/webp,image/gif";
const HEX = /^#[0-9a-f]{6}$/i;
/** The colour shown when the theme's cannot be read as hex. */
const FALLBACK_INK = "#000000";

/** The theme's text colour as `#rrggbb`, what the marks use until a colour is chosen. */
function themeInk(): string {
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim().toLowerCase();
  return HEX.test(ink) ? ink : FALLBACK_INK;
}

const change = (patch: Partial<BackdropSettings>): void => updateBackdrop((previous) => ({ ...previous, ...patch }));

/** A setting: its name on the left, its control on the right. */
function Row({ label, children, top }: { label: ReactNode; children: ReactNode; top?: boolean }): JSX.Element {
  return (
    <div className="backdrop-row" data-top={top || undefined}>
      <span className="backdrop-label">{label}</span>
      <div className="backdrop-control">{children}</div>
    </div>
  );
}

/** A number on a slider; its value sits in a column of its own, so dragging never moves the slider. */
function Slider({ name, value }: { name: BackdropNumber; value: number }): JSX.Element {
  const { min, max, step } = BACKDROP_RANGES[name];
  const id = `backdrop-${name}`;
  return (
    <Row label={<label htmlFor={id}>{LABELS[name]}</label>}>
      <input
        id={id}
        type="range"
        className="backdrop-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => change({ [name]: Number(event.target.value) })}
      />
      <output htmlFor={id} className="backdrop-value">
        {value.toFixed(backdropDecimals(name))}
      </output>
    </Row>
  );
}

/** The bundled pictures and the added ones, with thumbnails that live as long as the list. */
function usePictures(): BackdropPicture[] {
  const [added, setAdded] = useState<BackdropPicture[]>([]);
  useEffect(() => {
    let urls: string[] = [];
    let live = true;
    const load = async (): Promise<void> => {
      const uploads = await listBackdropUploads();
      if (!live) return;
      for (const url of urls) URL.revokeObjectURL(url);
      urls = uploads.map(({ blob }) => URL.createObjectURL(blob));
      setAdded(
        uploads.map(({ id }, index) => ({
          id,
          label: MESSAGE.addedPicture(index + 1),
          url: urls[index] ?? "",
          added: true,
        })),
      );
    };
    void load();
    const stop = subscribeBackdropUploads(() => void load());
    return () => {
      live = false;
      stop();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);
  return [...BUNDLED_BACKDROPS, ...added];
}

function PictureChoice({
  picture,
  selected,
  onRemove,
}: {
  picture: BackdropPicture;
  selected: boolean;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="backdrop-picture">
      <button
        type="button"
        className="backdrop-picture-choice"
        aria-pressed={selected}
        aria-label={picture.label}
        data-backdrop-picture={picture.id}
        onClick={() => change({ image: picture.id })}
      >
        <img src={picture.url} alt="" draggable={false} />
      </button>
      {picture.added && (
        <button
          type="button"
          className="backdrop-picture-remove"
          aria-label={MESSAGE.remove(picture.label)}
          onClick={onRemove}
        >
          <Icon name="close" size={10} />
        </button>
      )}
    </div>
  );
}

function PicturePicker({ selected }: { selected: string }): JSX.Element {
  const pictures = usePictures();
  const file = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState("");
  const add = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    const added = await addBackdropUpload(chosen);
    if ("problem" in added) {
      setProblem(MESSAGE.problems[added.problem]);
      return;
    }
    setProblem("");
    change({ image: added.id });
  };
  const remove = (picture: BackdropPicture): void => {
    if (picture.id === selected) change({ image: DEFAULT_BACKDROP_IMAGE });
    void removeBackdropUpload(picture.id);
  };
  const full = pictures.filter((picture) => picture.added).length >= MAX_BACKDROP_UPLOADS;
  return (
    <Row label={MESSAGE.picture} top>
      <div className="backdrop-pictures" role="group" aria-label={MESSAGE.picture}>
        {pictures.map((picture) => (
          <PictureChoice
            key={picture.id}
            picture={picture}
            selected={picture.id === selected}
            onRemove={() => remove(picture)}
          />
        ))}
        {!full && (
          <button
            type="button"
            className="backdrop-picture-add"
            data-backdrop-upload
            onClick={() => file.current?.click()}
          >
            <Icon name="plus" size={14} />
            {MESSAGE.upload}
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept={PICTURE_TYPES}
          className="hidden"
          aria-label={MESSAGE.upload}
          onChange={(event) => void add(event)}
        />
      </div>
      {problem && (
        <p className="appearance-error backdrop-problem" role="alert">
          {problem}
        </p>
      )}
    </Row>
  );
}

/**
 * The marks' colour in the theme on screen: the theme's text until one is picked, with the way back
 * to it. The other theme keeps its own.
 */
function ColorRow({ colors }: { colors: BackdropColors }): JSX.Element {
  const { scheme } = useAppearance();
  const color = colors[scheme];
  const shown = color ?? themeInk();
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const setColor = (next: string | null): void =>
    updateBackdrop((previous) => ({ ...previous, colors: { ...previous.colors, [scheme]: next } }));
  const commit = (): void => {
    const next = draft.trim().toLowerCase();
    if (HEX.test(next)) setColor(next);
    else setDraft(shown);
  };
  return (
    <Row label={MESSAGE.color}>
      {color && (
        <Button variant="ghost" onClick={() => setColor(null)}>
          {MESSAGE.useTheme}
        </Button>
      )}
      <div className="color-control">
        <input
          type="color"
          value={shown}
          aria-label={MESSAGE.color}
          data-backdrop-color
          onChange={(event) => setColor(event.target.value)}
        />
        <input
          aria-label={MESSAGE.colorHex}
          value={draft}
          maxLength={7}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      </div>
    </Row>
  );
}

/** The ramp field: what is typed shows at once; a ramp too short to draw with waits. */
function CharactersRow({ value }: { value: string }): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Row label={<label htmlFor="backdrop-characters">{MESSAGE.characters}</label>}>
      <Input
        id="backdrop-characters"
        className="backdrop-characters"
        value={draft}
        maxLength={ASCII_RAMP_MAX}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          if (Array.from(event.target.value).length >= 2) change({ asciiCharacters: event.target.value });
        }}
        onBlur={() => setDraft(value)}
      />
    </Row>
  );
}

/** An opened disclosure grows downward; bring what it revealed into view. */
function revealOpened(event: SyntheticEvent<HTMLDetailsElement>): void {
  const details = event.currentTarget;
  if (!details.open) return;
  requestAnimationFrame(() =>
    details.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" }),
  );
}

function EffectSettings({ settings }: { settings: BackdropSettings }): JSX.Element {
  return (
    <>
      <Slider name="strength" value={settings.strength} />
      {OWN_SLIDERS[settings.effect].map((name) => (
        <Slider key={name} name={name} value={settings[name]} />
      ))}
      {settings.effect === BackdropEffect.Dots && (
        <Row label={MESSAGE.grid}>
          <ViewSwitcher
            items={GRIDS}
            active={settings.dotGrid}
            onSelect={(dotGrid) => change({ dotGrid })}
            label={MESSAGE.grid}
            sans
          />
        </Row>
      )}
      {settings.effect === BackdropEffect.Ascii && <CharactersRow value={settings.asciiCharacters} />}
      <details className="appearance-details backdrop-more" onToggle={revealOpened}>
        <summary>{MESSAGE.more}</summary>
        {[...MORE_SLIDERS[settings.effect], ...TONE].map((name) => (
          <Slider key={name} name={name} value={settings[name]} />
        ))}
      </details>
    </>
  );
}

/** Everything that sets the background, below whatever heading its place gives it. */
export function BackdropControls({ settings }: { settings: BackdropSettings }): JSX.Element {
  return (
    <>
      <Row label={MESSAGE.effect}>
        <ViewSwitcher
          items={EFFECTS}
          active={settings.effect}
          onSelect={(effect) => change({ effect })}
          label={MESSAGE.effect}
          sans
          dataAttribute="data-backdrop-effect"
        />
      </Row>
      {settings.effect !== BackdropEffect.Off && (
        <>
          <PicturePicker selected={settings.image} />
          <ColorRow colors={settings.colors} />
          <EffectSettings settings={settings} />
        </>
      )}
    </>
  );
}

/** Back to the defaults, keeping the effect and the picture. */
export function resetBackdrop(): void {
  updateBackdrop((previous) => ({ ...DEFAULT_BACKDROP, effect: previous.effect, image: previous.image }));
}
