import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc';
import type { UpdateStatus } from '@shared/updates';
import { checkForUpdates, downloadUpdate, getStatus, installUpdate } from '../updates/updater';
import { assertSenderIsMainWindow } from './validate';

/**
 * IPC автообновления (UPD-01…04). Проверка/скачивание/установка запускаются
 * только из главного окна; установка выполняет бэкап БД и перезапуск (UPD-04).
 */
export function registerUpdateIpcHandlers(): void {
  ipcMain.handle(IPC.updateCheck, (event): Promise<void> => {
    assertSenderIsMainWindow(event);
    return checkForUpdates(true); // ручная проверка — всегда
  });

  ipcMain.handle(IPC.updateDownload, (event): Promise<void> => {
    assertSenderIsMainWindow(event);
    return downloadUpdate();
  });

  ipcMain.handle(IPC.updateInstall, (event): void => {
    assertSenderIsMainWindow(event);
    installUpdate();
  });

  ipcMain.handle(IPC.updateGetStatus, (event): UpdateStatus => {
    assertSenderIsMainWindow(event);
    return getStatus();
  });
}
