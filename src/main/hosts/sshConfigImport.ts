import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExternalImportResult, ImportedHost, UnsupportedDirective } from '@shared/import';

/**
 * Импорт из ~/.ssh/config (HM-04). Файл — недоверенные данные (§12 гайда):
 * импортируются только Host/HostName/User/Port/IdentityFile/ProxyJump.
 * Исполняемые директивы (ProxyCommand, LocalCommand, Match exec,
 * KnownHostsCommand) НЕ выполняются — собираются и показываются пользователю.
 */

const EXECUTABLE_DIRECTIVES = new Set([
  'proxycommand',
  'localcommand',
  'permitlocalcommand',
  'knownhostscommand'
]);

/** Потолки для недоверенного файла: реальные ssh_config — единицы КБ. */
const MAX_CONFIG_BYTES = 1_000_000;
const MAX_LINE_LENGTH = 4096;

function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2));
  return path;
}

/** Разбор содержимого ssh_config. Чистая функция — тестируется без ФС. */
export function parseSshConfig(content: string, home: string): ExternalImportResult {
  const hosts: ImportedHost[] = [];
  const unsupported: UnsupportedDirective[] = [];

  interface Block {
    pattern: string;
    hostName?: string;
    user?: string;
    port?: number;
    identityFile?: string;
    proxyJump?: string;
  }
  let block: Block | null = null;

  const flush = (): void => {
    if (!block) return;
    // Пропускаем шаблоны с подстановочными знаками — это не конкретный хост
    if (!block.pattern || /[*?]/.test(block.pattern)) {
      block = null;
      return;
    }
    const address = block.hostName ?? block.pattern;
    hosts.push({
      name: block.pattern,
      address,
      port: block.port ?? 22,
      username: block.user ?? '',
      authMethod: block.identityFile ? 'key' : 'password',
      keyPath: block.identityFile,
      proxyJump: block.proxyJump
    });
    block = null;
  };

  // Одинокий CR тоже разделитель строк; сверхдлинные строки пропускаем.
  for (const raw of content.split(/\r\n|\r|\n/)) {
    if (raw.length > MAX_LINE_LENGTH) {
      // Пропущенная строка могла открывать блок — закрываем текущий, чтобы
      // следующие директивы не прилипли к предыдущему хосту.
      flush();
      continue;
    }
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    // keyword и значение разделяются пробелом или '='; классы не пересекаются —
    // нет суперлинейного бэктрекинга на длинной серии '='
    const m = line.match(/^([^\s=]+)[\s=]+(.*)$/);
    if (!m) continue;
    const keyword = m[1]!.toLowerCase();
    const value = m[2]!.trim().replace(/^["']|["']$/g, '');

    if (keyword === 'host') {
      flush();
      // Берём первый шаблон без wildcard как имя хоста
      const patterns = value.split(/\s+/);
      const concrete = patterns.find((p) => !/[*?]/.test(p)) ?? patterns[0]!;
      block = { pattern: concrete };
      continue;
    }

    if (keyword === 'match') {
      flush();
      // Match exec — исполняемая директива (§12): показать, не выполнять
      if (/^exec\b/i.test(value)) {
        unsupported.push({ host: 'Match', directive: 'Match exec', value: value.replace(/^exec\s+/i, '') });
      }
      block = null; // Match-блоки не импортируем как хост
      continue;
    }

    if (EXECUTABLE_DIRECTIVES.has(keyword)) {
      unsupported.push({ host: block?.pattern ?? '*', directive: m[1]!, value });
      continue;
    }

    if (!block) continue; // директива вне Host-блока — игнорируем

    switch (keyword) {
      case 'hostname':
        block.hostName = value;
        break;
      case 'user':
        block.user = value;
        break;
      case 'port': {
        const p = parseInt(value, 10);
        if (Number.isFinite(p) && p > 0 && p <= 65535) block.port = p;
        break;
      }
      case 'identityfile':
        block.identityFile = expandHome(value, home);
        break;
      case 'proxyjump':
        block.proxyJump = value;
        break;
      default:
        break; // прочие безопасные директивы игнорируем
    }
  }
  flush();

  return { source: 'ssh-config', hosts, unsupported, available: true };
}

/** Прочитать и разобрать файл ssh_config (по умолчанию ~/.ssh/config). */
export async function importSshConfigPreview(filePath?: string): Promise<ExternalImportResult> {
  const home = homedir();
  const path = filePath ?? join(home, '.ssh', 'config');
  try {
    if ((await stat(path)).size > MAX_CONFIG_BYTES) throw new Error('ssh_config too large');
    const content = await readFile(path, 'utf8');
    return parseSshConfig(content, home);
  } catch {
    return { source: 'ssh-config', hosts: [], unsupported: [], available: false };
  }
}
