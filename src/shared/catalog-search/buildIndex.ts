/**
 * PURE BM25 inverted-index builder (ported from the docs-search engine, adapted
 * to project fields). Deterministic; runs in the browser over the corpus array.
 */
import { tokenize } from "./tokenize.ts";
import { FIELDS } from "./types.ts";
import type { SearchDoc, SearchIndexData, SearchField, TermPostings, Posting } from "./types.ts";

/** Count occurrences of each token. */
function tfMap(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** A document's tokens, field by field. */
function fieldTokens(doc: SearchDoc): Record<SearchField, string[]> {
  return {
    title: tokenize(doc.title),
    categories: tokenize(doc.categories.join(" ")),
    author: tokenize(doc.author),
    description: tokenize(doc.description),
  };
}

/** Adds document `i`'s postings to the index, and counts each of its terms once toward `df`. */
function indexDoc(
  i: number,
  tokensByField: Record<SearchField, string[]>,
  index: Record<string, TermPostings>,
  df: Record<string, number>,
): void {
  const docTermsSeen = new Set<string>();
  for (const f of FIELDS) {
    for (const [term, tf] of tfMap(tokensByField[f])) {
      index[term] ??= {};
      (index[term][f] ??= []).push([i, tf] satisfies Posting);
      docTermsSeen.add(term);
    }
  }
  for (const term of docTermsSeen) df[term] = (df[term] ?? 0) + 1;
}

function averageLengths(fieldLengths: Record<SearchField, number[]>, totalDocs: number): Record<SearchField, number> {
  const avgFieldLength: Record<SearchField, number> = {
    title: 0,
    categories: 0,
    author: 0,
    description: 0,
  };
  if (totalDocs === 0) return avgFieldLength;
  for (const f of FIELDS) {
    let sum = 0;
    for (const len of fieldLengths[f]) sum += len;
    avgFieldLength[f] = sum / totalDocs;
  }
  return avgFieldLength;
}

/** Build the in-memory BM25 search index from the corpus. */
export function buildIndex(docs: SearchDoc[]): SearchIndexData {
  const index: Record<string, TermPostings> = Object.create(null);
  const df: Record<string, number> = Object.create(null);
  const fieldLengths: Record<SearchField, number[]> = {
    title: [],
    categories: [],
    author: [],
    description: [],
  };
  const totalDocs = docs.length;
  docs.forEach((doc, i) => {
    const tokensByField = fieldTokens(doc);
    for (const f of FIELDS) fieldLengths[f][i] = tokensByField[f].length;
    indexDoc(i, tokensByField, index, df);
  });
  const avgFieldLength = averageLengths(fieldLengths, totalDocs);
  // `docs` is stored directly so hits carry full display data (cover, author…).
  return { version: 1, docs, index, df, fieldLengths, avgFieldLength, totalDocs };
}
