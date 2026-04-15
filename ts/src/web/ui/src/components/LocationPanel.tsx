import { useI18n } from '../hooks/useI18n.js';
import { IconGlobe } from './Icons.js';
import type { SearchResultItem, GeoLocation } from '../types.js';
import { ResultCard } from './ResultCard.js';

interface LocationPanelProps {
  location: GeoLocation | null;
  results: SearchResultItem[];
  onClose?: () => void;
}

export function LocationPanel({ location, results, onClose }: LocationPanelProps) {
  const { t } = useI18n();

  if (!location) {
    return (
      <div className="h-full flex flex-col items-center justify-center animate-fade-in">
        <IconGlobe size={40} className="opacity-25 text-text-secondary" />
        <p className="mt-3 text-text-secondary text-sm">{t('globe.clickMarker')}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header bar — sticky */}
      <div className="sticky top-0 z-10 bg-surface px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-accent truncate">{location.name}</h3>
            <p className="text-[11px] text-text-secondary mt-0.5">
              {location.lat.toFixed(2)}, {location.lng.toFixed(2)} · {results.length} {t('search.results')}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="shrink-0 p-1 text-text-secondary hover:text-text transition rounded"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable results */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {results.map((r) => <ResultCard key={r.id} result={r} />)}
      </div>
    </div>
  );
}
