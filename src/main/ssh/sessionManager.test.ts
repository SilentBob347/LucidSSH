import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@shared/config';
import type { Host } from '@shared/hosts';

// sessionManager.ts тянет за собой (транзитивно) better-sqlite3/keytar/Electron
// через hosts/repository, keychain, config/store, knownHosts, dashboard,
// content/loader, history/repository, notifications/notifier, window/mainWindow —
// ни один из них не нужен машине состояний attemptConnect (Часть 2 спеки,
// `.scratch/shell-integration-session/spec.md`: seam ограничен attemptConnect
// и фабрикой Client, establish()/hosts/keychain НЕ подменяются, а собираются
// тестом вручную — см. Testing Decisions). Мокаем по образцу guard/manager.test.ts.
vi.mock('../hosts/repository', () => ({ getHost: vi.fn() }));
vi.mock('../keychain', () => ({ getSecretForConnection: vi.fn() }));
vi.mock('../config/store', () => ({ loadConfig: vi.fn(), updateConfig: vi.fn() }));
vi.mock('../window/mainWindow', () => ({ getMainWindow: vi.fn(() => null) }));
vi.mock('./knownHosts', () => ({
  addKnownKey: vi.fn(),
  findKnownKey: vi.fn(() => null),
  replaceKnownKey: vi.fn(),
  sha256Fingerprint: vi.fn(() => 'sha256:fake')
}));
vi.mock('./dashboard', () => ({ startDashboard: vi.fn(), stopDashboard: vi.fn() }));
vi.mock('../content/loader', () => ({
  loadErrorPatterns: vi.fn(() => []),
  loadCommandCatalog: vi.fn(() => ({ version: '1', categories: [], categoryLabels: {}, commands: [] }))
}));
vi.mock('../errors/detector', () => ({
  detectError: vi.fn(() => ({ matched: false, fallback: 'doc-search' })),
  isEmptyOutput: vi.fn(() => true)
}));
vi.mock('../i18n', () => ({ t: vi.fn((key: string) => key) }));
vi.mock('../history/repository', () => ({ recordHistory: vi.fn() }));
vi.mock('../notifications/notifier', () => ({ notifyDisconnect: vi.fn(), notifyCommandDone: vi.fn() }));

import { IPC } from '@shared/ipc';
import type { HostKeyPrompt } from '@shared/ssh';
import { loadConfig } from '../config/store';
import { startDashboard } from './dashboard';
import { getMainWindow } from '../window/mainWindow';
import { getSecretForConnection } from '../keychain';
import { addKnownKey } from './knownHosts';
import {
  attemptConnectForTest,
  connectQuickHost,
  confirmHostKey,
  getSession,
  resizeSession,
  sendCommandLine,
  __setClientFactoryForTest,
  type FakeableClient
} from './sessionManager';

const mockLoadConfig = vi.mocked(loadConfig);
const mockStartDashboard = vi.mocked(startDashboard);
const mockGetMainWindow = vi.mocked(getMainWindow);
const mockGetSecretForConnection = vi.mocked(getSecretForConnection);
const mockAddKnownKey = vi.mocked(addKnownKey);

const fakeConfig = (): AppConfig =>
  ({
    version: '0.0.0',
    language: 'ru',
    connection: { autoreconnect: true, keepaliveIntervalSec: 30, connectTimeoutSec: 10 },
    ui: { hints: { errorPanel: true } },
    // recordCommand (issue 11 / ADR-0005 тесты гоняют реальный command-finished
    // через htop-маркер) выходит рано при enabled: false — не нужно мокать
    // getHost/recordHistory сверх уже замоканного в файле.
    history: { enabled: false, perHostDisabled: [] },
    // HM-12: deployPendingKey (keygen.ts) читает это через тот же мокнутый
    // loadConfig — без поля падает на .find() при 'ready' с паролем.
    pendingKeyDeployments: []
  }) as unknown as AppConfig;

const fakeHost = (overrides: Partial<Host> = {}): Host => ({
  id: 1,
  name: 'web-01',
  address: '10.0.0.5',
  port: 22,
  username: 'nikita',
  authMethod: 'password',
  guardEnabled: true,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
  ...overrides
});

// ManagedSession не экспортирован (по дизайну, см. guard/manager.test.ts) —
// достаточно минимальной формы, которую реально трогает attemptConnect.
type Session = Parameters<typeof attemptConnectForTest>[0];

const fakeSession = (overrides: Partial<Session> = {}): Session =>
  ({
    id: 's1',
    hostId: 1,
    hostName: 'web-01',
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
    ...overrides
  }) as unknown as Session;

/** Фальшивый ClientChannel, достаточный, чтобы openShell() отработал без
 *  падения (данные потока в этих тестах не нужны — их разбор уже покрыт
 *  shellIntegrationSession.test.ts). */
function fakeStream(): unknown {
  return {
    on: vi.fn(),
    stderr: { on: vi.fn() },
    write: vi.fn(),
    setWindow: vi.fn()
  };
}

/** Фальшивый ssh2.Client: копит обработчики on(event, …) и позволяет тесту
 *  сымитировать события сервера напрямую, без сети (Часть 2 спеки). */
function makeFakeClient(): { client: FakeableClient; emit: (event: string, ...args: unknown[]) => void } {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const client = {
    connect: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return client;
    }),
    shell: vi.fn((_opts: unknown, cb: (err: Error | undefined, stream: unknown) => void) => {
      cb(undefined, fakeStream());
    }),
    exec: vi.fn()
  } as unknown as FakeableClient;

  const emit = (event: string, ...args: unknown[]): void => {
    for (const handler of handlers.get(event) ?? []) handler(...args);
  };

  return { client, emit };
}

/**
 * Обязательное покрытие (CLAUDE.md §10 по духу правила — конвейер, питающий
 * Стража/детектор/breadcrumb, не должен меняться без тестов): машина
 * состояний attemptConnect без сети и без реального SSH-сервера.
 */
describe('attemptConnectForTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue(fakeConfig());
  });

  afterEach(() => {
    __setClientFactoryForTest(null);
  });

  it('успешное подключение: ready → openShell вызван, статус ready', async () => {
    const { client, emit } = makeFakeClient();
    __setClientFactoryForTest(() => client);
    const session = fakeSession();

    const promise = attemptConnectForTest(session, fakeHost(), 'pw', undefined, undefined, false);
    emit('ready');
    const result = await promise;

    expect(result).toBe('ready');
    expect(session.status).toBe('connected');
    expect(mockStartDashboard).toHaveBeenCalledTimes(1);
  });

  it('неверный пароль с разрешённым повтором — auth-failed', async () => {
    const { client, emit } = makeFakeClient();
    __setClientFactoryForTest(() => client);
    const session = fakeSession();

    const promise = attemptConnectForTest(session, fakeHost(), 'wrong', undefined, undefined, true);
    emit('error', Object.assign(new Error('auth'), { level: 'client-authentication' }));
    emit('close');
    const result = await promise;

    expect(result).toBe('auth-failed');
    expect(mockStartDashboard).not.toHaveBeenCalled();
  });

  it('keyboard-interactive: отвечает паролем на каждый prompt сервера (SSH-06)', async () => {
    const { client, emit } = makeFakeClient();
    __setClientFactoryForTest(() => client);
    const session = fakeSession();
    const finish = vi.fn();

    const promise = attemptConnectForTest(session, fakeHost(), 'secret', undefined, undefined, false);
    emit(
      'keyboard-interactive',
      'name',
      'instructions',
      'en',
      [
        { prompt: 'Password:', echo: false },
        { prompt: 'Confirm:', echo: false }
      ],
      finish
    );
    expect(finish).toHaveBeenCalledWith(['secret', 'secret']);

    emit('ready');
    await promise;
  });

  it('Quick Connect (hostId=0) — close после ready не планирует автопереподключение', async () => {
    const { client, emit } = makeFakeClient();
    __setClientFactoryForTest(() => client);
    const session = fakeSession({ hostId: 0 });

    const promise = attemptConnectForTest(session, fakeHost({ id: 0 }), 'pw', undefined, undefined, false);
    emit('ready');
    await promise;
    expect(session.status).toBe('connected');

    emit('close');
    // hostId=0 нигде не сохранён (HM-11) — реконнектить нечем, сессия сразу
    // уходит в disconnected, а не в 'reconnecting'.
    expect(session.status).toBe('disconnected');
  });

  it('закрытие канала до ready без allowAuthRetry — статус other, сессия disconnected', async () => {
    const { client, emit } = makeFakeClient();
    __setClientFactoryForTest(() => client);
    const session = fakeSession();

    const promise = attemptConnectForTest(session, fakeHost(), 'pw', undefined, undefined, false);
    emit('close');
    const result = await promise;

    expect(result).toBe('other');
    expect(session.status).toBe('disconnected');
    expect(mockStartDashboard).not.toHaveBeenCalled();
  });
});

/**
 * Регресс на `.scratch/quickconnect-hostkey-confirm-bug/spec.md`: confirmHostKey
 * брал address/port через getHost(session.hostId), который для Quick Connect
 * (hostId=0, HM-11) всегда null — accept проваливался в reject-ветку. Тест гоняет
 * confirmHostKey через реальный pendingHostKeys/sessions, populate которых
 * возможен только публичным путём connectQuickHost (карты приватны модулю).
 */
describe('confirmHostKey — Quick Connect (hostId=0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue(fakeConfig());
    mockGetSecretForConnection.mockResolvedValue('pw');
  });

  afterEach(() => {
    __setClientFactoryForTest(null);
  });

  it('accept сохраняет ключ и подтверждает подключение, а не отклоняет его', async () => {
    const sentPrompts: HostKeyPrompt[] = [];
    mockGetMainWindow.mockReturnValue({
      isDestroyed: () => false,
      webContents: {
        send: vi.fn((channel: string, payload: HostKeyPrompt) => {
          if (channel === IPC.evHostKeyPrompt) sentPrompts.push(payload);
        })
      }
    } as unknown as ReturnType<typeof getMainWindow>);

    const { client, emit } = makeFakeClient();
    __setClientFactoryForTest(() => client);

    const mockConnect = vi.mocked(client.connect);

    void connectQuickHost('10.0.0.9', 22, 'nikita');
    // establish() ждёт getSecretForConnection() (замокан resolved-промисом) до
    // вызова attemptConnect()/client.connect() — даём микротаскам догнать.
    await vi.waitFor(() => {
      if (mockConnect.mock.calls.length === 0) throw new Error('client.connect ещё не вызван');
    });

    // hostVerifier не событие on(), а прямое поле connectConfig — зовём его так,
    // как это сделал бы ssh2 при рукопожатии.
    const connectConfig = mockConnect.mock.calls[0]?.[0] as unknown as {
      hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => void;
    };
    const verifySpy = vi.fn();
    connectConfig.hostVerifier(Buffer.from('fake-key'), verifySpy);

    expect(sentPrompts).toHaveLength(1);
    const requestId = sentPrompts[0]?.requestId;
    if (!requestId) throw new Error('requestId отсутствует в отправленном prompt');

    confirmHostKey(requestId, 'accept');

    expect(verifySpy).toHaveBeenCalledWith(true);
    expect(mockAddKnownKey).toHaveBeenCalledWith('10.0.0.9', 22, expect.any(String), expect.any(Buffer));

    emit('ready');
  });
});

const US = '\x1f';
/** Тот же формат маркера shell-интеграции, что и в shellIntegrationSession.test.ts. */
const mk = (u: string, h: string, p: string, e: string, c = '0', sudoUser = ''): string =>
  `\x1b_lucidssh${US}${u}${US}${h}${US}${p}${US}${e}${US}${c}${US}${sudoUser}\x1b\\`;

/**
 * Issue 11 / ADR-0005: панели (ErrorDetector/HintBar), встроенные во flex-
 * раскладку терминала, меняют высоту его контейнера при появлении/скрытии —
 * ResizeObserver в XtermView.tsx реагирует на это реальным PTY-resize
 * (SIGWINCH-эффект), который часть шеллов отвечает перерисовкой приглашения,
 * задваивающей строку в терминале. Гейтинг в resizeSession() не должен
 * измениться без обновления этих тестов.
 */
describe('resizeSession — гейтинг PTY-resize по cols (issue 11 / ADR-0005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue(fakeConfig());
    mockGetSecretForConnection.mockResolvedValue('pw');
  });

  afterEach(() => {
    __setClientFactoryForTest(null);
  });

  /** Поднимает реальную сессию (connectQuickHost → ready → openShell) с
   *  фальшивым PTY-каналом, чей setWindow можно проверять напрямую, и
   *  позволяет скармливать сырые байты через тот же stream.on('data'), что
   *  использует sessionManager в проде. */
  async function connectedSession(): Promise<{
    sessionId: string;
    setWindow: ReturnType<typeof vi.fn>;
    feedData: (chunk: string) => void;
  }> {
    const setWindow = vi.fn();
    const dataHandlers: Array<(data: Buffer) => void> = [];
    const stream = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'data') dataHandlers.push(handler as (data: Buffer) => void);
      }),
      stderr: { on: vi.fn() },
      write: vi.fn(),
      setWindow
    };
    const readyHandlers: Array<() => void> = [];
    const client = {
      connect: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'ready') readyHandlers.push(handler as () => void);
        return client;
      }),
      shell: vi.fn((_opts: unknown, cb: (err: Error | undefined, s: unknown) => void) => cb(undefined, stream)),
      exec: vi.fn()
    } as unknown as FakeableClient;
    __setClientFactoryForTest(() => client);

    const { sessionId } = await connectQuickHost('10.0.0.9', 22, 'nikita');
    for (const handler of readyHandlers) handler();
    await vi.waitFor(() => {
      if ((client.shell as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 0) {
        throw new Error('shell ещё не открыт');
      }
    });

    return {
      sessionId,
      setWindow,
      feedData: (chunk: string) => {
        for (const handler of dataHandlers) handler(Buffer.from(chunk, 'utf8'));
      }
    };
  }

  /** Доводит сессию до состояния «первый маркер уже виден» (аналог warmUp()
   *  из shellIntegrationSession.test.ts) — без этого detectInteractiveProgram
   *  не срабатывает (firstMarkSeen должен быть true). tick() зовётся напрямую
   *  на боксе, а не через реальный setTimeout — сама коробка не имеет рук. */
  function warmUp(sessionId: string, feedData: (chunk: string) => void): void {
    feedData('Welcome to Ubuntu 24.04\r\n');
    getSession(sessionId)?.shellIntegration?.tick('setup-silence');
    feedData(mk('u', 'h', '/home/u', '1000', '0'));
  }

  it('открытие подключения не шлёт лишний setWindow — начальный размер уже применён через client.shell()', async () => {
    const { setWindow } = await connectedSession();
    expect(setWindow).not.toHaveBeenCalled();
  });

  it('изменение только rows (открытие/закрытие ErrorDetector/HintBar) не шлёт реальный PTY-resize', async () => {
    const { sessionId, setWindow } = await connectedSession();

    resizeSession(sessionId, 80, 20); // cols те же (80), rows 24 → 20
    expect(setWindow).not.toHaveBeenCalled();

    resizeSession(sessionId, 80, 24); // панель закрылась, rows вернулись к 24
    expect(setWindow).not.toHaveBeenCalled();
  });

  it('изменение cols всегда применяется к PTY, даже если rows тоже изменились', async () => {
    const { sessionId, setWindow } = await connectedSession();

    resizeSession(sessionId, 100, 20);
    expect(setWindow).toHaveBeenCalledTimes(1);
    expect(setWindow).toHaveBeenCalledWith(20, 100, 0, 0);
  });

  it('повторный вызов с тем же размером не шлёт лишний resize', async () => {
    const { sessionId, setWindow } = await connectedSession();

    resizeSession(sessionId, 100, 24);
    expect(setWindow).toHaveBeenCalledTimes(1);

    resizeSession(sessionId, 100, 24);
    expect(setWindow).toHaveBeenCalledTimes(1);
  });

  it('запуск известной интерактивной программы форсирует досылку ранее пропущенного resize', async () => {
    const { sessionId, setWindow, feedData } = await connectedSession();
    warmUp(sessionId, feedData);
    setWindow.mockClear();

    resizeSession(sessionId, 80, 20); // панель открылась — пропущено
    expect(setWindow).not.toHaveBeenCalled();

    sendCommandLine(sessionId, 'htop');
    expect(setWindow).toHaveBeenCalledWith(20, 80, 0, 0);
  });

  it('после выхода из программы (breadcrumb) новое изменение rows снова гасится', async () => {
    const { sessionId, setWindow, feedData } = await connectedSession();
    warmUp(sessionId, feedData);

    sendCommandLine(sessionId, 'htop');
    setWindow.mockClear();

    // Возврат к промпту после выхода из htop — тот же маркер, что и обычный
    // breadcrumb (BRD-04), снимает interactiveProgramActive.
    feedData(mk('u', 'h', '/home/u', '1000', '0'));

    resizeSession(sessionId, 80, 18);
    expect(setWindow).not.toHaveBeenCalled();
  });
});
