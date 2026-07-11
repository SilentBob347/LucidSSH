/**
 * Страж опасных команд — паттерны (GUARD-01, OQ-05: список ровно по ТЗ).
 * Файл обязан покрываться тестами (CLAUDE.md §10) и меняться только вместе с ними.
 *
 * Страж — средство предупреждения о РАСПОЗНАННЫХ опасных командах, не гарантия
 * блокировки любой разрушительной операции (§15 Security_Guide) — это ограничение
 * отражается в UI-текстах.
 */

export type DangerScope = 'file' | 'directory' | 'disk' | 'other';

export interface DangerMatch {
  /** id паттерна — для i18n-объяснения (guard.patterns.<id>) */
  patternId: string;
  /** Реальная цель из команды (GUARD-03) */
  target: string;
  scope: DangerScope;
  /** 'target' — подтверждение именем объекта, 'word' — общим словом подтверждения. */
  confirmationKind: 'target' | 'word';
  /** Для kind='target' — итоговый текст. Для kind='word' — внутренний плейсхолдер
   *  (CONFIRM_WORD), реальный локализованный текст подставляет guard/manager.ts. */
  confirmationText: string;
}

interface GuardPattern {
  id: string;
  re: RegExp;
  scope: DangerScope | ((m: RegExpMatchArray) => DangerScope);
  /** Извлечение цели из совпадения; null → вся команда */
  target: (m: RegExpMatchArray) => string | null;
}

/** Последний токен строки аргументов (цель команд вида shred/wipefs). */
function lastToken(args: string | undefined): string | null {
  if (!args) return null;
  const tokens = args.trim().split(/\s+/);
  const last = tokens[tokens.length - 1];
  return last && !last.startsWith('-') ? last : null;
}

/** Последний сегмент пути — им подтверждают удаление («www» для /var/www). */
function lastSegment(path: string): string {
  const cleaned = path.replace(/["']/g, '').replace(/\/+$/, '');
  const seg = cleaned.split('/').filter(Boolean).pop();
  return seg ?? cleaned;
}

const CONFIRM_WORD = 'ПОДТВЕРЖДАЮ';

/**
 * Паттерны применяются к каждой команде в составной строке (после разбиения
 * по ; && || |). Порядок важен: первый совпавший выигрывает.
 */
const PATTERNS: GuardPattern[] = [
  {
    // rm с рекурсивным или форсированным флагом: rm -rf X, rm -r X, rm --recursive X
    id: 'rm-recursive',
    re: /(?:^|\s)rm\s+(?=[^\n]*(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive))[^\n]*?\s(?!-)(\S+)\s*$/,
    scope: (m) => (m[1] === '/' || m[1] === '/*' ? 'disk' : 'directory'),
    target: (m) => m[1] ?? null
  },
  {
    // dd с записью в устройство или файл: dd if=... of=/dev/sda
    id: 'dd-write',
    re: /(?:^|\s)dd\s+[^\n]*of=(\S+)/,
    scope: (m) => (m[1]?.startsWith('/dev/') ? 'disk' : 'file'),
    target: (m) => m[1] ?? null
  },
  {
    // mkfs любого вида: mkfs /dev/sdb1, mkfs.ext4 /dev/sda
    id: 'mkfs',
    re: /(?:^|\s)mkfs(?:\.\w+)?\s+(?:-\S+\s+)*(\S+)/,
    scope: 'disk',
    target: (m) => m[1] ?? null
  },
  {
    // chmod -R 777 (полностью открытые права рекурсивно)
    id: 'chmod-777',
    re: /(?:^|\s)chmod\s+(?:-[a-zA-Z]*R[a-zA-Z]*\s+)0?777\s+(\S+)|(?:^|\s)chmod\s+0?777\s+(-[a-zA-Z]*R[a-zA-Z]*)\s+(\S+)/,
    scope: 'directory',
    target: (m) => m[1] ?? m[3] ?? null
  },
  {
    // truncate существующего файла до 0: truncate -s 0 file
    id: 'truncate',
    re: /(?:^|\s)truncate\s+[^\n]*-s\s*0\s+(\S+)/,
    scope: 'file',
    target: (m) => m[1] ?? null
  },
  {
    // Перенаправление в блочное устройство: > /dev/sda, >> /dev/nvme0n1
    id: 'redirect-device',
    re: />+\s*(\/dev\/(?:sd[a-z]\d*|hd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|vd[a-z]\d*|mmcblk\d+(?:p\d+)?))/,
    scope: 'disk',
    target: (m) => m[1] ?? null
  },
  {
    // shred устройства или файла: цель — последний аргумент (флаги могут иметь
    // отдельные значения вроде «-n 3»)
    id: 'shred',
    re: /(?:^|\s)shred\s+(.+)$/,
    scope: (m) => (lastToken(m[1]) ?? '').startsWith('/dev/') ? 'disk' : 'file',
    target: (m) => lastToken(m[1])
  },
  {
    // wipefs — стирание сигнатур ФС
    id: 'wipefs',
    re: /(?:^|\s)wipefs\s+(.+)$/,
    scope: 'disk',
    target: (m) => lastToken(m[1])
  },
  {
    // fork-бомба
    id: 'fork-bomb',
    re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    scope: 'other',
    target: () => null
  },
  {
    // DROP DATABASE / DROP TABLE в командной строке (mysql -e, psql -c)
    id: 'drop-database',
    re: /drop\s+(?:database|table)\s+(?:if\s+exists\s+)?[`"']?(\w+)/i,
    scope: 'other',
    target: (m) => m[1] ?? null
  },
  {
    // kill -9 1 (init) или killall5 — обрушение системы
    id: 'kill-init',
    re: /(?:^|\s)kill\s+-(?:9|KILL)\s+1(?:\s|$)/,
    scope: 'other',
    target: () => null
  }
];

/** Разбиение составной команды на простые (; && || |) без учёта кавычек — консервативно. */
function splitCompound(command: string): string[] {
  return command
    .split(/;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Анализ команды перед отправкой на сервер (GUARD-02).
 * Возвращает первый распознанный опасный фрагмент либо null.
 */
export function analyzeCommand(command: string): DangerMatch | null {
  const trimmed = command.trim();
  if (trimmed.length === 0 || trimmed.length > 10_000) return null;

  // Паттерны, разрушаемые разбиением по |/; (fork-бомба) — проверяем целиком.
  const wholeMatch = matchPatterns(trimmed);
  if (wholeMatch) return wholeMatch;

  for (const part of splitCompound(trimmed)) {
    const match = matchPatterns(part);
    if (match) return match;
  }
  return null;
}

function matchPatterns(part: string): DangerMatch | null {
  // sudo/env-префиксы не должны прятать команду
  const unprefixed = part.replace(/^(?:sudo\s+|env\s+\S+=\S+\s+)+/, '');
  for (const pattern of PATTERNS) {
    const m = unprefixed.match(pattern.re) ?? part.match(pattern.re);
    if (!m) continue;
    const rawTarget = pattern.target(m);
    const scope = typeof pattern.scope === 'function' ? pattern.scope(m) : pattern.scope;
    const target = rawTarget ?? part;
    return {
      patternId: pattern.id,
      target,
      scope,
      confirmationKind: rawTarget ? 'target' : 'word',
      confirmationText: rawTarget ? lastSegment(rawTarget) : CONFIRM_WORD
    };
  }
  return null;
}

export { CONFIRM_WORD };
