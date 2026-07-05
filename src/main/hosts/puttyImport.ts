import { execFile } from 'node:child_process';
import type { ExternalImportResult, ImportedHost } from '@shared/import';

/**
 * Импорт сессий PuTTY из реестра (HM-03). Реестр — недоверенные данные (§12
 * гайда): значения только читаются и разбираются, ничего не исполняется.
 * Команда reg.exe статическая, пользовательский ввод не подставляется (§19).
 */

const SESSIONS_KEY = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions';

interface RegSession {
  name: string;
  values: Map<string, string>;
}

/** Разбор вывода `reg query <key> /s` в список сессий с их значениями. */
export function parseRegOutput(stdout: string): RegSession[] {
  const sessions: RegSession[] = [];
  let current: RegSession | null = null;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') continue;
    // Строка-заголовок подраздела начинается с полного пути ключа
    if (/^HKEY_CURRENT_USER\\/i.test(line.trim())) {
      const idx = line.lastIndexOf('\\');
      const encoded = line.slice(idx + 1).trim();
      current = { name: decodeSessionName(encoded), values: new Map() };
      // Пропускаем сам корневой ключ Sessions (без имени сессии)
      if (encoded === 'Sessions') current = null;
      else sessions.push(current);
      continue;
    }
    // Строка значения: "    Name    REG_SZ    value"
    if (current && /^\s+\S/.test(raw)) {
      const m = raw.trim().match(/^(\S+)\s+REG_\w+\s+(.*)$/);
      if (m) current.values.set(m[1]!, m[2]!);
    }
  }
  return sessions;
}

/** Имена сессий в реестре PuTTY URL-кодированы (%XX). */
function decodeSessionName(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function toHost(session: RegSession): ImportedHost | null {
  const v = session.values;
  const protocol = (v.get('Protocol') ?? 'ssh').toLowerCase();
  if (protocol !== 'ssh') return null; // импортируем только SSH-сессии
  const address = (v.get('HostName') ?? '').trim();
  if (!address) return null; // без адреса запись бесполезна
  const portRaw = v.get('PortNumber');
  const port = portRaw ? parseRegDword(portRaw) : 22;
  const username = (v.get('UserName') ?? '').trim();
  const keyPath = (v.get('PublicKeyFile') ?? '').trim();
  return {
    name: session.name,
    address,
    port: port > 0 && port <= 65535 ? port : 22,
    username,
    authMethod: keyPath ? 'key' : 'password',
    keyPath: keyPath || undefined
  };
}

/** REG_DWORD печатается как 0xNN — переводим в число. */
function parseRegDword(raw: string): number {
  const s = raw.trim();
  const n = s.startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);
  return Number.isFinite(n) ? n : 22;
}

export function importPuttyPreview(): Promise<ExternalImportResult> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', SESSIONS_KEY, '/s'],
      { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve({ source: 'putty', hosts: [], unsupported: [], available: false });
          return;
        }
        const hosts = parseRegOutput(stdout)
          .filter((s) => s.name !== 'Default Settings')
          .map(toHost)
          .filter((h): h is ImportedHost => h !== null);
        resolve({ source: 'putty', hosts, unsupported: [], available: true });
      }
    );
  });
}
