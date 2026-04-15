import { createContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { startSearch as apiStartSearch, subscribeProgress } from '../api.js';
import type { ProgressEvent } from '../types.js';

interface ActiveSearch {
  searchId: string;
  query: string;
  events: ProgressEvent[];
  running: boolean;
  storeId?: number;
}

interface SearchContextValue {
  /** Currently active searches (keyed by temp searchId) */
  activeSearches: Map<string, ActiveSearch>;
  /** Start a new search — SSE managed globally, survives navigation */
  startSearch: (query: string, deep?: boolean) => Promise<string>;
  /** Get events for a specific search */
  getEvents: (searchId: string) => ProgressEvent[];
  /** Whether any search is running */
  isAnySearching: boolean;
}

export const SearchContext = createContext<SearchContextValue>({
  activeSearches: new Map(),
  startSearch: async () => '',
  getEvents: () => [],
  isAnySearching: false,
});

export function SearchProvider({ children, onSearchComplete }: {
  children: ReactNode;
  onSearchComplete?: (query: string, storeId: number) => void;
}) {
  const [activeSearches, setActive] = useState<Map<string, ActiveSearch>>(new Map());
  const cleanupRefs = useRef<Map<string, () => void>>(new Map());

  const updateSearch = useCallback((searchId: string, updater: (s: ActiveSearch) => ActiveSearch) => {
    setActive(prev => {
      const next = new Map(prev);
      const current = next.get(searchId);
      if (current) next.set(searchId, updater(current));
      return next;
    });
  }, []);

  const startSearchFn = useCallback(async (query: string, deep?: boolean) => {
    const searchId = await apiStartSearch(query, deep);

    const entry: ActiveSearch = { searchId, query, events: [], running: true };
    setActive(prev => {
      const next = new Map(prev);
      next.set(searchId, entry);
      return next;
    });

    const cleanup = subscribeProgress(
      searchId,
      (event) => {
        updateSearch(searchId, s => ({
          ...s,
          events: [...s.events, event.data as ProgressEvent],
        }));
      },
      (storeId) => {
        updateSearch(searchId, s => ({ ...s, running: false, storeId }));
        onSearchComplete?.(query, storeId);
        // Remove from active after 30s (keep for late viewers)
        setTimeout(() => {
          setActive(prev => {
            const next = new Map(prev);
            next.delete(searchId);
            return next;
          });
          cleanupRefs.current.delete(searchId);
        }, 30_000);
      },
      (message) => {
        updateSearch(searchId, s => ({
          ...s,
          running: false,
          events: [...s.events, { type: 'error', message }],
        }));
      },
    );

    cleanupRefs.current.set(searchId, cleanup);
    return searchId;
  }, [updateSearch, onSearchComplete]);

  const getEvents = useCallback((searchId: string) => {
    return activeSearches.get(searchId)?.events ?? [];
  }, [activeSearches]);

  const isAnySearching = [...activeSearches.values()].some(s => s.running);

  return (
    <SearchContext.Provider value={{ activeSearches, startSearch: startSearchFn, getEvents, isAnySearching }}>
      {children}
    </SearchContext.Provider>
  );
}
