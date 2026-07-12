import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * hardening.ts читает electron напрямую (app/session) — первый electron-мок
 * с событийной моделью в проекте. isDev вычисляется один раз при импорте
 * модуля (`const isDev = !app.isPackaged`), поэтому каждый тест переимпортирует
 * модуль свежим через vi.resetModules() после выставления isPackaged.
 */

interface FakeEvent {
  preventDefault: () => void;
  defaultPrevented: boolean;
}
function fakeEvent(): FakeEvent {
  const e: FakeEvent = { defaultPrevented: false, preventDefault: () => {} };
  e.preventDefault = () => {
    e.defaultPrevented = true;
  };
  return e;
}

type Handler = (...args: unknown[]) => void;

let isPackaged = false;
const removeSwitch = vi.fn();
const appHandlers = new Map<string, Handler[]>();
let permissionHandler: ((wc: unknown, permission: string, cb: (allow: boolean) => void) => void) | null =
  null;

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged;
    },
    commandLine: { removeSwitch: (sw: string) => removeSwitch(sw) },
    on: (event: string, cb: Handler) => {
      const list = appHandlers.get(event) ?? [];
      list.push(cb);
      appHandlers.set(event, list);
    }
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler: (cb: (wc: unknown, permission: string, cb2: (allow: boolean) => void) => void) => {
        permissionHandler = cb;
      }
    }
  }
}));

async function freshHardening(): Promise<typeof import('./hardening')> {
  vi.resetModules();
  appHandlers.clear();
  permissionHandler = null;
  removeSwitch.mockClear();
  return import('./hardening');
}

beforeEach(() => {
  isPackaged = false;
  delete process.env['ELECTRON_RENDERER_URL'];
});

describe('hardenCommandLine', () => {
  it('production (isPackaged=true) — снимает remote-debugging флаги', async () => {
    isPackaged = true;
    const { hardenCommandLine } = await freshHardening();
    hardenCommandLine();
    expect(removeSwitch).toHaveBeenCalledWith('remote-debugging-port');
    expect(removeSwitch).toHaveBeenCalledWith('remote-debugging-pipe');
    expect(removeSwitch).toHaveBeenCalledWith('inspect');
    expect(removeSwitch).toHaveBeenCalledWith('inspect-brk');
  });

  it('dev (isPackaged=false) — флаги не трогает', async () => {
    isPackaged = false;
    const { hardenCommandLine } = await freshHardening();
    hardenCommandLine();
    expect(removeSwitch).not.toHaveBeenCalled();
  });
});

describe('hardenApp — permission requests', () => {
  it('любой permission-запрос отклоняется', async () => {
    isPackaged = true;
    const { hardenApp } = await freshHardening();
    hardenApp();
    const allow = vi.fn();
    permissionHandler?.({}, 'camera', allow);
    expect(allow).toHaveBeenCalledWith(false);
  });
});

describe('hardenApp — web-contents-created (webview/navigation/window.open)', () => {
  interface FakeContents {
    on: (event: string, cb: Handler) => void;
    setWindowOpenHandler: (cb: (details: { url: string }) => { action: string }) => void;
  }

  function attachContents(): { contentsHandlers: Map<string, Handler>; windowOpenResult: { action: string } } {
    const contentsHandlers = new Map<string, Handler>();
    let windowOpenResult = { action: '' };
    const contents: FakeContents = {
      on: (event, cb) => contentsHandlers.set(event, cb),
      setWindowOpenHandler: (cb) => {
        windowOpenResult = cb({ url: 'https://evil.example.com' });
      }
    };
    const cb = appHandlers.get('web-contents-created')?.[0];
    cb?.({}, contents);
    return { contentsHandlers, windowOpenResult };
  }

  it('will-attach-webview — всегда preventDefault (webview запрещён)', async () => {
    isPackaged = true;
    const { hardenApp } = await freshHardening();
    hardenApp();
    const { contentsHandlers } = attachContents();
    const e = fakeEvent();
    contentsHandlers.get('will-attach-webview')?.(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('window.open — всегда deny', async () => {
    isPackaged = true;
    const { hardenApp } = await freshHardening();
    hardenApp();
    const { windowOpenResult } = attachContents();
    expect(windowOpenResult).toEqual({ action: 'deny' });
  });

  it('will-navigate — file: разрешён', async () => {
    isPackaged = true;
    const { hardenApp } = await freshHardening();
    hardenApp();
    const { contentsHandlers } = attachContents();
    const e = fakeEvent();
    contentsHandlers.get('will-navigate')?.(e, 'file:///C:/app/index.html');
    expect(e.defaultPrevented).toBe(false);
  });

  it('will-navigate — произвольный http(s) URL блокируется', async () => {
    isPackaged = true;
    const { hardenApp } = await freshHardening();
    hardenApp();
    const { contentsHandlers } = attachContents();
    const e = fakeEvent();
    contentsHandlers.get('will-navigate')?.(e, 'https://attacker.example.com/phish');
    expect(e.defaultPrevented).toBe(true);
  });

  it('will-navigate — битый URL блокируется, не падает', async () => {
    isPackaged = true;
    const { hardenApp } = await freshHardening();
    hardenApp();
    const { contentsHandlers } = attachContents();
    const e = fakeEvent();
    expect(() => contentsHandlers.get('will-navigate')?.(e, 'not a url')).not.toThrow();
    expect(e.defaultPrevented).toBe(true);
  });

  it('dev — навигация на ELECTRON_RENDERER_URL (vite dev-сервер) разрешена', async () => {
    isPackaged = false;
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';
    const { hardenApp } = await freshHardening();
    hardenApp();
    const { contentsHandlers } = attachContents();
    const e = fakeEvent();
    contentsHandlers.get('will-navigate')?.(e, 'http://localhost:5173/index.html');
    expect(e.defaultPrevented).toBe(false);
  });

  it('production — та же ссылка на dev-сервер уже НЕ разрешена (isDev=false)', async () => {
    isPackaged = true;
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173';
    const { hardenApp } = await freshHardening();
    hardenApp();
    const { contentsHandlers } = attachContents();
    const e = fakeEvent();
    contentsHandlers.get('will-navigate')?.(e, 'http://localhost:5173/index.html');
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('hardenApp — open-url', () => {
  it('всегда preventDefault (внешние протоколы не запускаются)', async () => {
    isPackaged = true;
    const { hardenApp } = await freshHardening();
    hardenApp();
    const e = fakeEvent();
    const cb = appHandlers.get('open-url')?.[0];
    cb?.(e);
    expect(e.defaultPrevented).toBe(true);
  });
});
