import { useState } from 'react';
import { useI18n } from '../hooks/useI18n.js';
import { Highlight } from './Highlight.js';
import type { SearchResultItem } from '../types.js';

interface ResultCardProps {
  result: SearchResultItem;
  query?: string;
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function sourceHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

export function ResultCard({ result, query = '' }: ResultCardProps) {
  const { t } = useI18n();
  const isDirect = result.resultType === 'direct';
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const fullText = result.summary || result.snippet || '';
  const isLong = fullText.length > 200;
  const displayText = expanded ? fullText : fullText.slice(0, 200);

  const hue = sourceHue(result.source);

  const handleCopy = () => {
    navigator.clipboard.writeText(result.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-4 hover:bg-surface-hover transition">
      {/* Row 1 — Title (up to 2 lines) */}
      <div className="flex items-start gap-2">
        <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${isDirect ? 'bg-success' : 'bg-warning'}`} />
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-text hover:text-accent transition line-clamp-2 min-w-0"
          title={result.title}
        >
          <Highlight text={result.title} query={query} />
        </a>
      </div>

      {/* Row 2 — Metadata (compact, single line, wraps if needed) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 ml-3.5 text-xs text-text-secondary">
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium"
          style={{
            backgroundColor: `hsl(${hue}, 60%, 25%)`,
            color: `hsl(${hue}, 80%, 80%)`,
          }}
        >
          {result.source}
        </span>
        <span className="font-mono truncate max-w-[200px]">
          {safeHostname(result.url)}
        </span>
        {result.timestamp && <span>{result.timestamp}</span>}
        {result.location && (
          <span className="text-accent">{result.location.name}</span>
        )}
        {result.importanceScore != null && result.importanceScore > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="relative w-12 h-1 rounded-full bg-border overflow-hidden">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-accent"
                style={{ width: `${Math.round(result.importanceScore * 100)}%` }}
              />
            </span>
            <span className="text-[10px] text-text-secondary">{(result.importanceScore * 100).toFixed(0)}</span>
          </span>
        )}
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-text-secondary hover:text-accent transition text-[10px] cursor-pointer"
          title={t('results.copyUrl')}
        >
          {copied ? (
            <span className="text-success">{t('results.copied')}</span>
          ) : (
            <span>{t('results.copyUrl')}</span>
          )}
        </button>
      </div>

      {/* Row 3 — Summary (independent paragraph) */}
      {fullText && (
        <div className="mt-2 ml-3.5">
          <p className="text-xs text-text-secondary leading-relaxed">
            <Highlight text={displayText} query={query} />
            {isLong && !expanded && '...'}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-accent hover:text-accent/80 transition mt-1 cursor-pointer"
            >
              {expanded ? t('results.showLess') : t('results.showMore')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
