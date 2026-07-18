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
vi.mock('../config/store', () => ({ loadConfig: vi.fn() }));
vi.mock('../window/mainWindow', () => ({ getMainWindow: vi.fn(() => null) }));
vi.mock('./knownHosts', () => ({
  addKnownKey: vi.fn(),
  findKnownKey: vi.fn(() => null),
  replaceKnownKey: vi.fn(),
  sha256Fingerprint: vi.fn(() => 'sha256:fake')
}));
vi.mock('./dashboard', () => ({ startDashboard: vi.fn(), stopDashboard: vi.fn() }));
vi.mock('../content/loader', () => ({ loadErrorPatterns: vi.fn(() => []) }));
vi.mock('../errors/detector', () => ({
  detectError: vi.fn(() => ({ matched: false, fallback: 'doc-search' })),
  isEmptyOutput: vi.fn(() => true)
}));
vi.mock('../i18n', () => ({ t: vi.fn((key: string) => key) }));
vi.mock('../history/repository', () => ({ recordHistory: vi.fn() }));
vi.mock('../notifications/notifier', () => ({ notifyDisconnect: vi.fn(), notifyCommandDone: vi.fn() }));

import { loadConfig } from '../config/store';
import { startDashboard } from './dashboard';
import {
  attemptConnectForTest,
  __setClientFactoryForTest,
  type FakeableClient
} from './sessionManager';

const mockLoadConfig = vi.mocked(loadConfig);
const mockStartDashboard = vi.mocked(startDashboard);

const fakeConfig = (): AppConfig =>
  ({
    version: '0.0.0',
    language: 'ru',
    connection: { autoreconnect: true, keepaliveIntervalSec: 30, connectTimeoutSec: 10 },
    ui: { hints: { errorPanel: true } }
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
