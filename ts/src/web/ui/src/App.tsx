import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { SearchHistory } from './pages/SearchHistory.js';
import { SearchResults } from './pages/SearchResults.js';
import { SourcesPage } from './pages/SourcesPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { SearchBar } from './components/SearchBar.js';
import { Sidebar } from './components/Sidebar.js';
import { LoginModal } from './components/LoginModal.js';
import { LocaleProvider } from './contexts/LocaleContext.js';
import { SearchProvider, SearchContext } from './contexts/SearchContext.js';
import { useI18n } from './hooks/useI18n.js';
import { fetchSources } from './api.js';

type Route =
  | { page: 'history' }
  | { page: 'results'; id: number }
  | { page: 'sources' }
  | { page: 'settings' };

function parseHash(): Route {
  const hash = window.location.hash;
  const resultMatch = hash.match(/^#\/search\/(\d+)/);
  if (resultMatch) return { page: 'results', id: parseInt(resultMatch[1], 10) };
  if (hash === '#/sources') return { page: 'sources' };
  if (hash === '#/settings') return { page: 'settings' };
  return { page: 'history' };
}

function AppInner() {
  const { t } = useI18n();
  const { activeSearches, startSearch } = useContext(SearchContext);
  const [route, setRoute] = useState<Route>(parseHash);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loginQueue, setLoginQueue] = useState<string[]>([]);
  const [pendingSearch, setPendingSearch] = useState<{ query: string; deep?: boolean } | null>(null);
  const loginQueueTotalRef = useRef(0);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navigate = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  // When login queue drains, start the pending search
  useEffect(() => {
    if (loginQueue.length === 0 && pendingSearch) {
      const { query, deep } = pendingSearch;
      setPendingSearch(null);
      startSearch(query, deep).then(() => {
        if (route.page !== 'history') navigate('#/');
      }).catch(() => {});
    }
  }, [loginQueue, pendingSearch, startSearch, route.page, navigate]);

  const handleLoginDone = useCallback(() => {
    setLoginQueue(q => q.slice(1));
  }, []);

  const handleSearch = useCallback(async (query: string, deep?: boolean) => {
    // Check which auth sources need login before searching
    try {
      const sources = await fetchSources();
      const needLogin = sources
        .filter(s => s.requiresAuth && !s.hasCredentials && s.isInDefaultSources)
        .map(s => s.name);
      if (needLogin.length > 0) {
        loginQueueTotalRef.current = needLogin.length;
        setPendingSearch({ query, deep });
        setLoginQueue(needLogin);
        return;
      }
    } catch {
      // If source check fails, proceed with search anyway
    }
    await startSearch(query, deep);
    if (route.page !== 'history') navigate('#/');
  }, [startSearch, route.page, navigate]);

  // Watch for any search completion -> refresh history + navigate to results
  useEffect(() => {
    for (const [, search] of activeSearches) {
      if (!search.running && search.storeId && !(search as { navigated?: boolean }).navigated) {
        (search as { navigated?: boolean }).navigated = true;
        setRefreshKey(k => k + 1);
        navigate(`#/search/${search.storeId}`);
        break; // navigate to the most recently completed
      }
    }
  }, [activeSearches, navigate]);

  // Count active searches for header badge
  const activeCount = [...activeSearches.values()].filter(s => s.running).length;

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-bg/95 backdrop-blur-md border-b border-border/60 px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('#/')}
            className="text-accent font-semibold text-sm whitespace-nowrap hover:opacity-80 transition tracking-tight"
          >
            {t('app.title')}
          </button>

          {/* Search is NEVER disabled — concurrent searches allowed */}
          <SearchBar onSearch={handleSearch} />

          {/* Active search count badge */}
          {activeCount > 0 && route.page !== 'history' && (
            <button
              onClick={() => navigate('#/')}
              className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border border-accent/30 rounded-md text-xs text-accent hover:bg-accent/20 transition whitespace-nowrap"
            >
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              {activeCount} {t('app.searching')}
            </button>
          )}
        </div>
      </header>

      {/* Login queue modal */}
      {loginQueue.length > 0 && (
        <LoginModal
          platform={loginQueue[0]}
          index={loginQueueTotalRef.current - loginQueue.length + 1}
          total={loginQueueTotalRef.current}
          onSuccess={handleLoginDone}
          onSkip={handleLoginDone}
        />
      )}

      {/* Body: sidebar + main */}
      <div className="flex flex-1">
        <Sidebar currentRoute={route.page} onNavigate={navigate} />

        <main className="flex-1 min-w-0 overflow-y-auto px-6 py-5 max-w-5xl">
          {route.page === 'history' && (
            <div className="animate-page-enter">
              <SearchHistory
                key={refreshKey}
                onNavigate={navigate}
                onSearch={handleSearch}
              />
            </div>
          )}
          {route.page === 'results' && (
            <div className="animate-page-enter">
              <SearchResults id={route.id} />
            </div>
          )}
          {route.page === 'sources' && (
            <div className="animate-page-enter">
              <SourcesPage />
            </div>
          )}
          {route.page === 'settings' && (
            <div className="animate-page-enter">
              <SettingsPage />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <LocaleProvider>
      <SearchProvider>
        <AppInner />
      </SearchProvider>
    </LocaleProvider>
  );
}
