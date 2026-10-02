import type { ProjectAsset } from "../../shared/game-assets.ts";
import { AssetThumbnail } from "./AssetThumbnail.tsx";
import { ResultButton } from "../ui/ResultButton.tsx";

/** The tile's action words for an asset kind: view a model, play a clip, else preview. */
function previewWords(kind: ProjectAsset["kind"]): string {
  if (kind === "model") return "View 3D";
  return kind === "audio" || kind === "video" ? "Play preview" : "Preview";
}

/** The same preview surface in the conversation and the Assets canvas. */
export function AssetTile({
  project,
  asset,
  companions,
  onOpen,
  onOpenAssets,
}: {
  project: string;
  asset: ProjectAsset;
  companions: string[];
  onOpen: () => void;
  onOpenAssets?: () => void;
}) {
  const name = asset.file.split("/").at(-1) ?? asset.file;
  return (
    <div
      data-tile-kind={asset.kind}
      className="asset-tile relative h-full min-h-0 overflow-hidden rounded-card bg-inset"
    >
      <button
        type="button"
        aria-label={`Preview ${name}`}
        title={name}
        onClick={onOpen}
        className="absolute inset-0 block w-full rounded-card text-ink-3"
      >
        <AssetThumbnail project={project} asset={asset} companions={companions} fallback={null} />
        <span className="asset-preview-action result-button absolute bottom-2 right-2">{previewWords(asset.kind)}</span>
      </button>
      {onOpenAssets && (
        <ResultButton data-open-assets onClick={onOpenAssets} className="asset-preview-action absolute left-2 top-2">
          Open in Assets
        </ResultButton>
      )}
    </div>
  );
}
