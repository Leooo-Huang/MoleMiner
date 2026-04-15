import { useState, useEffect, useCallback } from 'react';
import { fetchSources, patchSource, type SourceInfo } from '../api.js';
import { useI18n } from '../hooks/useI18n.js';
import { SOURCE_ICON_MAP, IconLink, IconInfo } from '../components/Icons.js';
import { LoginModal } from '../components/LoginModal.js';

function statusColor(s: SourceInfo): string {
  if (!s.isInDefaultSources) return 'bg-text-secondary/40';  // grey: disabled
  if (!s.lastStatus) {
    // Never searched — show warning if auth source missing cookies, else neutral
    if (s.requiresAuth && !s.hasCredentials) return 'bg-warning';
    return 'bg-text-secondary/60';
  }
  const ls = s.lastStatus;
  if (ls.status === 'ok' && ls.resultCount > 0) return 'bg-success';  // green
  if (ls.status === 'ok' && ls.resultCount === 0) return 'bg-warning';  // yellow: 0 results
  if (ls.status === 'skipped') return 'bg-text-secondary/60';  // grey: skipped
  return 'bg-red-400';  // red: error/timeout/disabled
}

function ToggleSwitch({ checked, onChange, disabled }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full
        transition-colors duration-200 ease-in-out
        focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-1 focus:ring-offset-bg
        disabled:opacity-40 disabled:cursor-not-allowed
        ${checked ? 'bg-accent' : 'bg-border'}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-4 w-4 transform rounded-full
          bg-white shadow-sm ring-0 transition duration-200 ease-in-out
          ${checked ? 'translate-x-4' : 'translate-x-0.5'}
          mt-0.5
        `}
      />
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-surface-hover hover:bg-border text-text-secondary transition"
      title="Copy"
    >
      {copied ? t('sources.copied') : '⎘'}
    </button>
  );
}

export function SourcesPage() {
  const { t } = useI18n();

  const statusLabel = (s: SourceInfo): string => {
    if (!s.isInDefaultSources) return t('sources.statusDisabled');
    if (!s.lastStatus) {
      if (s.requiresAuth && !s.hasCredentials) return t('sources.statusLoginRequired');
      return t('sources.statusNeverSearched') || 'Not searched yet';
    }
    const ls = s.lastStatus;
    if (ls.status === 'ok' && ls.resultCount > 0) {
      return `${t('sources.statusOk') || 'OK'} · ${ls.resultCount}`;
    }
    if (ls.status === 'ok' && ls.resultCount === 0) {
      return t('sources.statusZeroResults') || 'No results';
    }
    if (ls.status === 'skipped') return t('sources.statusSkipped') || 'Skipped';
    if (ls.status === 'timeout') return t('sources.statusTimeout') || 'Timeout';
    if (ls.status === 'error') return t('sources.statusError') || 'Error';
    return ls.status;
  };
  const [sources, setSources] = useState<SourceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [loginPlatform, setLoginPlatform] = useState<string | null>(null);

  useEffect(() => {
    fetchSources().then(setSources).catch(e => setError(String(e)));
  }, []);

  const handleToggle = useCallback(async (name: string, enabled: boolean) => {
    if (toggling) return;
    // When enabling an auth source without credentials, show login modal instead
    if (enabled) {
      const source = sources?.find(s => s.name === name);
      if (source?.requiresAuth && !source.hasCredentials) {
        setLoginPlatform(name);
        return;
      }
    }
    setToggling(name);
    try {
      await patchSource(name, enabled);
      const updated = await fetchSources();
      setSources(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setToggling(null);
    }
  }, [toggling, sources]);

  const handleLoginSuccess = useCallback(async () => {
    const name = loginPlatform;
    setLoginPlatform(null);
    if (!name) return;
    setToggling(name);
    try {
      await patchSource(name, true);
      const updated = await fetchSources();
      setSources(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setToggling(null);
    }
  }, [loginPlatform]);

  const handleLoginSkip = useCallback(() => {
    setLoginPlatform(null);
  }, []);

  if (error) return <div className="py-8 text-center text-red-400">{error}</div>;

  if (!sources) {
    return (
      <div className="space-y-3">
        <div className="h-8 bg-surface rounded w-1/4 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="bg-surface border border-border rounded-lg p-4 h-24 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const apiSources = sources.filter(s => !['zhihu','xiaohongshu','weibo','x'].includes(s.name));
  const authSources = sources.filter(s => ['zhihu','xiaohongshu','weibo','x'].includes(s.name));
  const enabledCount = sources.filter(s => s.isInDefaultSources).length;

  const renderCard = (s: SourceInfo) => {
    const IconComponent = SOURCE_ICON_MAP[s.name] ?? IconLink;
    return (
      <div key={s.name} className="bg-surface border border-border rounded-lg p-4 hover:border-accent/30 transition">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-text-secondary/60">
              <IconComponent size={16} />
            </span>
            <span className="font-medium text-text text-sm">{s.name}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-text-secondary/50 bg-surface-hover px-2 py-0.5 rounded font-mono">
            {s.type}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs" title={s.lastStatus?.error ?? undefined}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusColor(s)}`} />
            <span className="text-text-secondary">{statusLabel(s)}</span>
          </div>
          <ToggleSwitch
            checked={s.isInDefaultSources}
            onChange={(enabled) => handleToggle(s.name, enabled)}
            disabled={toggling === s.name}
          />
        </div>
        {s.lastStatus?.error && (
          <div
            className="mt-2 text-[10px] text-red-400/80 font-mono truncate"
            title={s.lastStatus.error}
          >
            {s.lastStatus.error}
          </div>
        )}
        {s.requiresAuth && !s.hasCredentials && (
          <div className="mt-2.5 flex items-center">
            <code className="text-[11px] text-accent bg-bg/80 border border-border rounded px-2 py-1 font-mono select-all">
              moleminer login {s.name}
            </code>
            <CopyButton text={`moleminer login ${s.name}`} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {loginPlatform && (
        <LoginModal
          platform={loginPlatform}
          index={1}
          total={1}
          onSuccess={handleLoginSuccess}
          onSkip={handleLoginSkip}
        />
      )}

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-xl font-semibold">{t('sources.title')}</h1>
        <span className="text-xs text-text-secondary font-mono">{enabledCount}/{sources.length} {t('sources.enabled')}</span>
      </div>

      <div className="mb-6">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/40 mb-3">
          {t('sources.searchSources')} ({apiSources.length})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {apiSources.map(renderCard)}
        </div>
      </div>

      <div>
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/40 mb-3">
          {t('sources.requiresLogin')} ({authSources.length})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {authSources.map(renderCard)}
        </div>
      </div>

      <div className="mt-6 p-3 bg-surface border border-border rounded-lg text-xs text-text-secondary flex items-start gap-2">
        <IconInfo size={14} className="flex-shrink-0 mt-0.5 opacity-50" />
        <span>{t('sources.cliHint')} <code className="font-mono text-accent">moleminer login &lt;platform&gt;</code></span>
      </div>
    </div>
  );
}
