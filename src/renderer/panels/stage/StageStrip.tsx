/**
 * The stage strip: one addressable row, so a check can prove every control in it stays uniquely
 * labelled — `control.ts` refuses an ambiguous selector at run time. The game's name and folder
 * live in the chat header; the rest of this strip drags the window.
 */
import type { JSX } from "react";
import { SOUND_SHORTCUT } from "../../../shared/game-sound.ts";
import type { PluginInfo } from "../../../shared/plugins.ts";
import { kindChip } from "../../../shared/shape-words.ts";
import type { BesideTarget } from "../../open-beside.ts";
import type { LiveBehind, StageView } from "../../stage.ts";
import type { GameProject } from "../../types.ts";
import { cn } from "../../ui/cn.ts";
import { Icon } from "../../ui/icons.tsx";
import { Shortcut } from "../../ui/Shortcut.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import { ViewSwitcher } from "../../ui/view-switcher.tsx";
import { liveBehindLabel, liveBehindWords } from "../../words.ts";
import { besideName } from "../FileViewer.tsx";
import type { Notify } from "../../state/toasts.ts";
import { PluginToolbar } from "../PluginToolbar.tsx";

/** A tab name longer than this is shortened in the middle, keeping this much of its start and end. */
const TAB_NAME_MAX = 26;
const TAB_NAME_HEAD = 14;
const TAB_NAME_TAIL = 10;

/** A tab keeps its width: a long file name is shortened in the middle, the full name is the viewer's title. */
function shortName(name: string): string {
  return name.length > TAB_NAME_MAX ? `${name.slice(0, TAB_NAME_HEAD)}…${name.slice(-TAB_NAME_TAIL)}` : name;
}

/** The view switcher's tabs: Live, Builds once there is a build to draw, Assets, and a file opened beside. */
function viewItems(hasBuilds: boolean, buildsLive: boolean, beside: BesideTarget | null) {
  const label = (key: StageView): string => {
    if (key === "live") return "Live";
    if (key === "assets") return "Assets";
    return `Builds${buildsLive ? " ●" : ""}`;
  };
  const views: StageView[] = ["live", ...(hasBuilds ? ["builds" as const] : []), "assets"];
  return [
    ...views.map((key) => ({ key, label: label(key) })),
    ...(beside
      ? [
          {
            key: "file" as const,
            label: shortName(besideName(beside)),
            icon: <Icon name={beside.kind === "image" ? "image" : "file"} size={13} />,
          },
        ]
      : []),
  ];
}

/**
 * Reload. While Live is behind — the game changed, a build is ready — it carries the accent dot
 * and tint and says what it would bring; Live itself never changes until it is pressed. A new
 * reason breathes the ring once (`key`), except under reduced motion (theme.css).
 */
function ReloadButton({ behind, onReload }: { behind: LiveBehind | null; onReload: () => void }): JSX.Element {
  const label = behind ? liveBehindLabel(behind.reason, behind.note) : "Reload game";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          key={behind ? `${behind.reason}:${behind.head ?? ""}` : "current"}
          type="button"
          aria-label={label}
          data-stage-reload={behind ? "behind" : ""}
          data-behind-reason={behind?.reason}
          onClick={onReload}
          className={cn(
            "grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors duration-(--duration-quick) enabled:active:scale-[0.96]",
            // The glass's own background would cover the tint, so a lit Reload trades it for the tint.
            // Its glyph takes the ink: the accent on its own tint falls under 3:1, dimmer than unlit.
            behind
              ? "border border-transparent bg-accent-tint text-ink"
              : "surface-glass text-muted-foreground hover:text-control-text-hover",
          )}
        >
          <Icon name="reload" size={15} />
        </button>
      </TooltipTrigger>
      {/* Beside, not below: a tooltip under the strip would sit behind the native game view. */}
      <TooltipContent side="right" sideOffset={6} data-stage-reload-tip="">
        {behind ? liveBehindWords(behind.reason) : "Reload game"}
        {behind?.note ? <span className="block max-w-72 opacity-75">{behind.note}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** The Live game's sound: one speaker, crossed out while it is off. */
function SoundButton({ on, onToggle }: { on: boolean; onToggle: () => void }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Game sound"
          aria-pressed={on}
          data-stage-sound={on ? "on" : "off"}
          onClick={onToggle}
          className="surface-glass grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors duration-(--duration-quick) hover:text-control-text-hover enabled:active:scale-[0.96]"
        >
          <Icon name={on ? "speaker" : "speaker-off"} size={15} />
        </button>
      </TooltipTrigger>
      {/* Beside, not below: a tooltip under the strip would sit behind the native game view. */}
      <TooltipContent side="left" sideOffset={6}>
        <span className="flex items-center gap-2">
          {on ? "Mute game" : "Unmute game"}
          <Shortcut>{SOUND_SHORTCUT}</Shortcut>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The strip over the stage: what the folder is, the view switcher, reload, the game's sound and
 * plugin buttons. An earlier build opens from its result card in the chat, not from here.
 */
export function StageStrip({
  loaded,
  project,
  hasBuilds,
  buildsLive,
  beside,
  stageView,
  onView,
  behind,
  onReload,
  sound,
  plugins,
  onNotice,
  onToolbarOpen,
}: {
  loaded: GameProject | null;
  project: string | null;
  hasBuilds: boolean;
  buildsLive: boolean;
  beside: BesideTarget | null;
  stageView: StageView;
  onView: (view: StageView) => void;
  /** What waits for Live's Reload, when anything does. */
  behind: LiveBehind | null;
  onReload: () => void;
  /** The Live game's sound switch (`game-sound.ts`). */
  sound: { on: boolean; toggle: () => void };
  plugins: PluginInfo[];
  onNotice: Notify;
  onToolbarOpen: (open: boolean) => void;
}): JSX.Element {
  return (
    <div
      data-stage-strip=""
      className="titlebar-drag window-controls-end flex min-h-12 max-h-30 shrink-0 flex-wrap items-center gap-2 overflow-auto border-b border-line bg-canvas ps-3 pe-2 py-1.5"
    >
      {/* What this folder is, from its own evidence — so nobody has to guess why the stage is
          showing a built page, and an engine export says so before a night is asked for. */}
      {loaded?.built ? (
        <span
          data-stage-kind={loaded.shape.kind}
          title={`The studio found this and keeps it as it is: ${loaded.shape.main}`}
          className="no-drag shrink-0 rounded-control bg-inset px-1.5 py-0.5 text-micro text-ink-3"
        >
          {kindChip(loaded.shape.kind)}
        </span>
      ) : null}
      {/* One segmented group for every loaded game; Builds joins it once there is a build to
          draw, and Assets is always there — a game with no build still has files. Plugin buttons
          follow it as siblings, so they are there for a game with no build either. */}
      {project ? (
        <ViewSwitcher
          className="no-drag shrink-0"
          label="Game view"
          dataAttribute="data-stage-action"
          items={viewItems(hasBuilds, buildsLive, beside)}
          active={stageView}
          onSelect={onView}
        />
      ) : null}
      {project ? <ReloadButton behind={behind} onReload={onReload} /> : null}
      <span className="min-w-0 flex-1 self-stretch" />
      {project ? <SoundButton on={sound.on} onToggle={sound.toggle} /> : null}
      <PluginToolbar plugins={plugins} project={project} onNotice={onNotice} onOpenChange={onToolbarOpen} />
    </div>
  );
}
