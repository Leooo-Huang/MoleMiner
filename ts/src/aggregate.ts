/** Stage 3: Aggregate search results — dedupe, filter, classify. */

import type { SearchResult } from './models.js';
import { dedupeResults, normalizeUrl } from './utils/dedupe.js';

/**
 * Best-effort parse of a timestamp string to a Date.
 *
 * Handles:
 * - Unix timestamps (10 digits = seconds, 13 digits = milliseconds)
 * - ISO 8601 and other formats that `new Date()` can handle
 * - Date-only strings like "2025-06-15"
 */
export function parseTimestamp(ts: string): Date | null {
  if (!ts) return null;

  const trimmed = ts.trim();

  // Unix timestamp: all digits, 10 or 13 chars
  if (/^\d{10}$/.test(trimmed)) {
    const d = new Date(Number(trimmed) * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{13}$/.test(trimmed)) {
    const d = new Date(Number(trimmed));
    return isNaN(d.getTime()) ? null : d;
  }

  // Try native Date parsing (handles ISO 8601 and many formats)
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  return null;
}

/**
 * Remove results older than `maxAgeDays`.
 *
 * Results with no parseable timestamp are always kept (benefit of the doubt).
 * If maxAgeDays is undefined, no filtering is applied.
 */
export function filterByFreshness(
  results: SearchResult[],
  maxAgeDays?: number,
): SearchResult[] {
  if (maxAgeDays === undefined || results.length === 0) return results;

  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  return results.filter(r => {
    const dt = parseTimestamp(r.timestamp ?? '');
    // Keep if no parseable timestamp or if within freshness window
    return dt === null || dt >= cutoff;
  });
}

/**
 * Deduplicate, filter, and organize search results.
 *
 * @param existingUrls URLs already seen in previous rounds (for cross-round dedup).
 */
export function aggregateResults(
  results: SearchResult[],
  opts?: { maxAgeDays?: number; existingUrls?: Set<string> },
): SearchResult[] {
  if (results.length === 0) return [];

  let processed = dedupeResults(results);
  processed = filterByFreshness(processed, opts?.maxAgeDays);

  // Cross-round URL dedup
  if (opts?.existingUrls && opts.existingUrls.size > 0) {
    processed = processed.filter(r => !opts.existingUrls!.has(normalizeUrl(r.url)));
  }

  return processed;
}
