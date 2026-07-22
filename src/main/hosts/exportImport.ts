import type { Host, HostGroup, HostInput, ImportPreview } from '@shared/hosts';
import { validateHostInput } from './validate';
import { keyFileExists } from './keyFile';
import * as repo from './repository';

/**
 * Экспорт/импорт хостов в JSON (EXP-01…EXP-04).
 * Секреты НЕ экспортируются — только путь к файлу ключа (EXP-01).
 * Импортируемый JSON — недоверенные данные: строгая валидация схемы,
 * содержимое не исполняется (EXP-04).
 */

export const EXPORT_FORMAT = 'lucidssh-hosts';
export const EXPORT_VERSION = 1;

interface ExportedGroup {
  name: string;
  collapsed: boolean;
}

interface ExportedHost {
  name: string;
  address: string;
  port: number;
  username: string;
  authMethod: string;
  keyPath?: string;
  group?: string; // имя группы, не id — переносимо между машинами
  proxyJump?: string;
  note?: string;
  guardEnabled: boolean;
}

export interface HostsExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  groups: ExportedGroup[];
  hosts: ExportedHost[];
}

export function buildExport(hosts: Host[], groups: HostGroup[]): HostsExportFile {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    groups: groups.map((g) => ({ name: g.name, collapsed: g.collapsed })),
    hosts: hosts.map((h) => ({
      name: h.name,
      address: h.address,
      port: h.port,
      username: h.username,
      authMethod: h.authMethod,
      // ВАЖНО: никаких паролей/passphrase/содержимого ключей (EXP-01)
      keyPath: h.keyPath,
      group: h.groupId !== undefined ? groupById.get(h.groupId)?.name : undefined,
      proxyJump: h.proxyJump,
      note: h.note,
      guardEnabled: h.guardEnabled
    }))
  };
}

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}

/** Парсит и валидирует файл импорта. Бросает ImportFormatError с понятной причиной. */
export function parseImportFile(json: string): { hosts: HostInput[]; groups: string[] } {
  if (json.length > 5_000_000) throw new ImportFormatError('file too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ImportFormatError('not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ImportFormatError('unexpected structure');
  }
  const root = parsed as Record<string, unknown>;
  if (root['format'] !== EXPORT_FORMAT) throw new ImportFormatError('unknown format');
  if (typeof root['version'] !== 'number' || root['version'] > EXPORT_VERSION) {
    throw new ImportFormatError('unsupported version');
  }
  if (!Array.isArray(root['hosts'])) throw new ImportFormatError('hosts array missing');
  if (root['hosts'].length > 10_000) throw new ImportFormatError('too many hosts');

  const groupNames = new Set<string>();
  const hosts: HostInput[] = [];
  const hostGroupNames: (string | undefined)[] = [];

  for (const rawHost of root['hosts']) {
    if (typeof rawHost !== 'object' || rawHost === null) {
      throw new ImportFormatError('host entry is not an object');
    }
    const rec = rawHost as Record<string, unknown>;
    const groupName =
      typeof rec['group'] === 'string' && rec['group'].length > 0 && rec['group'].length <= 60
        ? rec['group']
        : undefined;
    // Каждый хост проходит ту же строгую валидацию, что и IPC-ввод (EXP-04)
    const input = validateHostInput({
      name: rec['name'],
      address: rec['address'],
      port: rec['port'],
      username: rec['username'],
      authMethod: rec['authMethod'],
      keyPath: rec['keyPath'],
      proxyJump: rec['proxyJump'],
      note: rec['note'],
      guardEnabled: typeof rec['guardEnabled'] === 'boolean' ? rec['guardEnabled'] : true
    });
    if (groupName) groupNames.add(groupName);
    hostGroupNames.push(groupName);
    hosts.push(input);
  }

  // groupId проставим при импорте; временно храним имя группы в поле note? Нет —
  // возвращаем группы отдельно, а соответствие восстанавливаем по индексу.
  return {
    hosts: hosts.map((h, i) => ({ ...h, groupName: hostGroupNames[i] }) as HostInputWithGroup),
    groups: [...groupNames]
  };
}

export type HostInputWithGroup = HostInput & { groupName?: string };

export function previewImport(json: string): ImportPreview {
  const { hosts } = parseImportFile(json);
  let toAdd = 0;
  let missingKeyCount = 0;
  const conflicts: ImportPreview['conflicts'] = [];
  for (const h of hosts) {
    if (repo.hostExists(h.address, h.username)) {
      conflicts.push({ name: h.name, address: h.address, username: h.username });
      continue; // конфликтующий хост может быть пропущен и не создастся — ключ ему не понадобится
    }
    toAdd++;
    if (h.authMethod === 'key' && !keyFileExists(h.keyPath ?? '')) {
      missingKeyCount++;
    }
  }
  return { toAdd, toSkip: conflicts.length, conflicts, missingKeyCount };
}

/** Импорт: конфликт (address+username совпали) — пропустить или переименовать (EXP-02). */
export function importHosts(
  json: string,
  conflictStrategy: 'skip' | 'rename'
): { imported: number; skipped: number } {
  const { hosts, groups } = parseImportFile(json);

  const groupIdByName = new Map<string, number>();
  for (const g of repo.listGroups()) groupIdByName.set(g.name, g.id);
  for (const name of groups) {
    if (!groupIdByName.has(name)) groupIdByName.set(name, repo.createGroup(name));
  }

  let imported = 0;
  let skipped = 0;
  for (const h of hosts as HostInputWithGroup[]) {
    const { groupName, ...input } = h;
    if (repo.hostExists(input.address, input.username)) {
      if (conflictStrategy === 'skip') {
        skipped++;
        continue;
      }
      // rename: подобрать свободное имя «name (2)», «name (3)»…
      let candidate = input.name;
      let n = 2;
      while (repo.hostNameExists(candidate)) {
        candidate = `${input.name} (${n++})`;
      }
      input.name = candidate;
    }
    repo.createHost({
      ...input,
      groupId: groupName ? groupIdByName.get(groupName) : undefined
    });
    imported++;
  }
  return { imported, skipped };
}
