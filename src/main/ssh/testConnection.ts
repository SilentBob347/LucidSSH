import { Buffer } from 'node:buffer';
import { Client, type ClientChannel } from 'ssh2';
import type { AuthMethod, HostInput } from '@shared/hosts';
import type { TestConnectionResult } from '@shared/ssh';
import { loadConfig } from '../config/store';
import { loadPrivateKey, PrivateKeyError } from './keys';
import { getHost } from '../hosts/repository';
import { getSecretForConnection } from '../keychain';

/**
 * Пробное подключение из формы «Новое подключение» (кнопка «Проверить соединение»).
 * Проверяет достижимость сервера и аутентификацию, НЕ создаёт сессию и не
 * передаёт данные — сразу отключается. Отпечаток не сверяется и не сохраняется
 * (ключ в known_hosts не пишется): это лишь тест доступности/учётных данных.
 * Секрет живёт только в области видимости этой функции (§9.9 гайда).
 *
 * При заданном `proxyJumpHostId` (SSH-05) прогоняет ту же двухэтапную цепочку,
 * что и `sessionManager.ts` (bastion → forwardOut → target), с тем же
 * различением этапа ошибки: провал на bastion возвращается с `step: 'jump'`,
 * чтобы форма могла показать «не удалось подключиться к bastion», а не
 * запутывающее сообщение про целевой хост.
 *
 * `hostId` — id редактируемого хоста (undefined при создании нового), нужен
 * только для проверки self-reference (см. sessionManager.ts —
 * `establishJumpTunnel`, тот же случай: миграция v2 могла резолвнуть старый
 * текстовый `proxy_jump` на имя самого хоста).
 */
export async function testConnection(
  input: HostInput,
  secret: string | undefined,
  hostId?: number
): Promise<TestConnectionResult> {
  let jumpClient: Client | undefined;
  let sock: ClientChannel | undefined;

  if (input.proxyJumpHostId !== undefined) {
    if (input.proxyJumpHostId === hostId) {
      return { ok: false, errorKey: 'clog.jump.selfReference', step: 'jump' };
    }
    const bastion = getHost(input.proxyJumpHostId);
    if (!bastion) {
      return { ok: false, errorKey: 'clog.jump.hostMissing', step: 'jump' };
    }

    let bastionSecret: string | undefined;
    try {
      bastionSecret = (await getSecretForConnection(bastion.id)) ?? undefined;
    } catch {
      bastionSecret = undefined;
    }

    const jumpResult = await connectOnce(bastion, bastionSecret, undefined);
    if (!jumpResult.ok) return { ok: false, errorKey: jumpResult.errorKey, step: 'jump' };
    jumpClient = jumpResult.client;

    try {
      sock = await forwardOut(jumpClient, input.address, input.port);
    } catch {
      // Типичная причина — bastion запрещает проброс (AllowTcpForwarding no)
      // или целевой хост недоступен уже из его сети (см. sessionManager.ts).
      jumpClient.end();
      return { ok: false, errorKey: 'clog.jump.tunnelFailed', step: 'jump' };
    }
  }

  const targetResult = await connectOnce(input, secret, sock);
  jumpClient?.end();
  if (!targetResult.ok) return { ok: false, errorKey: targetResult.errorKey };
  targetResult.client.end();
  return { ok: true };
}

/** Минимум полей, нужных для одной попытки подключения — общий для целевого
 *  хоста (`HostInput`) и bastion (`Host`, у него есть лишние поля, но они
 *  совместимы структурно). */
interface ConnectTarget {
  address: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  keyPath?: string;
}

type ConnectOnceResult = { ok: true; client: Client } | { ok: false; errorKey: string };

/** Один хоп тестового подключения: ready/error/close → результат, без побочных
 *  эффектов на known_hosts. При успехе оставляет `Client` открытым — вызывающая
 *  сторона либо использует его как транспорт для forwardOut (bastion), либо
 *  закрывает (целевой хост, тест окончен). */
function connectOnce(
  target: ConnectTarget,
  secret: string | undefined,
  sock: ClientChannel | undefined
): Promise<ConnectOnceResult> {
  return new Promise((resolve) => {
    let privateKey: Buffer | undefined;
    if (target.authMethod === 'key') {
      try {
        privateKey = loadPrivateKey(target.keyPath ?? '', secret ?? undefined);
      } catch (err) {
        const reason = err instanceof PrivateKeyError ? err.reason : 'unparsable';
        resolve({ ok: false, errorKey: `clog.keyError.${reason}` });
        return;
      }
    }

    const cfg = loadConfig();
    const client = clientFactory() as unknown as Client;
    let settled = false;
    const settle = (r: ConnectOnceResult): void => {
      if (settled) return;
      settled = true;
      // Успех оставляет client открытым — вызывающая сторона либо использует
      // его как транспорт (bastion), либо закрывает сама (target). Провал
      // закрываем здесь: больше некому.
      if (!r.ok) {
        try {
          client.end();
        } catch {
          /* уже закрыт */
        }
      }
      resolve(r);
    };

    // Серверы с keyboard-interactive auth (без password auth) требуют tryKeyboard
    // и обработчик — см. sessionManager.ts.
    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      const answer = target.authMethod === 'password' ? (secret ?? '') : '';
      finish(prompts.map(() => answer));
    });

    client.on('ready', () => settle({ ok: true, client }));
    client.on('error', (err: Error & { level?: string }) => {
      const category =
        err.level === 'client-authentication'
          ? 'auth'
          : err.level === 'client-timeout'
            ? 'timeout'
            : 'socket';
      settle({ ok: false, errorKey: `clog.error.${category}` });
    });
    client.on('close', () => settle({ ok: false, errorKey: 'clog.error.socket' }));

    const connectConfig: Parameters<Client['connect']>[0] = {
      host: target.address,
      port: target.port,
      username: target.username,
      readyTimeout: cfg.connection.connectTimeoutSec * 1000,
      tryKeyboard: true,
      hostVerifier: () => true // тест: сессии нет, ключ не сохраняем
    };
    if (sock) connectConfig.sock = sock;
    if (target.authMethod === 'password') {
      connectConfig.password = secret ?? '';
    } else {
      connectConfig.privateKey = privateKey;
      if (secret) connectConfig.passphrase = secret;
    }

    try {
      client.connect(connectConfig);
    } catch {
      settle({ ok: false, errorKey: 'clog.error.socket' });
    }
  });
}

/** Канал bastion→target через уже установленное соединение с bastion —
 *  идентично sessionManager.ts (адрес источника ssh2 передаёт серверу лишь
 *  как справочный, реального сокета за ним нет). */
function forwardOut(client: Client, address: string, port: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, address, port, (err, channel) => {
      if (err || !channel) reject(err ?? new Error('forwardOut: no channel'));
      else resolve(channel);
    });
  });
}

// ---------------------------------------------------------------------------
// Transport seam — по образцу __setClientFactoryForTest в sessionManager.ts:
// тестам не нужен настоящий SSH-сервер, чтобы проверить обе попытки цепочки
// (bastion + target) по отдельности.
// ---------------------------------------------------------------------------

type ClientEventMap = {
  'keyboard-interactive': (
    name: string,
    instructions: string,
    lang: string,
    prompts: Array<{ prompt: string; echo: boolean }>,
    finish: (answers: string[]) => void
  ) => void;
  ready: () => void;
  error: (err: Error & { level?: string }) => void;
  close: () => void;
};

export interface FakeableTestClient {
  connect(config: Parameters<Client['connect']>[0]): void;
  on<E extends keyof ClientEventMap>(event: E, handler: ClientEventMap[E]): unknown;
  forwardOut: Client['forwardOut'];
  end(): void;
}

let clientFactory: () => FakeableTestClient = () => new Client() as unknown as FakeableTestClient;

/** Тестовый рычаг: подменить фабрику Client фальшивым дублёром или сбросить к
 *  настоящему ssh2.Client. */
export function __setClientFactoryForTest(factory: (() => FakeableTestClient) | null): void {
  clientFactory = factory ?? (() => new Client() as unknown as FakeableTestClient);
}
