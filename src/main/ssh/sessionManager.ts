import { randomUUID } from 'node:crypto';
import { Client, type ClientChannel } from 'ssh2';
import type { ConnectionLogEntry, HostKeyPrompt, SessionStatus } from '@shared/ssh';
import { isSignalExitCode } from '@shared/ssh';
import { IPC } from '@shared/ipc';
import type { Host } from '@shared/hosts';
import { getHost } from '../hosts/repository';
import { getSecretForConnection } from '../keychain';
import { loadConfig } from '../config/store';
import { getMainWindow } from '../window/mainWindow';
import { loadPrivateKey, PrivateKeyError } from './keys';
import {
  addKnownKey,
  findKnownKey,
  replaceKnownKey,
  sha256Fingerprint
} from './knownHosts';
import {
  ShellIntegrationSession,
  SETUP_CAP_MS,
  type ShellIntegrationEvent,
  type ShellIntegrationResult,
  type ShellIntegrationTimer,
  type TimerAction
} from './shellIntegrationSession';
import { startDashboard, stopDashboard } from './dashboard';
import { deployPendingKey, hasPendingDeployment } from './keygen';
import { loadErrorPatterns, loadCommandCatalog } from '../content/loader';
import { detectError, excerpt, isEmptyOutput } from '../errors/detector';
import { maskSecrets } from '../secrets/maskers';
import { extractCommandName, findCommandSuggestions } from '../errors/fuzzyMatch';
import { t } from '../i18n';
import type { ErrorExplanation } from '@shared/content';
import type { GuardStatus } from '@shared/history';
import { recordHistory } from '../history/repository';
import { notifyDisconnect, notifyCommandDone } from '../notifications/notifier';

/**
 * SSH-сессии (SSH-01…SSH-07, §9 Security_Guide).
 * Протокол подключения: renderer передаёт только hostId; main достаёт хост из
 * SQLite и секрет из Credential Manager; host key проверяется ДО аутентификации
 * (это гарантирует и протокол SSH, и hostVerifier ssh2); renderer получает
 * только sessionId и статусы. Секрет не кэшируется дольше подключения.
 *
 * Разбор вывода shell-интеграции (breadcrumb, эхо setup-команды, реинжект
 * после su/sudo, детекция запроса пароля) живёт за `ShellIntegrationSession`
 * (см. `.scratch/shell-integration-session/spec.md`) — эта коробка «не имеет
 * рук»: сама не пишет в provод и не заводит настоящих таймеров, только
 * сообщает решения (`ShellIntegrationResult`), которые ниже применяет
 * `applyResult`. Реальные `setTimeout` для её именованных таймеров живут в
 * `ManagedSession.shellTimers`.
 */

interface ManagedSession {
  id: string;
  hostId: number;
  hostName: string;
  client: Client | null;
  shell: ClientChannel | null;
  cols: number;
  rows: number;
  /** Последний размер, реально применённый к PTY через setWindow (issue 11 /
   *  ADR-0005) — отдельно от cols/rows, которые обновляются на каждый запрос
   *  от renderer независимо от того, дошёл ли он до PTY. */
  ptyCols: number;
  ptyRows: number;
  /** Идёт ли сейчас известная fullscreen-интерактивная программа (BRD-05/06) —
   *  зеркалит то же состояние, что renderer отслеживает в TerminalArea.tsx по
   *  событиям interactive-program/breadcrumb, нужно main для гейтинга resize
   *  (ADR-0005). */
  interactiveProgramActive: boolean;
  status: SessionStatus;
  log: ConnectionLogEntry[];
  userClosed: boolean;
  reconnectAttempts: number;
  connectStartedAt: number;
  /** Была ли сессия хоть раз подключена — чтобы уведомлять о потере, не о неудаче (NOTIF-01). */
  everConnected: boolean;
  /** Канал закрылся с распознанной ssh-connection-ошибкой (nologin и т.п.) —
   *  автопереподключение бессмысленно, см. client.on('close', ...). */
  shellUnavailable?: boolean;
  /** Имя пользователя для Quick Connect (HM-11, hostId=0 — нет строки в hosts,
   *  getHost(0) всегда null) — фоллбэк для recordCommand, где обычно берётся из host. */
  quickConnectUsername?: string;
  /** Конвейер разбора вывода текущего shell-канала. Новый экземпляр — на
   *  каждое открытие канала (в т.ч. после переподключения/эскалации), старый
   *  выбрасывается; отдельного reset() нет — чистое состояние гарантирует
   *  конструктор (см. ShellIntegrationSession). */
  shellIntegration: ShellIntegrationSession | null;
  /** Реальные таймеры именованных запросов коробки (см. applyTimerActions).
   *  Живёт бок о бок с shellIntegration — оба создаются заново в openShell,
   *  этого достаточно вместо ручного списка полей для сброса. */
  shellTimers: Partial<Record<ShellIntegrationTimer, NodeJS.Timeout>>;
}

interface PendingHostKey {
  sessionId: string;
  /** Адрес/порт сервера, к которому относится этот ключ — берутся из `host`,
   *  переданного в handleHostKey, а не из getHost(session.hostId): для Quick
   *  Connect (HM-11) hostId=0 и getHost(0) всегда null (SSH-03/04-регресс,
   *  см. .scratch/quickconnect-hostkey-confirm-bug/spec.md). */
  address: string;
  port: number;
  verify: (valid: boolean) => void;
  keyType: string;
  rawKey: Buffer;
  isChanged: boolean;
  timeout: NodeJS.Timeout;
}

interface PendingAuthPrompt {
  sessionId: string;
  resolve: (answers: string[]) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

const sessions = new Map<string, ManagedSession>();
const pendingHostKeys = new Map<string, PendingHostKey>();
const pendingAuthPrompts = new Map<string, PendingAuthPrompt>();

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2500;
const HOSTKEY_DECISION_TIMEOUT_MS = 5 * 60 * 1000;
const AUTH_PROMPT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_PASSPHRASE_ATTEMPTS = 3;
const MAX_PASSWORD_ATTEMPTS = 3;

function send(channel: string, ...args: unknown[]): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function setStatus(s: ManagedSession, status: SessionStatus): void {
  s.status = status;
  send(IPC.evSessionStatus, s.id, status);
}

function log(
  s: ManagedSession,
  level: ConnectionLogEntry['level'],
  messageKey: string,
  params?: Record<string, string | number>,
  step?: ConnectionLogEntry['step']
): void {
  const entry: ConnectionLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    messageKey,
    params,
    step
  };
  s.log.push(entry);
  if (s.log.length > 500) s.log.shift();
  send(IPC.evConnectionLog, s.id, entry);
}

/** Тип ключа из блоба host key (первое length-prefixed поле). */
function keyTypeFromBlob(blob: Buffer): string {
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

export function getSession(sessionId: string): ManagedSession | undefined {
  return sessions.get(sessionId);
}

export function getSessionLog(sessionId: string): ConnectionLogEntry[] {
  return sessions.get(sessionId)?.log ?? [];
}

export function listSessions(): Array<{
  sessionId: string;
  hostId: number;
  hostName: string;
  status: SessionStatus;
  busyCommand: string | null;
}> {
  return [...sessions.values()].map((s) => ({
    sessionId: s.id,
    hostId: s.hostId,
    hostName: s.hostName,
    status: s.status,
    busyCommand: s.shellIntegration?.runningCommand() ?? null
  }));
}

/** Сессии, которые сейчас выполняют команду — хост+команда (WIN-04), для
 *  расширенного текста в диалоге закрытия окна (несколько вкладок сразу, где
 *  renderer заранее не имеет списка сессий — только count, см. mainWindow.ts). */
export function busySessions(): Array<{ hostName: string; command: string }> {
  return [...sessions.values()].flatMap((s) => {
    const command = s.shellIntegration?.runningCommand() ?? null;
    return command === null ? [] : [{ hostName: s.hostName, command }];
  });
}

export async function connectHost(hostId: number): Promise<{ sessionId: string }> {
  const host = getHost(hostId);
  if (!host) throw new Error('host not found');

  const session: ManagedSession = {
    id: randomUUID(),
    hostId,
    hostName: host.name,
    client: null,
    shell: null,
    cols: 80,
    rows: 24,
    ptyCols: 80,
    ptyRows: 24,
    interactiveProgramActive: false,
    status: 'connecting',
    log: [],
    userClosed: false,
    reconnectAttempts: 0,
    connectStartedAt: Date.now(),
    everConnected: false,
    shellIntegration: null,
    shellTimers: {}
  };
  sessions.set(session.id, session);
  setStatus(session, 'connecting');

  void establish(session, host);
  return { sessionId: session.id };
}

/**
 * Quick Connect (HM-11): подключение по `user@host[:port]` без записи в hosts.
 * `id: 0` — безопасный sentinel (SQLite AUTOINCREMENT начинается с 1, getHost(0)
 * всегда null), только пароль (без сохранённого секрета — establish() уже умеет
 * спрашивать пароль интерактивно, когда getSecretForConnection() ничего не находит).
 */
export async function connectQuickHost(
  address: string,
  port: number,
  username: string
): Promise<{ sessionId: string }> {
  const host: Host = {
    id: 0,
    name: `${username}@${address}`,
    address,
    port,
    username,
    authMethod: 'password',
    guardEnabled: true,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const session: ManagedSession = {
    id: randomUUID(),
    hostId: 0,
    hostName: host.name,
    client: null,
    shell: null,
    cols: 80,
    rows: 24,
    ptyCols: 80,
    ptyRows: 24,
    interactiveProgramActive: false,
    status: 'connecting',
    log: [],
    userClosed: false,
    reconnectAttempts: 0,
    connectStartedAt: Date.now(),
    everConnected: false,
    shellIntegration: null,
    shellTimers: {},
    quickConnectUsername: username
  };
  sessions.set(session.id, session);
  setStatus(session, 'connecting');

  void establish(session, host);
  return { sessionId: session.id };
}

/**
 * Один заход на подключение: создаёт Client, вешает все обработчики, зовёт
 * connect(). Возвращает 'ready' при успехе (openShell уже вызван внутри),
 * 'auth-failed' — сервер отклонил аутентификацию ДО открытия сессии и
 * разрешён повторный запрос пароля (allowAuthRetry), 'other' — прочие случаи
 * (уже залогированы, и session переведена в disconnected через
 * finishDisconnected — вызывающему дальше ничего делать не нужно).
 *
 * Тестовый рычаг (Часть 2 спеки): реальный `Client` создаётся через
 * подменяемую фабрику `clientFactory` — см. `__setClientFactoryForTest` и
 * `attemptConnectForTest` внизу файла.
 */
function attemptConnect(
  session: ManagedSession,
  host: Host,
  password: string | undefined,
  privateKey: Buffer | undefined,
  keyPassphrase: string | undefined,
  allowAuthRetry: boolean
): Promise<'ready' | 'auth-failed' | 'other'> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: 'ready' | 'auth-failed' | 'other'): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const cfg = loadConfig();
    // Тестовый дублёр реализует только узкий FakeableClient — приводим к
    // Client один раз здесь, на границе seam'а (см. FakeableClient внизу
    // файла); дальше по функции и в openShell/dashboard.ts используется
    // обычный тип Client, ничего о подмене не зная.
    const client = clientFactory() as unknown as Client;
    session.client = client;

    client.on('greeting', (greeting: string) => {
      // Баннер сервера — недоверенный текст; в лог кладём только факт
      void greeting;
      log(session, 'info', 'clog.greeting', undefined, 'tcp');
    });

    client.on('handshake', (negotiated) => {
      log(
        session,
        'info',
        'clog.handshake',
        {
          kex: negotiated?.kex ?? '?',
          cipher: negotiated?.cs?.cipher ?? '?',
          mac: negotiated?.cs?.mac ?? '',
          ms: Date.now() - session.connectStartedAt
        },
        'handshake'
      );
    });

    // Некоторые серверы не предлагают password auth, только keyboard-interactive
    // (виден как "Keyboard-interactive authentication prompts from server" в
    // PuTTY-логах). ssh2 не пробует его без tryKeyboard: true и обработчика —
    // отвечаем тем же паролем, что и в connectConfig, это не альтернатива
    // password auth, а его серверный вариант (SSH-06).
    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      const answer = password ?? '';
      finish(prompts.map(() => answer));
    });

    client.on('ready', () => {
      session.reconnectAttempts = 0;
      log(
        session,
        'info',
        'clog.ready',
        {
          method: password !== undefined ? 'password' : host.authMethod,
          ms: Date.now() - session.connectStartedAt
        },
        'auth'
      );
      // HM-12 шаг 4: успешный пароль-логин — момент автоматической дозаписи
      // ожидающего публичного ключа в authorized_keys (дедупликация внутри;
      // no-op, если для этого keyPath ничего не ждёт). Помимо тихой записи в
      // «Детали подключения», результат печатается прямо в терминал — в этот
      // момент пользователь и так смотрит именно туда (только что вводил
      // пароль), а лог подключения открывают редко.
      if (password !== undefined && host.keyPath) {
        void deployPendingKey(client, host.keyPath, (level, key) => {
          log(session, level, key, undefined, 'session');
          send(IPC.evTerminalData, session.id, `\r\n${t(key)}\r\n`);
        });
      }
      openShell(session, client);
      settle('ready');
    });

    let authFailed = false;
    client.on('error', (err: Error & { level?: string }) => {
      const category =
        err.level === 'client-authentication'
          ? 'auth'
          : err.level === 'client-timeout'
            ? 'timeout'
            : 'socket';
      if (category === 'auth') authFailed = true;
      // Текст ошибки ssh2 не содержит секретов, но для надёжности не пробрасываем его
      log(
        session,
        'error',
        `clog.error.${category}`,
        undefined,
        category === 'auth' ? 'auth' : 'tcp'
      );
    });

    client.on('close', () => {
      if (settled) {
        // Сессия уже была открыта раньше — обычное последующее отключение,
        // штатная логика автопереподключения (не связана с retry паролем).
        if (session.userClosed || session.shellUnavailable) {
          finishDisconnected(session);
          return;
        }
        // HM-11: Quick Connect (hostId=0) не переподключается автоматически —
        // хост нигде не сохранён, getHost(0) всегда null, реконнектить нечем.
        if (session.hostId !== 0 && session.status === 'connected' && loadConfig().connection.autoreconnect) {
          scheduleReconnect(session);
          return;
        }
        if (session.hostId !== 0 && session.status === 'reconnecting') {
          scheduleReconnect(session);
          return;
        }
        finishDisconnected(session);
        return;
      }
      // Закрытие ДО 'ready' — эта попытка подключения провалилась.
      if (authFailed && allowAuthRetry) {
        settle('auth-failed');
        return;
      }
      finishDisconnected(session);
      settle('other');
    });

    const connectConfig: Parameters<Client['connect']>[0] = {
      host: host.address,
      port: host.port,
      username: host.username,
      // readyTimeout охватывает весь путь до 'ready', включая ожидание решения
      // пользователя по fingerprint в hostVerifier. Добавляем окно решения, иначе
      // долгое подтверждение отпечатка ложно роняет соединение по таймауту.
      // Недоступность сервера ловится раньше ОС-ошибками сокета (refused/unreachable).
      readyTimeout: cfg.connection.connectTimeoutSec * 1000 + HOSTKEY_DECISION_TIMEOUT_MS,
      keepaliveInterval: cfg.connection.keepaliveIntervalSec * 1000,
      keepaliveCountMax: 3,
      tryKeyboard: true,
      hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
        handleHostKey(session, host, key, verify);
      }
    };

    // Выбор по переданным кредам, а не по host.authMethod: для key-хоста с
    // ожидающим дозаписи ключом (HM-12) первый вход идёт по паролю.
    if (password !== undefined) {
      if (password) connectConfig.password = password;
    } else {
      connectConfig.privateKey = privateKey;
      if (keyPassphrase) connectConfig.passphrase = keyPassphrase;
    }

    // Секрет живёт только в локальной области видимости этой функции и в
    // конфиге ssh2 на время подключения — нигде не кэшируется (§9.9 гайда).
    try {
      client.connect(connectConfig);
    } catch {
      log(session, 'error', 'clog.error.socket', undefined, 'tcp');
      finishDisconnected(session);
      settle('other');
    }
  });
}

/** Тестовый алиас без изменения сигнатуры (Часть 2 спеки, по образцу
 *  `parseMetricsForTest` в dashboard.ts) — тесты зовут машину состояний
 *  подключения напрямую, минуя establish()/hosts/repository.ts/keychain. */
export const attemptConnectForTest = attemptConnect;

async function establish(session: ManagedSession, host: Host): Promise<void> {
  session.connectStartedAt = Date.now();
  log(session, 'info', 'clog.tcpConnecting', { address: host.address, port: host.port }, 'tcp');

  // Секрет достаётся из Credential Manager непосредственно перед подключением
  // и не сохраняется в объекте сессии (§9.9 гайда).
  let secret: string | null;
  try {
    secret = await getSecretForConnection(host.id);
  } catch {
    secret = null;
  }

  // Passphrase ключа: если не сохранён/неверен, запрашиваем интерактивно в
  // терминале (как PuTTY/консольный ssh), с ограниченным числом попыток —
  // ключ расшифровывается локально, до всякого обращения к серверу (SSH-06).
  let privateKey: Buffer | undefined;
  let keyPassphrase = secret ?? undefined;
  if (host.authMethod === 'key') {
    // HM-12 шаг 4: свежесгенерированный мастером ключ ещё не на сервере —
    // первый вход выполняется по паролю (интерактивный запрос в терминале);
    // на 'ready' ключ дозапишется в authorized_keys, и следующие подключения
    // пойдут уже по ключу. Если пользователь не ответил на запрос пароля,
    // пробуем обычный вход по ключу (вдруг ключ добавлен вручную).
    if (host.keyPath && hasPendingDeployment(host.keyPath)) {
      if ((await passwordLoginLoop(session, host)) === 'settled') return;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        privateKey = loadPrivateKey(host.keyPath ?? '', keyPassphrase);
        break;
      } catch (err) {
        const reason = err instanceof PrivateKeyError ? err.reason : 'unparsable';
        if (reason !== 'needs-passphrase' || attempt >= MAX_PASSPHRASE_ATTEMPTS) {
          log(session, 'error', `clog.keyError.${reason}`, undefined, 'auth');
          finishDisconnected(session);
          return;
        }
        try {
          const promptKey = attempt === 0 ? 'sshAuth.passphrasePrompt' : 'sshAuth.passphrasePromptRetry';
          const [answer] = await requestAuthPrompt(
            session,
            [{ text: t(promptKey), echo: false }],
            attempt > 0
          );
          keyPassphrase = answer;
        } catch {
          log(session, 'error', 'clog.keyError.needs-passphrase', undefined, 'auth');
          finishDisconnected(session);
          return;
        }
      }
    }
    await attemptConnect(session, host, undefined, privateKey, keyPassphrase, false);
    return;
  }

  // Пароль не сохранён: спрашиваем ДО подключения (pre-flight, как и
  // passphrase выше) — это гарантирует connectConfig.password не пустым,
  // что нужно для серверов, не предлагающих keyboard-interactive (частый
  // случай на дефолтных настройках sshd, SSH-06).
  if (!secret) {
    if ((await passwordLoginLoop(session, host)) === 'cancelled') finishDisconnected(session);
    return;
  }

  await attemptConnect(session, host, secret, privateKey, keyPassphrase, false);
}

/**
 * Интерактивный вход по паролю (SSH-06): запрашивает пароль в терминале и
 * подключается, при отказе сервера пересоздаёт попытку с новым Client и
 * переспрашивает (до MAX_PASSWORD_ATTEMPTS). 'settled' — попытки завершены
 * (успех или окончательная неудача уже обработаны внутри attemptConnect),
 * 'cancelled' — пользователь не ответил на запрос пароля; что делать с
 * сессией дальше, решает вызывающая сторона.
 */
async function passwordLoginLoop(
  session: ManagedSession,
  host: Host
): Promise<'settled' | 'cancelled'> {
  for (let attempt = 0; ; attempt++) {
    let password: string;
    try {
      const promptKey = attempt === 0 ? 'sshAuth.passwordPrompt' : 'sshAuth.passwordPromptRetry';
      const [answer] = await requestAuthPrompt(
        session,
        [{ text: t(promptKey, { username: host.username, address: host.address }), echo: false }],
        attempt > 0
      );
      password = answer ?? '';
    } catch {
      return 'cancelled';
    }
    const allowRetry = attempt < MAX_PASSWORD_ATTEMPTS - 1;
    const result = await attemptConnect(session, host, password, undefined, undefined, allowRetry);
    if (result !== 'auth-failed') return 'settled'; // 'ready'/'other' — уже обработано внутри
  }
}

function handleHostKey(
  session: ManagedSession,
  host: Host,
  rawKey: Buffer,
  verify: (valid: boolean) => void
): void {
  const keyType = keyTypeFromBlob(rawKey);
  const fingerprint = sha256Fingerprint(rawKey);
  log(session, 'info', 'clog.hostkeyReceived', { keyType, fingerprint }, 'hostkey');

  const known = findKnownKey(host.address, host.port, keyType);

  if (known && known.keyBase64 === rawKey.toString('base64')) {
    log(session, 'info', 'clog.hostkeyKnown', undefined, 'hostkey');
    verify(true);
    return;
  }

  const isChanged = known !== null;
  const requestId = randomUUID();
  const timeout = setTimeout(() => {
    const pending = pendingHostKeys.get(requestId);
    if (pending) {
      pendingHostKeys.delete(requestId);
      log(session, 'warn', 'clog.hostkeyTimeout', undefined, 'hostkey');
      pending.verify(false);
    }
  }, HOSTKEY_DECISION_TIMEOUT_MS);

  pendingHostKeys.set(requestId, {
    sessionId: session.id,
    address: host.address,
    port: host.port,
    verify,
    keyType,
    rawKey,
    isChanged,
    timeout
  });

  log(session, isChanged ? 'warn' : 'info', isChanged ? 'clog.hostkeyChanged' : 'clog.hostkeyNew', undefined, 'hostkey');

  const prompt: HostKeyPrompt = {
    requestId,
    hostId: host.id,
    hostName: host.name,
    address: host.address,
    port: host.port,
    fingerprintSha256: fingerprint,
    isChanged,
    previousFingerprint: known
      ? sha256Fingerprint(Buffer.from(known.keyBase64, 'base64'))
      : undefined
  };
  send(IPC.evHostKeyPrompt, prompt);
}

/**
 * Открытие интерактивного shell-канала после успешной аутентификации (TERM-01).
 * Вывод сервера — недоверенные данные: пересылается в renderer как строка и
 * вставляется в xterm через write(), не innerHTML (TERM-07, §13 гайда).
 */
function openShell(session: ManagedSession, client: Client): void {
  client.shell(
    { term: 'xterm-256color', cols: session.cols, rows: session.rows },
    (err, stream) => {
      if (err) {
        log(session, 'error', 'clog.shellError', undefined, 'session');
        setStatus(session, 'connected'); // канал не открылся, но соединение есть
        return;
      }
      session.shell = stream;
      // PTY уже открыт с session.cols/rows (см. client.shell(...) выше) —
      // синхронизируем ptyCols/ptyRows, чтобы resizeSession/forceResize
      // сравнивали с фактически применённым размером, а не с 80×24 по
      // умолчанию (ADR-0005).
      session.ptyCols = session.cols;
      session.ptyRows = session.rows;
      session.everConnected = true;
      // Новый shell (в т.ч. после переподключения) — свежий конвейер разбора и
      // пустой реестр таймеров сами по себе заменяют ручной список сброса
      // прежних гейтов/полей (setupSent, commandGate.reset(), disarmReinject, …).
      clearAllShellTimers(session);
      session.shellIntegration = new ShellIntegrationSession();
      setStatus(session, 'connected');
      log(session, 'info', 'clog.shellOpen', undefined, 'session');

      // Вывод сервера проходит через ShellIntegrationSession: APC-маркеры
      // вырезаются (в xterm не попадают), из них формируется breadcrumb
      // (BRD-04) и отслеживается exit code для детектора ошибок (ERR-01).
      stream.on('data', (data: Buffer) => {
        const box = session.shellIntegration;
        if (!box) return;
        applyResult(session, box.feed(data.toString('utf8')));
      });
      stream.stderr?.on('data', (data: Buffer) => {
        send(IPC.evTerminalData, session.id, data.toString('utf8'));
      });
      stream.on('close', () => {
        clearAllShellTimers(session);
        const box = session.shellIntegration;
        session.shell = null;
        stopDashboard(session.id);
        if (box) applyResult(session, box.close());
      });

      // Кап на случай сервера без MOTD/приглашения: настройка уйдёт даже
      // если данных от сервера не было и silence-таймер не взводился. Это
      // единственный таймер, который коробка не может попросить сама —
      // её интерфейс не включает «канал открылся».
      applyTimerActions(session, [{ timer: 'setup-cap', action: 'schedule', ms: SETUP_CAP_MS }]);

      // Мини-дашборд: отдельный exec-канал, интервал 10 с (DASH-02).
      // Логгер — причина недоступности метрик попадает в «Детали подключения» (DASH-05).
      startDashboard(session.id, client, session.hostId, (messageKey, params) =>
        log(session, 'warn', messageKey, params, 'session')
      );
    }
  );
}

/** Применяет решение ShellIntegrationSession: пишет в provод, показывает
 *  текст в терминале, (пере)заводит/отменяет таймеры, разбирает события —
 *  единственное место, где коробка встречается с реальным IO. */
function applyResult(session: ManagedSession, result: ShellIntegrationResult): void {
  if (result.toWrite) session.shell?.write(result.toWrite);
  if (result.display) send(IPC.evTerminalData, session.id, result.display);
  applyTimerActions(session, result.timerActions);
  for (const event of result.events) {
    handleShellIntegrationEvent(session, event);
  }
}

function clearShellTimer(session: ManagedSession, timer: ShellIntegrationTimer): void {
  const handle = session.shellTimers[timer];
  if (handle) {
    clearTimeout(handle);
    delete session.shellTimers[timer];
  }
}

function clearAllShellTimers(session: ManagedSession): void {
  for (const timer of Object.keys(session.shellTimers) as ShellIntegrationTimer[]) {
    clearShellTimer(session, timer);
  }
}

/** Заводит/отменяет именованные таймеры коробки — она сама «рук не имеет»
 *  (см. shellIntegrationSession.ts). По истечении таймер зовёт box.tick(). */
function applyTimerActions(session: ManagedSession, actions: TimerAction[]): void {
  for (const action of actions) {
    clearShellTimer(session, action.timer);
    if (action.action !== 'schedule') continue;
    session.shellTimers[action.timer] = setTimeout(() => {
      delete session.shellTimers[action.timer];
      const box = session.shellIntegration;
      if (!box) return;
      applyResult(session, box.tick(action.timer));
    }, action.ms);
  }
}

function handleShellIntegrationEvent(session: ManagedSession, event: ShellIntegrationEvent): void {
  switch (event.kind) {
    case 'breadcrumb':
      // breadcrumb приходит на каждое приглашение, в т.ч. на marker-перерисовку
      // без Enter (SIGWINCH-эффект, см. shellIntegrationSession.test.ts) — во
      // время реальной fullscreen-программы (vim/htop/...) этот маркер не
      // приходит вовсе, так что сброс здесь корректно ловит именно выход из
      // программы (ADR-0005), а не путает её с обычным промптом.
      session.interactiveProgramActive = false;
      send(IPC.evBreadcrumb, session.id, event.crumb);
      break;
    case 'command-finished':
      handleCommandFinished(session, event);
      break;
    case 'password-prompt':
      send(IPC.evPasswordPrompt, session.id);
      break;
    case 'unmarked-output':
      checkShellUnavailable(session, event.output);
      break;
    case 'integration-unconfirmed':
      send(IPC.evIntegrationUnconfirmed, session.id);
      break;
    case 'interactive-program':
      session.interactiveProgramActive = true;
      // Досылаем ранее пропущенный (только-rows) resize (ADR-0005): если
      // ErrorDetector/HintBar были открыты до запуска программы, PTY мог
      // остаться на устаревшем rows — fullscreen-программе нужен точный
      // размер сразу при старте, иначе она отрисуется некорректно.
      if (session.cols !== session.ptyCols || session.rows !== session.ptyRows) {
        applyRealResize(session, session.cols, session.rows);
      }
      send(IPC.evInteractiveProgram, session.id, event.program);
      break;
  }
}

/**
 * Некоторые серверы аутентифицируют успешно, но не могут открыть интерактивную
 * сессию (login shell = nologin и т.п.) — канал сразу закрывается, ssh2 не
 * эмитит 'error' (это не ошибка аутентификации). Наш маркер breadcrumb в таком
 * случае никогда не приходит, поэтому обычный путь детектора (по exit code
 * команды) не срабатывает. Текст, который сервер успел прислать перед
 * закрытием канала (событие `unmarked-output` от ShellIntegrationSession.close()),
 * сверяется с базой паттернов scope 'ssh-connection'; совпадение показывается
 * как отдельное объяснение, а сессия помечается, чтобы client.on('close', ...)
 * не пытался переподключиться — повтор бесполезен.
 */
function checkShellUnavailable(session: ManagedSession, output: string): void {
  const patterns = loadErrorPatterns(loadConfig().language);
  const result = detectError(patterns, 'ssh-connection', output, null, '');
  if (result.matched) {
    session.shellUnavailable = true;
    send(IPC.evError, session.id, result.explanation);
  }
}

/**
 * Обработка события «команда завершилась» от ShellIntegrationSession. Пустая
 * `command` — прямой ввод в xterm (main не знает его текста, история его не
 * пишет, см. HIST-01). При exit code ≠ 0 и включённой панели детектора
 * (SET-05) — матч по базе.
 */
function handleCommandFinished(
  session: ManagedSession,
  event: Extract<ShellIntegrationEvent, { kind: 'command-finished' }>
): void {
  const { command, exitCode, output, guardStatus, typed, durationMs } = event;

  // Запись в историю выполненной команды из композера (HIST-01). Прямой ввод в
  // xterm не записывается — его текст main не знает. Маскирование секретов — в
  // recordHistory (HIST-07).
  if (command) {
    recordCommand(session, command, exitCode, guardStatus, output);
    // NOTIF-02: тост о долгой/упавшей команде, если окно не в фокусе
    notifyCommandDone(session.hostName, exitCode, durationMs);
  }

  if (exitCode === null || exitCode === 0) return;
  // Прервано сигналом (напр. Ctrl+C во время `tail -f`/`journalctl -f`) — это
  // намеренное действие пользователя, а не ошибка команды.
  if (isSignalExitCode(exitCode)) return;
  // Пустой Enter: команды не было, $? унаследован от предыдущей — не детектор.
  if (!typed && !command) return;
  if (!loadConfig().ui.hints.errorPanel) return; // отключено в «Интерфейсе»

  const patterns = loadErrorPatterns(loadConfig().language);
  const result = detectError(patterns, 'command', output, exitCode, command);

  let explanation: ErrorExplanation;
  if (result.matched) {
    explanation = result.explanation;
    // ERR-07: для command-not-found ищем похожие имена в каталоге команд
    // (расстояние Левенштейна ≤ 2). Формулировка «возможно» — это догадка, не факт.
    if (explanation.id === 'command-not-found') {
      const catalog = loadCommandCatalog(loadConfig().language);
      const suggestions = findCommandSuggestions(
        extractCommandName(command),
        catalog.commands.map((c) => c.name)
      );
      if (suggestions.length > 0) explanation.suggestions = suggestions;
    }
  } else {
    // Fallback-шаблон (ERR-06): пустой stderr → осмысленный текст
    const explainKey = isEmptyOutput(output) ? 'errDetector.emptyOutput' : 'errDetector.fallbackExplain';
    explanation = {
      title: t('errDetector.fallbackTitle'),
      explanation: t(explainKey, { code: exitCode }),
      checks: [],
      source: 'fallback',
      command: maskSecrets(command).masked,
      exitCode,
      stderr: maskSecrets(excerpt(output)).masked
    };
  }
  send(IPC.evError, session.id, explanation);
}

/** Запись команды в историю с учётом отключения истории (HIST-07). */
function recordCommand(
  session: ManagedSession,
  command: string,
  exitCode: number | null | undefined,
  guardStatus?: GuardStatus,
  output?: string
): void {
  const cfg = loadConfig();
  if (!cfg.history.enabled) return;
  if (cfg.history.perHostDisabled.includes(session.hostId)) return;
  const host = getHost(session.hostId);
  recordHistory({
    command,
    hostId: session.hostId,
    hostName: session.hostName,
    username: host?.username ?? session.quickConnectUsername ?? '',
    exitCode: exitCode ?? undefined,
    guardStatus,
    output
  });
  // HistoryDrawer, если уже открыт, не перечитывает список сам по себе —
  // нужен явный сигнал (тот же баг чинили для сниппетов, snippetsRevision).
  send(IPC.evHistoryRecorded);
}

/** Прямая запись в историю (заблокированная стражем команда, HIST-05). */
export function recordBlockedCommand(sessionId: string, command: string): void {
  const session = sessions.get(sessionId);
  if (session) recordCommand(session, command, undefined, 'blocked');
}

/** Отправка ввода пользователя в сессию — сырая, без Стража; вызывающая
 *  сторона (guard/manager.ts или XtermView при «не на промпте») сама решает,
 *  когда это уместно (см. GUARD-02/04). */
export function sendInput(sessionId: string, data: string): void {
  const session = sessions.get(sessionId);
  if (!session?.shellIntegration) return;
  applyResult(session, session.shellIntegration.sendRawInput(data));
}

/**
 * Отправка ОДОБРЕННОЙ стражем команды (submitCommand/confirmDangerousCommand,
 * GUARD-02). В отличие от sendInput, дополнительно вырезает из вывода сервера
 * эхо именно этой команды — терминал уже показал её локально во время набора
 * (буфер строки на промпте в XtermView), без подавления команда дублировалась
 * бы на экране (набор + отдельное эхо от pty). guardStatus — статус Стража
 * для этой команды (confirmed при подтверждении опасной, иначе не передаётся) —
 * единственный писатель lastCommand/pendingGuardStatus внутри ShellIntegrationSession
 * (User Story 6 спеки: одна запись вместо двух независимых полей, которые
 * могли разойтись).
 */
export function sendCommandLine(sessionId: string, command: string, guardStatus?: GuardStatus): void {
  const session = sessions.get(sessionId);
  if (!session?.shellIntegration) return;
  applyResult(session, session.shellIntegration.writeCommand(command, guardStatus));
}

/** Реально применяет размер к PTY-каналу и запоминает его как последний
 *  применённый (ADR-0005) — единственное место, где вызывается setWindow. */
function applyRealResize(session: ManagedSession, cols: number, rows: number): void {
  session.ptyCols = cols;
  session.ptyRows = rows;
  session.shell?.setWindow(rows, cols, 0, 0);
}

/**
 * Изменение размера pty под размер xterm (TERM-xx). Гейтинг по cols
 * (issue 11 / ADR-0005): панели вроде ErrorDetector/HintBar меняют только
 * высоту (rows) контейнера xterm, не ширину — реальный PTY-resize (SIGWINCH-
 * эффект, приводящий к перерисовке приглашения на удалённой стороне) в этом
 * случае пропускается, если сейчас не идёт известная fullscreen-программа,
 * которой точный rows нужен для корректной отрисовки. При изменении cols
 * resize применяется всегда, как раньше.
 */
export function resizeSession(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.cols = cols;
  session.rows = rows;

  const colsChanged = cols !== session.ptyCols;
  const rowsChanged = rows !== session.ptyRows;
  if (!colsChanged && !rowsChanged) return;
  if (!colsChanged && !session.interactiveProgramActive) return;

  applyRealResize(session, cols, rows);
}

/** Решение пользователя по fingerprint (SSH-03/04). */
export function confirmHostKey(requestId: string, decision: 'accept' | 'reject'): void {
  const pending = pendingHostKeys.get(requestId);
  if (!pending) return; // просроченный/неизвестный requestId игнорируется
  pendingHostKeys.delete(requestId);
  clearTimeout(pending.timeout);

  const session = sessions.get(pending.sessionId);

  if (decision === 'accept' && session) {
    if (pending.isChanged) {
      replaceKnownKey(pending.address, pending.port, pending.keyType, pending.rawKey);
      log(session, 'warn', 'clog.hostkeyReplaced', undefined, 'hostkey');
    } else {
      addKnownKey(pending.address, pending.port, pending.keyType, pending.rawKey);
      log(session, 'info', 'clog.hostkeyAccepted', undefined, 'hostkey');
    }
    pending.verify(true);
  } else {
    if (session) log(session, 'warn', 'clog.hostkeyRejected', undefined, 'hostkey');
    pending.verify(false);
  }
}

/**
 * Запросить у renderer ввод пароля/passphrase прямо в терминале (SSH-06),
 * когда для хоста нет сохранённого секрета — как в PuTTY/консольном ssh.
 */
function requestAuthPrompt(
  session: ManagedSession,
  prompts: { text: string; echo: boolean }[],
  retry: boolean
): Promise<string[]> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAuthPrompts.delete(requestId);
      reject(new Error('auth prompt timeout'));
    }, AUTH_PROMPT_TIMEOUT_MS);
    pendingAuthPrompts.set(requestId, { sessionId: session.id, resolve, reject, timeout });
    send(IPC.evAuthPrompt, {
      sessionId: session.id,
      requestId,
      prompts,
      retry
    });
  });
}

/** Ответ renderer на запрос пароля/passphrase. */
export function answerAuthPrompt(requestId: string, answers: string[]): void {
  const pending = pendingAuthPrompts.get(requestId);
  if (!pending) return; // просроченный/неизвестный requestId игнорируется
  clearTimeout(pending.timeout);
  pendingAuthPrompts.delete(requestId);
  pending.resolve(answers);
}

/** Отменить незавершённые промпты сессии — при закрытии вкладки/отключении. */
function cancelAuthPrompts(sessionId: string): void {
  for (const [id, pending] of pendingAuthPrompts) {
    if (pending.sessionId !== sessionId) continue;
    clearTimeout(pending.timeout);
    pendingAuthPrompts.delete(id);
    pending.reject(new Error('session closed'));
  }
}

function scheduleReconnect(session: ManagedSession): void {
  session.reconnectAttempts += 1;
  if (session.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    log(session, 'error', 'clog.reconnectGiveUp', undefined, 'session');
    finishDisconnected(session);
    return;
  }
  setStatus(session, 'reconnecting');
  log(session, 'warn', 'clog.reconnecting', { attempt: session.reconnectAttempts }, 'session');
  setTimeout(() => {
    if (session.userClosed) {
      finishDisconnected(session);
      return;
    }
    const host = getHost(session.hostId);
    if (!host) {
      finishDisconnected(session);
      return;
    }
    void establish(session, host);
  }, RECONNECT_DELAY_MS);
}

function finishDisconnected(session: ManagedSession): void {
  log(session, 'info', 'clog.closed', undefined, 'session');
  setStatus(session, 'disconnected');
  stopDashboard(session.id);
  cancelAuthPrompts(session.id);
  session.client = null;
  // NOTIF-01: уведомить о потере уже установленного соединения (не о неудаче входа
  // и не о закрытии пользователем).
  if (session.everConnected && !session.userClosed) {
    notifyDisconnect(session.hostName);
  }
}

export function disconnectSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.userClosed = true;
  session.client?.end();
  if (!session.client) finishDisconnected(session);
}

/** Полное удаление сессии (закрытие вкладки). */
export function destroySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.userClosed = true;
  clearAllShellTimers(session);
  stopDashboard(sessionId);
  cancelAuthPrompts(sessionId);
  session.client?.destroy();
  sessions.delete(sessionId);
}

export function activeSessionCount(): number {
  return [...sessions.values()].filter(
    (s) => s.status === 'connected' || s.status === 'connecting' || s.status === 'reconnecting'
  ).length;
}

// ---------------------------------------------------------------------------
// Transport seam (Часть 2 спеки): фабрика Client подменяема на уровне модуля —
// тестам не нужен настоящий SSH-сервер, чтобы проверить attemptConnect (повтор
// пароля, keyboard-interactive, host-key verifier, отказ Quick Connect от
// автопереподключения). Публичные функции (connectHost, connectQuickHost,
// IPC-слой в ipc/sessions.ts) щели не видят — она приходит в игру только
// внутри attemptConnect. FakeableClient — узкий контракт: только то, чем
// реально пользуются sessionManager/dashboard.ts, не весь API ssh2.Client.
// ---------------------------------------------------------------------------

type ClientEventMap = {
  greeting: (greeting: string) => void;
  handshake: (negotiated: { kex?: string; cs?: { cipher?: string; mac?: string } }) => void;
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

export interface FakeableClient {
  connect(config: Parameters<Client['connect']>[0]): void;
  on<E extends keyof ClientEventMap>(event: E, handler: ClientEventMap[E]): unknown;
  shell: Client['shell'];
  exec: Client['exec'];
}

let clientFactory: () => FakeableClient = () => new Client();

/** Тестовый рычаг (по образцу `parseMetricsForTest` в dashboard.ts): подменить
 *  фабрику Client фальшивым дублёром или сбросить к настоящему ssh2.Client. */
export function __setClientFactoryForTest(factory: (() => FakeableClient) | null): void {
  clientFactory = factory ?? (() => new Client());
}
