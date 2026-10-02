/** Discovery state is independent of provider authentication. */
export const ModelCatalogState = {
  Loading: "loading",
  Ready: "ready",
  Stale: "stale",
  Unavailable: "unavailable",
} as const;
export type ModelCatalogState = (typeof ModelCatalogState)[keyof typeof ModelCatalogState];
/** Where the last complete model list came from. */
export const ModelCatalogSource = { Provider: "provider", Cache: "cache" } as const;
export type ModelCatalogSource = (typeof ModelCatalogSource)[keyof typeof ModelCatalogSource];
/** Bounded discovery failures; none implies a failed sign-in. */
export const ModelCatalogProblemCode = {
  Timeout: "timeout",
  Unsupported: "unsupported",
  Malformed: "malformed",
  Provider: "provider",
} as const;
export type ModelCatalogProblemCode = (typeof ModelCatalogProblemCode)[keyof typeof ModelCatalogProblemCode];
/** Serializable catalog progress for Settings and the model picker. */
export interface ModelCatalogStatus {
  state: ModelCatalogState;
  revision: number;
  refreshing: boolean;
  source?: ModelCatalogSource;
  refreshedAt?: number;
  problem?: { code: ModelCatalogProblemCode; message: string };
}
