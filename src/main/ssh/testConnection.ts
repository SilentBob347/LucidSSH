import { Buffer } from 'node:buffer';
import { Client, type ClientChannel } from 'ssh2';
import type { AuthMethod, HostInput } from '@shared/hosts';
import type { TestConnectionResult } from '@shared/ssh';
import { loadConfig } from '../config/store';
import { loadPrivateKey, PrivateKeyError } from './keys';
import { getHost } from '../hosts/repository';
import { getSecretForConnection } from '../keychain';
import { matchesKnownKey } from './knownHosts';
import { forwardOut } from './forwardOut';

/**
 * Пробное подключение из формы «Новое подключение» (кнопка «Проверить соединение»).
 * Проверяет достижимость сервера и аутентификацию, НЕ создаёт сессию и не
 * передаёт данные — сразу отключается. Ключ в known_hosts не пишется: подтвердить
 * новый отпечаток здесь негде (диалог SSH-03 привязан к сессии), а молча
 * сохранять его нельзя.
 * Секрет живёт только в области видимости этой функции (§9.9 гайда).
 *
 * Для bastion отпечаток при этом СВЕРЯЕТСЯ с known_hosts (§4: проверка на каждом
 * соединении). Иначе кнопка проверки отдавала бы его сохранённый пароль серверу,
 * подлинность которого не подтверждена ничем, — причём пользователь этот bastion
 * в форме даже не редактирует и подмены не заметит. Незнакомый или изменившийся
 * ключ → отказ (`clog.jump.hostkeyUnknown`), подтвердить его нужно один раз
 * обычным подключением к самому bastion. Для целевого хоста проверки нет и здесь:
 * это поведение старше jump-хостов, менять его — отдельная задача.
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

    // Пароль bastion не сохранён — в сессии (sessionManager.ts) это повод
    // спросить его интерактивно в терминале, но здесь терминала нет (тест
    // выполняется прямо из формы, до открытия сессии). Не пытаемся подключиться
    // с пустым паролем — итоговая «Ошибка аутентификации» выглядела бы так же,
    // как неверный пароль, хотя причина другая и чинится иначе (сохранить
    // пароль bastion, открыв его отдельно). Ключ без сохранённого passphrase
    // (undefined тоже) — легитимный случай (незашифрованный ключ), не блокируем.
    if (bastion.authMethod === 'password' && bastionSecret === undefined) {
      return { ok: false, errorKey: 'clog.jump.hostSecretMissing', step: 'jump' };
    }

    const jumpResult = await connectOnce(bastion, {
      secret: bastionSecret,
      requireKnownHostKey: true
    });
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

  const targetResult = await connectOnce(input, { secret, sock });
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

/** Чем один хоп цепочки отличается от другого: свой секрет, транспорт (готовый
 *  канал у целевого хоста, прямой TCP у bastion) и требование сверить отпечаток. */
interface HopOptions {
  secret: string | undefined;
  /** Канал через bastion — для целевого хоста цепочки. */
  sock?: ClientChannel;
  /** Отказать, если ключ сервера не совпал с known_hosts (bastion, см. шапку). */
  requireKnownHostKey?: boolean;
}

/** Один хоп тестового подключения: ready/error/close → результат, без побочных
 *  эффектов на known_hosts. При успехе оставляет `Client` открытым — вызывающая
 *  сторона либо использует его как транспорт для forwardOut (bastion), либо
 *  закрывает (целевой хост, тест окончен). */
function connectOnce(target: ConnectTarget, opts: HopOptions): Promise<ConnectOnceResult> {
  const { secret, sock } = opts;
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

    // Отказ по отпечатку ssh2 сообщает обычной ошибкой соединения — без этого
    // флага он был бы неотличим от «сервер недоступен», и пользователь чинил бы
    // сеть вместо того, чтобы подтвердить ключ bastion.
    let hostKeyRejected = false;

    client.on('ready', () => settle({ ok: true, client }));
    client.on('error', (err: Error & { level?: string }) => {
      if (hostKeyRejected) {
        settle({ ok: false, errorKey: 'clog.jump.hostkeyUnknown' });
        return;
      }
      const category =
        err.level === 'client-authentication'
          ? 'auth'
          : err.level === 'client-timeout'
            ? 'timeout'
            : 'socket';
      settle({ ok: false, errorKey: `clog.error.${category}` });
    });
    client.on('close', () =>
      settle({
        ok: false,
        errorKey: hostKeyRejected ? 'clog.jump.hostkeyUnknown' : 'clog.error.socket'
      })
    );

    const connectConfig: Parameters<Client['connect']>[0] = {
      host: target.address,
      port: target.port,
      username: target.username,
      readyTimeout: cfg.connection.connectTimeoutSec * 1000,
      tryKeyboard: true,
      // ssh2 принимает и синхронный ответ, и колбэк; здесь везде синхронный.
      hostVerifier: opts.requireKnownHostKey
        ? (key: Buffer): boolean => {
            // Подтвердить новый отпечаток здесь негде, поэтому единственный
            // безопасный ответ — пускать только уже известный ключ.
            const ok = matchesKnownKey(target.address, target.port, key);
            if (!ok) hostKeyRejected = true;
            return ok;
          }
        : () => true // целевой хост: поведение старше jump-хостов, см. шапку
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
