/** Output formatters for search results. */

import type { SearchResult, SearchResponse, SearchReport, SearchDimension } from './models.js';
import { computeImportanceScores } from './utils/scoring.js';

// ─── JSON ──────────────────────────────────────────────────────────────────

/**
 * Format the full search response as JSON.
 * Includes query, rounds, source statuses, and complete result data.
 * This is the canonical machine-readable output — nothing is omitted.
 */
export function formatJson(response: SearchResponse): string {
  return JSON.stringify(
    {
      query: response.query,
      rounds: response.rounds,
      totalResults: response.totalResults,
      sources: response.sources.map(s => ({
        name: s.name,
        status: s.status,
        resultCount: s.resultCount,
        ...(s.elapsedSeconds !== undefined && { elapsedSeconds: s.elapsedSeconds }),
        ...(s.error && { error: s.error }),
      })),
      ...(response.entities && response.entities.length > 0 && {
        entities: response.entities.map(e => ({ name: e.name, confidence: e.confidence })),
      }),
      results: response.results.map(r => ({
        title: r.title,
        url: r.url,
        source: r.source,
        snippet: r.snippet,
        type: r.resultType ?? 'direct',
        ...(r.importanceScore !== undefined && { importanceScore: r.importanceScore }),
        ...(r.language  && { language: r.language }),
        ...(r.timestamp && { timestamp: r.timestamp }),
        ...(r.mentions  && r.mentions.length > 0 && { mentions: r.mentions }),
        ...(r.summary   && { summary: r.summary }),
        ...(r.metadata  && Object.keys(r.metadata).length > 0 && { metadata: r.metadata }),
      })),
    },
    null,
    2,
  );
}

// ─── Table ─────────────────────────────────────────────────────────────────

/**
 * Format results as a plain-text table for terminal display.
 */
export function formatTable(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  const header = `${'#'.padEnd(4)} ${'Title'.padEnd(50)} ${'Source'.padEnd(14)} ${'Type'.padEnd(8)} URL`;
  const separator = '-'.repeat(Math.min(header.length, 120));
  const lines = [header, separator];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const num    = String(i + 1).padEnd(4);
    const title  = truncate(r.title, 50).padEnd(50);
    const source = r.source.padEnd(14);
    const type   = (r.resultType ?? 'direct').padEnd(8);
    const url    = r.url;
    lines.push(`${num} ${title} ${source} ${type} ${url}`);
  }

  return lines.join('\n');
}

// ─── Markdown ──────────────────────────────────────────────────────────────

/**
 * Format results as Markdown.
 */
export function formatMarkdown(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  const lines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`### ${i + 1}. ${r.title}`);
    lines.push(`- **Source:** ${r.source}`);
    lines.push(`- **Type:** ${r.resultType ?? 'direct'}`);
    lines.push(`- **URL:** ${r.url}`);
    if (r.timestamp) lines.push(`- **Date:** ${r.timestamp.slice(0, 10)}`);
    if (r.snippet)   lines.push(`- **Snippet:** ${r.snippet}`);
    if (r.metadata && Object.keys(r.metadata).length > 0) {
      const parts = Object.entries(r.metadata)
        .filter(([, v]) => v !== null && v !== undefined && v !== 0 && v !== false)
        .map(([k, v]) => `${k}: ${v}`);
      if (parts.length > 0) lines.push(`- **${parts.join(' · ')}**`);
    }
    if (r.mentions && r.mentions.length > 0) {
      lines.push(`- **Mentions:** ${r.mentions.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Terminal (rich default) ───────────────────────────────────────────────

/**
 * Rich terminal output — the default format.
 * Sections: stats → key entities → direct sources (★ ranked) → leads (folded) → coverage.
 *
 * @param verbose  When false (default), direct results show 1 line each (rank + stars + title).
 *                 When true, each direct result shows 4 lines (+ URL, source/time, summary).
 */
export function formatTerminal(response: SearchResponse, verbose = false): string {
  const { sources, query, rounds, entities } = response;

  // Enrich with importance scores
  const scored = computeImportanceScores(response.results);
  const directs = scored
    .filter(r => r.resultType === 'direct')
    .sort((a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0));
  const leads = scored
    .filter(r => r.resultType !== 'direct')
    .sort((a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0));

  const ok      = sources.filter(s => s.status === 'ok');
  const errored = sources.filter(s => s.status === 'error' || s.status === 'timeout');
  const skipped = sources.filter(s => s.status === 'skipped');

  const zh = isChinese(query ?? '');

  const lines: string[] = [];
  const HR = '─'.repeat(60);

  // Stats header
  lines.push('');
  const newCount = scored.filter(r => r.isNew === true).length;
  const knownCount = scored.filter(r => r.isNew === false).length;
  // Only show NEW count when there are also KNOWN results (i.e., repeated search)
  const showNewTags = knownCount > 0;
  const newSuffix = showNewTags && newCount > 0 ? (zh ? `  ·  ${newCount} 条新增` : `  ·  ${newCount} new`) : '';
  const statsLine = zh
    ? `${scored.length} 条结果  ·  ${ok.length} 个来源  ·  ${rounds} 轮搜索${newSuffix}`
    : `${scored.length} results  ·  ${ok.length} source${ok.length !== 1 ? 's' : ''}  ·  ${rounds} round${rounds !== 1 ? 's' : ''}${newSuffix}`;
  lines.push(statsLine);
  if (query) lines.push(zh ? `查询：${query}` : `Query: ${query}`);

  // Key entities
  if (entities && entities.length > 0) {
    lines.push('');
    lines.push(HR);
    lines.push(zh ? `关键实体  (${entities.length})` : `Key Entities  (${entities.length})`);
    lines.push(HR);
    const names = entities.map(e => `${e.name} (${(e.confidence * 100).toFixed(0)}%)`);
    lines.push('  ' + names.join('  ·  '));
  }

  // Direct sources — grouped by dimension if available
  if (directs.length > 0) {
    const primaryDim = response.dimensions?.find(d => d.priority === 'primary');
    const groups = primaryDim
      ? groupByDimension(directs, primaryDim, zh)
      : [{ label: zh ? '直接来源' : 'Direct Sources', results: directs }];

    let globalIdx = 0;
    for (const group of groups) {
      lines.push('');
      lines.push(HR);
      lines.push(`${group.label}  (${group.results.length})`);
      lines.push(HR);

      const displayCount = verbose ? Math.min(group.results.length, 10) : group.results.length;
      for (let i = 0; i < displayCount; i++) {
        const r = group.results[i];
        const stars = starRating(r.importanceScore ?? 0);
        globalIdx++;
        const num = String(globalIdx).padEnd(3);
        const newTag = showNewTags && r.isNew === true ? ' ✦NEW' : '';

        if (verbose) {
          // Verbose: 4 lines per result (title, URL, source/time, summary)
          lines.push('');
          lines.push(`  ${num} ${stars}  ${r.title}${newTag}`);
          lines.push(`           ${r.url}`);

          const meta: string[] = [r.source];
          if (r.timestamp) {
            const age = relativeTime(r.timestamp, zh);
            if (age) meta.push(age);
          }
          lines.push(`           ${meta.join(' · ')}`);

          const rawText = r.summary || r.snippet || '';
          const text = stripMarkdown(rawText).slice(0, 200);
          if (text) lines.push(`           ${text}`);
        } else {
          // Default: 1 line per result (rank + stars + title)
          lines.push(`  ${num} ${stars}  ${r.title}${newTag}`);
        }
      }

      if (verbose && group.results.length > 10) {
        lines.push(`  [+${group.results.length - 10}]`);
      }
    }
  }

  // Leads (clustered by topic similarity)
  if (leads.length > 0) {
    const clusters = clusterLeads(leads);
    const uniqueTopics = clusters.length;

    lines.push('');
    lines.push(HR);
    lines.push(zh
      ? `线索  (${leads.length} 条, ${uniqueTopics} 个主题)`
      : `Leads  (${leads.length}, ${uniqueTopics} topic${uniqueTopics !== 1 ? 's' : ''})`);
    lines.push(HR);

    // Show up to 8 clusters
    const showClusters = Math.min(clusters.length, 8);
    for (let ci = 0; ci < showClusters; ci++) {
      const c = clusters[ci];
      const newTag = showNewTags && c.hasNew ? ' ✦' : '';
      if (c.items.length === 1) {
        // Single-item cluster: show as before
        lines.push(`  · ${truncate(c.label, 65)}  [${c.sources.join(',')}]${newTag}`);
      } else {
        // Multi-item cluster: show representative + count
        lines.push(`  · ${truncate(c.label, 55)}  (×${c.items.length})  [${c.sources.join(',')}]${newTag}`);
      }
    }

    if (clusters.length > showClusters) {
      const remaining = clusters.slice(showClusters).reduce((sum, c) => sum + c.items.length, 0);
      lines.push(zh
        ? `  [+${clusters.length - showClusters} 个主题, ${remaining} 条线索]`
        : `  [+${clusters.length - showClusters} topics, ${remaining} leads]`);
    }

    lines.push(zh
      ? '  使用 --format markdown 查看所有线索详情'
      : '  Use --format markdown to see all leads with snippets');
  }

  if (scored.length === 0) {
    lines.push('');
    lines.push(zh ? '未找到结果。' : 'No results found.');
    lines.push(zh
      ? '  运行 "moleminer doctor" 检查配置'
      : '  Run "moleminer doctor" to check configuration');
    lines.push(zh
      ? '  运行 "moleminer setup" 配置 API 密钥'
      : '  Run "moleminer setup" to configure API keys');
  }

  // Verbose hint (only in default mode when there are results)
  if (!verbose && scored.length > 0) {
    lines.push('');
    lines.push(zh
      ? '  使用 --verbose 查看完整结果（URL、来源、摘要）'
      : '  Use --verbose to see full results (URLs, sources, summaries)');
  }

  // Coverage footer
  lines.push('');
  lines.push(HR);
  const okParts  = ok.map(s => `${s.name}(${s.resultCount})`);
  const errParts = errored.map(s => `✗${s.name}`);
  if (okParts.length > 0 || errParts.length > 0) {
    lines.push(zh
      ? `已搜索：${[...okParts, ...errParts].join(' ')}`
      : `Searched: ${[...okParts, ...errParts].join(' ')}`);
  }
  if (skipped.length > 0) {
    lines.push(zh
      ? `已跳过：${skipped.map(s => s.name).join(', ')}`
      : `Skipped:  ${skipped.map(s => s.name).join(', ')}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Report ────────────────────────────────────────────────────────────────

/**
 * Format an AI-generated SearchReport as readable terminal text.
 */
export function formatReport(report: SearchReport): string {
  const lines: string[] = [];
  const HR  = '─'.repeat(60);
  const HR2 = '═'.repeat(60);

  lines.push('');
  lines.push(HR2);
  lines.push('Research Report');
  lines.push(HR2);

  // Summary
  lines.push('');
  lines.push('Summary');
  lines.push(HR);
  lines.push(report.summary);

  // Key Findings
  lines.push('');
  lines.push('Key Findings');
  lines.push(HR);
  for (const finding of report.keyFindings) {
    lines.push(`  • ${finding}`);
  }

  // Ranked Results
  lines.push('');
  lines.push(`Top Results  (${report.rankedResults.length})`);
  lines.push(HR);
  for (const r of report.rankedResults) {
    lines.push('');
    lines.push(`  ${r.rank}. ${r.title}`);
    lines.push(`     ${r.url}`);
    lines.push(`     Source: ${r.source}`);
    lines.push(`     Why: ${r.why}`);
  }

  // Key Entities
  if (report.keyEntities.length > 0) {
    lines.push('');
    lines.push('Key Entities');
    lines.push(HR);
    for (const e of report.keyEntities) {
      lines.push(`  ${e.name}: ${e.description}`);
    }
  }

  // Information Gaps
  if (report.informationGaps.length > 0) {
    lines.push('');
    lines.push('Information Gaps');
    lines.push(HR);
    for (const gap of report.informationGaps) {
      lines.push(`  • ${gap}`);
    }
  }

  // Search Quality
  lines.push('');
  lines.push('Search Quality');
  lines.push(HR);
  const q = report.searchQuality;
  lines.push(`  Coverage: ${q.coverage}  ·  ${q.totalResults} results  ·  ${(q.directSourceRatio * 100).toFixed(0)}% primary sources`);
  if (q.recommendation) {
    lines.push(`  Recommendation: ${q.recommendation}`);
  }

  lines.push('');
  return lines.join('\n');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function starRating(score: number): string {
  if (score >= 0.70) return '★★★';
  if (score >= 0.55) return '★★☆';
  return '★☆☆';
}

function isChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function relativeTime(timestamp: string, zh = false): string | null {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (isNaN(ageMs)) return null;
  const ageDays = ageMs / 86_400_000;
  if (zh) {
    if (ageDays < 1)   return '今天';
    if (ageDays < 7)   return `${Math.floor(ageDays)}天前`;
    if (ageDays < 30)  return `${Math.floor(ageDays / 7)}周前`;
    if (ageDays < 365) return `${Math.floor(ageDays / 30)}个月前`;
    return `${Math.floor(ageDays / 365)}年前`;
  }
  if (ageDays < 1)  return 'today';
  if (ageDays < 7)  return `${Math.floor(ageDays)}d ago`;
  if (ageDays < 30) return `${Math.floor(ageDays / 7)}w ago`;
  if (ageDays < 365) return `${Math.floor(ageDays / 30)}mo ago`;
  return `${Math.floor(ageDays / 365)}y ago`;
}

/** Strip markdown formatting for plain-text terminal display. */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')          // headings: ## Title → Title
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1') // bold/italic: **text** → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links: [text](url) → text
    .replace(/^[-*+]\s+/gm, '· ')          // list bullets
    .replace(/^>\s+/gm, '')                // blockquotes
    .replace(/`([^`]+)`/g, '$1')           // inline code
    .replace(/\n{2,}/g, ' ')              // collapse multi-newlines to space
    .replace(/\n/g, ' ')                  // single newlines to space
    .replace(/\s+/g, ' ')                 // collapse whitespace
    .trim();
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

// ─── Lead clustering ─────────────────────────────────────────────────────────

interface LeadCluster {
  /** Representative title (from the highest-scored lead in the cluster). */
  label: string;
  /** All leads in this cluster. */
  items: SearchResult[];
  /** Source breakdown. */
  sources: string[];
  /** Whether any item is new. */
  hasNew: boolean;
}

/**
 * Cluster leads by title similarity using bigram Jaccard index.
 * Greedy single-pass clustering: for each lead, attach to the first cluster
 * whose representative title has Jaccard similarity >= threshold.
 */
function clusterLeads(leads: SearchResult[], minSharedTokens = 2): LeadCluster[] {
  const clusters: LeadCluster[] = [];

  for (const lead of leads) {
    const titleTokens = extractKeyTokens(lead.title);
    let matched = false;

    for (const cluster of clusters) {
      // Match if ANY item in the cluster shares enough key tokens
      const isMatch = cluster.items.some(item => {
        const otherTokens = extractKeyTokens(item.title);
        let shared = 0;
        for (const t of titleTokens) {
          if (otherTokens.has(t)) shared++;
        }
        return shared >= minSharedTokens;
      });
      if (isMatch) {
        cluster.items.push(lead);
        if (lead.isNew) cluster.hasNew = true;
        matched = true;
        break;
      }
    }

    if (!matched) {
      clusters.push({
        label: lead.title,
        items: [lead],
        sources: [],
        hasNew: lead.isNew === true,
      });
    }
  }

  // Fill source breakdown
  for (const c of clusters) {
    const srcSet = new Set(c.items.map(i => i.source));
    c.sources = [...srcSet];
  }

  // Sort: largest clusters first
  clusters.sort((a, b) => b.items.length - a.items.length);
  return clusters;
}

/**
 * Extract key tokens from a title for clustering.
 *
 * Strategy: extract meaningful "words" rather than character bigrams.
 * - English words (2+ chars): "OPC", "AI", "2024"
 * - CJK 2-char words: "深圳", "政策", "补贴", "创业"
 *
 * The set is intentionally small (typically 5-15 tokens) so Jaccard is meaningful.
 */
function extractKeyTokens(text: string): Set<string> {
  const tokens = new Set<string>();

  // Split by non-word boundaries: extract runs of CJK or ASCII-word chars
  const segments = text.match(/[\u4e00-\u9fff]+|[a-zA-Z0-9]+/g) || [];

  for (const seg of segments) {
    if (/^[a-zA-Z0-9]+$/.test(seg)) {
      // English/number word — add as-is (lowered) if 2+ chars
      if (seg.length >= 2) tokens.add(seg.toLowerCase());
    } else {
      // CJK segment — extract non-overlapping 2-char chunks
      for (let i = 0; i + 1 < seg.length; i += 2) {
        tokens.add(seg.slice(i, i + 2));
      }
      // Also add the last 2 chars if odd length (ensures last char is represented)
      if (seg.length % 2 === 1 && seg.length >= 2) {
        tokens.add(seg.slice(-2));
      }
    }
  }

  return tokens;
}

// ─── Dimension-based result grouping ──────────────────────────────────────

interface ResultGroup {
  label: string;
  results: SearchResult[];
}

/**
 * Group results by primary dimension values (e.g., geographic districts).
 * Matches result title + summary against each dimension value.
 * Unmatched results go into a "通用/General" group.
 */
function groupByDimension(
  results: SearchResult[],
  dim: SearchDimension,
  zh: boolean,
): ResultGroup[] {
  const groups = new Map<string, SearchResult[]>();
  const unmatched: SearchResult[] = [];

  // For each dimension value, find matching results
  for (const r of results) {
    const text = `${r.title} ${r.summary ?? ''} ${r.url}`.toLowerCase();
    let matched = false;

    for (const val of dim.values) {
      // Extract the key part of the dimension value (e.g., "南山区" from "南山区 AI创业补贴")
      const keywords = val.split(/\s+/).filter(w => w.length >= 2);
      const firstKeyword = keywords[0]?.toLowerCase() ?? '';

      if (firstKeyword && text.includes(firstKeyword)) {
        const existing = groups.get(firstKeyword) ?? [];
        existing.push(r);
        groups.set(firstKeyword, existing);
        matched = true;
        break;
      }
    }

    if (!matched) {
      unmatched.push(r);
    }
  }

  // Build output: general first, then each dimension group
  const output: ResultGroup[] = [];

  if (unmatched.length > 0) {
    output.push({
      label: zh ? `${dim.label} · 通用/市级` : `${dim.label} · General`,
      results: unmatched,
    });
  }

  for (const [keyword, items] of groups) {
    output.push({
      label: `${dim.label} · ${keyword}`,
      results: items.sort((a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0)),
    });
  }

  return output;
}

/** Jaccard similarity between two sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
