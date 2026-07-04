import { app, clipboard, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IPC, type AppInfo } from '@shared/ipc';
import { loadConfig, updateConfig } from '../config/store';
import {
  changeMainLanguage,
  isValidLanguage,
  isValidNamespace,
  listLanguages,
  localesDir,
  FALLBACK_LANGUAGE
} from '../i18n';
import { forceCloseWindow, getMainWindow } from '../window/mainWindow';
import { assertSenderIsMainWindow, assertString } from './validate';

/**
 * Регистрация всех IPC-обработчиков. Один канал — одна операция (SEC-05).
 * Ошибки не содержат stack trace и путей — renderer получает категорию.
 */

export function registerIpcHandlers(): void {
  // --- Приложение ---
  ipcMain.handle(IPC.appGetInfo, (event): AppInfo => {
    assertSenderIsMainWindow(event);
    return { version: app.getVersion(), language: loadConfig().language };
  });

  // --- i18n ---
  ipcMain.handle(IPC.i18nListLanguages, (event): string[] => {
    assertSenderIsMainWindow(event);
    return listLanguages();
  });

  ipcMain.handle(IPC.i18nGetLanguage, (event): string => {
    assertSenderIsMainWindow(event);
    return loadConfig().language;
  });

  ipcMain.handle(IPC.i18nSetLanguage, async (event, lng: unknown): Promise<void> => {
    assertSenderIsMainWindow(event);
    const language = assertString(lng, 'language', 12);
    if (!isValidLanguage(language)) throw new Error('unsupported language');
    updateConfig((cfg) => {
      cfg.language = language;
    });
    await changeMainLanguage(language);
  });

  ipcMain.handle(
    IPC.i18nGetResource,
    async (event, lng: unknown, ns: unknown): Promise<Record<string, unknown>> => {
      assertSenderIsMainWindow(event);
      const language = assertString(lng, 'language', 12);
      const namespace = assertString(ns, 'namespace', 64);
      if (!isValidLanguage(language) && language !== FALLBACK_LANGUAGE) {
        throw new Error('unsupported language');
      }
      if (!isValidNamespace(namespace)) throw new Error('unknown namespace');
      // Путь собирается только из провалидированных сегментов — traversal невозможен.
      const file = join(localesDir(), language, `${namespace}.json`);
      try {
        const raw = await readFile(file, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('bad resource');
        }
        return parsed as Record<string, unknown>;
      } catch {
        // отсутствие перевода — не ошибка: i18next уйдёт в fallback (ru→en)
        return {};
      }
    }
  );

  // --- Буфер обмена (§14 гайда: пароли/passphrase приложение в буфер не пишет) ---
  ipcMain.handle(IPC.clipboardRead, (event): string => {
    assertSenderIsMainWindow(event);
    // Ограничение размера: защита от вставки гигантского буфера
    return clipboard.readText().slice(0, 1_000_000);
  });

  ipcMain.on(IPC.clipboardWrite, (event, text: unknown) => {
    assertSenderIsMainWindow(event);
    if (typeof text !== 'string' || text.length > 1_000_000) return;
    clipboard.writeText(text);
  });

  // --- Управление окном (fire-and-forget) ---
  ipcMain.on(IPC.windowMinimize, (event) => {
    assertSenderIsMainWindow(event);
    getMainWindow()?.minimize();
  });

  ipcMain.on(IPC.windowToggleMaximize, (event) => {
    assertSenderIsMainWindow(event);
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on(IPC.windowClose, (event) => {
    assertSenderIsMainWindow(event);
    getMainWindow()?.close();
  });

  // WIN-02: пользователь подтвердил закрытие окна с активными сессиями
  ipcMain.on(IPC.windowConfirmClose, (event) => {
    assertSenderIsMainWindow(event);
    forceCloseWindow();
  });
}
