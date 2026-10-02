/** Settings → About: Check for Updates, with what it found and the one next step. */
import { type JSX, useState } from "react";
import { UpdateAction, type UpdateCheckResult, UpdateCheckStatus } from "../../shared/app-update.ts";
import { Button } from "../ui/Button.tsx";
import { ABOUT_WORDS, problemWords } from "../words.ts";

/** The line a check's answer reads as. */
function resultLine(result: UpdateCheckResult): string {
  const version = result.update?.version ?? null;
  if (result.status === UpdateCheckStatus.Current) return ABOUT_WORDS.current;
  if (result.status === UpdateCheckStatus.Downloading) return ABOUT_WORDS.downloading;
  if (result.status === UpdateCheckStatus.Off) return ABOUT_WORDS.off;
  if (result.status === UpdateCheckStatus.Failed) return ABOUT_WORDS.failed;
  return result.update?.action === UpdateAction.Download ? ABOUT_WORDS.available(version) : ABOUT_WORDS.ready(version);
}

/** The step a waiting update offers: relaunch into it, or open its download page. */
function NextStep({ result }: { result: UpdateCheckResult }): JSX.Element | null {
  if (result.status !== UpdateCheckStatus.Waiting || !result.update) return null;
  if (result.update.action === UpdateAction.Download)
    return (
      <Button data-about-download onClick={() => void window.studio.openUpdateDownload()}>
        {ABOUT_WORDS.download}
      </Button>
    );
  return (
    <Button data-about-restart onClick={() => void window.studio.restartToUpdate()}>
      {ABOUT_WORDS.restart}
    </Button>
  );
}

export function AboutSection(): JSX.Element {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An unpackaged build reports Electron's version, so only a checking build names its own.
  const versioned = result && result.status !== UpdateCheckStatus.Off;
  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setResult(await window.studio.checkForUpdates());
    } catch (cause) {
      setError(problemWords(cause));
    } finally {
      setChecking(false);
    }
  };
  return (
    <div data-about-settings className="appearance-section">
      <section className="appearance-theme settings-rows">
        <div className="appearance-row flex-wrap">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-ink">{versioned ? ABOUT_WORDS.version(result.current) : ABOUT_WORDS.product}</span>
            {result && (
              <span data-about-update-state role="status" className="text-ink-2">
                {resultLine(result)}
              </span>
            )}
            {error && (
              <span role="alert" className="text-red">
                {error}
              </span>
            )}
          </span>
          {result && <NextStep result={result} />}
          <Button data-about-check aria-busy={checking} disabled={checking} onClick={() => void check()}>
            {checking ? ABOUT_WORDS.checking : ABOUT_WORDS.check}
          </Button>
        </div>
      </section>
    </div>
  );
}
