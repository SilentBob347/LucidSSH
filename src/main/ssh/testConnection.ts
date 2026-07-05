import { Buffer } from 'node:buffer';
import { Client } from 'ssh2';
import type { HostInput } from '@shared/hosts';
import type { TestConnectionResult } from '@shared/ssh';
import { loadConfig } from '../config/store';
import { loadPrivateKey, PrivateKeyError } from './keys';

/**
 * Пробное подключение из формы «Новое подключение» (кнопка «Проверить соединение»).
 * Проверяет достижимость сервера и аутентификацию, НЕ создаёт сессию и не
 * передаёт данные — сразу отключается. Отпечаток не сверяется и не сохраняется
 * (ключ в known_hosts не пишется): это лишь тест доступности/учётных данных.
 * Секрет живёт только в области видимости этой функции (§9.9 гайда).
 */

export function testConnection(
  input: HostInput,
  secret: string | undefined
): Promise<TestConnectionResult> {
  return new Promise((resolve) => {
    const cfg = loadConfig();

    let privateKey: Buffer | undefined;
    if (input.authMethod === 'key') {
      try {
        privateKey = loadPrivateKey(input.keyPath ?? '', secret ?? undefined);
      } catch (err) {
        const reason = err instanceof PrivateKeyError ? err.reason : 'unparsable';
        resolve({ ok: false, errorKey: `clog.keyError.${reason}` });
        return;
      }
    }

    const client = new Client();
    let settled = false;
    const done = (r: TestConnectionResult): void => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        /* уже закрыт */
      }
      resolve(r);
    };

    client.on('ready', () => done({ ok: true }));
    client.on('error', (err: Error & { level?: string }) => {
      const category =
        err.level === 'client-authentication'
          ? 'auth'
          : err.level === 'client-timeout'
            ? 'timeout'
            : 'socket';
      done({ ok: false, errorKey: `clog.error.${category}` });
    });

    const connectConfig: Parameters<Client['connect']>[0] = {
      host: input.address,
      port: input.port,
      username: input.username,
      readyTimeout: cfg.connection.connectTimeoutSec * 1000,
      tryKeyboard: false,
      hostVerifier: () => true // тест: сессии нет, ключ не сохраняем
    };
    if (input.authMethod === 'password') {
      connectConfig.password = secret ?? '';
    } else {
      connectConfig.privateKey = privateKey;
      if (secret) connectConfig.passphrase = secret;
    }

    try {
      client.connect(connectConfig);
    } catch {
      done({ ok: false, errorKey: 'clog.error.socket' });
    }
  });
}
