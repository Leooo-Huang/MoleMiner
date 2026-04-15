import { useState, useEffect, useContext, useMemo } from 'react';
import { fetchSearches, deleteSearchById } from '../api.js';
import { SearchContext } from '../contexts/SearchContext.js';
import { useI18n } from '../hooks/useI18n.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { SearchProgress } from '../components/SearchProgress.js';
import type { SearchListItem } from '../types.js';

type SortMode = 'date' | 'results';

const EXAMPLE_QUERIES = [
  'AI startup funding 2026',
  '\u6DF1\u5733 AI \u521B\u4E1A\u8865\u8D34',
  'best practices RAG pipelines',
];

interface SearchHistoryProps {
  onNavigate: (hash: string) => void;
  onSearch?: (query: string) => void;
}

export function SearchHistory({ onNavigate, onSearch }: SearchHistoryProps) {
  const { t } = useI18n();
  const { activeSearches } = useContext(SearchContext);
  const [searches, setSearches] = useState<SearchListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [filterText, setFilterText] = useState('');
  const [expandedSearchId, setExpandedSearchId] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchSearches()
        .then(({ searches: items }) => { if (!cancelled) setSearches(items); })
        .catch((err) => { if (!cancelled) setError(String(err)); });
    };
    load();
    const interval = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const handleDeleteClick = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(id);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTarget === null) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    setDeletingId(id);
    try {
      await deleteSearchById(id);
      setSearches(prev => prev?.filter(s => s.id !== id) ?? null);
    } catch { /* silently fail */ }
    setDeletingId(null);
  };

  // Group searches by query for deduplication
  const groupedSearches = useMemo(() => {
    if (!searches) return null;
    let list = searches;
    if (filterText) {
      const lower = filterText.toLowerCase();
      list = list.filter(s => s.query.toLowerCase().includes(lower));
    }
    if (sortMode === 'results') {
      list = [...list].sort((a, b) => b.resultCount - a.resultCount);
    }

    // Group by query text (case-insensitive)
    const groups = new Map<string, SearchListItem[]>();
    for (const s of list) {
      const key = s.query.toLowerCase();
      const group = groups.get(key) ?? [];
      group.push(s);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [searches, sortMode, filterText]);

  if (error) {
    return <div className="text-center py-12 text-red-400">{t('search.failedLoad')}: {error}</div>;
  }

  if (searches === null) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-lg p-4 animate-pulse">
            <div className="h-5 bg-border rounded w-2/3 mb-3" />
            <div className="h-3 bg-border rounded w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  const activeList = [...activeSearches.values()].filter(s => s.running);
  const completedActive = [...activeSearches.values()].filter(s => !s.running && s.events.length > 0);
  const hasContent = searches.length > 0 || activeList.length > 0 || completedActive.length > 0;

  if (!hasContent) {
    return (
      <div className="text-center py-16">
        <p className="text-text-secondary text-lg mb-2">{t('search.noHistory')}</p>
        <p className="text-text-secondary text-sm mb-6">{t('search.noHistoryHint')}</p>
        {onSearch && (
          <div>
            <p className="text-text-secondary text-xs mb-3">{t('search.tryExample')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLE_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => onSearch(q)}
                  className="px-3 py-1.5 text-xs font-medium bg-surface border border-border rounded-full text-text-secondary hover:text-accent hover:border-accent/30 transition cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">{t('search.history')}</h1>

      {/* Sort + Filter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setSortMode('date')}
            className={`px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
              sortMode === 'date' ? 'bg-accent/15 text-accent border-b-2 border-accent' : 'bg-surface text-text-secondary hover:text-text border-b-2 border-transparent'
            }`}
          >
            {t('search.sortDate')}
          </button>
          <button
            onClick={() => setSortMode('results')}
            className={`px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
              sortMode === 'results' ? 'bg-accent/15 text-accent border-b-2 border-accent' : 'bg-surface text-text-secondary hover:text-text border-b-2 border-transparent'
            }`}
          >
            {t('search.sortResults')}
          </button>
        </div>
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder={t('search.filterPlaceholder')}
          className="bg-surface border border-border rounded-md px-3 py-1.5 text-xs text-text placeholder:text-text-secondary flex-1 min-w-[140px] max-w-[280px] focus:border-accent/50"
        />
      </div>

      <div className="space-y-3">
        {/* Active searches — inline progress, expandable */}
        {activeList.map((s) => {
          const isExpanded = expandedSearchId === s.searchId;
          return (
            <div key={s.searchId} className="space-y-2">
              <button
                onClick={() => setExpandedSearchId(isExpanded ? null : s.searchId)}
                className="w-full text-left bg-surface border border-accent/30 rounded-lg p-4 hover:bg-surface-hover transition cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                  <span className="font-medium text-accent font-mono text-sm">"{s.query}"</span>
                  <span className="ml-auto text-[10px] text-text-secondary">
                    {isExpanded ? 'collapse' : 'expand'}
                  </span>
                </div>
              </button>
              {isExpanded && (
                <div className="ml-4">
                  <SearchProgress
                    query={s.query}
                    events={s.events}
                    isRunning={s.running}

                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Recently completed (still in SearchContext, not yet in DB refresh) */}
        {completedActive.map((s) => {
          const isExpanded = expandedSearchId === s.searchId;
          return (
            <div key={s.searchId} className="space-y-2">
              <button
                onClick={() => setExpandedSearchId(isExpanded ? null : s.searchId)}
                className="w-full text-left bg-surface border border-success/30 rounded-lg p-4 hover:bg-surface-hover transition cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-success" />
                  <span className="font-medium text-text font-mono text-sm">"{s.query}"</span>
                  <span className="ml-auto text-[10px] text-success">{t('progress.complete')}</span>
                </div>
              </button>
              {isExpanded && (
                <div className="ml-4">
                  <SearchProgress
                    query={s.query}
                    events={s.events}
                    isRunning={false}

                    onClose={() => setExpandedSearchId(null)}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Completed searches — grouped by query */}
        {groupedSearches?.map((group) => {
          const latest = group[0]; // newest first
          const olderCount = group.length - 1;
          const qualityPct = latest.resultCount > 0
            ? Math.round((latest.directCount / latest.resultCount) * 100)
            : 0;
          // Color gradient: red (<20%) -> amber (20-50%) -> green (>50%)
          const qualityColor = qualityPct > 50 ? '#34d399' : qualityPct > 20 ? '#fbbf24' : '#f87171';

          return (
            <div key={latest.id}>
              {/* Main card — latest run */}
              <div
                className="group relative bg-surface/60 border border-border/80 rounded-lg px-4 py-3 hover:bg-surface-hover hover:border-l-2 hover:border-l-accent hover:border-accent/20 hover:shadow-[0_0_24px_rgba(52,211,153,0.06)] transition-all duration-150 cursor-pointer"
                onClick={() => onNavigate(`#/search/${latest.id}`)}
              >
                <div className="flex items-center gap-3">
                  {/* Quality indicator bar — gradient red/amber/green */}
                  <div className="w-1 h-8 rounded-full bg-border/30 overflow-hidden flex-shrink-0" title={`${qualityPct}% direct results`}>
                    <div
                      className="w-full rounded-full transition-all"
                      style={{ height: `${Math.max(8, qualityPct)}%`, marginTop: `${100 - Math.max(8, qualityPct)}%`, backgroundColor: qualityColor }}
                    />
                  </div>

                  <div className="flex-1 min-w-0 pr-6">
                    {/* Primary: query title */}
                    <div className="font-semibold text-text group-hover:text-accent transition text-[15px] leading-tight min-w-0 truncate">
                      {latest.query}
                    </div>
                    {/* Secondary: date + result summary */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[11px] text-text-secondary/50">
                        {new Date(latest.searchedAt).toLocaleDateString()}
                      </span>
                      <span className="text-[11px] text-text-secondary/30">{latest.resultCount} results</span>
                    </div>
                    {/* Tertiary: stat pills */}
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-accent/15 text-accent/90">
                        {latest.directCount} {t('search.direct')}
                      </span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-warning/15 text-warning/90">
                        {latest.leadCount} {t('search.leads')}
                      </span>
                      {latest.locationCount > 0 && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-info/15 text-info/90">
                          {latest.locationCount} loc
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Older runs indicator */}
                {olderCount > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpandedGroupId(expandedGroupId === latest.id ? null : latest.id); }}
                    className="mt-1.5 ml-4 flex items-center gap-1 text-[10px] text-text-secondary/40 hover:text-text-secondary/70 transition cursor-pointer"
                  >
                    <svg
                      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      className={`transition-transform duration-200 ${expandedGroupId === latest.id ? 'rotate-180' : ''}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                    <span>+{olderCount} earlier {olderCount === 1 ? 'run' : 'runs'}</span>
                  </button>
                )}

                {/* Delete button */}
                <button
                  onClick={(e) => handleDeleteClick(latest.id, e)}
                  disabled={deletingId === latest.id}
                  className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition p-1 text-text-secondary hover:text-red-400 rounded hover:bg-red-400/10 cursor-pointer"
                  title={t('search.deleteConfirm')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Expanded older runs */}
              {olderCount > 0 && expandedGroupId === latest.id && (
                <div className="ml-4 mt-1 space-y-1">
                  {group.slice(1).map((older) => (
                    <div
                      key={older.id}
                      onClick={(e) => { e.stopPropagation(); onNavigate(`#/search/${older.id}`); }}
                      className="flex items-center gap-3 px-3 py-1.5 rounded text-[11px] text-text-secondary hover:bg-surface-hover hover:text-text transition cursor-pointer"
                    >
                      <span className="text-text-secondary/50">
                        {new Date(older.searchedAt).toLocaleDateString()}{' '}
                        {new Date(older.searchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-text-secondary/40">{older.resultCount} results</span>
                      <span className="text-accent/60">{older.directCount} direct</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('search.deleteConfirm')}
        confirmLabel={t('search.deleted')}
        cancelLabel={t('search.cancelButton')}
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
