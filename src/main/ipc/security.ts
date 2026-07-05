import { Buffer } from 'node:buffer';
import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc';
import type { AppConfig } from '@shared/config';
import type { KnownHostView } from '@shared/ssh';
import { listKnownHosts, removeKnownHostLine, sha256Fingerprint } from '../ssh/knownHosts';
import { resetConfig } from '../config/store';
import { assertSenderIsMainWindow, IpcValidationError } from './validate';

/**
 * IPC раздела «Безопасность» настроек (SET-04) и сброса до заводских (SET-08).
 * known_hosts отдаётся в renderer только как отпечаток (без сырого ключа не нужно,
 * но и с ним секрета нет — это публичный ключ сервера); удаление — по номеру строки.
 */

export function registerSecurityIpcHandlers(): void {
  ipcMain.handle(IPC.knownHostsList, (event): KnownHostView[] => {
    assertSenderIsMainWindow(event);
    return listKnownHosts().map((e) => ({
      line: e.line,
      host: e.hostPattern,
      keyType: e.keyType,
      fingerprint: sha256Fingerprint(Buffer.from(e.keyBase64, 'base64'))
    }));
  });

  ipcMain.handle(IPC.knownHostsDelete, (event, rawLine: unknown): void => {
    assertSenderIsMainWindow(event);
    if (typeof rawLine !== 'number' || !Number.isInteger(rawLine) || rawLine < 1) {
      throw new IpcValidationError('line: positive integer expected');
    }
    removeKnownHostLine(rawLine);
  });

  ipcMain.handle(IPC.configReset, (event): AppConfig => {
    assertSenderIsMainWindow(event);
    return resetConfig();
  });
}
