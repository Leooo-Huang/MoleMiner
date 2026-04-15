import { useMemo, useEffect, useRef } from 'react';
import { useI18n } from '../hooks/useI18n.js';
import type { ProgressEvent } from '../types.js';

interface SearchProgressProps {
  query: string;
  events: ProgressEvent[];
  isRunning: boolean;
  onClose?: () => void;
}

interface RoundData {
  round: number;
  maxRounds: number;
  steps: Array<{ status: 'done' | 'active' | 'error'; text: string }>;
}

function buildRounds(events: ProgressEvent[], t: (key: string, params?: Record<string, string | number>) => string): RoundData[] {
  const rounds: RoundData[] = [];
  let current: RoundData | null = null;

  for (const e of events) {
    switch (e.type) {
      case 'round_start':
        current = { round: e.round as number, maxRounds: e.maxRounds as number, steps: [] };
        rounds.push(current);
        break;
      case 'generating_queries':
        current?.steps.push({ status: 'active', text: t('progress.generatingQueries') });
        break;
      case 'queries_generated':
        if (current && current.steps.length > 0) {
          current.steps[current.steps.length - 1] = {
            status: 'done',
            text: t('progress.queriesGenerated', { count: e.activeCount as number, lang: e.language as string }),
          };
        }
        break;
      case 'dispatching':
        current?.steps.push({ status: 'active', text: t('progress.dispatching', { count: e.sourceCount as number }) });
        break;
      case 'dispatch_done':
        if (current && current.steps.length > 0) {
          current.steps[current.steps.length - 1] = {
            status: 'done',
            text: t('progress.resultsCollected', { count: e.resultCount as number }),
          };
        }
        break;
      case 'classifying':
        current?.steps.push({ status: 'active', text: t('progress.classifying', { count: e.resultCount as number }) });
        break;
      case 'classified':
        if (current && current.steps.length > 0) {
          current.steps[current.steps.length - 1] = {
            status: 'done',
            text: t('progress.classified', { direct: e.directCount as number, leads: e.leadCount as number }),
          };
        }
        break;
      case 'extracting_entities':
        current?.steps.push({ status: 'active', text: t('progress.extractingEntities', { count: e.leadCount as number }) });
        break;
      case 'entities_extracted': {
        const names = (e.entities as string[])?.slice(0, 5).join(', ') ?? '';
        if (current && current.steps.length > 0) {
          current.steps[current.steps.length - 1] = {
            status: 'done',
            text: t('progress.entities', { names }),
          };
        }
        break;
      }
      case 'converged':
        current?.steps.push({ status: 'done', text: t('progress.converged', { reason: e.reason as string }) });
        break;
      case 'extracting_content':
        current?.steps.push({ status: 'active', text: t('progress.fetchingPages', { count: e.totalUrls as number }) });
        break;
      case 'content_extracted':
        if (current && current.steps.length > 0) {
          const failText = (e.failCount as number) > 0 ? t('progress.pagesFailed', { fail: e.failCount as number }) : '';
          current.steps[current.steps.length - 1] = {
            status: 'done',
            text: t('progress.pagesExtracted', { success: e.successCount as number }) + failText,
          };
        }
        break;
      case 'error':
        if (current) {
          current.steps.push({ status: 'error', text: t('progress.error', { message: e.message as string }) });
        } else {
          rounds.push({ round: 0, maxRounds: 0, steps: [{ status: 'error', text: t('progress.error', { message: e.message as string }) }] });
        }
        break;
    }
  }

  return rounds;
}

function StatusDot({ status }: { status: 'done' | 'active' | 'error' }) {
  if (status === 'done') return <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0 mt-1.5" />;
  if (status === 'active') return <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0 mt-1.5" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0 mt-1.5" />;
}

function ProgressContent({ query, events, isRunning, onClose, t }: {
  query: string;
  events: ProgressEvent[];
  isRunning: boolean;
  onClose?: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const rounds = useMemo(() => buildRounds(events, t), [events, t]);
  const hasError = events.some(e => e.type === 'error');
  const maxRounds = rounds.length > 0 ? rounds[0].maxRounds : 0;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          {isRunning && <span className="w-2 h-2 rounded-full bg-accent animate-pulse flex-shrink-0" />}
          {!isRunning && !hasError && <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />}
          {hasError && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
          <div className="min-w-0">
            <span className="text-xs font-medium">
              {hasError ? t('progress.failed') : isRunning ? t('progress.title') : t('progress.complete')}
            </span>
            <span className="text-xs text-text-secondary font-mono ml-2 truncate">{query}</span>
          </div>
        </div>
        {onClose && !isRunning && (
          <button
            onClick={onClose}
            className="p-1 text-text-secondary hover:text-text transition rounded"
            aria-label={t('progress.close')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Progress bar */}
      {maxRounds > 0 && (
        <div className="h-0.5 bg-border">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${Math.min(100, (rounds.length / maxRounds) * 100)}%` }} />
        </div>
      )}

      {/* Steps */}
      <div ref={scrollRef} className="px-4 py-2.5 max-h-60 overflow-y-auto space-y-2.5">
        {rounds.map((round) => (
          <div key={round.round}>
            <div className="flex items-center gap-2 text-[11px] font-medium text-text-secondary mb-1">
              <span className="w-3 h-px bg-border" />
              <span>
                {round.maxRounds > 0
                    ? t('progress.roundOf', { n: round.round, total: round.maxRounds })
                    : t('progress.round', { n: round.round })}
              </span>
              <span className="flex-1 h-px bg-border" />
            </div>
            <div className="ml-2.5 border-l border-border/50 pl-2.5 space-y-0.5">
              {round.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <StatusDot status={step.status} />
                  <span className={step.status === 'error' ? 'text-red-400' : 'text-text-secondary'}>{step.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {isRunning && rounds.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span>{t('progress.initializing')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function SearchProgress({ query, events, isRunning, onClose }: Omit<SearchProgressProps, 'inline'>) {
  const { t } = useI18n();
  return <ProgressContent query={query} events={events} isRunning={isRunning} onClose={onClose} t={t} />;
}
