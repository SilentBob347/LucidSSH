import { app, session } from 'electron';

/**
 * Глобальный hardening Electron (SEC-05, §5–6 Security_Guide):
 * запрет навигации, window.open, webview; блокировка опасных permission-запросов;
 * отключение remote debugging в production.
 */

const isDev = !app.isPackaged;

/** Вызывать ДО app.ready. */
export function hardenCommandLine(): void {
  if (!isDev) {
    // Remote debugging в production отключён (§5 гайда)
    for (const sw of ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk']) {
      app.commandLine.removeSwitch(sw);
    }
  }
}

/** Разрешённые origin'ы для навигации: dev-сервер vite либо file:// самого приложения. */
function isAllowedNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (isDev && parsed.origin === new URL(process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173').origin) {
      return true;
    }
    return parsed.protocol === 'file:';
  } catch {
    return false;
  }
}

/** Вызывать после app.ready. */
export function hardenApp(): void {
  app.on('web-contents-created', (_event, contents) => {
    // Запрет webview (§5 гайда)
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });

    // Запрет произвольной навигации
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault();
    });

    // window.open запрещён; внешние ссылки открываются только через
    // отдельный подтверждаемый механизм (SEC-08), не отсюда.
    contents.setWindowOpenHandler(({ url }) => {
      void url; // намеренно не открываем ничего автоматически
      return { action: 'deny' };
    });
  });

  // Renderer не запрашивает никаких системных permissions — отклоняем все.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  // Внешние протоколы из renderer не запускаются.
  app.on('open-url', (event) => event.preventDefault());
}
