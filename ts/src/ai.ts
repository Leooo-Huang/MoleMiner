/**
 * Three AI functions for the recursive search loop.
 *
 * 1. aiClassify       — classify search results as direct / lead
 * 2. aiExtractEntities — extract named entities from lead results
 * 3. aiGenerateQueries — generate platform-optimized search queries
 */

import type { SearchResult, SearchResponse, SearchReport, ExtractedEntity, GeoLocation } from './models.js';
import type { LLMClient } from './llm.js';

// Re-export for backward compat — pipeline and tests import ExtractedEntity from here
export type { ExtractedEntity } from './models.js';

/** Default fast model for classification/extraction. Overridden by config.llmFastModel. */
const DEFAULT_FAST_MODEL = 'gpt-4o-mini';

/** Module-level fast model — set via setFastModel() from pipeline before use. */
let fastModel: string = DEFAULT_FAST_MODEL;

/** Set the fast model from config. Called by pipeline on init. */
export function setFastModel(model: string | undefined): void {
  fastModel = model || DEFAULT_FAST_MODEL;
}

// --- JSON schemas for constrained output ---

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          type: { type: 'string', enum: ['direct', 'lead', 'irrelevant'] },
        },
        required: ['index', 'type'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

const ENTITIES_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['name', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['entities'],
  additionalProperties: false,
} as const;

const QUERIES_SCHEMA = {
  type: 'object',
  properties: {
    anchor: { type: 'string', enum: ['zh', 'en', 'none'] },
    language: { type: 'string', enum: ['zh', 'en', 'mixed'] },
    scope: { type: 'string', enum: ['local', 'national', 'global'] },
    base_keywords: { type: 'string' },
    translated_base: { type: 'string' },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          priority: { type: 'string', enum: ['primary', 'secondary'] },
          values: { type: 'array', items: { type: 'string' } },
        },
        required: ['label', 'priority', 'values'],
        additionalProperties: false,
      },
    },
    platforms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string' },
          skip: { type: 'boolean' },
          skip_reason: { type: 'string' },
        },
        required: ['platform', 'skip', 'skip_reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['anchor', 'language', 'scope', 'base_keywords', 'translated_base', 'dimensions', 'platforms'],
  additionalProperties: false,
} as const;

// --- Prompts ---

const CLASSIFY_SYSTEM = `You are a search result classifier that evaluates both RELEVANCE and SOURCE TYPE.

You will receive the user's ORIGINAL QUERY and a list of search results.

For each result, first judge relevance to the original query, then classify:
- "direct": Relevant AND a primary source (original publisher's own content — policy text, official site, product page, registration portal, event page). Not limited to government sites.
- "lead": Relevant AND a secondary source (news report, blog analysis, community discussion, third-party summary)
- "irrelevant": NOT relevant to the original query intent — even if it shares some keywords

RULES:
1. Sharing a keyword does NOT mean relevant. Query "深圳AI创业补贴", result "深圳天气" → irrelevant. Query "AI hackathon 2026", result "Electric Cars Are Catching Fire" → irrelevant.
2. When uncertain, prefer "irrelevant". False leads cause topic drift in subsequent search rounds.
3. "direct" means the ORIGINAL PUBLISHER published this content. A news article ABOUT a policy is "lead", the policy document itself is "direct".
4. SPECIFICITY TEST — a result must contain SPECIFIC, CONCRETE information about the query topic to be "direct" or "lead". Vague mentions, name-drops, or macro statistics are "irrelevant":
   - Policy/subsidy queries: must have specific amounts, eligibility, deadlines, or application steps
   - Event/hackathon queries: must have specific dates, venues, registration info, or organizer details
   - Product/tech queries: must have specific versions, benchmarks, features, or how-to steps
   - General rule: if the snippet only mentions the topic BY NAME without any concrete detail → "irrelevant"
   Examples of "irrelevant": "AI企业数量超3000家", "将大力发展AI产业", "举办XX活动", "Cambodia cuts EV import tax" (for an AI hackathon query)

Return JSON with a "results" array. Each item: {index (0-based), type}.`;

const CLASSIFY_USER = (query: string, resultsText: string) =>
  `ORIGINAL QUERY: ${query}\n\nClassify these search results:\n\n${resultsText}`;

const ENTITIES_SYSTEM = `You are a STRICT entity extractor for a recursive search system. Your extractions generate the NEXT search round, so BAD ENTITIES = WASTED SEARCHES + TOPIC DRIFT.

You receive the user's ORIGINAL QUERY and search results classified as "leads".

GOAL: Extract ONLY entities that will lead to PRIMARY/AUTHORITATIVE sources about the user's exact topic.

STRICT LITMUS TEST (apply to EVERY candidate):
  "If I search ONLY this entity name, would 80%+ of the first page results be directly about the user's original query topic?"
  - "前海AI扶持计划" for query "深圳AI创业补贴" → YES (most results = that specific subsidy program)
  - "高盛" for query "深圳AI创业补贴" → NO (most results = Goldman Sachs finance news, not subsidies)
  - "百度" for query "深圳AI创业补贴" → NO (most results = Baidu company news, not subsidies)
  - "深圳市工业和信息化局" for query "深圳AI创业补贴" → BORDERLINE (many results, but some about AI subsidies) → extract only if multiple leads mention it in subsidy context

EXTRACT (high-value entities):
- Specific policy/program document names with document numbers (e.g., "深工信规〔2025〕3号")
- Specific subsidy/grant program names (e.g., "前海深港合作区AI扶持计划")
- Specific government departments that ADMINISTER the relevant programs (not just mentioned)

DO NOT EXTRACT (guaranteed topic drift):
- Generic place names: "深圳", "北京", "龙岗区" — too broad
- Generic company/org names: "百度", "腾讯", "高盛", "红杉资本" — unless query is about them specifically
- Generic tech terms: "AI", "DeepSeek", "machine learning"
- Media/platform names: "36氪", "知乎", "微信公众号"
- Venues/locations: "深圳大剧院", "图书馆"
- People names: "陈厂长" — unless the query is about that person
- Training camps/courses: "创业营", "加速计划" — too generic
- Exhibitions/conferences: "人工智能展", "AGIC大会" — unless query is about events

QUANTITY LIMIT: Return AT MOST 5 entities per batch. Fewer is better. Zero is fine.
CONFIDENCE: Below 0.7 = do not include. Be stingy, not generous.

Return JSON: {"entities": [{name, confidence (0.7-1.0), reason}]}.
Return {"entities": []} if nothing passes the litmus test.`;

const ENTITIES_USER = (query: string, resultsText: string) =>
  `ORIGINAL QUERY: ${query}\n\nExtract entities from these lead results:\n\n${resultsText}`;

/** Returns the current date ISO string, for prompt injection. */
function currentDateLine(): string {
  return `CURRENT_DATE: ${new Date().toISOString().slice(0, 10)}`;
}

const QUERIES_SYSTEM_PART_0 = `PART 0 — ANCHOR + SCOPE DECISION:

## 0a. Anchor (output as \`anchor\`):
Identify the geographic/linguistic anchor of the query. This decides which language sources to search.

- 'zh': query is intrinsically about Chinese-context content only
    Examples: "中国 agent 黑客松", "深圳AI补贴", "上海创业园", "北京 hackathon", "微信小程序生态"
    Triggers: contains Chinese place names, Chinese organizations, Chinese policies, or culture-specific topics
    → English sources will be skipped (no relevant content)

- 'en': query is intrinsically about English/Western-context content only
    Examples: "Silicon Valley hackathon", "UK AI grants", "Y Combinator startup", "NYC tech scene"
    Triggers: contains Western place names, Western organizations, or region-locked content
    → Chinese sources will be skipped (no relevant content)

- 'none': query is about a global/universal topic, no geographic anchor
    Examples: "AI hackathon 2026", "React vs Vue", "LLM paper", "transformer attention", "rust async runtime"
    Triggers: technical concepts, global topics, cross-language communities discuss it
    → BOTH Chinese and English sources are searched, each in their own language

When in doubt, default to 'none' (more coverage is safer than less).

## 0b. Scope (output as \`scope\`):
Infer the GEOGRAPHIC SCOPE of the query. This controls search granularity — how many results per query, how deep to dig.

- 'local': query targets a specific city or district — needs deep, precise results from a small area
    Examples: "深圳AI补贴", "NYC startup grants", "朝阳区创业园", "San Francisco AI meetup"
    Strategy: few queries, many results per query, thorough content extraction

- 'national': query targets a country or large region — balanced depth and breadth
    Examples: "中国AI政策", "US AI regulation", "日本创业补贴", "UK energy hackathon"
    Strategy: moderate queries, moderate results per query

- 'global': query has no geographic anchor or targets worldwide — needs broad coverage, less depth per location
    Examples: "AI hackathon 2026", "global startup ecosystem", "best LLM frameworks", "AI conferences worldwide"
    Strategy: many queries spread across regions, few results per query to ensure even geographic distribution

NOTE: scope is independent of anchor. A query can have anchor='zh' + scope='local' ("深圳AI补贴") or anchor='none' + scope='global' ("AI hackathon 2026").`;

const QUERIES_SYSTEM_PART_1 = `PART 1 — CROSS-LANGUAGE TRANSLATION:
Output base_keywords in the ORIGINAL query language.
Output translated_base based on anchor:
- If anchor='zh': set translated_base = "" (no translation needed, we won't search English sources)
- If anchor='en': set translated_base = "" (no translation needed, we won't search Chinese sources)
- If anchor='none': translated_base MUST be a high-quality translation in the OTHER language
    Examples:
      "AI hackathon 2026" → translated_base: "AI 黑客松 2026"
      "React vs Vue" → translated_base: "React 对比 Vue 性能"
      "中国开源贡献" (anchor=none, query language=zh) → translated_base: "China open source contribution"`;

const QUERIES_SYSTEM_PART_3 = `PART 3 — PLATFORM SELECTION:
For each platform, decide skip or not. The code layer will further decide query distribution based on anchor.

PLATFORMS:
- brave: General web search, all languages. Never skip.
- hackernews: English tech community. Skip for non-tech queries.
- reddit: English communities. Skip for niche local queries.
- github: Code repos, English. Skip for non-technical.
- stackoverflow: English tech Q&A. Skip for non-programming.
- devto: English dev blogs. Skip for non-tech.
- youtube: Video, multilingual. Rarely skip.
- x: Twitter/X, multilingual. Real-time, rarely skip.
- zhihu: Chinese Q&A. Skip only if anchor='en' or content is obviously not discussed on zhihu.
- weibo: Chinese microblog. Same as zhihu.
- xiaohongshu: Chinese lifestyle/reviews. Same as zhihu.
- wechat: Chinese articles. Same as zhihu.

NOTE: You only decide skip/not-skip based on topic relevance. Language-based filtering is handled by the code layer using \`anchor\`. For example, if anchor='zh', the code will automatically skip English sources regardless of your decision. For anchor='none', do NOT skip any platform based on language — the code will distribute translated queries.

CRITICAL: Your "platforms" array MUST contain EXACTLY one entry for EVERY platform listed above (12 platforms total). Missing any platform is an error.`;

const QUERIES_SYSTEM_BASE = `You are a search query optimizer. Your job has FOUR parts:

${QUERIES_SYSTEM_PART_0}

${QUERIES_SYSTEM_PART_1}`;

const QUERIES_SYSTEM_NORMAL_TEMPLATE = `${QUERIES_SYSTEM_BASE}

PART 2 — TIME-SENSITIVITY (normal mode, no dimension expansion):

{{CURRENT_DATE}}

Decide if the query is time-sensitive (events, hackathons, releases, news, rankings, "best X", policies, products, competitions).

- If YES: append the current year and a recency token to base_keywords.
    Examples:
      "AI hackathon" → base_keywords: "AI hackathon 2026 latest"
      "中国 agent 黑客松" → base_keywords: "中国 agent 黑客松 2026 最新"
      "best laptops" → base_keywords: "best laptops 2026"
      "Python frameworks" → base_keywords: "Python frameworks 2026"
    Apply the same rule to translated_base.

- If NO (evergreen knowledge: definitions, theory, historical facts):
    Keep base_keywords unchanged.
    Examples:
      "how does JavaScript closure work" → unchanged
      "快速排序原理" → unchanged
      "transformer self-attention explained" → unchanged

- For normal search mode: output EMPTY dimensions array. Only base_keywords and translated_base matter.

${QUERIES_SYSTEM_PART_3}`;

const QUERIES_SYSTEM_DEEP_TEMPLATE = `${QUERIES_SYSTEM_BASE}

PART 2 — DIMENSION EXPANSION (deep mode, MECE 6-dimension framework):

{{CURRENT_DATE}}

Use the MECE 6-dimension orthogonal framework. These 6 dimensions are mutually exclusive and collectively exhaustive:

1. WHAT   — sub-topic / facet / aspect of the entity
            Example: query "AI agent" → WHAT: ["multi-agent", "tool use", "memory", "planning"]
2. WHERE  — geographic / platform / community scope
            Example: query "AI hackathon" → WHERE: ["China AI hackathon", "US AI hackathon", "Europe AI hackathon", "Asia AI hackathon"]
3. WHEN   — time window
            Example: query "LLM paper" → WHEN: ["LLM paper 2026", "LLM paper 2025", "LLM paper latest"]
4. WHO    — actor / vendor / community / organizer type
            Example: query "RAG framework" → WHO: ["LangChain RAG", "LlamaIndex RAG", "open source RAG"]
5. HOW    — methodology / approach / presentation format
            Example: query "deploy AI" → HOW: ["deploy AI tutorial", "deploy AI comparison", "deploy AI best practices"]
6. SOURCE — evidence type
            Example: query "transformer" → SOURCE: ["transformer paper", "transformer official docs", "transformer benchmark"]

DECISION RULES (very important):
- Pick AT MOST 2 dimensions most relevant to the query intent.
- Each chosen dimension lists 3-6 concrete values. Values are COMPLETE search queries (primary priority) — they will be sent as-is to the search engine.
- Total query count across all dimension values: 6-20.
- Each value belongs to ONE dimension (don't mix WHAT with WHERE in one string).
- ALWAYS output at least 1 dimension. NEVER return empty dimensions in deep mode.
- If no obvious WHAT/WHERE/WHO/HOW/SOURCE applies, DEFAULT to WHEN with [base + current year, base + last year, base + "最新"/"latest"].

SCOPE-AWARE GRANULARITY RULES (use the scope you determined in PART 0):
- scope=local:  WHERE expands to districts/neighborhoods (5-8 values), other dims max 3 values
- scope=national: WHERE expands to major cities/regions (4-6 values), other dims max 5 values
- scope=global: WHERE expands to macro-regions (4-5 values like "North America", "Europe", "China", "East Asia", "India"), other dims max 4 values
- WHEN time-sensitive: use [current year, last year, "latest"/"最新"] — 3 values minimum
- Keep all dimension values orthogonal (non-overlapping)

OUTPUT STRUCTURE for dimensions:
Each dimension entry: { label: "WHAT"|"WHERE"|"WHEN"|"WHO"|"HOW"|"SOURCE", priority: "primary", values: [complete query strings] }
Always use priority="primary" for deep mode (values are complete queries, not fragments).

${QUERIES_SYSTEM_PART_3}`;

/** Build the NORMAL mode system prompt, injecting current date. */
function buildQueriesSystemNormal(): string {
  return QUERIES_SYSTEM_NORMAL_TEMPLATE.replace('{{CURRENT_DATE}}', currentDateLine());
}

/** Build the DEEP mode system prompt, injecting current date. */
function buildQueriesSystemDeep(): string {
  return QUERIES_SYSTEM_DEEP_TEMPLATE.replace('{{CURRENT_DATE}}', currentDateLine());
}

const QUERIES_FROM_INTENT = (intent: string, platforms: string) =>
  `User intent: ${intent}\n\nPlatforms to evaluate: ${platforms}\n\nFor each platform, decide skip or generate queries.`;

const ENTITY_QUERIES_SYSTEM = `You generate search queries to find PRIMARY SOURCES for named entities.

You receive:
- ORIGINAL INTENT: the user's original search goal
- Entities: named entities extracted from search leads (with confidence scores)
- Platforms: search platforms to consider

For each platform, output:
- skip: true if this platform is irrelevant for these entities
- skip_reason: why (empty string if not skipped)
- queries: 1-3 search queries combining entity name with intent-relevant keywords

RULES:
- DO NOT search bare entity names alone — always include intent context keywords.
- For Chinese platforms (zhihu, weibo, xiaohongshu, wechat): generate Chinese queries.
- For English platforms: generate English queries.

Examples:
  intent "深圳AI创业补贴", entity "前海AI扶持计划" → queries: ["前海AI扶持计划 申请条件", "前海AI扶持计划 补贴金额 2025"]
  intent "AI hackathon 2026", entity "MLH Fellowship" → queries: ["MLH Fellowship AI hackathon 2026", "MLH hackathon schedule registration"]

Return JSON: {"language": "zh|en|mixed", "platforms": [{platform, skip, skip_reason, queries}]}`;

const QUERIES_FROM_ENTITIES = (intent: string, entities: string, platforms: string) =>
  `ORIGINAL INTENT: ${intent}\n\nEntities to investigate: ${entities}\n\nPlatforms: ${platforms}`;

// --- Helpers ---

function formatResultsForPrompt(results: SearchResult[]): string {
  const lines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`[${i}] ${r.title}`);
    lines.push(`    URL: ${r.url}`);
    lines.push(`    Source: ${r.source}`);
    if (r.snippet) {
      lines.push(`    Snippet: ${r.snippet.slice(0, 100)}`);
    }
    if (r.timestamp) {
      lines.push(`    Time: ${r.timestamp}`);
    }
    // Include raw engagement metadata — let LLM interpret platform-specific signals
    if (r.metadata && Object.keys(r.metadata).length > 0) {
      const parts = Object.entries(r.metadata)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${v}`);
      if (parts.length > 0) {
        lines.push(`    Engagement: ${parts.join(', ')}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// --- AI Functions ---

/**
 * Classify search results as direct or lead using LLM.
 * Returns the same results with resultType and summary updated.
 */
export async function aiClassify(
  query: string,
  results: SearchResult[],
  llm: LLMClient,
): Promise<SearchResult[]> {
  if (results.length === 0) return [];

  // Process in batches of 30 to avoid exceeding LLM context/token limits
  const BATCH_SIZE = 30;
  if (results.length > BATCH_SIZE) {
    const classified: SearchResult[] = [];
    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);
      const batchResult = await aiClassify(query, batch, llm);
      classified.push(...batchResult);
    }
    return classified;
  }

  const resultsText = formatResultsForPrompt(results);
  const prompt = CLASSIFY_USER(query, resultsText);

  const response = await llm.extractJson<{ results: Array<{ index: number; type: 'direct' | 'lead' | 'irrelevant' }> }>(
    prompt,
    { system: CLASSIFY_SYSTEM, schema: CLASSIFY_SCHEMA, model: fastModel },
  );

  if (!response || !('results' in response)) {
    return results;
  }

  // Apply classifications — create new objects (don't mutate originals)
  const classified = [...results];
  for (const item of response.results) {
    const idx = item.index ?? -1;
    if (idx >= 0 && idx < classified.length) {
      classified[idx] = {
        ...classified[idx],
        resultType: item.type ?? 'lead',
        // Store classify summary separately — don't overwrite the `summary` field
        // which is reserved for extracted page content
      };
    }
  }

  return classified;
}

/**
 * Extract named entities from lead results using LLM.
 * Returns deduplicated entities with confidence scores (0-1).
 */
export async function aiExtractEntities(
  query: string,
  leads: SearchResult[],
  llm: LLMClient,
): Promise<ExtractedEntity[]> {
  if (leads.length === 0) return [];

  const BATCH_SIZE = 30;
  const byKey = new Map<string, ExtractedEntity>();

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const resultsText = formatResultsForPrompt(batch);
    const prompt = ENTITIES_USER(query, resultsText);

    const response = await llm.extractJson<{
      entities: Array<{ name: string; confidence: number; reason: string }>;
    }>(prompt, { system: ENTITIES_SYSTEM, schema: ENTITIES_SCHEMA, model: fastModel });

    if (!response || !('entities' in response)) continue;

    // Deduplicate (case-insensitive), keep highest confidence
    // Hard filter: only accept entities with confidence >= 0.7
    for (const e of response.entities) {
      const key = (e.name ?? '').toLowerCase().trim();
      if (!key) continue;
      const conf = Math.max(0, Math.min(1, e.confidence ?? 0));
      if (conf < 0.7) continue; // Hard cutoff — prompt says 0.7 but LLM may ignore
      const existing = byKey.get(key);
      if (!existing || conf > existing.confidence) {
        byKey.set(key, {
          name: e.name.trim(),
          confidence: conf,
          reason: e.reason ?? '',
        });
      }
    }
  }

  const all = Array.from(byKey.values());
  all.sort((a, b) => b.confidence - a.confidence);
  return all.slice(0, 10);
}

/** Dimension from AI query analysis. */
export interface SearchDimension {
  label: string;
  priority: 'primary' | 'secondary';
  values: string[];
}

/** Result from aiGenerateQueries — queries per platform + which to skip. */
export interface QueryPlan {
  queries: Record<string, string[]>;
  skipped: string[];
  language: string;
  /** Dimensions used for query expansion (for result grouping in output). */
  dimensions?: SearchDimension[];
  /** Geographic scope — controls per-query result caps, content extraction depth, concurrency. */
  scope?: 'local' | 'national' | 'global';
}

// --- Platform language sets for anchor-based dispatch ---
/** Chinese-only platforms (skipped when anchor='en'). */
const CHINESE_PLATFORMS = new Set(['zhihu', 'weibo', 'xiaohongshu', 'wechat']);
/** English-only community platforms (skipped when anchor='zh'). */
const ENGLISH_PLATFORMS = new Set(['hackernews', 'reddit', 'github', 'stackoverflow', 'devto']);
/** Multilingual platforms (always searched regardless of anchor). */
const MULTILINGUAL_PLATFORMS = new Set(['brave', 'youtube', 'x']);

/** Max dimension values (hard cap to prevent query explosion). */
const MAX_DIMENSION_VALUES = 20;
/** Max queries per platform (hard cap). */
const MAX_QUERIES_PER_PLATFORM = 30;

/**
 * Generate platform-optimized search queries using LLM.
 *
 * Round 0: pass intent (user's original query). Uses anchor decision + MECE dimensions.
 * Round 1+: pass entities (extracted from leads). Uses ENTITY_QUERIES_SYSTEM.
 *
 * @param deep - when true, enables MECE 6-dimension expansion for broader coverage.
 */
export async function aiGenerateQueries(
  opts: { intent?: string; entities?: ExtractedEntity[]; sourceNames: string[]; deep?: boolean },
  llm: LLMClient,
): Promise<QueryPlan> {
  const platforms = opts.sourceNames.join(', ');

  // Round 1+: entity-based search uses the old direct query style (no dimension expansion)
  if (opts.entities && opts.entities.length > 0) {
    return generateEntityQueries(opts, llm, platforms);
  }

  if (!opts.intent) {
    return { queries: {}, skipped: [], language: 'en' };
  }

  const prompt = QUERIES_FROM_INTENT(opts.intent, platforms);
  const systemPrompt = opts.deep ? buildQueriesSystemDeep() : buildQueriesSystemNormal();

  interface DimensionEntry { label: string; priority: 'primary' | 'secondary'; values: string[] }
  interface PlatformEntry { platform: string; skip: boolean; skip_reason: string }

  const response = await llm.extractJson<{
    anchor: 'zh' | 'en' | 'none';
    language: string;
    scope: 'local' | 'national' | 'global';
    base_keywords: string;
    translated_base: string;
    dimensions: DimensionEntry[];
    platforms: PlatformEntry[];
  }>(prompt, { system: systemPrompt, schema: QUERIES_SCHEMA });

  if (!response || !response.platforms) {
    // Fallback: use raw query for all sources
    const fallback: Record<string, string[]> = {};
    for (const name of opts.sourceNames) fallback[name] = [opts.intent];
    return { queries: fallback, skipped: [], language: 'en' };
  }

  const base = response.base_keywords || opts.intent;
  const translatedBase = response.translated_base || '';
  const anchor: 'zh' | 'en' | 'none' = response.anchor ?? 'none';  // default to most permissive
  const scope: 'local' | 'national' | 'global' = response.scope ?? 'national'; // default to current behavior
  const lang = response.language ?? 'en';
  let dims = response.dimensions ?? [];

  // --- Deep mode fallback: if LLM returned empty dimensions, inject WHEN ---
  if (opts.deep && dims.length === 0) {
    const year = new Date().getFullYear();
    const recencyZh = lang === 'zh' ? '最新' : 'latest';
    const fallbackValues = [
      `${base} ${year}`,
      `${base} ${year - 1}`,
      `${base} ${recencyZh}`,
    ];
    if (translatedBase) {
      fallbackValues.push(`${translatedBase} ${year} latest`);
    }
    dims = [{ label: 'WHEN', priority: 'primary', values: fallbackValues }];
  }

  // --- Scope-aware hard cap on dimension values ---
  const scopeMaxWhere = { local: 8, national: 6, global: 5 } as const;
  const scopeMaxOther = { local: 3, national: 5, global: 4 } as const;
  for (const dim of dims) {
    const maxVals = dim.label === 'WHERE'
      ? scopeMaxWhere[scope]
      : scopeMaxOther[scope];
    const cap = Math.min(maxVals, MAX_DIMENSION_VALUES);
    if (dim.values.length > cap) {
      dim.values = dim.values.slice(0, cap);
    }
  }

  // --- Build the expanded query list from base + dimensions ---
  const allQueries: string[] = [base];
  for (const dim of dims) {
    if (dim.priority === 'primary') {
      // Primary values are complete queries — add directly
      allQueries.push(...dim.values);
    } else {
      // Secondary values are keywords appended to base
      for (const v of dim.values) {
        allQueries.push(`${base} ${v}`);
      }
    }
  }
  const uniqueQueries = [...new Set(allQueries)].slice(0, MAX_QUERIES_PER_PLATFORM);

  // Same for translated_base if available
  const translatedQueries: string[] = translatedBase ? [translatedBase] : [];
  if (translatedBase && opts.deep) {
    for (const dim of dims) {
      // Only extend translated queries with primary dimensions
      // to avoid mixing translated/original base in secondary fragments
      if (dim.priority === 'primary' && dim.label === 'WHEN') {
        // For WHEN, add translated + year
        const year = new Date().getFullYear();
        translatedQueries.push(`${translatedBase} ${year}`, `${translatedBase} latest`);
      }
    }
  }
  const uniqueTranslated = [...new Set(translatedQueries)].slice(0, MAX_QUERIES_PER_PLATFORM);

  // --- Build LLM platform skip decisions ---
  const platformDecisions = new Map<string, boolean>();
  for (const item of response.platforms) {
    const name = item.platform ?? '';
    if (name) platformDecisions.set(name, item.skip);
  }

  // --- Anchor-driven dispatch ---
  const queries: Record<string, string[]> = {};
  const skipped: string[] = [];

  for (const name of opts.sourceNames) {
    // Rule 1: LLM explicitly wants to skip → honor it
    if (platformDecisions.get(name) === true) {
      skipped.push(name);
      continue;
    }

    // Rule 2: Anchor-based language filtering (dominant)
    if (anchor === 'zh' && ENGLISH_PLATFORMS.has(name)) {
      skipped.push(name);
      continue;
    }
    if (anchor === 'en' && CHINESE_PLATFORMS.has(name)) {
      skipped.push(name);
      continue;
    }

    // Rule 3: Determine which query set this platform gets
    // - Chinese platforms always get Chinese query (base if lang=zh, else translated_base)
    // - English platforms always get English query (base if lang=en, else translated_base)
    // - brave: gets the most expansion + bilingual if anchor=none
    // - youtube/x: multilingual, get base (+ translated if anchor=none)

    if (name === 'brave') {
      // brave gets the full dimension-expanded query set
      const braveQueries = [...uniqueQueries];
      if (anchor === 'none' && translatedBase) {
        // Also add translated queries for bilingual coverage
        braveQueries.push(...uniqueTranslated);
      }
      queries[name] = [...new Set(braveQueries)].slice(0, MAX_QUERIES_PER_PLATFORM);
      continue;
    }

    if (CHINESE_PLATFORMS.has(name)) {
      // Chinese source needs Chinese query
      const chineseQuery = lang === 'zh' ? base : (translatedBase || base);
      queries[name] = [chineseQuery];
      continue;
    }

    if (ENGLISH_PLATFORMS.has(name)) {
      // English source needs English query
      const englishQuery = lang === 'en' ? base : (translatedBase || base);
      queries[name] = [englishQuery];
      continue;
    }

    if (MULTILINGUAL_PLATFORMS.has(name)) {
      // youtube, x → use base; in anchor=none also add translated for coverage
      const multiQueries = [base];
      if (anchor === 'none' && translatedBase) {
        multiQueries.push(translatedBase);
      }
      queries[name] = multiQueries;
      continue;
    }

    // Unknown platform → default to base
    queries[name] = [base];
  }

  const dimensions: SearchDimension[] = dims.map(d => ({
    label: d.label, priority: d.priority, values: d.values,
  }));

  return { queries, skipped, language: lang, dimensions, scope };
}

/**
 * Round 1+ entity-based query generation — no dimension expansion.
 * Combines entity names with intent keywords for targeted search.
 */
async function generateEntityQueries(
  opts: { intent?: string; entities?: ExtractedEntity[]; sourceNames: string[] },
  llm: LLMClient,
  platforms: string,
): Promise<QueryPlan> {
  const entityDesc = (opts.entities ?? [])
    .map(e => `${e.name} (confidence: ${e.confidence.toFixed(1)})`)
    .join(', ');
  const prompt = QUERIES_FROM_ENTITIES(opts.intent ?? '', entityDesc, platforms);

  // For entity queries, use the old schema (AI directly generates queries)
  const oldSchema = {
    type: 'object' as const,
    properties: {
      language: { type: 'string' as const, enum: ['zh', 'en', 'mixed'] as const },
      platforms: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            platform: { type: 'string' as const },
            skip: { type: 'boolean' as const },
            skip_reason: { type: 'string' as const },
            queries: { type: 'array' as const, items: { type: 'string' as const } },
          },
          required: ['platform', 'skip', 'skip_reason', 'queries'] as const,
          additionalProperties: false as const,
        },
      },
    },
    required: ['language', 'platforms'] as const,
    additionalProperties: false as const,
  };

  const response = await llm.extractJson<{
    language: string;
    platforms: Array<{ platform: string; skip: boolean; skip_reason: string; queries: string[] }>;
  }>(prompt, { system: ENTITY_QUERIES_SYSTEM, schema: oldSchema });

  if (!response || !('platforms' in response)) {
    const raw = opts.intent ?? '';
    const fallback: Record<string, string[]> = {};
    for (const name of opts.sourceNames) fallback[name] = [raw];
    return { queries: fallback, skipped: [], language: 'en' };
  }

  const queries: Record<string, string[]> = {};
  const skipped: string[] = [];
  for (const item of response.platforms) {
    if (!item.platform) continue;
    if (item.skip) { skipped.push(item.platform); }
    else if (item.queries?.length > 0) { queries[item.platform] = item.queries; }
  }
  return { queries, skipped, language: response.language ?? 'en' };
}

// ─── 4. AI Report Generation ──────────────────────────────────────────────

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    summary:      { type: 'string' },
    keyFindings:  { type: 'array', items: { type: 'string' } },
    rankedResults: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank:   { type: 'integer' },
          title:  { type: 'string' },
          url:    { type: 'string' },
          source: { type: 'string' },
          why:    { type: 'string' },
        },
        required: ['rank', 'title', 'url', 'source', 'why'],
        additionalProperties: false,
      },
    },
    keyEntities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name:        { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'description'],
        additionalProperties: false,
      },
    },
    informationGaps: { type: 'array', items: { type: 'string' } },
    searchQuality: {
      type: 'object',
      properties: {
        coverage:           { type: 'string', enum: ['high', 'medium', 'low'] },
        directSourceRatio:  { type: 'number' },
        totalResults:       { type: 'integer' },
        recommendation:     { type: 'string' },
      },
      required: ['coverage', 'directSourceRatio', 'totalResults'],
      additionalProperties: false,
    },
  },
  required: ['summary', 'keyFindings', 'rankedResults', 'keyEntities', 'informationGaps', 'searchQuality'],
  additionalProperties: false,
} as const;

const REPORT_SYSTEM = `You are a research analyst producing a structured report from web search results.

You will receive a search query and ranked search results with metadata.

Produce a concise, factual report:
- summary: 2-3 sentence executive summary of what was found
- keyFindings: 3-5 specific, actionable findings (use exact names, numbers, dates from results)
- rankedResults: top 15 results by relevance + authority + recency. "why" = one sentence explaining value to the user
- keyEntities: named entities found (programs, orgs, events, policies) with brief descriptions
- informationGaps: what was NOT found that would be useful
- searchQuality: coverage (high=5+ direct sources, medium=1-4, low=0), directSourceRatio, totalResults

RULES:
- Respond in the SAME LANGUAGE as the search query. Chinese query → Chinese report. English query → English report.
- Be specific. "AI subsidy program" is bad. "Shenzhen Qianhai AI Startup Fund (100M RMB)" is good.
- "why" must explain value to the USER, not just describe content.
- If results are mostly irrelevant, say so honestly in searchQuality.recommendation.`;

function formatResultsForReport(results: SearchResult[]): string {
  const lines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const score = r.importanceScore != null ? ` [score:${r.importanceScore.toFixed(2)}]` : '';
    lines.push(`[${i + 1}] ${r.title}${score}`);
    lines.push(`    type:${r.resultType ?? 'unknown'} source:${r.source}`);
    lines.push(`    url:${r.url}`);
    if (r.timestamp) lines.push(`    date:${r.timestamp.slice(0, 10)}`);
    if (r.snippet)   lines.push(`    snippet:${r.snippet.slice(0, 150)}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Generate an AI research report from search results.
 * Uses the fast model. Pass pre-scored results (importanceScore set) for best ranking.
 * Falls back to a minimal report if the LLM call fails.
 */
export async function aiGenerateReport(
  response: SearchResponse,
  llm: LLMClient,
): Promise<SearchReport> {
  // Sort by importance score (descending), take top 50 for the prompt
  const sorted = [...response.results].sort(
    (a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0),
  );
  const top50 = sorted.slice(0, 50);

  const resultsText = formatResultsForReport(top50);
  const prompt = `Search query: "${response.query}"\n\nResults (${top50.length} of ${response.results.length} total):\n\n${resultsText}`;

  const result = await llm.extractJson<SearchReport>(
    prompt,
    { system: REPORT_SYSTEM, schema: REPORT_SCHEMA, model: fastModel },
  );

  if (result && 'summary' in result) {
    return result;
  }

  // Fallback: minimal report without AI
  const directs = response.results.filter(r => r.resultType === 'direct');
  return {
    summary: `Found ${response.results.length} results for "${response.query}" across ${response.sources.filter(s => s.status === 'ok').length} sources in ${response.rounds} round${response.rounds !== 1 ? 's' : ''}.`,
    keyFindings: [
      `${directs.length} primary source${directs.length !== 1 ? 's' : ''} found`,
      `${response.rounds} search round${response.rounds !== 1 ? 's' : ''} completed`,
    ],
    rankedResults: sorted.slice(0, 10).map((r, i) => ({
      rank: i + 1,
      title: r.title,
      url: r.url,
      source: r.source,
      why: r.summary || r.snippet?.slice(0, 120) || 'No description available',
    })),
    keyEntities: (response.entities ?? []).slice(0, 5).map(e => ({
      name: e.name,
      description: e.reason,
    })),
    informationGaps: ['AI report generation failed — check LLM configuration'],
    searchQuality: {
      coverage: directs.length >= 5 ? 'high' : directs.length >= 1 ? 'medium' : 'low',
      directSourceRatio: response.results.length > 0
        ? directs.length / response.results.length
        : 0,
      totalResults: response.results.length,
    },
  };
}

// ─── 5. Structured Policy Extraction ─────────────────────────────────────

export interface PolicyInfo {
  policy_name: string;
  document_number: string;
  amounts: string[];
  conditions: string[];
  deadline: string;
  key_points: string[];
  application_url: string;
}

const POLICY_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    policy_name: { type: 'string' },
    document_number: { type: 'string' },
    amounts: { type: 'array', items: { type: 'string' } },
    conditions: { type: 'array', items: { type: 'string' } },
    deadline: { type: 'string' },
    key_points: { type: 'array', items: { type: 'string' } },
    application_url: { type: 'string' },
  },
  required: ['policy_name', 'document_number', 'amounts', 'conditions', 'deadline', 'key_points', 'application_url'],
  additionalProperties: false,
} as const;

const POLICY_EXTRACT_SYSTEM = `You extract structured policy information from a search result.

Given a search result with title, URL, and page content (summary), extract:
- policy_name: The official name of the policy/subsidy program (concise, 中文)
- document_number: Official document number (e.g. "深工信规〔2024〕13号"). Empty string if none.
- amounts: List of specific subsidy amounts mentioned (e.g. "最高1000万元", "补贴50%"). Empty array if none.
- conditions: List of eligibility conditions (e.g. "注册满一年", "员工超5人"). Empty array if none.
- deadline: Application deadline or validity period. "长期有效" if not mentioned.
- key_points: 2-5 bullet points summarizing the most important content. Be specific with numbers/names.
- application_url: The URL where users can apply. Use the result URL if no specific application portal is mentioned.

RULES:
- Use Chinese for all output.
- Be concise — each field should be short, factual, no filler.
- If the content is a news article ABOUT a policy (not the policy itself), still extract the policy details mentioned.
- If no specific amounts/conditions are found, return empty arrays — do NOT make up information.`;

/**
 * Extract structured policy info from a single search result using LLM.
 * Returns null if extraction fails.
 */
export async function aiExtractPolicyInfo(
  result: { title: string; url: string; summary?: string; snippet?: string },
  llm: LLMClient,
): Promise<PolicyInfo | null> {
  const content = result.summary || result.snippet || '';
  if (content.length < 50) return null;

  const prompt = `Title: ${result.title}\nURL: ${result.url}\n\nContent:\n${content.slice(0, 3000)}`;

  try {
    const info = await llm.extractJson<PolicyInfo>(
      prompt,
      { system: POLICY_EXTRACT_SYSTEM, schema: POLICY_EXTRACT_SCHEMA, model: fastModel },
    );
    return info;
  } catch {
    return null;
  }
}

// --- Location Extraction (post-content-extraction) ---

const LOCATION_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          location: {
            type: ['object', 'null'],
            properties: {
              name: { type: 'string' },
              lat: { type: 'number' },
              lng: { type: 'number' },
              level: { type: 'string', enum: ['country', 'region', 'city', 'district'] },
            },
            required: ['name', 'lat', 'lng', 'level'],
          },
        },
        required: ['index', 'location'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

const LOCATION_SYSTEM = `You are a geographic location extractor. Given search results with their full page content, extract the most specific geographic location mentioned.

RULES:
1. Extract the PRIMARY location the result is about (not every location mentioned).
2. Use well-known coordinates for the location. For cities, use city center coordinates.
3. Choose the most specific level: "district" > "city" > "region" > "country".
4. Return null if no clear geographic location is associated with the result.
5. Examples:
   - "深圳市南山区科技园" → {name: "深圳市南山区", lat: 22.54, lng: 113.95, level: "district"}
   - "San Francisco Bay Area hackathon" → {name: "San Francisco", lat: 37.77, lng: -122.42, level: "city"}
   - "European AI Summit" → {name: "Europe", lat: 50.85, lng: 4.35, level: "region"}
   - "Best practices for React" → null (no geographic relevance)

Return JSON with a "results" array. Each item: {index (0-based), location (object or null)}.`;

/**
 * Extract geographic locations from search results using their full page content.
 * Called after content extraction (enrichWithContent) for maximum accuracy.
 * Modifies results in-place, setting the `location` field.
 */
export async function aiExtractLocations(
  results: SearchResult[],
  llm: LLMClient,
): Promise<void> {
  // Only process results with meaningful content
  const candidates = results
    .map((r, i) => ({ result: r, index: i }))
    .filter(({ result }) => (result.summary?.length ?? 0) >= 100 || (result.snippet?.length ?? 0) >= 50);

  if (candidates.length === 0) return;

  const BATCH_SIZE = 30;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);

    const lines: string[] = [];
    for (let j = 0; j < batch.length; j++) {
      const { result } = batch[j];
      const content = (result.summary || result.snippet || '').slice(0, 300);
      lines.push(`[${j}] ${result.title}`);
      lines.push(`    URL: ${result.url}`);
      lines.push(`    Content: ${content}`);
      lines.push('');
    }

    const prompt = `Extract the primary geographic location for each result:\n\n${lines.join('\n')}`;

    try {
      const response = await llm.extractJson<{
        results: Array<{ index: number; location: GeoLocation | null }>;
      }>(prompt, {
        system: LOCATION_SYSTEM,
        schema: LOCATION_SCHEMA,
        model: fastModel,
      });

      if (response?.results) {
        for (const item of response.results) {
          const idx = item.index ?? -1;
          if (idx >= 0 && idx < batch.length && item.location) {
            batch[idx].result.location = item.location;
          }
        }
      }
    } catch {
      // Location extraction is best-effort — failures don't block the pipeline
    }
  }
}
