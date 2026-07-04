import { app } from 'electron';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import { loadConfig } from '../config/store';

/**
 * i18n main-процесса (CLAUDE.md §5a): сообщения стража/детектора формируются
 * в main, поэтому переводы нужны по обе стороны IPC. Словари — в
 * assets/locales/<lang>/<ns>.json; новый язык = новая папка, без правок кода.
 */

export const FALLBACK_LANGUAGE = 'en';
export const DEFAULT_LANGUAGE = 'ru';

/** Namespace'ы валидируются по формату, а не по фиксированному списку. */
const NS_RE = /^[a-z][a-z0-9-]{0,63}$/;
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

export function isValidNamespace(ns: unknown): ns is string {
  if (typeof ns !== 'string' || !NS_RE.test(ns)) return false;
  // namespace должен существовать хотя бы для fallback-языка
  return (
    existsSync(join(localesDir(), DEFAULT_LANGUAGE, `${ns}.json`)) ||
    existsSync(join(localesDir(), FALLBACK_LANGUAGE, `${ns}.json`))
  );
}

export async function initMainI18n(): Promise<void> {
  const cfg = loadConfig();
  await i18next.use(Backend).init({
    lng: isValidLanguage(cfg.language) ? cfg.language : DEFAULT_LANGUAGE,
    // ru → en; остальные языки при неполном переводе падают на ru (CLAUDE.md §5a)
    fallbackLng: { ru: [FALLBACK_LANGUAGE], default: [DEFAULT_LANGUAGE] },
    ns: ['common'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    backend: {
      loadPath: join(localesDir(), '{{lng}}', '{{ns}}.json')
    }
  });
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options);
}

export async function changeMainLanguage(lng: string): Promise<void> {
  await i18next.changeLanguage(lng);
}
