/** Settings → Games: the folder new games are created in. */
import { useState, type JSX } from "react";
import { Button } from "../ui/Button.tsx";
import { problemWords } from "../words.ts";

export function GamesSection({
  rootLabel,
  onRoot,
}: {
  rootLabel: string;
  onRoot: (label: string) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const label = await window.studio.chooseGamesRoot();
      if (label) onRoot(label);
    } catch (cause) {
      setError(problemWords(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-games-settings className="appearance-section">
      <div className="appearance-row">
        <span className="flex min-w-0 flex-col">
          <span className="text-ink">Games folder</span>
          <span data-games-root className="font-mono break-all text-ink-2">
            {rootLabel}
          </span>
          <span className="text-ink-3">New games are created here. Games you already have stay where they are.</span>
        </span>
        <Button disabled={busy} onClick={() => void choose()}>
          {busy ? "Choosing…" : "Change…"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-red">
          {error}
        </p>
      )}
    </div>
  );
}
