import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CommandsDatabase, ErrorPattern } from '@shared/content';
import { localesDir } from '../i18n';
import { mergeCommands, mergeErrors } from './merge';

/**
 * Загрузка контент-баз: ядро (assets/*.core.json) + перевод активного языка с
 * fallback на ru (§5a). Версии сверяются с версией приложения косвенно через
 * поле version (OQ-06 — стратегия обновления вне 1.0). Кэш по языку.
 */

const FALLBACK_LANG = 'ru';

function assetsDir(): string {
  return app.isPackaged
    ? join(app.getAppPath(), 'assets')
    : resolve(app.getAppPath(), 'assets');
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const errorsCache = new Map<string, ErrorPattern[]>();
const commandsCache = new Map<string, CommandsDatabase>();

function localeErrors(lang: string): Record<string, unknown> {
  try {
    return readJson(join(localesDir(), lang, 'errors.json'));
  } catch {
    return {};
  }
}

function localeCommands(lang: string): { categories: Record<string, unknown>; commands: Record<string, unknown> } {
  try {
    return readJson(join(localesDir(), lang, 'commands.json'));
  } catch {
    return { categories: {}, commands: {} };
  }
}

export function loadErrorPatterns(lang: string): ErrorPattern[] {
  const cached = errorsCache.get(lang);
  if (cached) return cached;
  // Типы core/locale известны структурно; merge принимает распарсенный JSON
  const core = readJson(join(assetsDir(), 'errors.core.json')) as Parameters<typeof mergeErrors>[0];
  const active = localeErrors(lang) as Parameters<typeof mergeErrors>[1];
  const fallback = localeErrors(FALLBACK_LANG) as Parameters<typeof mergeErrors>[2];
  const merged = mergeErrors(core, active, fallback);
  errorsCache.set(lang, merged);
  return merged;
}

export function loadCommandCatalog(lang: string): CommandsDatabase {
  const cached = commandsCache.get(lang);
  if (cached) return cached;
  const core = readJson(join(assetsDir(), 'commands.core.json')) as Parameters<typeof mergeCommands>[0];
  const active = localeCommands(lang) as Parameters<typeof mergeCommands>[1];
  const fallback = localeCommands(FALLBACK_LANG) as Parameters<typeof mergeCommands>[2];
  const merged = mergeCommands(core, active, fallback);
  commandsCache.set(lang, merged);
  return merged;
}

/** Сброс кэша при смене языка. */
export function clearContentCache(): void {
  errorsCache.clear();
  commandsCache.clear();
}
