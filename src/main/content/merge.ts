import type {
  CatalogCommand,
  CommandCategory,
  CommandFlag,
  CommandsDatabase,
  ErrorCheck,
  ErrorPattern
} from '@shared/content';

/**
 * Слияние ядра контент-баз с переводом (обязательный тест §10).
 * Связь по `id`/`name`; при отсутствии ключа в активном языке — fallback на
 * язык-fallback (ru), затем разумная заглушка. Чистые функции — работают с уже
 * распарсенным JSON, тесты не трогают файловую систему.
 */

// ---- Ошибки ----

interface ErrorCoreEntry {
  id: string;
  match: string;
  category: string;
  scope: ErrorPattern['scope'];
  checks: { command?: string }[];
}
interface ErrorsCore {
  version: string;
  patterns: ErrorCoreEntry[];
}
interface ErrorLocaleEntry {
  title: string;
  explanation: string;
  checks: string[];
}
type ErrorsLocale = Record<string, ErrorLocaleEntry | undefined>;

export function mergeErrors(
  core: ErrorsCore,
  active: ErrorsLocale,
  fallback: ErrorsLocale
): ErrorPattern[] {
  return core.patterns.map((p) => {
    const loc = active[p.id] ?? fallback[p.id];
    const checks: ErrorCheck[] = p.checks.map((c, i) => ({
      text: loc?.checks[i] ?? fallback[p.id]?.checks[i] ?? '',
      command: c.command
    }));
    return {
      id: p.id,
      match: p.match,
      category: p.category,
      scope: p.scope,
      title: loc?.title ?? p.id,
      explanation: loc?.explanation ?? '',
      checks
    };
  });
}

// ---- Команды ----

interface CommandCoreEntry {
  name: string;
  category: CommandCategory;
  dangerous: boolean;
  flags: { flag: string }[];
}
interface CommandsCore {
  version: string;
  categories: CommandCategory[];
  commands: CommandCoreEntry[];
}
interface CommandLocaleEntry {
  summary: string;
  keywords: string[];
  flags: Record<string, string | undefined>;
}
interface CommandsLocale {
  categories: Record<string, string | undefined>;
  commands: Record<string, CommandLocaleEntry | undefined>;
}

export function mergeCommands(
  core: CommandsCore,
  active: CommandsLocale,
  fallback: CommandsLocale
): CommandsDatabase {
  const categoryLabels: Record<string, string> = {};
  for (const cat of core.categories) {
    categoryLabels[cat] = active.categories[cat] ?? fallback.categories[cat] ?? cat;
  }

  const commands: CatalogCommand[] = core.commands.map((c) => {
    const loc = active.commands[c.name] ?? fallback.commands[c.name];
    const fb = fallback.commands[c.name];
    const flags: CommandFlag[] = c.flags.map((f) => ({
      flag: f.flag,
      desc: loc?.flags[f.flag] ?? fb?.flags[f.flag] ?? ''
    }));
    return {
      name: c.name,
      category: c.category,
      summary: loc?.summary ?? c.name,
      keywords: loc?.keywords ?? fb?.keywords ?? [],
      flags,
      dangerous: c.dangerous
    };
  });

  return {
    version: core.version,
    categories: core.categories,
    categoryLabels,
    commands
  };
}
