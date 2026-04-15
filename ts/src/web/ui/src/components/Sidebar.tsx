import { useState, useEffect, type ReactNode } from 'react';
import { useI18n } from '../hooks/useI18n.js';
import { fetchSources, fetchConfig, type SourceInfo, type ConfigInfo } from '../api.js';
import { IconHistory, IconSources, IconSettings, IconRadio } from './Icons.js';

interface SidebarProps {
  currentRoute: string;
  onNavigate: (hash: string) => void;
}

const AUTH_PLATFORMS = ['zhihu', 'xiaohongshu', 'weibo', 'x'];

export function Sidebar({ currentRoute, onNavigate }: SidebarProps) {
  const { t } = useI18n();
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [config, setConfig] = useState<ConfigInfo | null>(null);

  useEffect(() => {
    fetchSources().then(setSources).catch(() => {});
    fetchConfig().then(setConfig).catch(() => {});
  }, []);

  const enabledCount = sources.filter(s => s.enabled).length;
  const authSources = sources.filter(s => AUTH_PLATFORMS.includes(s.name));

  const navItem = (icon: ReactNode, label: string, hash: string, route: string, badge?: string) => {
    const active = currentRoute === route;
    return (
      <button
        key={hash}
        onClick={() => onNavigate(hash)}
        className={`w-full text-left px-3 py-2 text-[13px] rounded-md transition flex items-center gap-2.5 cursor-pointer ${
          active
            ? 'bg-accent/8 text-accent border-l-2 border-accent pl-2.5 shadow-[inset_0_0_20px_rgba(52,211,153,0.03)]'
            : 'text-text-secondary hover:text-text hover:bg-surface-hover'
        }`}
      >
        <span className="flex-shrink-0 opacity-60">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        {badge && (
          <span className="text-[10px] text-text-secondary/40 font-mono">{badge}</span>
        )}
      </button>
    );
  };

  return (
    <aside className="w-48 flex-shrink-0 bg-bg/80 border-r border-border/60 flex flex-col h-[calc(100vh-45px)] sticky top-[45px] overflow-y-auto">
      <nav className="flex-1 px-3 py-5 space-y-6">
        {/* Search section */}
        <div>
          <div className="px-3 mb-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-text-secondary/30">
            {t('sidebar.search')}
          </div>
          <div className="space-y-0.5">
            {navItem(<IconHistory size={14} />, t('search.history'), '#/', 'history')}
          </div>
        </div>

        {/* System section */}
        <div>
          <div className="px-3 mb-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-text-secondary/30">
            {t('sidebar.system')}
          </div>
          <div className="space-y-0.5">
            {navItem(<IconSources size={14} />, t('sidebar.sources'), '#/sources', 'sources', `${enabledCount}/${sources.length}`)}
            {navItem(<IconSettings size={14} />, t('sidebar.settings'), '#/settings', 'settings')}
          </div>
        </div>

        {/* Auth status */}
        {authSources.length > 0 && (
          <div>
            <div className="px-3 mb-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-text-secondary/30">
              {t('sidebar.logins')}
            </div>
            <div className="space-y-2 px-3">
              {authSources.map(s => (
                <div key={s.name} className="flex items-center justify-between text-[11px] text-text-secondary/70">
                  <span>{s.name}</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${s.hasCredentials ? 'bg-accent shadow-[0_0_6px_rgba(52,211,153,0.4)]' : 'bg-red-400/50'}`}
                    title={s.hasCredentials ? 'Logged in' : 'Not logged in'}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LLM info */}
        {config && config.llmProvider && (
          <div>
            <div className="px-3 mb-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-text-secondary/30">
              {t('sidebar.aiEngine')}
            </div>
            <div className="px-3">
              <div className="flex items-center gap-2 text-[11px]">
                <IconRadio size={12} className="text-accent/40" />
                <span className="text-text-secondary/70">{config.llmProvider}</span>
                <span className="text-text-secondary/30 font-mono text-[9px]">{config.llmModel}</span>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border/30 text-[9px] text-text-secondary/20 font-mono">
        v{config?.version ?? '0.3.0'}
      </div>
    </aside>
  );
}
