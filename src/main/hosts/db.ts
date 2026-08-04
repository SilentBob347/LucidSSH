import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from '../config/store';
import { resolveHostRefByName } from './resolveByName';

/**
 * hosts.db — SQLite-хранилище хостов и групп (Data_Structures.md §2).
 * Все запросы параметризованы; конкатенация значений в SQL запрещена (§18 гайда).
 * Перед необратимой миграцией создаётся резервная копия файла (UPD-04).
 */

let db: Database.Database | null = null;

type MigrationStep = string | ((db: Database.Database) => void);

/** Миграции применяются последовательно по user_version. */
const MIGRATIONS: MigrationStep[] = [
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
  `,
  // v2 — proxy_jump становится рабочей ссылкой на другой хост (SSH-05, jump-хост)
  (db) => {
    db.exec(
      'ALTER TABLE hosts ADD COLUMN proxy_jump_host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL'
    );
    // Тихая техническая миграция данных: старое значение proxy_jump (текст)
    // превращается в ссылку, только если совпадает с именем существующего
    // хоста; иначе остаётся пустым — без уведомления пользователя.
    const rows = db
      .prepare("SELECT id, proxy_jump FROM hosts WHERE proxy_jump IS NOT NULL AND proxy_jump <> ''")
      .all() as Array<{ id: number; proxy_jump: string }>;
    if (rows.length === 0) return;
    const allHosts = db.prepare('SELECT id, name FROM hosts').all() as Array<{
      id: number;
      name: string;
    }>;
    // Сначала разрешаем все алиасы, затем отбрасываем связи, нарушающие
    // single-hop (ADR-0006): ребро X→Y выживает, только если у самого Y нет
    // исходящего ребра. Так после миграции цепочка A→B→C превращается в B→C
    // (A остаётся без jump-хоста), а взаимные ссылки A↔B исчезают целиком —
    // ни одна пара не может дать второй прыжок. Данные и так были нерабочими
    // (proxy_jump никогда не участвовал в подключении), поэтому потеря
    // неоднозначной связи безопаснее, чем молча собранная цепочка.
    const edges = new Map<number, number>();
    for (const row of rows) {
      const jumpId = resolveHostRefByName(allHosts, row.proxy_jump);
      if (jumpId !== null && jumpId !== row.id) edges.set(row.id, jumpId);
    }
    const setJumpId = db.prepare('UPDATE hosts SET proxy_jump_host_id = ? WHERE id = ?');
    for (const [hostId, jumpId] of edges) {
      if (!edges.has(jumpId)) setJumpId.run(jumpId, hostId);
    }
  }
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
        const step = MIGRATIONS[v]!;
        if (typeof step === 'string') db!.exec(step);
        else step(db!);
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
