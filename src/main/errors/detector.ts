import type { ErrorExplanation, ErrorPattern, ErrorScope, FallbackRef } from '@shared/content';

/**
 * Детектор ошибок (ERR-01…06). Матчинг по exit code + тексту stderr/вывода
 * против встроенной базы (офлайн, без LLM в 1.0). Подстановки {original}/{target}
 * в подсказках-командах — БЕЗОПАСНЫ: это текст для показа/вставки, не исполнение.
 *
 * Возвращает найденное объяснение из базы либо fallback-хук (в 1.0 → doc-search;
 * в 1.2 тот же контракт направляется в локальную LLM, §12.13 ТЗ). Контракт не
 * меняется — точка расширения заложена.
 */

export type DetectResult =
  | { matched: true; explanation: ErrorExplanation }
  | { matched: false; fallback: FallbackRef };

/** Извлечь «цель» из команды: последний аргумент, похожий на путь/имя. */
function extractTarget(command: string): string {
  const tokens = command.trim().split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i]!;
    if (!tok.startsWith('-') && tok !== '') return tok;
  }
  return '';
}

function substitute(command: string, original: string, target: string): string {
  return command.replaceAll('{original}', original).replaceAll('{target}', target);
}

/** Обрезка фрагмента stderr для fallback/логов после маскирования секретов. */
function excerpt(text: string, max = 500): string {
  const trimmed = text.replace(/\s+$/g, '').slice(-max);
  return trimmed;
}

/**
 * Компиляция паттерна с поддержкой ведущих инлайн-флагов вида `(?i)` / `(?im)`.
 * JS RegExp такие флаги в теле не понимает — переносим их в аргумент flags.
 */
export function compilePattern(match: string): RegExp | null {
  let source = match;
  let flags = '';
  const inline = /^\(\?([a-z]+)\)/.exec(source);
  if (inline && inline[1]) {
    for (const f of inline[1]) {
      if ('imsuy'.includes(f) && !flags.includes(f)) flags += f;
    }
    source = source.slice(inline[0].length);
  }
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

export function detectError(
  patterns: ErrorPattern[],
  scope: ErrorScope,
  output: string,
  exitCode: number | null,
  command: string
): DetectResult {
  const target = extractTarget(command);

  for (const p of patterns) {
    if (p.scope !== scope) continue;
    const re = compilePattern(p.match);
    if (!re) continue; // повреждённый паттерн не должен ронять детектор
    if (re.test(output)) {
      return {
        matched: true,
        explanation: {
          title: p.title,
          explanation: p.explanation,
          checks: p.checks.map((c) => ({
            text: c.text,
            command: c.command ? substitute(c.command, command, target) : undefined
          })),
          source: 'database'
        }
      };
    }
  }

  // Не распознано — fallback-хук (ERR-06). В 1.0 kind='doc-search'.
  return {
    matched: false,
    fallback: {
      kind: 'doc-search',
      command,
      exitCode: exitCode ?? undefined,
      stderrExcerpt: excerpt(output)
    }
  };
}

/**
 * Пустой stderr при exit code ≠ 0 (ERR-06): осмысленный текст вместо пустой панели.
 */
export function isEmptyOutput(output: string): boolean {
  return output.trim().length === 0;
}
