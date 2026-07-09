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
import { BreadcrumbParser, CommandGate, EchoGate, SHELL_INTEGRATION_SETUP } from './shellIntegration';
import { startDashboard, stopDashboard } from './dashboard';
import { loadErrorPatterns } from '../content/loader';
import { detectError, isEmptyOutput } from '../errors/detector';
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
 */

interface ManagedSession {
  id: string;
  hostId: number;
  hostName: string;
  client: Client | null;
  shell: ClientChannel | null;
  cols: number;
  rows: number;
  status: SessionStatus;
  log: ConnectionLogEntry[];
  userClosed: boolean;
  reconnectAttempts: number;
  connectStartedAt: number;
  breadcrumbParser: BreadcrumbParser;
  /** Вывод с момента предыдущего маркера — для детектора ошибок (ERR-01). */
  outputSinceMark: string;
  /** Последняя команда, отправленная через композер/Стража (для {original} и истории). */
  lastCommand: string;
  /** Момент отправки последней команды — для порога долгой команды (NOTIF-02). */
  lastCommandStartedAt: number;
  /** Была ли сессия хоть раз подключена — чтобы уведомлять о потере, не о неудаче (NOTIF-01). */
  everConnected: boolean;
  /** Статус Стража для последней команды (confirmed при подтверждении опасной). */
  pendingGuardStatus?: GuardStatus;
  /** Первый маркер после подключения — приветствие, не результат команды. */
  firstMarkSeen: boolean;
  /** Гейт подавления эха setup-команды: MOTD виден, эхо настройки — нет. */
  echoGate: EchoGate;
  /** Гейт «команда выполнялась»: отсекает маркеры от перерисовок приглашения. */
  commandGate: CommandGate;
  /** Отправлена ли настройка shell integration в текущий shell. */
  setupSent: boolean;
  /** Пауза в выводе после MOTD — сигнал отправить настройку. */
  setupSilenceTimer?: NodeJS.Timeout;
  /** Кап: настройка уходит даже если сервер молчит (нет MOTD/приглашения). */
  setupCapTimer?: NodeJS.Timeout;
  /** Страховка: shell без bash/zsh не пришлёт маркер — показать накопленное. */
  echoFlushTimer?: NodeJS.Timeout;
  /** Канал закрылся с распознанной ssh-connection-ошибкой (nologin и т.п.) —
   *  автопереподключение бессмысленно, см. client.on('close', ...). */
  shellUnavailable?: boolean;
}

interface PendingHostKey {
  sessionId: string;
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
// Отправка shell integration: ждём паузу в выводе после MOTD (иначе окно
// подавления эха съест приветствие), но не дольше капа. Маркер-страховка —
// если shell не bash/zsh и маркер не придёт, накопленное эхо показывается.
const SETUP_SILENCE_MS = 300;
const SETUP_CAP_MS = 2000;
const ECHO_FLUSH_TIMEOUT_MS = 3000;

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

/** Накопление вывода между маркерами с тем же капом, что и раньше (ERR-01). */
function appendOutput(session: ManagedSession, text: string): void {
  if (!text) return;
  session.outputSinceMark += text;
  if (session.outputSinceMark.length > 65536) {
    session.outputSinceMark = session.outputSinceMark.slice(-65536);
  }
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
}> {
  return [...sessions.values()].map((s) => ({
    sessionId: s.id,
    hostId: s.hostId,
    hostName: s.hostName,
    status: s.status
  }));
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
    status: 'connecting',
    log: [],
    userClosed: false,
    reconnectAttempts: 0,
    connectStartedAt: Date.now(),
    breadcrumbParser: new BreadcrumbParser(),
    outputSinceMark: '',
    lastCommand: '',
    lastCommandStartedAt: 0,
    everConnected: false,
    firstMarkSeen: false,
    echoGate: new EchoGate(),
    commandGate: new CommandGate(),
    setupSent: false
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
    const client = new Client();
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
      const answer = host.authMethod === 'password' ? (password ?? '') : '';
      finish(prompts.map(() => answer));
    });

    client.on('ready', () => {
      session.reconnectAttempts = 0;
      log(
        session,
        'info',
        'clog.ready',
        { method: host.authMethod, ms: Date.now() - session.connectStartedAt },
        'auth'
      );
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
        if (session.status === 'connected' && loadConfig().connection.autoreconnect) {
          scheduleReconnect(session);
          return;
        }
        if (session.status === 'reconnecting') {
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

    if (host.authMethod === 'password') {
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
  // случай на дефолтных настройках sshd, SSH-06). При отказе сервера —
  // пересоздаём попытку с новым Client и переспрашиваем пароль.
  if (!secret) {
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
        finishDisconnected(session);
        return;
      }
      const allowRetry = attempt < MAX_PASSWORD_ATTEMPTS - 1;
      const result = await attemptConnect(session, host, password, privateKey, keyPassphrase, allowRetry);
      if (result !== 'auth-failed') return; // 'ready'/'other' — уже обработано внутри
    }
  }

  await attemptConnect(session, host, secret, privateKey, keyPassphrase, false);
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
      session.everConnected = true;
      // Новый shell (в т.ч. после переподключения) — настройка ещё не отправлена,
      // гейты и таймеры прошлого shell сбрасываются.
      session.setupSent = false;
      session.commandGate.reset();
      clearSetupTimers(session);
      setStatus(session, 'connected');
      log(session, 'info', 'clog.shellOpen', undefined, 'session');

      // Вывод сервера проходит через парсер breadcrumb: APC-маркеры вырезаются
      // (в xterm не попадают), из них формируется breadcrumb (BRD-04) и
      // отслеживается exit code для детектора ошибок (ERR-01). EchoGate
      // дополнительно прячет эхо setup-команды (MOTD остаётся видимым).
      stream.on('data', (data: Buffer) => {
        const { pieces, marks } = session.breadcrumbParser.push(data.toString('utf8'));
        if (!session.setupSent) {
          // MOTD ещё идёт — настройка уходит после паузы в выводе
          clearTimeout(session.setupSilenceTimer);
          session.setupSilenceTimer = setTimeout(() => sendShellSetup(session), SETUP_SILENCE_MS);
        }
        const effective = session.echoGate.filter(pieces, marks.length);
        const display = effective.join('');
        if (display) {
          send(IPC.evTerminalData, session.id, display);
        }
        // Приписываем вывод СВОЕМУ маркеру: effective[i] — это то, что пришло
        // между (i-1)-м и i-м маркером в этом чанке. Несколько маркеров могут
        // прийти в одном data-событии (см. баг: два маркера одним пакетом).
        for (let i = 0; i < marks.length; i++) {
          appendOutput(session, effective[i] ?? '');
          send(IPC.evBreadcrumb, session.id, marks[i]!.crumb);
          handleCommandFinished(session, marks[i]!.exitCode);
        }
        appendOutput(session, effective[effective.length - 1] ?? '');
      });
      stream.stderr?.on('data', (data: Buffer) => {
        send(IPC.evTerminalData, session.id, data.toString('utf8'));
      });
      stream.on('close', () => {
        clearSetupTimers(session);
        session.shell = null;
        stopDashboard(session.id);
        checkShellUnavailable(session);
      });

      // Кап на случай сервера без MOTD/приглашения: настройка уйдёт даже
      // если данных от сервера не было и silence-таймер не взводился.
      session.setupCapTimer = setTimeout(() => sendShellSetup(session), SETUP_CAP_MS);

      // Мини-дашборд: отдельный exec-канал, интервал 10 с (DASH-02).
      // Логгер — причина недоступности метрик попадает в «Детали подключения» (DASH-05).
      startDashboard(session.id, client, (messageKey, params) =>
        log(session, 'warn', messageKey, params, 'session')
      );
    }
  );
}

/**
 * Некоторые серверы аутентифицируют успешно, но не могут открыть интерактивную
 * сессию (login shell = nologin и т.п.) — канал сразу закрывается, ssh2 не
 * эмитит 'error' (это не ошибка аутентификации). Наш маркер breadcrumb в таком
 * случае никогда не приходит, поэтому обычный путь детектора (по exit code
 * команды) не срабатывает. Текст, который сервер успел прислать перед
 * закрытием канала, сверяется с базой паттернов scope 'ssh-connection';
 * совпадение показывается как отдельное объяснение, а сессия помечается, чтобы
 * client.on('close', ...) не пытался переподключиться — повтор бесполезен.
 */
function checkShellUnavailable(session: ManagedSession): void {
  const output = session.outputSinceMark;
  if (!output.trim()) return;
  const patterns = loadErrorPatterns(loadConfig().language);
  const result = detectError(patterns, 'ssh-connection', output, null, '');
  if (result.matched) {
    session.shellUnavailable = true;
    send(IPC.evError, session.id, result.explanation);
  }
}

/**
 * Обработка завершения команды по маркеру (ERR-01). Первый маркер после
 * подключения — приветствие/сам setup, не команда, поэтому пропускается.
 * При exit code ≠ 0 и включённой панели детектора (SET-05) — матч по базе.
 */
function handleCommandFinished(session: ManagedSession, exitCode: number | null): void {
  const output = session.outputSinceMark;
  session.outputSinceMark = '';

  if (!session.firstMarkSeen) {
    session.firstMarkSeen = true;
    return;
  }

  // Маркер без Enter'а с прошлого маркера — перерисовка приглашения, а не
  // завершение команды (см. CommandGate). Открытие/закрытие самой панели
  // детектора вызывает resize → SIGWINCH → readline перепечатывает промпт
  // вместе со встроенным в PS1 маркером и СТАРЫМ $? — без этой проверки
  // панель затирается fallback'ом и переоткрывается сама по кругу.
  const cycle = session.commandGate.consume();
  if (!cycle.ran) return;

  // Команда, которая только что завершилась — нужна и для истории, и для
  // подстановки {original}/{target} в шагах детектора ниже. Читаем ДО очистки
  // session.lastCommand (следующий блок её обнуляет).
  const command = session.lastCommand;

  // Запись в историю выполненной команды из композера (HIST-01). Прямой ввод в
  // xterm не записывается — его текст main не знает. Маскирование секретов — в
  // recordHistory (HIST-07).
  if (session.lastCommand) {
    recordCommand(session, session.lastCommand, exitCode, session.pendingGuardStatus, output);
    // NOTIF-02: тост о долгой/упавшей команде, если окно не в фокусе
    notifyCommandDone(session.hostName, exitCode, Date.now() - session.lastCommandStartedAt);
    session.lastCommand = '';
    session.pendingGuardStatus = undefined;
  }

  if (exitCode === null || exitCode === 0) return;
  // Прервано сигналом (напр. Ctrl+C во время `tail -f`/`journalctl -f`) — это
  // намеренное действие пользователя, а не ошибка команды.
  if (isSignalExitCode(exitCode)) return;
  // Пустой Enter: команды не было, $? унаследован от предыдущей — не детектор.
  if (!cycle.typed && !command) return;
  if (!loadConfig().ui.hints.errorPanel) return; // отключено в «Интерфейсе»

  const patterns = loadErrorPatterns(loadConfig().language);
  const result = detectError(patterns, 'command', output, exitCode, command);

  let explanation: ErrorExplanation;
  if (result.matched) {
    explanation = result.explanation;
  } else {
    // Fallback-шаблон (ERR-06): пустой stderr → осмысленный текст
    const explainKey = isEmptyOutput(output) ? 'errDetector.emptyOutput' : 'errDetector.fallbackExplain';
    explanation = {
      title: t('errDetector.fallbackTitle'),
      explanation: t(explainKey, { code: exitCode }),
      checks: [],
      source: 'fallback',
      command
    };
  }
  send(IPC.evError, session.id, explanation);
}

/** Запомнить последнюю отправленную команду (для {original} и истории). */
export function setLastCommand(sessionId: string, command: string, guardStatus?: GuardStatus): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastCommand = command.trim();
    session.lastCommandStartedAt = Date.now();
    session.pendingGuardStatus = guardStatus;
  }
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
    username: host?.username ?? '',
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

function clearSetupTimers(session: ManagedSession): void {
  clearTimeout(session.setupSilenceTimer);
  clearTimeout(session.setupCapTimer);
  clearTimeout(session.echoFlushTimer);
  session.setupSilenceTimer = undefined;
  session.setupCapTimer = undefined;
  session.echoFlushTimer = undefined;
}

/**
 * Отправка настройки shell integration (BRD-04): статическая строка, значения
 * подставляет удалённый shell из своих переменных (§19 гайда). Отправляется
 * один раз на shell, ПОСЛЕ того как MOTD дошёл до xterm (см. таймеры в
 * openShell) — с этого момента EchoGate прячет эхо настройки до первого маркера.
 */
function sendShellSetup(session: ManagedSession): void {
  if (session.setupSent || !session.shell) return;
  session.setupSent = true;
  clearTimeout(session.setupSilenceTimer);
  clearTimeout(session.setupCapTimer);
  session.echoGate.arm();
  session.shell.write(SHELL_INTEGRATION_SETUP);
  // Маркер не пришёл (shell без bash/zsh, ошибка настройки) — показать
  // накопленный вывод вместо того, чтобы молча его проглотить.
  session.echoFlushTimer = setTimeout(() => {
    const buffered = session.echoGate.flush();
    if (buffered) {
      send(IPC.evTerminalData, session.id, buffered);
      session.outputSinceMark += buffered;
    }
  }, ECHO_FLUSH_TIMEOUT_MS);
}

/** Отправка ввода пользователя в сессию (SEC: проверка через Стража — Этап 4). */
export function sendInput(sessionId: string, data: string): void {
  const session = sessions.get(sessionId);
  if (!session?.shell) return;
  // Пользователь успел напечатать до отправки настройки — настройка уходит
  // первой отдельной строкой, ввод следом: bash выполнит её раньше, эхо ввода
  // придёт уже после маркера и подавлено не будет.
  if (!session.setupSent) sendShellSetup(session);
  // Настройка выше пишется мимо этого учёта (session.shell.write) — её маркер
  // и так съедается firstMarkSeen, кредит ей не нужен.
  session.commandGate.noteInput(data);
  session.shell.write(data);
}

/** Изменение размера pty под размер xterm. */
export function resizeSession(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.cols = cols;
  session.rows = rows;
  session.shell?.setWindow(rows, cols, 0, 0);
}

/** Решение пользователя по fingerprint (SSH-03/04). */
export function confirmHostKey(requestId: string, decision: 'accept' | 'reject'): void {
  const pending = pendingHostKeys.get(requestId);
  if (!pending) return; // просроченный/неизвестный requestId игнорируется
  pendingHostKeys.delete(requestId);
  clearTimeout(pending.timeout);

  const session = sessions.get(pending.sessionId);
  const host = session ? getHost(session.hostId) : null;

  if (decision === 'accept' && session && host) {
    if (pending.isChanged) {
      replaceKnownKey(host.address, host.port, pending.keyType, pending.rawKey);
      log(session, 'warn', 'clog.hostkeyReplaced', undefined, 'hostkey');
    } else {
      addKnownKey(host.address, host.port, pending.keyType, pending.rawKey);
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
  clearSetupTimers(session);
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
