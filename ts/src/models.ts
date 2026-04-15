/** Data models for MoleMiner search results. */

/** Geographic location extracted by AI during classification. */
export interface GeoLocation {
  name: string;
  lat: number;
  lng: number;
  level: 'country' | 'region' | 'city' | 'district';
}

export interface SearchResult {
  title: string;
  url: string;
  source: string;
  snippet: string;
  resultType?: 'direct' | 'lead' | 'irrelevant';
  language?: string;
  timestamp?: string;
  mentions?: string[];
  metadata?: Record<string, unknown>;
  summary?: string;
  /** Computed importance score 0-1 for ranking. Set by computeImportanceScores(). */
  importanceScore?: number;
  /** Cross-session diff: true if this URL was NOT seen in any previous search for the same query. */
  isNew?: boolean;
  /** Geographic location extracted by AI classify. */
  location?: GeoLocation;
}

export interface SourceStatus {
  name: string;
  status: 'ok' | 'error' | 'timeout' | 'disabled' | 'skipped';
  resultCount: number;
  error?: string;
  elapsedSeconds?: number;
}

/** A named entity extracted from search leads with confidence score. */
export interface ExtractedEntity {
  name: string;
  confidence: number;
  reason: string;
}

/** Dimension used for query expansion and result grouping. */
export interface SearchDimension {
  label: string;
  priority: 'primary' | 'secondary';
  values: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  sources: SourceStatus[];
  query: string;
  totalResults: number;
  enhancedQueries?: Record<string, string[]>;
  rounds: number;
  /** Entities extracted during recursive search rounds (from AI entity extraction). */
  entities?: ExtractedEntity[];
  /** Dimensions used for query expansion (for result grouping in output). */
  dimensions?: SearchDimension[];
}

/**
 * AI-generated research report from a search response.
 * Produced by aiGenerateReport() — optional, costs one LLM call.
 */
export interface SearchReport {
  summary: string;
  keyFindings: string[];
  rankedResults: Array<{
    rank: number;
    title: string;
    url: string;
    source: string;
    why: string;
  }>;
  keyEntities: Array<{
    name: string;
    description: string;
  }>;
  informationGaps: string[];
  searchQuality: {
    coverage: 'high' | 'medium' | 'low';
    directSourceRatio: number;
    totalResults: number;
    recommendation?: string;
  };
}

/** Create a SearchResponse with sensible defaults. */
export function createSearchResponse(
  partial?: Partial<SearchResponse>,
): SearchResponse {
  return {
    results: [],
    sources: [],
    query: '',
    totalResults: 0,
    rounds: 1,
    ...partial,
  };
}
