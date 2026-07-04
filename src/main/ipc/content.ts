import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc';
import type { CommandsDatabase } from '@shared/content';
import { loadCommandCatalog } from '../content/loader';
import { loadConfig } from '../config/store';
import { assertSenderIsMainWindow } from './validate';

/**
 * IPC контент-баз (только чтение встроенных баз, CAT-01…04).
 * Каталог отдаётся на активном языке со слиянием ядра и перевода.
 */
export function registerContentIpcHandlers(): void {
  ipcMain.handle(IPC.catalogGet, (event): CommandsDatabase => {
    assertSenderIsMainWindow(event);
    return loadCommandCatalog(loadConfig().language);
  });
}
