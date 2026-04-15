import { useState, useRef, useEffect, useCallback } from 'react';
import { useI18n } from '../hooks/useI18n.js';
import { IconSearch } from './Icons.js';

const RECENT_KEY = 'moleminer-recent';
const MAX_RECENT = 5;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENT);
  } catch { /* corrupted data */ }
  return [];
}

function saveRecent(queries: string[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(queries.slice(0, MAX_RECENT)));
}

function addRecent(query: string): string[] {
  const current = loadRecent();
  const deduped = current.filter(q => q !== query);
  const updated = [query, ...deduped].slice(0, MAX_RECENT);
  saveRecent(updated);
  return updated;
}

interface SearchBarProps {
  onSearch: (query: string, deep: boolean) => void;
  disabled?: boolean;
}

export function SearchBar({ onSearch, disabled }: SearchBarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [deep, setDeep] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>(loadRecent);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Sync recent queries from localStorage on mount
  useEffect(() => {
    setRecentQueries(loadRecent());
  }, []);

  // Reset selectedIndex when dropdown closes
  useEffect(() => {
    if (!showDropdown) setSelectedIndex(-1);
  }, [showDropdown]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed && !disabled) {
      setRecentQueries(addRecent(trimmed));
      setShowDropdown(false);
      onSearch(trimmed, deep);
    }
  }, [query, disabled, onSearch, deep]);

  const handleSelectRecent = useCallback((q: string) => {
    setQuery(q);
    setShowDropdown(false);
    if (!disabled) {
      setRecentQueries(addRecent(q));
      onSearch(q, deep);
    }
  }, [disabled, onSearch, deep]);

  const handleClearRecent = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.removeItem(RECENT_KEY);
    setRecentQueries([]);
    setShowDropdown(false);
  }, []);

  const handleFocus = useCallback(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    if (recentQueries.length > 0) {
      setShowDropdown(true);
    }
  }, [recentQueries.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showDropdown || recentQueries.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => (i + 1) % recentQueries.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => (i <= 0 ? recentQueries.length - 1 : i - 1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault(); // Prevent form submit — select the dropdown item instead
      handleSelectRecent(recentQueries[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowDropdown(false);
      // Don't blur — just close dropdown. App.tsx global handler will blur on next Escape.
    }
  }, [showDropdown, recentQueries, selectedIndex, handleSelectRecent]);

  const handleBlur = useCallback(() => {
    // Delay to allow click on dropdown items to register
    blurTimeoutRef.current = setTimeout(() => {
      setShowDropdown(false);
    }, 150);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  return (
    <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
      <div ref={wrapperRef} className="relative flex-1">
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary/50 pointer-events-none" />
        <input
          id="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder')}
          disabled={disabled}
          className="w-full bg-surface border border-border rounded-md pl-9 pr-4 py-2 text-sm text-text placeholder:text-text-secondary focus:border-accent transition disabled:opacity-50"
        />

        {/* Recent queries dropdown */}
        {showDropdown && recentQueries.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-md shadow-lg z-50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs text-text-secondary">{t('search.recentSearches')}</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleClearRecent}
                className="text-xs text-text-secondary hover:text-accent transition"
              >
                {t('search.clearRecent')}
              </button>
            </div>
            {recentQueries.map((q, i) => (
              <button
                key={q}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelectRecent(q)}
                className={`w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover cursor-pointer transition ${
                  i === selectedIndex ? 'bg-surface-hover text-accent' : ''
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDeep(d => !d)}
        title={t('search.deepModeTitle')}
        disabled={disabled}
        aria-pressed={deep}
        className={`px-3 py-2 text-xs font-medium rounded-md border transition disabled:opacity-30 whitespace-nowrap ${
          deep
            ? 'bg-accent/20 text-accent border-accent/30'
            : 'bg-surface/50 text-text-secondary border-border hover:border-accent/30 hover:text-text'
        }`}
      >
        {t('search.deepMode')}
      </button>
      <button
        type="submit"
        disabled={disabled || !query.trim()}
        className="bg-accent/20 text-accent border border-accent/30 rounded-md px-4 py-2 text-sm font-medium hover:bg-accent/30 transition disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {t('search.button')}
      </button>
    </form>
  );
}
