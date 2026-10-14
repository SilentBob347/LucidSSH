import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerHostKeyAlgorithm } from 'ssh2';
import { configDir } from '../config/store';

/**
 * known_hosts в формате OpenSSH (§8 гайда, SSH-03/04):
 * `host keytype base64key` либо `[host]:port ...` для нестандартного порта.
 * Запись добавляется только после явного подтверждения пользователя.
 * Изменившийся ключ НЕ перезаписывается автоматически.
 */

export interface KnownHostEntry {
  line: number;
  hostPattern: string;
  keyType: string;
  keyBase64: string;
}

function knownHostsPath(): string {
  return join(configDir(), 'known_hosts');
}

function hostToken(address: string, port: number): string {
  return port === 22 ? address : `[${address}]:${port}`;
}

/** Обратное к hostToken: разбирает `[address]:port` либо просто `address` (порт 22). */
export function parseHostToken(token: string): { address: string; port: number } {
  const m = /^\[(.+)]:(\d+)$/.exec(token);
  if (m) return { address: m[1]!, port: Number(m[2]) };
  return { address: token, port: 22 };
}

export function sha256Fingerprint(rawKey: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '');
}

export function parseKnownHosts(content: string): KnownHostEntry[] {
  const entries: KnownHostEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    entries.push({
      line: i + 1,
      hostPattern: parts[0]!,
      keyType: parts[1]!,
      keyBase64: parts[2]!
    });
  }
  return entries;
}

export function listKnownHosts(): KnownHostEntry[] {
  const path = knownHostsPath();
  if (!existsSync(path)) return [];
  try {
    return parseKnownHosts(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

function matchesHost(hostPattern: string, token: string): boolean {
  // hostPattern может содержать несколько host'ов через запятую
  return hostPattern.split(',').some((h) => h === token);
}

/** Все сохранённые ключи host:port, любого типа (ADR-0019: единица доверия —
 *  адрес:порт, а не пара адрес:порт + тип ключа). */
export function findKnownKeys(
  address: string,
  port: number
): { keyType: string; keyBase64: string }[] {
  const token = hostToken(address, port);
  return listKnownHosts()
    .filter((e) => matchesHost(e.hostPattern, token))
    .map((e) => ({ keyType: e.keyType, keyBase64: e.keyBase64 }));
}

/** Тип ключа в known_hosts → алгоритмы подписи ssh2, в порядке его списка по
 *  умолчанию. RSA-ключ хранится как `ssh-rsa`, а согласуется одним из трёх.
 *  Мусорный тип после ручной правки отбрасывается: незнакомое ssh2 имя в
 *  `algorithms` роняет connect(). `ssh-dss` ssh2 знает, но по умолчанию не
 *  предлагает — отброшен намеренно, чтобы предпочтение не включало DSA обратно. */
const HOST_KEY_ALGORITHMS: [keyType: string, algorithms: ServerHostKeyAlgorithm[]][] = [
  ['ssh-ed25519', ['ssh-ed25519']],
  ['ecdsa-sha2-nistp256', ['ecdsa-sha2-nistp256']],
  ['ecdsa-sha2-nistp384', ['ecdsa-sha2-nistp384']],
  ['ecdsa-sha2-nistp521', ['ecdsa-sha2-nistp521']],
  ['ssh-rsa', ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa']]
];

/**
 * Алгоритмы ключа хоста, которые надо предложить серверу первыми: у доверенных
 * ключей хоста. Честный сервер, у которого просто появился новый тип, согласует
 * доверенный и тревоги смены не получает; до смены доходит только сервер, у
 * которого не осталось ни одного доверенного типа (ADR-0019). Пусто — хост
 * неизвестен, ssh2 согласует по своему списку.
 */
export function preferredHostKeyAlgorithms(address: string, port: number): ServerHostKeyAlgorithm[] {
  const stored = new Set(findKnownKeys(address, port).map((k) => k.keyType));
  return HOST_KEY_ALGORITHMS.filter(([keyType]) => stored.has(keyType)).flatMap(([, algorithms]) => algorithms);
}

/** Тип ключа из блоба host key (первое length-prefixed поле). */
export function keyTypeFromBlob(blob: Buffer): string {
  try {
    const len = blob.readUInt32BE(0);
    if (len > 0 && len < 64 && blob.length >= 4 + len) {
      return blob.toString('utf8', 4, 4 + len);
    }
  } catch {
    /* повреждённый блоб — вернём unknown */
  }
  return 'unknown';
}

export function addKnownKey(address: string, port: number, keyType: string, rawKey: Buffer): void {
  mkdirSync(configDir(), { recursive: true });
  const line = `${hostToken(address, port)} ${keyType} ${rawKey.toString('base64')}\n`;
  appendFileSync(knownHostsPath(), line, 'utf8');
}

/** Замена после ЯВНОГО решения пользователя при смене fingerprint (SSH-04):
 *  удаляются ВСЕ ключи host:port, любого типа, — у хоста один доверенный ключ
 *  (ADR-0019). Строка с несколькими host'ами через запятую удаляется целиком. */
export function replaceHostKeys(
  address: string,
  port: number,
  keyType: string,
  rawKey: Buffer
): void {
  const token = hostToken(address, port);
  const path = knownHostsPath();
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  const kept = lines.filter((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) return true;
    return !matchesHost(parts[0]!, token);
  });
  const content = kept.join('\n').replace(/\n+$/, '');
  writeFileSync(path, (content ? content + '\n' : '') , 'utf8');
  addKnownKey(address, port, keyType, rawKey);
}

/** Удаление записи по номеру строки (Настройки → Безопасность, SET-04). */
export function removeKnownHostLine(lineNumber: number): void {
  const path = knownHostsPath();
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  if (lineNumber < 1 || lineNumber > lines.length) return;
  lines.splice(lineNumber - 1, 1);
  const content = lines.join('\n').replace(/\n+$/, '');
  writeFileSync(path, content ? content + '\n' : '', 'utf8');
}
