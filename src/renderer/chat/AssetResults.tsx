import type { JSX } from "react";
import { memo, useMemo, useState } from "react";
import type { AssetDeliveredPayload, ProjectAsset } from "../../shared/game-assets.ts";
import { assetPreviewMode } from "../../shared/asset-preview.ts";
import { AssetTile } from "../panels/AssetTile.tsx";
import { AssetPreview } from "../panels/AssetPreview.tsx";
import { ResultButton } from "../ui/ResultButton.tsx";
import { useAsyncEffect } from "../use-async-effect.ts";
import { AudioStrip } from "./AudioStrip.tsx";
import { hostPlatform } from "../platform.ts";
import { fileManagerWords } from "../words.ts";

/** What the game folder was last seen holding, so a remounted row keeps its height. */
const presence = new Map<string, boolean>();
/** How many files `presence` remembers before it forgets the oldest. */
const PRESENCE_CAP = 2000;
/** Results shown at first, and added by each "Show more assets". */
const PAGE_SIZE = 6;
const presenceKey = (project: string, file: string) => `${project}\n${file}`;
const VISUAL = new Set(["image", "model", "texture", "video"]);
const isVisual = (asset: ProjectAsset): boolean => VISUAL.has(assetPreviewMode(asset.file));
const isAudio = (asset: ProjectAsset): boolean => assetPreviewMode(asset.file) === "audio";

/** Remember what the folder holds, forgetting the oldest entry past the cap. */
function rememberPresence(project: string, asked: readonly string[], here: ReadonlySet<string>): void {
  for (const file of asked) presence.set(presenceKey(project, file), here.has(file));
  while (presence.size > PRESENCE_CAP) {
    const oldest = presence.keys().next().value;
    if (oldest !== undefined) presence.delete(oldest);
  }
}

/** Each delivered file once, with the delivery it came in. */
function deliveredAssets(deliveries: AssetDeliveredPayload[]): ProjectAsset[] {
  const seen = new Set<string>();
  return deliveries
    .flatMap((delivery) =>
      delivery.files.map((file) => ({
        ...file,
        source: delivery.source,
        mtime: delivery.at,
        jobId: delivery.jobId,
        render: file.kind === "model" ? delivery.render : null,
      })),
    )
    .filter((asset) => !seen.has(asset.file) && Boolean(seen.add(asset.file)));
}

/**
 * The files the game folder holds now, or null until the first answer (unless every file was
 * seen before). Entries are rebuilt as the log grows; the question only changes when the files do.
 */
function usePresentFiles(project: string, files: readonly string[], revision: number): Set<string> | null {
  const filesKey = files.join("\n");
  const known = (): Set<string> | null =>
    files.every((file) => presence.has(presenceKey(project, file)))
      ? new Set(files.filter((file) => presence.get(presenceKey(project, file))))
      : null;
  const [present, setPresent] = useState<Set<string> | null>(known);
  useAsyncEffect(
    (alive) => {
      const asked = filesKey ? filesKey.split("\n") : [];
      if (!project || asked.length === 0) {
        setPresent(new Set());
        return;
      }
      void Promise.resolve()
        .then(() => window.studio.presentProjectAssets({ project, files: asked }))
        .then((found) => {
          const here = new Set(found);
          rememberPresence(project, asked, here);
          if (alive()) setPresent(here);
        })
        .catch(() => {
          if (alive()) setPresent((current) => current ?? new Set());
        });
      return undefined;
    },
    [project, filesKey, revision],
  );
  return present;
}

/** A non-visual file: its name opens the preview, and a hover action opens the Assets tab. */
function AssetRow({
  asset,
  onSelect,
  onOpenAssets,
}: {
  asset: ProjectAsset;
  onSelect: () => void;
  onOpenAssets?: () => void;
}): JSX.Element {
  return (
    <div data-asset-file={asset.file} className="asset-row flex h-9 min-w-0 items-center rounded-control bg-inset px-3">
      <div className="relative flex min-w-0 flex-1 items-center">
        <button
          type="button"
          title={asset.file}
          onClick={onSelect}
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-chat-sub text-ink-2 hover:text-control-text-hover"
        >
          {asset.file.split("/").at(-1)}
        </button>
        {onOpenAssets && (
          <ResultButton
            data-open-assets
            onClick={onOpenAssets}
            className="asset-preview-action absolute right-0 top-1/2 -translate-y-1/2"
          >
            Open in Assets
          </ResultButton>
        )}
      </div>
    </div>
  );
}

/** One tile alone keeps a modest width; several share a two-column grid. */
function TileGroup({ tiles, render }: { tiles: ProjectAsset[]; render: (asset: ProjectAsset) => JSX.Element }) {
  const [only] = tiles;
  if (tiles.length === 1 && only) return <div className="max-w-80">{render(only)}</div>;
  if (tiles.length > 1) return <div className="grid grid-cols-2 gap-2">{tiles.map(render)}</div>;
  return null;
}

/**
 * Generated files as results: only what the game folder holds now. A build's files arrive with
 * its result once it lands; a file that is not in the game is never shown as a broken preview.
 */
export const AssetResults = memo(function AssetResults({
  deliveries,
  revision = 0,
  onOpenAssets,
}: {
  deliveries: AssetDeliveredPayload[];
  revision?: number;
  onOpenAssets?: () => void;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<ProjectAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const project = deliveries[0]?.project ?? "";
  const assets = useMemo(() => deliveredAssets(deliveries), [deliveries]);
  const files = useMemo(() => assets.map((asset) => asset.file), [assets]);
  const present = usePresentFiles(project, files, revision);
  if (!present) return null;
  const available = assets.filter((asset) => present.has(asset.file));
  const visual = available.filter(isVisual);
  const audio = available.filter(isAudio);
  // Buffers, material and atlas files belong to the media beside them; alone they still get a row.
  const ordered = visual.length || audio.length ? [...visual, ...audio] : available;
  if (ordered.length === 0) return null;
  const page = ordered.slice(0, limit);
  const rows = page.filter((asset) => !isVisual(asset));
  const tile = (asset: ProjectAsset) => (
    <div key={asset.file} className="aspect-[16/10] min-w-0">
      <AssetTile
        project={project}
        asset={asset}
        companions={files}
        onOpen={() => setSelected(asset)}
        onOpenAssets={onOpenAssets}
      />
    </div>
  );
  return (
    <section data-chat-assets className="w-full max-w-[26rem] min-w-0 space-y-2" aria-label="Generated assets">
      <TileGroup tiles={page.filter(isVisual)} render={tile} />
      {rows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {rows.map((asset) =>
            isAudio(asset) ? (
              <AudioStrip
                key={asset.file}
                project={project}
                asset={asset}
                onOpen={() => setSelected(asset)}
                onOpenAssets={onOpenAssets}
              />
            ) : (
              <AssetRow
                key={asset.file}
                asset={asset}
                onSelect={() => setSelected(asset)}
                onOpenAssets={onOpenAssets}
              />
            ),
          )}
        </div>
      )}
      {ordered.length > limit && (
        <ResultButton onClick={() => setLimit((n) => n + PAGE_SIZE)}>Show more assets</ResultButton>
      )}
      {error && (
        <p role="alert" className="text-chat-sub text-ink-3">
          {error}
        </p>
      )}
      {selected && (
        <AssetPreview
          key={selected.file}
          project={project}
          asset={selected}
          assets={assets}
          onClose={() => setSelected(null)}
          onReveal={() =>
            void window.studio
              .revealProject(project, selected.file)
              .catch(() => setError(fileManagerWords(hostPlatform()).revealFailed))
          }
        />
      )}
    </section>
  );
});
