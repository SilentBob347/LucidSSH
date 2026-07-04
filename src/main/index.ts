import { app, Menu } from 'electron';
import { hardenApp, hardenCommandLine } from './security/hardening';
import { createMainWindow, getMainWindow } from './window/mainWindow';
import { registerIpcHandlers } from './ipc';
import { registerHostIpcHandlers } from './ipc/hosts';
import { registerSessionIpcHandlers } from './ipc/sessions';
import { registerConfigIpcHandlers } from './ipc/config';
import { registerContentIpcHandlers } from './ipc/content';
import { initMainI18n } from './i18n';
import { loadConfig } from './config/store';

/**
 * Точка входа main-процесса LucidSSH.
 * Порядок: hardening → single instance → ready → i18n → IPC → окно.
 */

hardenCommandLine();

// Вторая копия приложения фокусирует существующее окно.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    hardenApp();
    loadConfig();
    await initMainI18n();
    registerIpcHandlers();
    registerHostIpcHandlers();
    registerSessionIpcHandlers();
    registerConfigIpcHandlers();
    registerContentIpcHandlers();
    createMainWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
