import { userInfo } from 'node:os';
import type { ImportedHost } from '@shared/import';
import type { HostInput } from '@shared/hosts';
import { validateHostInput } from './validate';
import * as repo from './repository';

/**
 * Применение импорта из внешних источников (HM-03/HM-04). Каждый хост проходит
 * ту же строгую валидацию, что и обычный ввод; невалидные записи пропускаются,
 * а не роняют весь импорт. Секретов здесь нет — только путь к файлу ключа.
 */

function fallbackUsername(): string {
  try {
    const u = userInfo().username;
    // Приводим к допустимому формату (POSIX-подобный логин)
    const safe = u.replace(/[^A-Za-z0-9._-]/g, '');
    return safe.length > 0 ? safe : 'user';
  } catch {
    return 'user';
  }
}

/**
 * ImportedHost → сырой HostInput для валидации (guardEnabled по умолчанию
 * включён). `h.proxyJump` (сырой алиас из ~/.ssh/config, HM-04) сюда
 * намеренно не передаётся — резолв алиаса в proxyJumpHostId делает отдельный
 * тикет (06), после того как импортируемые хосты уже записаны в БД.
 */
function toRawInput(h: ImportedHost, defaultUser: string): Record<string, unknown> {
  return {
    name: h.name,
    address: h.address,
    port: h.port,
    username: h.username && h.username.length > 0 ? h.username : defaultUser,
    authMethod: h.authMethod,
    keyPath: h.keyPath,
    note: h.note,
    guardEnabled: true
  };
}

export function applyExternalImport(
  hosts: ImportedHost[],
  conflictStrategy: 'skip' | 'rename'
): { imported: number; skipped: number } {
  const defaultUser = fallbackUsername();
  let imported = 0;
  let skipped = 0;

  for (const h of hosts) {
    let input: HostInput;
    try {
      input = validateHostInput(toRawInput(h, defaultUser));
    } catch {
      skipped++; // невалидная запись (например, адрес с недопустимыми символами)
      continue;
    }

    if (repo.hostExists(input.address, input.username)) {
      if (conflictStrategy === 'skip') {
        skipped++;
        continue;
      }
      let candidate = input.name;
      let n = 2;
      while (repo.hostNameExists(candidate)) candidate = `${input.name} (${n++})`;
      input.name = candidate;
    }
    repo.createHost(input);
    imported++;
  }
  return { imported, skipped };
}
