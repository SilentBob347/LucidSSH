import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { configDir } from '../config/store';

/**
 * Единственное место, знающее раскладку резервных копий (UPD-04, HIST-08/09,
 * Data_Structures §3.6): `<db>.backup-vN` рядом с БД (копия перед миграцией) и
 * `backups/pre-update-<ts>/{hosts.db,history.db,config.json}` (копия перед
 * обновлением). Запись, ротация и очистка идут через эти функции.
 *
 * Ротация — после записи: сначала пишется новая копия, и только когда она
 * легла целиком, удаляются прежние того же вида. Упавшее копирование не должно
 * оставить пользователя вообще без копии.
 */

const PRE_UPDATE_PREFIX = 'pre-update-';

function backupsDir(): string {
  return join(configDir(), 'backups');
}

function listNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return []; // каталога ещё нет — копий тоже
  }
}

/** Удаляет все `<db>.backup-v*` этой БД, кроме `keepPath` (если задан). */
function pruneDbBackups(dbPath: string, keepPath?: string): void {
  const prefix = `${basename(dbPath)}.backup-v`;
  const dir = dirname(dbPath);
  for (const name of listNames(dir)) {
    if (name.startsWith(prefix) && join(dir, name) !== keepPath) rmSync(join(dir, name), { force: true });
  }
}

/** Удаляет все `backups/pre-update-*`, кроме `keepDir` (если задан). */
function prunePreUpdateBackups(keepDir?: string): void {
  const dir = backupsDir();
  for (const name of listNames(dir)) {
    if (name.startsWith(PRE_UPDATE_PREFIX) && join(dir, name) !== keepDir) {
      rmSync(join(dir, name), { recursive: true, force: true });
    }
  }
}

/**
 * Копия БД перед миграцией (UPD-04): `<db>.backup-v<version>`, после успешной
 * записи прежние `<db>.backup-v*` удаляются — одна копия на БД.
 */
export function writeDbBackup(dbPath: string, version: number): void {
  const copy = `${dbPath}.backup-v${version}`;
  copyFileSync(dbPath, copy);
  pruneDbBackups(dbPath, copy);
}

/**
 * Копия перед обновлением (UPD-04): `backups/pre-update-<ts>/` с перечисленными
 * файлами каталога данных (отсутствующие пропускаются). После успешной записи
 * прежние `pre-update-*` удаляются; при сбое недописанная папка убирается, а
 * прежняя копия остаётся.
 */
export function writePreUpdateBackup(fileNames: readonly string[]): void {
  const dir = configDir();
  const backupDir = join(backupsDir(), `${PRE_UPDATE_PREFIX}${Date.now()}`);
  try {
    mkdirSync(backupDir, { recursive: true });
    for (const name of fileNames) {
      const src = join(dir, name);
      if (existsSync(src)) copyFileSync(src, join(backupDir, name));
    }
  } catch (err) {
    rmSync(backupDir, { recursive: true, force: true });
    throw err;
  }
  prunePreUpdateBackups(backupDir);
}

/**
 * Удаляет все копии history.db (HIST-08/09): `history.db.backup-v*` и
 * `history.db` внутри `backups/pre-update-*` (hosts.db/config.json остаются).
 * Вычистить строки из копии нельзя — удаляется копия целиком.
 */
export function purgeHistoryBackups(historyDbPath: string): void {
  pruneDbBackups(historyDbPath);
  const dir = backupsDir();
  for (const name of listNames(dir)) {
    if (name.startsWith(PRE_UPDATE_PREFIX)) {
      rmSync(join(dir, name, basename(historyDbPath)), { force: true });
    }
  }
}
