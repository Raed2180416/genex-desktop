/**
 * The Plugins tab: what is installed (on or off), the MCP servers you added, what was removed or
 * waits to be allowed, More plugins when the catalog has something you don't have, and a way to
 * make your own.
 */
import type { JSX, RefObject } from "react";
import { GENEX_PLUGIN_ID } from "../../../shared/genex.ts";
import type { PluginIndexEntry, PluginIndexView, PluginInfo } from "../../../shared/plugins.ts";
import { Button } from "../../ui/Button.tsx";
import { Icon } from "../../ui/icons.tsx";
import { IconButton } from "../../ui/kit.tsx";
import { PLUGINS_WORDS } from "../../words.ts";
import { type ConnectorActions, ConnectorsCard } from "../ConnectorsCard.tsx";
import { useGenexCredits } from "./genex/use-genex-credits.ts";
import { meetsMinimumVersion, PLUGIN_GUIDE_URL, pluginAccount } from "./labels.ts";
import type { CatalogRow, PluginsPage } from "./page.ts";
import { Pending } from "../../ui/Pending.tsx";
import { PluginIcon } from "../../ui/PluginIcon.tsx";
import { PluginRows, pluginMatches, Section } from "./rows.tsx";

const WORDS = PLUGINS_WORDS;

function Installed({
  installed,
  page,
  query,
  index,
}: {
  installed: PluginInfo[];
  page: PluginsPage;
  query: string;
  index: PluginIndexView | null;
}) {
  const nothingShown = installed.filter((p) => pluginMatches(page, p)).length === 0;
  const credits = useGenexCredits(installed, pluginAccount(page.connections, GENEX_PLUGIN_ID), page.connections);
  const updates = new Map((index?.updates ?? []).map((u) => [u.id, u.version]));
  return (
    <Section title="Installed" count={installed.length}>
      <PluginRows list={installed} page={page} credits={credits} updates={updates} />
      {nothingShown && (
        <p className="extensions-empty">
          {query ? "No installed plugins match your search." : "No plugins installed yet. Add one from the Add menu."}
        </p>
      )}
    </Section>
  );
}

/** What a catalog entry offers: a Studio floor it is under, an update, or install. */
function EntryAction({
  entry,
  index,
  page,
  removed,
}: {
  entry: PluginIndexEntry;
  index: PluginIndexView;
  page: PluginsPage;
  removed: Set<string>;
}): JSX.Element {
  const blocked =
    entry.minStudioVersion !== undefined && !meetsMinimumVersion(index.studioVersion, entry.minStudioVersion);
  if (blocked) return <span className="text-xs text-ink-3">Needs Studio ≥ {entry.minStudioVersion}</span>;
  return (
    <IconButton
      icon="plus"
      disabled={page.busy}
      label={`${removed.has(entry.id) ? "Reinstall" : "Install"} ${entry.name}`}
      onClick={() => void page.act(() => window.studio.pluginInstall(entry.id))}
    />
  );
}

/** One plugin you don't have: its picture, name and one line, and the way to get it. */
function CatalogEntry({ name, description, children }: { name: string; description: string; children: JSX.Element }) {
  return (
    <div className="extension-row">
      <div className="extension-open extension-static">
        <PluginIcon name={name} />
        <span className="extension-copy">
          <span className="extension-name">{name}</span>
          <span className="extension-description" title={description}>
            {description}
          </span>
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * More plugins: only what the catalog has that you don't. Nothing to offer, no section; a catalog
 * that can't be read says so in one line with Try again.
 */
function MorePlugins({
  index,
  catalog,
  page,
  installed,
  removed,
  onRetry,
}: {
  index: PluginIndexView | null;
  catalog: CatalogRow[];
  page: PluginsPage;
  installed: Set<string>;
  removed: Set<string>;
  onRetry: () => void;
}): JSX.Element | null {
  const entries = (index?.entries ?? []).filter(
    (e) => !installed.has(e.id) && page.matches(e.name, e.description, e.category),
  );
  const releases = catalog.filter((c) => !installed.has(c.id) && page.matches(c.name));
  const failed = Boolean(index?.error) && entries.length === 0;
  const nothing = entries.length === 0 && releases.length === 0;
  if (index && nothing && !failed) return null;
  return (
    <Section title={WORDS.more.title} hooks={{ "data-more-plugins": "" }}>
      {!index && <Pending label={WORDS.more.loading} className="extensions-empty" />}
      {failed && (
        <div className="extension-row">
          <p className="extensions-empty flex-1">{WORDS.more.failed}</p>
          <Button variant="ghost" disabled={page.busy} onClick={onRetry}>
            <Icon name="reload" size={14} />
            {WORDS.more.tryAgain}
          </Button>
        </div>
      )}
      {index &&
        entries.map((e) => (
          <article key={e.id} data-plugin-tier={e.tier} data-plugin-category={e.category}>
            <CatalogEntry name={e.name} description={e.description}>
              <EntryAction entry={e} index={index} page={page} removed={removed} />
            </CatalogEntry>
          </article>
        ))}
      {releases.map((p) => (
        <CatalogEntry key={p.id} name={p.name} description={p.version}>
          <IconButton
            icon="plus"
            disabled={page.busy}
            label={`Install ${p.name}`}
            onClick={() => void page.act(() => window.studio.pluginInstall(p.id))}
          />
        </CatalogEntry>
      ))}
    </Section>
  );
}

/** The last row: every plugin here, Studio's own included, is one folder anyone can make. */
function MakeYourOwn(): JSX.Element {
  return (
    <section className="extension-row extension-own" aria-label={WORDS.own.title}>
      <span className="extension-icon extension-icon-row extension-icon-make" aria-hidden="true">
        <Icon name="code" size={20} />
      </span>
      <span className="extension-copy">
        <span className="extension-name">{WORDS.own.title}</span>
        <span className="extension-description">{WORDS.own.text}</span>
      </span>
      <Button onClick={() => void window.studio.openUrl(PLUGIN_GUIDE_URL)}>
        {WORDS.own.guide}
        <Icon name="arrow-up-right" size={14} />
      </Button>
    </section>
  );
}

/** The Plugins tab's lists, below the search. */
export function PluginsBrowse({
  plugins,
  page,
  query,
  catalog,
  index,
  connectorActions,
  onRetryIndex,
}: {
  plugins: PluginInfo[];
  page: PluginsPage;
  query: string;
  catalog: CatalogRow[];
  index: PluginIndexView | null;
  connectorActions: RefObject<ConnectorActions | null>;
  onRetryIndex: () => void;
}): JSX.Element {
  const installed = plugins.filter((p) => !p.removed && !p.unlisted);
  const removed = plugins.filter((p) => p.removed);
  const unlisted = plugins.filter((p) => p.unlisted);
  return (
    <>
      <Installed installed={installed} page={page} query={query} index={index} />
      <ConnectorsCard
        ref={connectorActions}
        project={page.project}
        query={query}
        onOpenPlugin={page.openPlugin}
        pluginName={(id) => plugins.find((p) => p.manifest.id === id)?.manifest.name ?? id}
      />
      {removed.length > 0 && (
        <Section title="Removed" count={removed.length}>
          <PluginRows list={removed} page={page} />
        </Section>
      )}
      {unlisted.length > 0 && (
        <Section title="Not enabled" count={unlisted.length}>
          <p className="mb-3 text-sm text-ink-3">Found locally. These plugins only run after you allow them.</p>
          <PluginRows list={unlisted} page={page} />
        </Section>
      )}
      <MorePlugins
        index={index}
        catalog={catalog}
        page={page}
        installed={new Set(installed.map((p) => p.manifest.id))}
        removed={new Set(removed.map((p) => p.manifest.id))}
        onRetry={onRetryIndex}
      />
      {!query && <MakeYourOwn />}
    </>
  );
}
