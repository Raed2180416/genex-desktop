/** Settings → Harness: copy a redacted diagnostics report for a bug report. */
import { useState, type JSX } from "react";
import { Button } from "../ui/Button.tsx";
import { problemWords } from "../words.ts";

export function DiagnosticsRow(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const copy = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await navigator.clipboard.writeText(await window.studio.diagnostics());
      setNotice("Copied.");
    } catch (cause) {
      setNotice(problemWords(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="appearance-row">
      <span className="flex min-w-0 flex-col">
        <span className="text-ink">Diagnostics</span>
        <span role="status" className="text-ink-3">
          {notice ?? "Versions, provider status and recent log lines for a bug report. Paths and keys are removed."}
        </span>
      </span>
      <Button data-copy-diagnostics disabled={busy} onClick={() => void copy()}>
        Copy diagnostics
      </Button>
    </div>
  );
}
