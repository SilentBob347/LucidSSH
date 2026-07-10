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
import { importPuttyPreview } from '../hosts/puttyImport';
import { importSshConfigPreview } from '../hosts/sshConfigImport';
import { applyExternalImport } from '../hosts/externalImport';
import type { ExternalImportResult, ImportedHost } from '@shared/import';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

  ipcMain.handle(IPC.hostsReorder, (event, rawIds: unknown): void => {
    assertSenderIsMainWindow(event);
    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 1000) {
      throw new IpcValidationError('orderedIds: non-empty array expected');
    }
    const ids = rawIds.map((id) => validateId(id, 'orderedIds[]'));
    // Все id должны существовать и принадлежать одной группе — иначе можно
    // было бы переносить хосты между группами в обход createHost/updateHost.
    const found = ids.map((id) => repo.getHost(id));
    if (found.some((h) => h === null)) throw new IpcValidationError('orderedIds: host not found');
    const groupIds = new Set(found.map((h) => h!.groupId ?? null));
    if (groupIds.size > 1) throw new IpcValidationError('orderedIds: hosts span multiple groups');
    repo.reorderHosts(ids);
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

  // --- Импорт из внешних источников (HM-03 PuTTY, HM-04 ssh_config) ---
  ipcMain.handle(IPC.importPuttyPreview, (event): Promise<ExternalImportResult> => {
    assertSenderIsMainWindow(event);
    return importPuttyPreview();
  });

  ipcMain.handle(
    IPC.importSshConfigPreview,
    async (event): Promise<ExternalImportResult | null> => {
      assertSenderIsMainWindow(event);
      const win = getMainWindow();
      if (!win) return null;
      // Файл выбирается пользователем; по умолчанию ~/.ssh/config
      const res = await dialog.showOpenDialog(win, {
        title: t('import.ssh.pickTitle'),
        defaultPath: join(homedir(), '.ssh', 'config'),
        properties: ['openFile', 'showHiddenFiles']
      });
      const file = res.filePaths[0];
      if (res.canceled || !file) return null;
      // Файл — недоверенные данные: только читается и разбирается (§12 гайда)
      return importSshConfigPreview(file);
    }
  );

  ipcMain.handle(
    IPC.importExternalApply,
    (event, rawHosts: unknown, rawStrategy: unknown): { imported: number; skipped: number } => {
      assertSenderIsMainWindow(event);
      if (rawStrategy !== 'skip' && rawStrategy !== 'rename') {
        throw new IpcValidationError('strategy: skip|rename expected');
      }
      const hosts = validateImportedHosts(rawHosts);
      return applyExternalImport(hosts, rawStrategy);
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

/**
 * Валидация массива ImportedHost, пришедшего из renderer при применении импорта.
 * Проверяем только базовую форму; строгую проверку каждого поля делает
 * applyExternalImport через validateHostInput (недоверенные данные, §12 гайда).
 */
function validateImportedHosts(raw: unknown): ImportedHost[] {
  if (!Array.isArray(raw) || raw.length > 10_000) {
    throw new IpcValidationError('hosts: array expected');
  }
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length <= 500 ? v : undefined;
  return raw.map((item): ImportedHost => {
    if (typeof item !== 'object' || item === null) {
      throw new IpcValidationError('host: object expected');
    }
    const r = item as Record<string, unknown>;
    return {
      name: str(r['name']) ?? '',
      address: str(r['address']) ?? '',
      port: typeof r['port'] === 'number' ? r['port'] : 22,
      username: str(r['username']) ?? '',
      authMethod: r['authMethod'] === 'key' ? 'key' : 'password',
      keyPath: str(r['keyPath']),
      proxyJump: str(r['proxyJump']),
      note: str(r['note'])
    };
  });
}
