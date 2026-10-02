/** Settings → Permissions: the "always allow" rules chats saved, by game. Each chat picks its mode in the composer. */
import { type JSX, useEffect, useRef, useState } from "react";
import type { PermissionRuleView } from "../../shared/permissions.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/icons.tsx";
import { usePermissionSettings } from "../use-permission-settings.ts";
import { problemWords } from "../words.ts";
import { Pending } from "../ui/Pending.tsx";

/** The section's own words. */
const WORDS = {
  loading: "Loading…",
  none: "No saved rules. Choosing Always allow in a chat adds one here.",
  some: "Claude does these without asking in every chat of the game.",
  stop: "Stop allowing",
  stopRule: (rule: string) => `Stop allowing ${rule}`,
} as const;

/** One game's saved rules, each with its Stop allowing. `first` is the index of its first rule in the whole list. */
function GameRules({
  game,
  first,
  busy,
  onForget,
}: {
  game: PermissionRuleView;
  first: number;
  busy: boolean;
  onForget: (project: string, rule: string, index: number) => void;
}): JSX.Element {
  const title = game.title || game.project;
  return (
    <section aria-label={title} className="mt-4">
      <h3>{title}</h3>
      <ul className="mt-1">
        {game.rules.map((rule, offset) => (
          <li key={rule} className="appearance-row min-h-10">
            <code className="min-w-0 font-mono text-ink-2 [overflow-wrap:anywhere]">{rule}</code>
            <Button
              data-forget-rule
              variant="ghost"
              size="icon-sm"
              aria-label={WORDS.stopRule(rule)}
              title={WORDS.stop}
              disabled={busy}
              onClick={() => onForget(game.project, rule, first + offset)}
            >
              <Icon name="trash" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PermissionsSection(): JSX.Element {
  const { settings, setSettings, error } = usePermissionSettings();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // Focus stays in the list after a removal: on the rule that took its place, else the panel.
  const refocus = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus moves once the removal's answer is drawn
  useEffect(() => {
    if (busy || refocus.current === null) return;
    const left = root.current?.querySelectorAll<HTMLElement>("[data-forget-rule]");
    const next = left?.[Math.min(refocus.current, left.length - 1)];
    (next ?? root.current?.closest<HTMLElement>('[role="tabpanel"]'))?.focus();
    refocus.current = null;
  }, [busy, settings]);
  const forget = async (project: string, rule: string, index: number) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      setSettings(await window.studio.forgetPermission(project, rule));
      refocus.current = index;
    } catch (cause) {
      setFailure(problemWords(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!settings)
    return (
      <div data-permission-settings className="appearance-section">
        {error ? (
          <p role="alert" className="text-red">
            {error}
          </p>
        ) : (
          <Pending label={WORDS.loading} />
        )}
      </div>
    );
  const games = settings.rules.filter((game) => game.rules.length > 0);
  const firsts = games.map((_, index) => games.slice(0, index).reduce((sum, game) => sum + game.rules.length, 0));
  return (
    <div ref={root} data-permission-settings className="appearance-section">
      <p className="text-ink-3">{games.length ? WORDS.some : WORDS.none}</p>
      {games.map((game, index) => (
        <GameRules
          key={game.project}
          game={game}
          first={firsts[index] ?? 0}
          busy={busy}
          onForget={(project, rule, at) => void forget(project, rule, at)}
        />
      ))}
      {failure && (
        <p role="alert" className="mt-2 text-red">
          {failure}
        </p>
      )}
    </div>
  );
}
