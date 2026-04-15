/**
 * Importance score computation for search results.
 *
 * Composite score 0–1 from:
 *   40% source authority  — how credible is this platform/source type
 *   25% freshness         — recency decay: today=1.0, >1 year=0.3
 *   20% engagement        — log-normalized against per-platform p95 values
 *   15% AI confidence     — direct=1.0, lead=0.6, unknown=0.5
 */

import type { SearchResult } from '../models.js';

/**
 * p95 reference engagement per platform.
 * Represents "excellent" engagement — a result at this level scores 1.0.
 * Values tuned to distinguish quality signals from noise.
 */
const P95: Record<string, Record<string, number>> = {
  hackernews:   { score: 500, comments: 200 },
  reddit:       { score: 2000, comments: 500 },
  github:       { stars: 5000, forks: 1000 },
  stackoverflow:{ score: 100, answers: 10 },
  devto:        { likes: 500, comments: 100, views: 10000 },
  youtube:      { views: 100000, likes: 5000, comments: 1000 },
  x:            { likes: 1000, retweets: 500, replies: 200, views: 50000 },
  zhihu:        { upvotes: 1000, comments: 200 },
  weibo:        { likes: 500, reposts: 200, comments: 100 },
  xiaohongshu:  { likes: 500, comments: 100, bookmarks: 200 },
  wechat:       { views: 10000, likes: 200 },
  brave:        {},
};

/**
 * Base authority weight per platform (0–1).
 * Reflects how likely results from this platform are authoritative.
 */
const SOURCE_AUTHORITY: Record<string, number> = {
  stackoverflow:  0.90,
  github:         0.85,
  hackernews:     0.75,
  wechat:         0.70,
  zhihu:          0.70,
  devto:          0.65,
  youtube:        0.65,
  brave:          0.60,
  reddit:         0.60,
  xiaohongshu:    0.55,
  x:              0.55,
  weibo:          0.50,
};

const DEFAULT_AUTHORITY = 0.55;

/** Log-normalize a raw engagement metric against a p95 reference. */
function logNormalize(value: number, p95: number): number {
  if (p95 <= 0 || value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(p95));
}

/** Freshness score based on timestamp age. Unknown age → 0.5 (medium). */
function freshnessScore(timestamp?: string): number {
  if (!timestamp) return 0.5;
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (isNaN(ageMs) || ageMs < 0) return 0.5;
  const ageDays = ageMs / 86_400_000;
  if (ageDays < 7)   return 1.0;
  if (ageDays < 30)  return 0.85;
  if (ageDays < 90)  return 0.70;
  if (ageDays < 180) return 0.55;
  if (ageDays < 365) return 0.40;
  if (ageDays < 730) return 0.25; // 1-2 years
  if (ageDays < 1095) return 0.10; // 2-3 years
  return 0.05; // >3 years — severely outdated
}

/** Normalized engagement score for a result, 0–1. */
function engagementScore(result: SearchResult): number {
  const meta = result.metadata ?? {};
  const p95Map = P95[result.source] ?? {};
  const p95Entries = Object.entries(p95Map);
  if (p95Entries.length === 0) return 0;

  const scores: number[] = [];
  for (const [key, p95Val] of p95Entries) {
    const raw = Number(meta[key] ?? 0);
    if (raw > 0) {
      scores.push(logNormalize(raw, p95Val));
    }
  }

  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Enrich results with importanceScore (0–1).
 * Returns new result objects — originals are not mutated.
 *
 * Formula: 0.40 * authority + 0.25 * freshness + 0.20 * engagement + 0.15 * aiConfidence
 */
export function computeImportanceScores(results: SearchResult[]): SearchResult[] {
  return results.map(r => {
    const authority   = SOURCE_AUTHORITY[r.source] ?? DEFAULT_AUTHORITY;
    const freshness   = freshnessScore(r.timestamp);
    const engagement  = engagementScore(r);
    // Direct results are primary sources → highest AI confidence
    const aiConfidence = r.resultType === 'direct' ? 1.0
                       : r.resultType === 'lead'   ? 0.6
                       : 0.5;

    const score =
      0.40 * authority  +
      0.25 * freshness  +
      0.20 * engagement +
      0.15 * aiConfidence;

    return { ...r, importanceScore: Math.round(score * 1000) / 1000 };
  });
}
