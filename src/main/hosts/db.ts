import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from '../config/store';

/**
 * hosts.db — SQLite-хранилище хостов и групп (Data_Structures.md §2).
 * Все запросы параметризованы; конкатенация значений в SQL запрещена (§18 гайда).
 * Перед необратимой миграцией создаётся резервная копия файла (UPD-04).
 */

let db: Database.Database | null = null;

/** Миграции применяются последовательно по user_version. */
const MIGRATIONS: string[] = [
  // v1 — исходная схема
  `
  CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    collapsed   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hosts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    address       TEXT    NOT NULL,
    port          INTEGER NOT NULL DEFAULT 22,
    username      TEXT    NOT NULL,
    auth_method   TEXT    NOT NULL,
    key_path      TEXT,
    group_id      INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    proxy_jump    TEXT,
    note          TEXT,
    guard_enabled INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
  );
  `
];

export function hostsDbPath(): string {
  return join(configDir(), 'hosts.db');
}

export function openHostsDb(): Database.Database {
  if (db) return db;
  mkdirSync(configDir(), { recursive: true });
  const path = hostsDbPath();
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const current = db.pragma('user_version', { simple: true }) as number;
  if (current < MIGRATIONS.length) {
    // Резервная копия перед изменением схемы существующей БД (UPD-04)
    if (current > 0 && existsSync(path)) {
      copyFileSync(path, `${path}.backup-v${current}`);
    }
    const migrate = db.transaction(() => {
      for (let v = current; v < MIGRATIONS.length; v++) {
        db!.exec(MIGRATIONS[v]!);
      }
      db!.pragma(`user_version = ${MIGRATIONS.length}`);
    });
    migrate();
  }
  return db;
}

export function closeHostsDb(): void {
  db?.close();
  db = null;
}
