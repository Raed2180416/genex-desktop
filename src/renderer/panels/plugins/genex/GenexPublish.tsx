/**
 * Publish to the web, drawn by Studio over the game's stage in the app's own type and buttons. It
 * asks first for what publishing needs and the person lacks (Genex Tools installed and on, then a
 * Genex account), then shows where the game is (not online, a test version, public), the running
 * attempt with its steps, and Publish: first the exact files that would go online, then the press
 * that publishes them. That press is the consent; no system dialog or chat card asks again.
 */
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { SECOND_MS } from "../../../../shared/duration.ts";
import {
  GENEX_PLUGIN_ID,
  GenexAction,
  GenexPublishStatusOperation,
  type GenexPublishState,
} from "../../../../shared/genex.ts";
import type { ExportReview as FileList, PluginInfo } from "../../../../shared/plugins.ts";
import { relativeTime } from "../../../chat-labels.ts";
import { ExportReview } from "../../../chat/ExportReview.tsx";
import { type PluginReviewRequest, runPluginAction } from "../../../plugin-actions.ts";
import { Button } from "../../../ui/Button.tsx";
import { OPEN_PLUGINS_EVENT } from "../../../ui/ComposerAddMenu.tsx";
import { DialogSurface } from "../../../ui/dialog.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { Pending } from "../../../ui/Pending.tsx";
import { GENEX_WORDS, problemWords } from "../../../words.ts";
import { PluginApproval } from "../../PluginApproval.tsx";
import { GenexAccountKind, genexAccountView } from "./genex-view.ts";
import {
  isListed,
  type PublishButton,
  PublishGate,
  type PublishView,
  publishGate,
  publishView,
  StepState,
  type StepView,
} from "./genex-publish-view.ts";
import { useGenexStatus } from "./use-genex-status.ts";

const WORDS = GENEX_WORDS.publish;
const ACCOUNT = GENEX_WORDS.account;
/** How often the dialog re-reads the record while an attempt runs, and otherwise. */
const RUNNING_POLL_MS = 2 * SECOND_MS;
const IDLE_POLL_MS = 10 * SECOND_MS;
/** Where the publish-open action sends the browser (the plugin's `PublishLinkTarget`). */
const LinkTarget = { Draft: "draft", Gallery: "gallery", Play: "play" } as const;

/** A cancelled review or approval is the person's choice, not an error to show. */
const CANCELLED = /Cancelled/;
const words = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The game's publish record, re-read on open and on a timer that quickens while an attempt runs. */
function usePublishRecord(plugin: PluginInfo, project: string | null) {
  const [state, setState] = useState<GenexPublishState | null>(null);
  const [error, setError] = useState("");
  const [review, setReview] = useState<PluginReviewRequest | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [acting, setActing] = useState(false);
  const id = plugin.manifest.id;
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const args = { operation: GenexPublishStatusOperation.Status };
      setState(
        (await window.studio.pluginAction(
          id,
          GenexAction.PublishStatus,
          args,
          project ?? undefined,
        )) as GenexPublishState,
      );
    } catch (e) {
      setError(words(e));
    }
  }, [id, project]);
  const running = state ? publishView(state).running : false;
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), running ? RUNNING_POLL_MS : IDLE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, running]);
  const run = async (step: () => Promise<unknown>): Promise<void> => {
    setError("");
    setActing(true);
    try {
      await step();
    } catch (e) {
      if (!CANCELLED.test(words(e))) setError(words(e));
    } finally {
      setActing(false);
      await refresh();
    }
  };
  const act = (name: string, args: Record<string, unknown> = {}): Promise<void> =>
    run(() => runPluginAction({ plugin, name, args, project, review: setReview }));
  // Publish first lists what would go online; nothing starts until the person publishes that list.
  const showFiles = (): Promise<void> =>
    run(async () => setFiles(await window.studio.genexPublishReview(project ?? "")));
  const publish = (approved: FileList): Promise<void> => {
    setFiles(null);
    return run(() => window.studio.genexPublish(project ?? "", approved));
  };
  return {
    state,
    error,
    review,
    closeReview: () => setReview(null),
    acting,
    act,
    files,
    showFiles,
    closeFiles: () => setFiles(null),
    publish,
    refresh,
  };
}

/** Seconds since an attempt started, ticking while it runs. */
function useElapsed(startedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (!startedAt) return null;
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / SECOND_MS));
}

/** The running attempt: what it is doing, for how long, and its steps as one bar. */
function Progress({ view }: { view: PublishView }): JSX.Element {
  const elapsed = useElapsed(view.startedAt);
  const at = view.steps.findIndex((s) => s.state === StepState.Current);
  return (
    <div className="genex-publish-progress" aria-live="polite">
      <div className="genex-publish-phase">
        <span>{view.phase}</span>
        {elapsed !== null && <span className="genex-publish-elapsed">{WORDS.seconds(elapsed)}</span>}
      </div>
      <div
        className="genex-publish-bar"
        role="progressbar"
        aria-label={WORDS.progress}
        aria-valuemin={0}
        aria-valuemax={view.steps.length}
        aria-valuenow={Math.max(at, 0)}
        aria-valuetext={view.phase}
      >
        {view.steps.map((step: StepView) => (
          <span key={step.step} data-state={step.state} />
        ))}
      </div>
      <span className="genex-publish-steps">{view.steps.map((s) => s.label).join(" · ")}</span>
    </div>
  );
}

/** The exact files Publish would put online, and the press that publishes exactly those. */
function FilesToPublish({
  files,
  label,
  disabled,
  onCancel,
  onPublish,
}: {
  files: FileList;
  label: string;
  disabled: boolean;
  onCancel: () => void;
  onPublish: (files: FileList) => Promise<void>;
}): JSX.Element {
  return (
    <>
      <ExportReview review={files} />
      <div className="genex-publish-actions">
        <Button onClick={onCancel}>{WORDS.cancel}</Button>
        <Button
          variant="default"
          aria-label={WORDS.publishFiles}
          disabled={disabled}
          onClick={() => void onPublish(files)}
        >
          {label}
        </Button>
      </div>
    </>
  );
}

/** A page link: it opens through the plugin, which hands the browser the page Genex has for the game. */
function PageLink({ label, onOpen }: { label: string; onOpen: () => void }): JSX.Element {
  return (
    <button type="button" className="genex-publish-link" onClick={onOpen}>
      {label}
      <Icon name="arrow-up-right" size={12} />
    </button>
  );
}

/** "updated 2m ago", or nothing when there is no time to tell. */
const updatedWords = (at: string | undefined): string => (at ? WORDS.updated(relativeTime(at)) : "");

/**
 * The game page and when it changed, or that there is none yet; and a test version, while there is
 * one and the game is not public.
 */
function Pages({ state, open }: { state: GenexPublishState; open: (target: string) => void }): JSX.Element {
  const listed = isListed(state);
  const published = listed ? updatedWords(state.lastPublishAt) : "";
  const draft = !listed && state.draftUrl ? updatedWords(state.lastPreviewAt) : "";
  return (
    <dl className="genex-publish-pages">
      <dt>{WORDS.publicVersion}</dt>
      <dd>
        {listed ? <PageLink label={WORDS.openGame} onOpen={() => open(LinkTarget.Gallery)} /> : WORDS.notPublished}
        {published && <span className="text-ink-3"> · {published}</span>}
      </dd>
      {!listed && state.draftUrl && (
        <>
          <dt>{WORDS.draftPage}</dt>
          <dd>
            <PageLink
              label={WORDS.playDraft}
              onOpen={() => open(state.readyDraft ? LinkTarget.Play : LinkTarget.Draft)}
            />
            {draft && <span className="text-ink-3"> · {draft}</span>}
          </dd>
        </>
      )}
    </dl>
  );
}

/** What a step of setting up asks: a line saying what is missing, and the presses that fix it. */
function Ask({ children, actions }: { children: ReactNode; actions: ReactNode }): JSX.Element {
  return (
    <>
      <p className="genex-publish-ask">{children}</p>
      <div className="genex-publish-actions">{actions}</div>
    </>
  );
}

/**
 * Connect a Genex account from the Publish dialog: Connect, then finishing in the browser with the
 * code to check, then the terms, until the account is connected and `onConnected` re-reads the record.
 */
function ConnectGenex({
  plugin,
  project,
  onConnected,
}: {
  plugin: PluginInfo;
  project: string | null;
  onConnected: () => void;
}): JSX.Element {
  const live = useGenexStatus(plugin, project);
  const view = genexAccountView(live.status);
  const busy = live.running !== null;
  const connected = view.kind === GenexAccountKind.Connected;
  useEffect(() => {
    if (connected) onConnected();
  }, [connected, onConnected]);
  const connect = () => void live.act(GenexAction.Connect);
  return (
    <>
      <ConnectStep view={view} busy={busy} live={live} connect={connect} />
      {live.error && (
        <p role="alert" className="genex-publish-problem">
          {live.error}
        </p>
      )}
      {live.review && <PluginApproval review={live.review} onClose={live.closeReview} />}
    </>
  );
}

/** The account step the person is on, with only the presses it needs. */
function ConnectStep({
  view,
  busy,
  live,
  connect,
}: {
  view: ReturnType<typeof genexAccountView>;
  busy: boolean;
  live: ReturnType<typeof useGenexStatus>;
  connect: () => void;
}): JSX.Element {
  switch (view.kind) {
    case GenexAccountKind.SignedOut:
      return (
        <Ask
          actions={
            <Button variant="default" disabled={busy} onClick={connect}>
              {view.retry ? ACCOUNT.retry : ACCOUNT.connect}
            </Button>
          }
        >
          {view.retry ? ACCOUNT.retryText : WORDS.connectText}
        </Ask>
      );
    case GenexAccountKind.SigningIn:
      return (
        <Ask
          actions={
            <>
              <Button variant="ghost" disabled={busy} onClick={() => void live.act(GenexAction.CancelConnect)}>
                {ACCOUNT.cancel}
              </Button>
              <Button disabled={busy} onClick={connect}>
                {ACCOUNT.reopen}
              </Button>
            </>
          }
        >
          {ACCOUNT.signingInTitle}. {ACCOUNT.signingInText} <code className="genex-code">{view.code}</code>
        </Ask>
      );
    case GenexAccountKind.Terms:
      return (
        <Ask
          actions={
            <Button variant="default" disabled={busy} onClick={() => void live.act(GenexAction.Terms)}>
              {ACCOUNT.terms}
              <Icon name="arrow-up-right" size={14} />
            </Button>
          }
        >
          {WORDS.termsNote}
        </Ask>
      );
    case GenexAccountKind.Attention:
      return <Ask actions={<Button onClick={() => void live.refresh()}>{ACCOUNT.tryAgain}</Button>}>{view.error}</Ask>;
    default:
      return <Pending label={ACCOUNT.checking} className="genex-checking" />;
  }
}

/**
 * The dialog's frame: one title, the words for where the game is, and, once the record is read,
 * where it is on Genex for smoke checks, whatever the dialog asks for first.
 */
function PublishFrame({
  intro,
  state = null,
  onClose,
  children,
}: {
  intro: string;
  state?: GenexPublishState | null;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <DialogSurface
      title={WORDS.title}
      titleIcon={<Icon name="globe" size={20} className="text-ink-3" />}
      description={intro}
      onDismiss={onClose}
      size="lg"
      testId="genex-publish"
    >
      <div
        className="contents"
        data-genex-publish-status={state ? publishView(state).stage : undefined}
        data-connected={state?.connected}
      >
        {children}
      </div>
    </DialogSurface>
  );
}

/** Where publishing goes next, in the description's own type, just above the dialog's buttons. */
function NativeSoon(): JSX.Element {
  return <p className="text-dialog-body text-muted-foreground">{WORDS.native}</p>;
}

/** The Genex plugin's name as a link to its page in Plugins; the dialog closes on the way. */
function PluginLink({ onLeave }: { onLeave: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="genex-publish-plugin"
      aria-label={WORDS.pluginPage}
      onClick={() => {
        onLeave();
        window.dispatchEvent(new CustomEvent(OPEN_PLUGINS_EVENT, { detail: { plugin: GENEX_PLUGIN_ID } }));
      }}
    >
      {WORDS.plugin}
      <Icon name="arrow-up-right" size={12} />
    </button>
  );
}

/**
 * Publish while Genex Tools is off or not installed: what publishing goes through (its name opens
 * the plugin's page), and in the footer the one press that brings it back. The strip's own Publish
 * opens it; once Genex is on, its Publish takes over.
 */
export function GenexSetupDialog({
  genex,
  onClose,
}: {
  genex: PluginInfo | undefined;
  onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const install = publishGate(genex, undefined) === PublishGate.Install;
  const press = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      if (install) await window.studio.pluginInstall(GENEX_PLUGIN_ID);
      else await window.studio.pluginEnable(GENEX_PLUGIN_ID, true);
    } catch (e) {
      if (!CANCELLED.test(words(e))) setError(problemWords(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PublishFrame intro={WORDS.intro} onClose={onClose}>
      <p className="genex-publish-setup">
        {WORDS.through} <PluginLink onLeave={onClose} />
      </p>
      <NativeSoon />
      {error && (
        <p role="alert" className="genex-publish-problem">
          {error}
        </p>
      )}
      <div className="genex-publish-actions">
        <Button variant="default" disabled={busy} onClick={() => void press()}>
          {install ? WORDS.install : WORDS.turnOn}
        </Button>
      </div>
    </PublishFrame>
  );
}

/** The dialog over the stage, while Genex Tools is on. */
export function GenexPublishDialog({
  plugin,
  project,
  onClose,
}: {
  plugin: PluginInfo;
  project: string | null;
  onClose: () => void;
}): JSX.Element {
  const record = usePublishRecord(plugin, project);
  const { state } = record;
  const view = state ? publishView(state) : null;
  const press = (button: PublishButton) => void record.act(button.action, button.args ?? {});
  const disabled = record.acting || !view?.canPublish;
  if (state && publishGate(plugin, state.connected) === PublishGate.Connect)
    return (
      <PublishFrame intro={WORDS.intro} state={state} onClose={onClose}>
        <ConnectGenex plugin={plugin} project={project} onConnected={record.refresh} />
      </PublishFrame>
    );
  return (
    <PublishFrame intro={view?.intro ?? WORDS.intro} state={state} onClose={onClose}>
      {view?.running && <Progress view={view} />}
      {state && <Pages state={state} open={(target) => void record.act(GenexAction.PublishOpen, { target })} />}
      {[...(view?.problems ?? []), ...(record.error ? [record.error] : [])].map((problem) => (
        <p key={problem} role="alert" className="genex-publish-problem">
          {problem}
        </p>
      ))}
      {view?.notes.map((note) => (
        <p key={note} className="genex-publish-note">
          {note}
        </p>
      ))}
      <NativeSoon />
      {view && record.files && (
        <FilesToPublish
          files={record.files}
          label={view.primary.label}
          disabled={disabled}
          onCancel={record.closeFiles}
          onPublish={record.publish}
        />
      )}
      {view && !record.files && (
        <div className="genex-publish-actions">
          {view.extra.map((button) => (
            <Button
              key={button.label}
              aria-label={button.ariaLabel}
              disabled={record.acting}
              onClick={() => press(button)}
            >
              {button.label}
            </Button>
          ))}
          <Button
            variant="default"
            aria-label={view.primary.ariaLabel}
            disabled={disabled}
            onClick={() => void record.showFiles()}
          >
            {view.primary.label}
          </Button>
        </div>
      )}
      {record.review && <PluginApproval review={record.review} onClose={record.closeReview} />}
    </PublishFrame>
  );
}
