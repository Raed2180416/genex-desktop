import type { JSX } from "react";
import type { ExportReview as Review } from "../../shared/plugins.ts";

const MESSAGE = {
  Included: "Files that will be uploaded",
  Excluded: "Excluded from this upload",
  Empty: "None",
} as const;

/** The complete host-generated file list for a staged upload, including excluded paths. */
export function ExportReview({ review }: { review: Review }): JSX.Element {
  return (
    <div data-export-review className="mt-2 space-y-2 text-chat-sub">
      {(
        [
          [MESSAGE.Included, review.included],
          [MESSAGE.Excluded, review.excluded],
        ] as const
      ).map(([title, files]) => (
        <details key={title} open>
          <summary className="chat-disclosure">
            {title} ({files.length})
          </summary>
          <ul className="mt-1 max-h-48 overflow-auto [overflow-wrap:anywhere]">
            {files.length ? (
              files.map((file) => (
                <li key={file} className="font-mono text-ink-2">
                  {file}
                </li>
              ))
            ) : (
              <li>{MESSAGE.Empty}</li>
            )}
          </ul>
        </details>
      ))}
    </div>
  );
}
