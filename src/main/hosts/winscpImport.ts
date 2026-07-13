import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { ExternalImportResult, ImportedHost } from '@shared/import';
import { parseRegOutput } from './puttyImport';

/**
 * Импорт сессий WinSCP из реестра или WinSCP.ini (HM-10). Оба источника —
 * недоверенные данные (§12 гайда): значения только читаются и разбираются,
 * ничего не исполняется. Пароли WinSCP хранятся в обфусцированном виде —
 * значения Password/PasswordFormat никогда не читаются и не передаются
 * дальше ни в каком виде (TZ.md HM-10: пользователь вводит пароль заново).
 */

const SESSIONS_KEY = 'HKCU\\Software\\Martin Prikryl\\WinSCP 2\\Sessions';

// FSProtocol: 0/1/7 ≈ SFTP/SCP-семейство (импортируем), 2 = FTP, 5 = WebDAV,
// 6 = S3 (не SSH — пропускаем). Поле не документировано официально, точные
// числа — по факту работы WinSCP; при отсутствии поля считаем SFTP (дефолт).
const NON_SSH_PROTOCOLS = new Set(['2', '5', '6']);

function decodeSessionName(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function parseRegDword(raw: string): number {
  const s = raw.trim();
  const n = s.startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);
  return Number.isFinite(n) ? n : 22;
}

function toHost(name: string, values: Map<string, string>): ImportedHost | null {
  const protocol = values.get('FSProtocol');
  if (protocol && NON_SSH_PROTOCOLS.has(protocol.trim())) return null;
  const address = (values.get('HostName') ?? '').trim();
  if (!address) return null;
  const portRaw = values.get('PortNumber');
  const port = portRaw ? parseRegDword(portRaw) : 22;
  const username = (values.get('UserName') ?? '').trim();
  const keyPath = (values.get('PublicKeyFile') ?? '').trim();
  return {
    name,
    address,
    port: port > 0 && port <= 65535 ? port : 22,
    username,
    authMethod: keyPath ? 'key' : 'password',
    keyPath: keyPath || undefined
  };
}

/** Импорт из реестра: HKCU\...\WinSCP 2\Sessions, читается через reg.exe query /s. */
export function importWinScpRegistryPreview(): Promise<ExternalImportResult> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', SESSIONS_KEY, '/s'],
      { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve({ source: 'winscp', hosts: [], unsupported: [], available: false });
          return;
        }
        const hosts = parseRegOutput(stdout)
          .filter((s) => s.name !== 'Default Settings')
          .map((s) => toHost(s.name, s.values))
          .filter((h): h is ImportedHost => h !== null);
        resolve({ source: 'winscp', hosts, unsupported: [], available: true });
      }
    );
  });
}

/** Разбор содержимого WinSCP.ini. Чистая функция — тестируется без ФС. */
export function parseWinScpIni(content: string): ExternalImportResult {
  const hosts: ImportedHost[] = [];
  let sectionName: string | null = null;
  let values = new Map<string, string>();

  const flush = (): void => {
    if (sectionName !== null && sectionName !== 'Default%20Settings') {
      const host = toHost(decodeSessionName(sectionName), values);
      if (host) hosts.push(host);
    }
    sectionName = null;
    values = new Map();
  };

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue;

    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      flush();
      // Сессии живут под "Sessions\<Name>"; прочие секции (Configuration и т.п.) пропускаем
      const m = section[1]!.match(/^Sessions\\(.+)$/);
      sectionName = m ? m[1]! : null;
      continue;
    }

    if (sectionName === null) continue;
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (!kv) continue;
    const key = kv[1]!.trim();
    if (/^password/i.test(key)) continue; // Password/PasswordFormat — никогда не читаем
    values.set(key, kv[2]!.trim());
  }
  flush();

  return { source: 'winscp', hosts, unsupported: [], available: true };
}

/** Прочитать и разобрать файл WinSCP.ini по выбранному пользователем пути. */
export async function importWinScpIniPreview(filePath: string): Promise<ExternalImportResult> {
  try {
    const content = await readFile(filePath, 'utf8');
    return parseWinScpIni(content);
  } catch {
    return { source: 'winscp', hosts: [], unsupported: [], available: false };
  }
}
