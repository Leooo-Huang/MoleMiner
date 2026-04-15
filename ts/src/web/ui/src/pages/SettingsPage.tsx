import { useState, useEffect, useCallback } from 'react';
import { fetchConfig, patchConfig, type ConfigInfo } from '../api.js';
import { useI18n } from '../hooks/useI18n.js';
import { IconInfo } from '../components/Icons.js';
import type { Locale } from '../contexts/LocaleContext.js';

type DraftMap = Record<string, string>;

export function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftMap>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const loadConfig = useCallback(() => {
    fetchConfig().then((c) => {
      setConfig(c);
      setDraft({});
    }).catch(e => setError(String(e)));
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const saveField = useCallback(async (key: string, rawValue: string, type: 'number' | 'text' | 'password') => {
    const value: string | number = type === 'number' ? Number(rawValue) : rawValue;
    if (type === 'number' && Number.isNaN(value as number)) return;

    setSaving(prev => ({ ...prev, [key]: true }));
    setSaveError(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

    try {
      await patchConfig(key, value);
      loadConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(prev => ({ ...prev, [key]: msg }));
    } finally {
      setSaving(prev => ({ ...prev, [key]: false }));
    }
  }, [loadConfig]);

  if (error) return <div className="py-8 text-center text-red-400">{error}</div>;

  if (!config) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-surface rounded w-1/4 animate-pulse" />
        {[1,2,3].map(i => (
          <div key={i} className="bg-surface border border-border rounded-lg p-5 h-20 animate-pulse" />
        ))}
      </div>
    );
  }

  const section = (title: string, children: React.ReactNode) => (
    <div className="bg-surface border border-border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-text mb-3">{title}</h2>
      {children}
    </div>
  );

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text font-mono text-xs">{value}</span>
    </div>
  );

  const statusBadge = (ok: boolean, label: string) => (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs ${
      ok ? 'bg-success/10 text-success' : 'bg-red-400/10 text-red-400'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-success' : 'bg-red-400'}`} />
      {label}
    </span>
  );

  const getDraftOrConfig = (key: string, configValue: string | number): string => {
    if (key in draft) return draft[key];
    return String(configValue);
  };

  const handleChange = (key: string, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleCommit = (key: string, type: 'number' | 'text' | 'password') => {
    if (!(key in draft)) return;
    const currentConfigValue = String((config as unknown as Record<string, unknown>)[key] ?? '');
    if (draft[key] === currentConfigValue) {
      setDraft(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    saveField(key, draft[key], type);
  };

  const editableRow = (label: string, key: string, configValue: string | number, type: 'number' | 'text' = 'text') => {
    const displayValue = getDraftOrConfig(key, configValue);
    const isSaving = saving[key] ?? false;
    const fieldError = saveError[key];
    const isDirty = key in draft && draft[key] !== String(configValue);

    return (
      <div className="flex items-center justify-between py-1.5 text-sm gap-3">
        <span className="text-text-secondary flex-shrink-0">{label}</span>
        <div className="flex items-center gap-2">
          <input
            type={type}
            value={displayValue}
            onChange={e => handleChange(key, e.target.value)}
            onBlur={() => handleCommit(key, type)}
            onKeyDown={e => { if (e.key === 'Enter') handleCommit(key, type); }}
            disabled={isSaving}
            className={`w-24 bg-bg border rounded px-2 py-1 text-xs font-mono text-text text-right
              focus:outline-none focus:border-accent transition
              ${isDirty ? 'border-accent/50' : 'border-border'}
              ${isSaving ? 'opacity-50' : ''}
              ${fieldError ? 'border-red-400' : ''}`}
          />
          {isSaving && <span className="text-xs text-text-secondary animate-pulse">...</span>}
          {fieldError && <span className="text-xs text-red-400" title={fieldError}>!</span>}
        </div>
      </div>
    );
  };

  const passwordRow = (label: string, key: string, configValue: string) => {
    const displayValue = getDraftOrConfig(key, configValue);
    const isSaving = saving[key] ?? false;
    const fieldError = saveError[key];
    const isDirty = key in draft && draft[key] !== configValue;
    const isVisible = showKeys[key] ?? false;

    return (
      <div className="flex items-center justify-between py-1.5 text-sm gap-3">
        <span className="text-text-secondary flex-shrink-0">{label}</span>
        <div className="flex items-center gap-2">
          <input
            type={isVisible ? 'text' : 'password'}
            value={displayValue}
            onChange={e => handleChange(key, e.target.value)}
            onBlur={() => handleCommit(key, 'password')}
            onKeyDown={e => { if (e.key === 'Enter') handleCommit(key, 'password'); }}
            disabled={isSaving}
            className={`w-48 bg-bg border rounded px-2 py-1 text-xs font-mono text-text
              focus:outline-none focus:border-accent transition
              ${isDirty ? 'border-accent/50' : 'border-border'}
              ${isSaving ? 'opacity-50' : ''}
              ${fieldError ? 'border-red-400' : ''}`}
          />
          <button
            type="button"
            onClick={() => setShowKeys(prev => ({ ...prev, [key]: !prev[key] }))}
            className="text-xs text-text-secondary hover:text-text transition px-1"
          >
            {isVisible ? 'Hide' : 'Show'}
          </button>
          {isSaving && <span className="text-xs text-text-secondary animate-pulse">...</span>}
          {fieldError && <span className="text-xs text-red-400" title={fieldError}>!</span>}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">{t('settings.title')}</h1>

      <div className="space-y-4 max-w-2xl">
        {/* AI Engine — read-only (profile-managed) */}
        {section(t('settings.aiEngine'), (
          <div className="divide-y divide-border/50">
            {row(t('settings.provider'), config.llmProvider ?? t('settings.notConfigured'))}
            {row(t('settings.model'), config.llmModel ?? 'Default')}
            {row(t('settings.profile'), config.llmProfile ?? 'None')}
            {row(t('settings.status'), config.llmProvider
              ? statusBadge(true, t('settings.connected'))
              : statusBadge(false, t('settings.notConfigured'))
            )}
          </div>
        ))}

        {/* API Keys — editable password fields */}
        {section(t('settings.apiKeys'), (
          <div className="divide-y divide-border/50">
            {passwordRow('Brave Search', 'braveApiKey', config.braveApiKey)}
            {passwordRow('GitHub Token', 'githubToken', config.githubToken)}
          </div>
        ))}

        {/* Search Defaults — editable number fields */}
        {section(t('settings.searchDefaults'), (
          <div className="divide-y divide-border/50">
            {editableRow(t('settings.maxRounds'), 'defaultMaxRounds', config.defaultMaxRounds, 'number')}
            {editableRow(t('settings.apiTimeout'), 'sourceTimeoutApi', config.sourceTimeoutApi, 'number')}
            {editableRow(t('settings.browserTimeout'), 'sourceTimeoutBrowser', config.sourceTimeoutBrowser, 'number')}
          </div>
        ))}

        {/* Language */}
        {section(t('settings.language'), (
          <div className="flex gap-2">
            {(['en', 'zh'] as Locale[]).map(lang => (
              <button
                key={lang}
                onClick={() => setLocale(lang)}
                className={`px-4 py-2 text-sm rounded-md border transition ${
                  locale === lang
                    ? 'bg-accent/15 border-accent/50 text-accent'
                    : 'bg-surface border-border text-text-secondary hover:text-text hover:border-accent/30'
                }`}
              >
                {lang === 'en' ? 'English' : '中文'}
              </button>
            ))}
          </div>
        ))}

        {/* CLI hint */}
        <div className="p-3 bg-surface border border-border rounded-lg text-xs text-text-secondary flex items-start gap-2">
          <IconInfo size={14} className="flex-shrink-0 mt-0.5 opacity-50" />
          <span>{t('settings.cliHint')} <code className="font-mono text-accent">moleminer config list</code> / <code className="font-mono text-accent">moleminer setup</code></span>
        </div>

        {/* Version */}
        <div className="text-xs text-text-secondary/40 text-right">
          MoleMiner v{config.version}
        </div>
      </div>
    </div>
  );
}
