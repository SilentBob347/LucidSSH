import { dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { IPC } from '@shared/ipc';
import type { Host, HostGroup, ImportPreview } from '@shared/hosts';
import * as repo from '../hosts/repository';
import * as keychain from '../keychain';
import {
  validateGroupName,
  validateHostInput,
  validateId,
  validateSecret
} from '../hosts/validate';
import {
  buildExport,
  ImportFormatError,
  importHosts,
  previewImport
} from '../hosts/exportImport';
import { countPuttySessions } from '../hosts/puttyDetect';
import { getMainWindow } from '../window/mainWindow';
import { loadConfig, updateConfig } from '../config/store';
import { assertSenderIsMainWindow, IpcValidationError } from './validate';
import { t } from '../i18n';

/**
 * IPC хостов/групп (HM-01…HM-06, EXP-01…04). Один канал — одна операция.
 * Секрет приходит отдельным аргументом, сразу уходит в keychain и
 * не возвращается обратно (SEC-01, §9–10 гайда).
 */

export function registerHostIpcHandlers(): void {
  // --- Хосты ---
  ipcMain.handle(IPC.hostsList, (event): Host[] => {
    assertSenderIsMainWindow(event);
    return repo.listHosts();
  });

  ipcMain.handle(IPC.groupsList, (event): HostGroup[] => {
    assertSenderIsMainWindow(event);
    return repo.listGroups();
  });

  ipcMain.handle(
    IPC.hostCreate,
    async (event, rawInput: unknown, rawSecret: unknown): Promise<{ id: number }> => {
      assertSenderIsMainWindow(event);
      const input = validateHostInput(rawInput);
      const secret = validateSecret(rawSecret);
      if (input.groupId !== undefined && !repo.groupExists(input.groupId)) {
        throw new IpcValidationError('groupId: group not found');
      }
      const id = repo.createHost(input);
      if (secret !== undefined) await keychain.setSecret(id, secret);
      return { id };
    }
  );

  ipcMain.handle(
    IPC.hostUpdate,
    async (event, rawId: unknown, rawInput: unknown, rawSecret: unknown): Promise<void> => {
      assertSenderIsMainWindow(event);
      const id = validateId(rawId, 'hostId');
      const input = validateHostInput(rawInput);
      const secret = validateSecret(rawSecret);
      if (!repo.getHost(id)) throw new IpcValidationError('hostId: not found');
      if (input.groupId !== undefined && !repo.groupExists(input.groupId)) {
        throw new IpcValidationError('groupId: group not found');
      }
      repo.updateHost(id, input);
      if (secret !== undefined) await keychain.setSecret(id, secret);
    }
  );

  ipcMain.handle(IPC.hostDelete, async (event, rawId: unknown): Promise<void> => {
    assertSenderIsMainWindow(event);
    const id = validateId(rawId, 'hostId');
    repo.deleteHost(id);
    // Секрет удаляется вместе с хостом (§10 гайда)
    await keychain.deleteSecret(id);
    updateConfig((cfg) => {
      cfg.history.perHostDisabled = cfg.history.perHostDisabled.filter((h) => h !== id);
    });
  });

  ipcMain.handle(IPC.hostHasSecret, async (event, rawId: unknown): Promise<boolean> => {
    assertSenderIsMainWindow(event);
    const id = validateId(rawId, 'hostId');
    // Только факт наличия — само значение никогда не покидает main (SEC-01)
    return keychain.hasSecret(id);
  });

  ipcMain.handle(IPC.hostDeleteSecret, async (event, rawId: unknown): Promise<void> => {
    assertSenderIsMainWindow(event);
    const id = validateId(rawId, 'hostId');
    await keychain.deleteSecret(id);
  });

  ipcMain.handle(IPC.hostPickKeyFile, async (event): Promise<string | null> => {
    assertSenderIsMainWindow(event);
    const win = getMainWindow();
    if (!win) return null;
    // Возвращается только путь к оригиналу — файл не читается и не копируется (SEC-02)
    const res = await dialog.showOpenDialog(win, {
      title: t('conn.keyPath'),
      properties: ['openFile', 'showHiddenFiles']
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });

  // --- Группы ---
  ipcMain.handle(IPC.groupCreate, (event, rawName: unknown): { id: number } => {
    assertSenderIsMainWindow(event);
    const name = validateGroupName(rawName);
    return { id: repo.createGroup(name) };
  });

  ipcMain.handle(IPC.groupRename, (event, rawId: unknown, rawName: unknown): void => {
    assertSenderIsMainWindow(event);
    const id = validateId(rawId, 'groupId');
    const name = validateGroupName(rawName);
    repo.renameGroup(id, name);
  });

  ipcMain.handle(IPC.groupSetCollapsed, (event, rawId: unknown, rawCollapsed: unknown): void => {
    assertSenderIsMainWindow(event);
    const id = validateId(rawId, 'groupId');
    if (typeof rawCollapsed !== 'boolean') {
      throw new IpcValidationError('collapsed: boolean expected');
    }
    repo.setGroupCollapsed(id, rawCollapsed);
  });

  ipcMain.handle(IPC.groupDelete, (event, rawId: unknown): void => {
    assertSenderIsMainWindow(event);
    const id = validateId(rawId, 'groupId');
    repo.deleteGroup(id);
  });

  // --- Экспорт / импорт (EXP-01…04) ---
  ipcMain.handle(IPC.hostsExport, async (event): Promise<{ saved: boolean }> => {
    assertSenderIsMainWindow(event);
    const win = getMainWindow();
    if (!win) return { saved: false };
    const res = await dialog.showSaveDialog(win, {
      title: t('hosts.export.dialogTitle'),
      defaultPath: 'lucidssh-hosts.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { saved: false };
    const data = buildExport(repo.listHosts(), repo.listGroups());
    await writeFile(res.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { saved: true };
  });

  ipcMain.handle(
    IPC.hostsImportPick,
    async (event): Promise<{ json: string; preview: ImportPreview } | null> => {
      assertSenderIsMainWindow(event);
      const win = getMainWindow();
      if (!win) return null;
      const res = await dialog.showOpenDialog(win, {
        title: t('hosts.import.dialogTitle'),
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      });
      const file = res.filePaths[0];
      if (res.canceled || !file) return null;
      const json = await readFile(file, 'utf8');
      try {
        return { json, preview: previewImport(json) };
      } catch (err) {
        if (err instanceof ImportFormatError || err instanceof IpcValidationError) {
          // Некорректный файл отклоняется с понятным сообщением (EXP-04)
          throw new Error(t('hosts.import.invalidFile'), { cause: err });
        }
        throw err;
      }
    }
  );

  ipcMain.handle(
    IPC.hostsImportApply,
    (event, rawJson: unknown, rawStrategy: unknown): { imported: number; skipped: number } => {
      assertSenderIsMainWindow(event);
      if (typeof rawJson !== 'string' || rawJson.length > 5_000_000) {
        throw new IpcValidationError('json: invalid');
      }
      if (rawStrategy !== 'skip' && rawStrategy !== 'rename') {
        throw new IpcValidationError('strategy: skip|rename expected');
      }
      try {
        return importHosts(rawJson, rawStrategy);
      } catch (err) {
        if (err instanceof ImportFormatError || err instanceof IpcValidationError) {
          throw new Error(t('hosts.import.invalidFile'), { cause: err });
        }
        throw err;
      }
    }
  );

  // --- Onboarding (OB-01, OB-03) ---
  ipcMain.handle(IPC.puttySessionsCount, (event): Promise<number> => {
    assertSenderIsMainWindow(event);
    return countPuttySessions();
  });

  ipcMain.handle(IPC.onboardingComplete, (event): void => {
    assertSenderIsMainWindow(event);
    updateConfig((cfg) => {
      cfg.onboarding.completed = true;
    });
  });

  ipcMain.handle(IPC.onboardingStatus, (event): boolean => {
    assertSenderIsMainWindow(event);
    // completed вычисляется лениво: конфиг + наличие хостов (OB-01)
    return loadOnboardingCompleted();
  });
}

function loadOnboardingCompleted(): boolean {
  return loadConfig().onboarding.completed || repo.listHosts().length > 0;
}
