import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchSearchDetail } from '../api.js';
import { ResultCard } from '../components/ResultCard.js';
import { CustomSelect } from '../components/CustomSelect.js';
import { GlobeView } from '../components/GlobeView.js';
import { LocationPanel } from '../components/LocationPanel.js';
import { useI18n } from '../hooks/useI18n.js';
import type { SearchDetail, SearchResultItem, GeoLocation } from '../types.js';

interface SearchResultsProps {
  id: number;
}

type ViewMode = 'list' | 'globe';
type SortMode = 'relevance' | 'date' | 'source';

const RESULTS_PER_PAGE = 20;

export function SearchResults({ id }: SearchResultsProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<SearchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('list');
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [selectedLocation, setSelectedLocation] = useState<GeoLocation | null>(null);
  const [selectedResults, setSelectedResults] = useState<SearchResultItem[]>([]);

  useEffect(() => {
    if (id < 0) return; // active search placeholder
    let cancelled = false;
    setDetail(null);
    setError(null);
    setView('list');
    setSelectedLocation(null);
    fetchSearchDetail(id)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [id]);

  // Reset page when filters/sort/keyword change
  useEffect(() => {
    setPage(1);
  }, [sourceFilter, typeFilter, sortMode, keyword]);

  const filteredResults = useMemo(() => {
    if (!detail) return [];

    let results = detail.results.filter((r) => {
      if (sourceFilter && r.source !== sourceFilter) return false;
      if (typeFilter && r.resultType !== typeFilter) return false;
      return true;
    });

    // Keyword filter
    if (keyword.trim()) {
      const kw = keyword.toLowerCase();
      results = results.filter((r) => {
        const title = r.title.toLowerCase();
        const snippet = (r.summary || r.snippet || '').toLowerCase();
        return title.includes(kw) || snippet.includes(kw);
      });
    }

    // Sort
    switch (sortMode) {
      case 'relevance':
        results = [...results].sort((a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0));
        break;
      case 'date':
        results = [...results].sort((a, b) => {
          const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return tb - ta;
        });
        break;
      case 'source':
        results = [...results].sort((a, b) => a.source.localeCompare(b.source));
        break;
    }

    return results;
  }, [detail, sourceFilter, typeFilter, sortMode, keyword]);

  const totalPages = Math.max(1, Math.ceil(filteredResults.length / RESULTS_PER_PAGE));

  const pagedResults = useMemo(() => {
    const start = (page - 1) * RESULTS_PER_PAGE;
    return filteredResults.slice(start, start + RESULTS_PER_PAGE);
  }, [filteredResults, page]);

  const locationCount = useMemo(() => {
    if (!detail) return 0;
    return detail.results.filter(r => r.location).length;
  }, [detail]);

  const sources = useMemo(() => {
    if (!detail) return [];
    return [...new Set(detail.results.map(r => r.source))].sort();
  }, [detail]);

  const handleMarkerClick = useCallback((location: GeoLocation, results: SearchResultItem[]) => {
    setSelectedLocation(location);
    setSelectedResults(results);
  }, []);

  if (error) {
    return <div className="text-center py-12 text-red-400">{error}</div>;
  }

  if (!detail) {
    return (
      <div className="space-y-3">
        <div className="h-8 bg-surface rounded w-1/2 animate-pulse" />
        <div className="h-4 bg-surface rounded w-1/3 animate-pulse" />
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-border rounded w-3/4 mb-2" />
            <div className="h-3 bg-border rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  const { search, stats } = detail;

  return (
    <div>
      {/* Meta info */}
      <div className="mb-4">
        <h1 className="text-xl font-semibold font-mono">"{search.query}"</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-text-secondary">
          <span>{new Date(search.searchedAt).toLocaleString()}</span>
          <span>{search.resultCount} {t('search.results')}</span>
          <span>{search.sourcesUsed.length} {t('search.sources')}</span>
        </div>
        <div className="flex gap-3 mt-1 text-xs">
          <span className="text-success">{stats.directCount} {t('search.direct')}</span>
          <span className="text-warning">{stats.leadCount} {t('search.leads')}</span>
          {stats.locationCount > 0 && (
            <span className="text-accent">{stats.locationCount} {t('search.locations')}</span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 text-xs font-medium transition ${
              view === 'list' ? 'bg-accent/20 text-accent' : 'bg-surface text-text-secondary hover:text-text'
            }`}
          >
            {t('results.list')}
          </button>
          <button
            onClick={() => locationCount > 0 && setView('globe')}
            disabled={locationCount === 0}
            className={`hidden sm:block px-3 py-1.5 text-xs font-medium transition ${
              view === 'globe' ? 'bg-accent/20 text-accent' : 'bg-surface text-text-secondary hover:text-text'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={locationCount === 0 ? t('results.noLocation') : `${locationCount} ${t('results.withLocation')}`}
          >
            {t('results.globe')}{locationCount > 0 && locationCount < search.resultCount && ` (${locationCount})`}
          </button>
        </div>

        {view === 'list' && (
          <>
            <CustomSelect
              value={sourceFilter ?? ''}
              options={[
                { value: '', label: t('results.allSources') },
                ...sources.map(s => ({ value: s, label: `${s} (${stats.sourceBreakdown[s] ?? 0})` })),
              ]}
              onChange={v => setSourceFilter(v || null)}
            />
            <CustomSelect
              value={typeFilter ?? ''}
              options={[
                { value: '', label: t('results.allTypes') },
                { value: 'direct', label: `${t('search.direct')} (${stats.directCount})` },
                { value: 'lead', label: `${t('search.leads')} (${stats.leadCount})` },
              ]}
              onChange={v => setTypeFilter(v || null)}
            />

            {/* Sort */}
            <CustomSelect
              value={sortMode}
              options={[
                { value: 'relevance', label: t('results.sortRelevance') },
                { value: 'date', label: t('results.sortDate') },
                { value: 'source', label: t('results.sortSource') },
              ]}
              onChange={v => setSortMode(v as SortMode)}
            />

            {/* Keyword search */}
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('results.filterPlaceholder')}
              className="bg-surface border border-border rounded-md px-2 py-1.5 text-xs text-text placeholder:text-text-secondary w-40"
            />
          </>
        )}
      </div>

      {/* Content */}
      {view === 'list' && (
        <div className="space-y-2">
          {pagedResults.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-sm">{t('results.noMatch')}</div>
          ) : (
            <>
              {pagedResults.map((r) => (
                <ResultCard key={r.id} result={r} query={keyword || search.query} />
              ))}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 pt-4 pb-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-xs font-medium bg-surface border border-border rounded-md text-text-secondary hover:text-text transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {t('results.prev')}
                  </button>
                  <span className="text-xs text-text-secondary">
                    {t('results.page')} {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 text-xs font-medium bg-surface border border-border rounded-md text-text-secondary hover:text-text transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {t('results.next')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {view === 'globe' && (
        <div className="flex flex-col lg:flex-row gap-4" style={{ height: 'calc(100vh - 280px)' }}>
          <div className="flex-1 min-h-[400px] bg-surface border border-border rounded-lg overflow-hidden">
            <GlobeView results={detail.results.filter(r => r.location)} onMarkerClick={handleMarkerClick} />
          </div>
          <div className="lg:w-[40%] min-h-[300px] bg-surface border border-border rounded-lg overflow-hidden">
            <LocationPanel location={selectedLocation} results={selectedResults} onClose={() => setSelectedLocation(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
