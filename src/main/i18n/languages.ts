import { app } from 'electron';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Список поддерживаемых языков и определение языка по локали ОС.
 * Вынесено из index.ts отдельным модулем без зависимости на config/store.ts,
 * чтобы config/defaults.ts мог использовать detectSystemLanguage() без
 * циклического импорта (defaults.ts → i18n/index.ts → config/store.ts → defaults.ts).
 */

export const FALLBACK_LANGUAGE = 'en';
export const DEFAULT_LANGUAGE = 'ru';

const LANG_RE = /^[a-z]{2}(-[A-Za-z]{2,8})?$/;

export function localesDir(): string {
  // dev: <repo>/assets/locales; prod: внутри app.asar (fs-backend читает через asar)
  return app.isPackaged
    ? join(app.getAppPath(), 'assets', 'locales')
    : resolve(app.getAppPath(), 'assets', 'locales');
}

export function listLanguages(): string[] {
  try {
    return readdirSync(localesDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && LANG_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [DEFAULT_LANGUAGE];
  }
}

export function isValidLanguage(lng: unknown): lng is string {
  return typeof lng === 'string' && LANG_RE.test(lng) && listLanguages().includes(lng);
}

/**
 * Язык интерфейса при первом запуске (нет ещё config.json — CLAUDE.md §5a).
 * Берётся основной подтег локали ОС (`ru-RU` → `ru`); если такого языка нет
 * среди поддерживаемых — DEFAULT_LANGUAGE. Ошибки чтения ОС/файловой системы
 * не должны блокировать запуск — тихо откатываемся к DEFAULT_LANGUAGE.
 */
export function detectSystemLanguage(): string {
  try {
    const primary = (app.getLocale().split('-')[0] ?? '').toLowerCase();
    return listLanguages().includes(primary) ? primary : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}
