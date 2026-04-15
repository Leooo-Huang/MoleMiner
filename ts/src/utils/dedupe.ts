/** URL normalization and result deduplication. */

import type { SearchResult } from '../models.js';

const TRACKING_PARAMS = new Set([
  'ref',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'source',
  'via',
]);

const MIN_TITLE_LENGTH = 10;
const DEFAULT_TITLE_THRESHOLD = 0.85;

/** Normalize a URL for deduplication comparison. */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const scheme = 'https:';
    const netloc = parsed.hostname.toLowerCase();
    const port = parsed.port;
    const path = parsed.pathname.replace(/\/+$/, '') || '';

    // Filter and sort query params
    const params: string[] = [];
    parsed.searchParams.sort();
    for (const [key, value] of parsed.searchParams) {
      if (!TRACKING_PARAMS.has(key)) {
        params.push(`${key}=${value}`);
      }
    }
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    const portStr = port ? `:${port}` : '';

    return `${scheme}//${netloc}${portStr}${path}${query}`;
  } catch {
    return url;
  }
}

/** Lowercase, strip punctuation (preserving Unicode letters/numbers), collapse whitespace. */
export function normalizeTitle(title: string): string {
  let t = title.toLowerCase().trim();
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Generate character trigrams from text. */
export function trigramSet(text: string): Set<string> {
  if (text.length === 0) return new Set();
  if (text.length < 3) return new Set([text]);
  const trigrams = new Set<string>();
  for (let i = 0; i <= text.length - 3; i++) {
    trigrams.add(text.slice(i, i + 3));
  }
  return trigrams;
}

/** Compute trigram-based Jaccard similarity between two titles. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1.0;

  const sa = trigramSet(na);
  const sb = trigramSet(nb);
  if (sa.size === 0 || sb.size === 0) return 0.0;

  let intersection = 0;
  for (const t of sa) {
    if (sb.has(t)) intersection++;
  }
  const union = sa.size + sb.size - intersection;
  return intersection / union;
}

/**
 * Remove duplicate results based on normalized URL and fuzzy title matching.
 *
 * Two-pass dedup:
 * 1. Exact URL match (after normalization)
 * 2. Title similarity — if two results from *different* sources have nearly
 *    identical titles, keep only the first.
 */
export function dedupeResults(
  results: SearchResult[],
  titleThreshold: number = DEFAULT_TITLE_THRESHOLD,
): SearchResult[] {
  if (results.length === 0) return [];

  // Pass 1: URL dedup
  const seenUrls = new Set<string>();
  const urlDeduped: SearchResult[] = [];
  for (const r of results) {
    const norm = normalizeUrl(r.url);
    if (seenUrls.has(norm)) continue;
    seenUrls.add(norm);
    urlDeduped.push(r);
  }

  // Pass 2: Title fuzzy dedup (only across different sources)
  const deduped: SearchResult[] = [];
  for (const r of urlDeduped) {
    let isDup = false;
    if (r.title.length >= MIN_TITLE_LENGTH) {
      for (const existing of deduped) {
        if (r.source === existing.source) continue;
        if (existing.title.length < MIN_TITLE_LENGTH) continue;
        if (titleSimilarity(r.title, existing.title) >= titleThreshold) {
          isDup = true;
          break;
        }
      }
    }
    if (!isDup) {
      deduped.push(r);
    }
  }

  return deduped;
}
