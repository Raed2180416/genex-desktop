/**
 * PURE type declarations + BM25 tuning for gallery search (AG-746). Adapted from
 * the docs-search engine: the four fields are now project fields, and stored docs
 * carry full display data so result rows render without a second fetch.
 */

/** The four searchable fields, ordered by importance. */
export type SearchField = "title" | "categories" | "author" | "description";

/** Per-document, per-field term frequency: tuple [docIndex, tf]. */
export type Posting = [docIndex: number, tf: number];

/** One term's postings, split by field. Missing key => no occurrences there. */
export interface TermPostings {
  title?: Posting[];
  categories?: Posting[];
  author?: Posting[];
  description?: Posting[];
}

/** A project as indexed + displayed. Mirrors GET /api/gallery/search-corpus items
 *  (minus createdAt, which search doesn't use). Stored in the index so hits carry
 *  everything a result row needs — cover banner included. */
export interface SearchDoc {
  id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  author: string;
  thumbnailUrl: string | null;
  playsCount: number;
  multiplayer: boolean;
}

/** The fully in-memory BM25 index built in the browser from the corpus. */
export interface SearchIndexData {
  version: 1;
  docs: SearchDoc[];
  index: Record<string, TermPostings>;
  /** term -> document frequency (distinct docs containing the term in ANY field). */
  df: Record<string, number>;
  /** fieldLengths[field][docIndex] = token count of that field for that doc. */
  fieldLengths: Record<SearchField, number[]>;
  /** Average field length across the corpus, per field. 0 when totalDocs===0. */
  avgFieldLength: Record<SearchField, number>;
  /** == docs.length. */
  totalDocs: number;
}

/** A single ranked hit — the full doc plus its score (rows render from `doc`). */
export interface SearchResult {
  doc: SearchDoc;
  score: number;
}

/** BM25 + boost constants — exported so index/query agree. */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const FIELD_BOOSTS: Record<SearchField, number> = {
  title: 8,
  categories: 5, // typing "assets" must surface that category's projects
  author: 3, // author-name matches return projects (decision #3)
  description: 1.5,
};
/** Iteration order for fields — use everywhere instead of Object.keys for determinism. */
export const FIELDS: readonly SearchField[] = ["title", "categories", "author", "description"];
/** Per extra distinct query term matched, multiply score by (1 + this). */
export const COVERAGE_BONUS = 0.15;
/** Speculative prefix-expansion keys are damped vs the exact-typed key. */
export const PREFIX_WEIGHT = 0.5;
/** Default result cap. */
export const DEFAULT_LIMIT = 10;
