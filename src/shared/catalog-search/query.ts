/**
 * PURE client query engine (ported from the docs-search engine). BM25 with field
 * boosts, prefix expansion on the still-being-typed final token, and a multi-term
 * coverage bonus. Returns full docs (rows render the cover banner from them); no
 * HTML snippet — gallery rows show cover/title/author/categories instead.
 */
import { tokenize } from "./tokenize.ts";
import { BM25_K1, BM25_B, FIELD_BOOSTS, FIELDS, COVERAGE_BONUS, PREFIX_WEIGHT, DEFAULT_LIMIT } from "./types.ts";
import type { SearchIndexData, SearchResult, SearchField } from "./types.ts";

export type Searcher = { search(query: string, limit?: number): SearchResult[] };

export function createSearcher(index: SearchIndexData): Searcher {
  const termKeys = Object.keys(index.index);

  /** Inverse document frequency (Lucene BM25+ convention — strictly positive). */
  function idf(t: string): number {
    const N = index.totalDocs;
    const n = index.df[t] ?? 0;
    if (n === 0) return 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  /** Term frequency of `term` in `docIndex` within `field` (linear posting scan). */
  function tf(term: string, docIndex: number, field: SearchField): number {
    const postings = index.index[term]?.[field];
    if (!postings) return 0;
    for (const [d, f] of postings) {
      if (d === docIndex) return f;
    }
    return 0;
  }

  /** BM25 score of one term in one field of one doc (before field boost). */
  function fieldScore(term: string, docIndex: number, field: SearchField): number {
    const f = tf(term, docIndex, field);
    if (f === 0) return 0;
    const len = index.fieldLengths[field][docIndex];
    const avgRaw = index.avgFieldLength[field];
    const avg = avgRaw > 0 ? avgRaw : 1; // guard div-by-zero on empty-field corpora.
    const denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (len / avg));
    return idf(term) * ((f * (BM25_K1 + 1)) / denom);
  }

  /** Boosted BM25 contribution of one term in one doc, summed across fields. */
  function termDocContribution(term: string, docIndex: number): number {
    let s = 0;
    for (const fld of FIELDS) s += FIELD_BOOSTS[fld] * fieldScore(term, docIndex, fld);
    return s;
  }

  /** Distinct docIndexes a term appears in across all fields. */
  function docsForTerm(term: string): Set<number> {
    const set = new Set<number>();
    const postings = index.index[term];
    if (!postings) return set;
    for (const fld of FIELDS) {
      const arr = postings[fld];
      if (!arr) continue;
      for (const [d] of arr) set.add(d);
    }
    return set;
  }

  /** Each doc's summed score so far, and how many distinct query terms it matched. */
  type Tally = { scores: Map<number, number>; matchedTerms: Map<number, number> };

  function addContribution(tally: Tally, d: number, amount: number): void {
    tally.scores.set(d, (tally.scores.get(d) ?? 0) + amount);
  }

  function markTerm(tally: Tally, d: number): void {
    tally.matchedTerms.set(d, (tally.matchedTerms.get(d) ?? 0) + 1);
  }

  /** (a) Exact terms. */
  function scoreExact(tally: Tally, exactTokens: string[]): void {
    for (const term of exactTokens) {
      if (!index.index[term]) continue;
      const hitDocs = docsForTerm(term);
      for (const d of hitDocs) addContribution(tally, d, termDocContribution(term, d));
      for (const d of hitDocs) markTerm(tally, d);
    }
  }

  /** (b) Prefix term (counts as ONE distinct query term for coverage). */
  function scorePrefix(tally: Tally, prefixToken: string): void {
    const prefixKeys = termKeys.filter((k) => k.startsWith(prefixToken));
    const prefixHitDocs = new Set<number>();
    for (const k of prefixKeys) {
      const weight = k === prefixToken ? 1 : PREFIX_WEIGHT;
      for (const d of docsForTerm(k)) {
        addContribution(tally, d, weight * termDocContribution(k, d));
        prefixHitDocs.add(d);
      }
    }
    for (const d of prefixHitDocs) markTerm(tally, d);
  }

  /** Coverage bonus + ranking. Tie-break by plays (popularity), then docIndex. */
  function rank(tally: Tally): { d: number; final: number }[] {
    const ranked: { d: number; final: number }[] = [];
    for (const d of tally.scores.keys()) {
      const base = tally.scores.get(d) ?? 0;
      const matched = tally.matchedTerms.get(d) ?? 1;
      const final = base * (1 + COVERAGE_BONUS * (matched - 1));
      if (final <= 0) continue;
      ranked.push({ d, final });
    }
    ranked.sort((a, b) => b.final - a.final || index.docs[b.d].playsCount - index.docs[a.d].playsCount || a.d - b.d);
    return ranked;
  }

  function search(query: string, limit?: number): SearchResult[] {
    const raw = query;
    if (raw.trim() === "") return [];
    const tokens = tokenize(raw);
    if (tokens.length === 0) return [];

    // Prefix decision: the final token is "still being typed" iff the raw string
    // ends in a letter/number (not a separator/whitespace).
    const lastChar = raw.slice(-1);
    const endsClean = lastChar !== "" && !/[^\p{L}\p{N}]/u.test(lastChar);
    const prefixToken = endsClean ? tokens[tokens.length - 1] : null;
    const exactTokens = endsClean ? tokens.slice(0, -1) : tokens.slice();

    const tally: Tally = { scores: new Map(), matchedTerms: new Map() };
    scoreExact(tally, exactTokens);
    if (prefixToken !== null) scorePrefix(tally, prefixToken);
    const cap = limit ?? DEFAULT_LIMIT;
    return rank(tally)
      .slice(0, cap)
      .map(({ d, final }) => ({ doc: index.docs[d], score: final }));
  }

  return { search };
}
