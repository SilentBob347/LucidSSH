import { readFileSync, statSync } from 'node:fs';
import { utils } from 'ssh2';

/**
 * Загрузка приватного ключа (SSH-02, §11 гайда):
 * — читается только в main, по оригинальному пути (SEC-02), без копий;
 * — форматы OpenSSH (Ed25519/ECDSA/RSA), PEM и PPK — парсятся ssh2 в памяти;
 * — ошибки не содержат содержимого ключа.
 */

const MAX_KEY_SIZE = 1024 * 1024; // 1 МБ — с запасом для любых реальных ключей

export type KeyLoadError = 'not-found' | 'not-a-file' | 'too-large' | 'unparsable' | 'needs-passphrase';

export class PrivateKeyError extends Error {
  constructor(public readonly reason: KeyLoadError) {
    super(`private key error: ${reason}`); // без пути и содержимого
    this.name = 'PrivateKeyError';
  }
}

export function loadPrivateKey(keyPath: string, passphrase?: string): Buffer {
  let stat;
  try {
    stat = statSync(keyPath);
  } catch {
    throw new PrivateKeyError('not-found');
  }
  if (!stat.isFile()) throw new PrivateKeyError('not-a-file');
  if (stat.size > MAX_KEY_SIZE) throw new PrivateKeyError('too-large');

  const data = readFileSync(keyPath);
  // Валидация формата в памяти (включая PPK); временные файлы не создаются
  const parsed = utils.parseKey(data, passphrase);
  if (parsed instanceof Error) {
    const msg = parsed.message.toLowerCase();
    if (msg.includes('passphrase') || msg.includes('decrypt')) {
      throw new PrivateKeyError('needs-passphrase');
    }
    throw new PrivateKeyError('unparsable');
  }
  return data;
}
