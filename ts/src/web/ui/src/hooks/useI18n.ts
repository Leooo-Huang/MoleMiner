import { useContext } from 'react';
import { LocaleContext, type Locale } from '../contexts/LocaleContext.js';
import en from '../locales/en.json';
import zh from '../locales/zh.json';

type Messages = typeof en;

const MESSAGES: Record<Locale, Messages> = { en, zh };

function getByPath(obj: Record<string, unknown>, path: string): string | undefined {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

export function useI18n() {
  const { locale, setLocale } = useContext(LocaleContext);
  const messages = MESSAGES[locale];

  function t(key: string, params?: Record<string, string | number>): string {
    const value = getByPath(messages as unknown as Record<string, unknown>, key);
    if (value === undefined) return key;
    return interpolate(value, params);
  }

  return { t, locale, setLocale };
}
