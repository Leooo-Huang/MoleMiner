export interface GeoLocation {
  name: string;
  lat: number;
  lng: number;
  level: 'country' | 'region' | 'city' | 'district';
}

export interface SearchListItem {
  id: number;
  query: string;
  sourcesUsed: string[];
  resultCount: number;
  searchedAt: string;
  directCount: number;
  leadCount: number;
  locationCount: number;
}

export interface SearchResultItem {
  id: number;
  title: string;
  url: string;
  source: string;
  snippet: string;
  resultType: 'direct' | 'lead';
  language?: string;
  timestamp?: string;
  summary?: string;
  location?: GeoLocation;
  importanceScore?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchDetail {
  search: {
    id: number;
    query: string;
    sourcesUsed: string[];
    resultCount: number;
    searchedAt: string;
  };
  results: SearchResultItem[];
  stats: {
    directCount: number;
    leadCount: number;
    locationCount: number;
    sourceBreakdown: Record<string, number>;
  };
}

export interface ProgressEvent {
  type: string;
  [key: string]: unknown;
}
