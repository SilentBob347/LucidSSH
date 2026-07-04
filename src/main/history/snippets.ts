import type { Snippet } from '@shared/history';
import { openHistoryDb } from './db';
import { maskSecrets } from '../secrets/maskers';
import { analyzeCommand } from '../guard/patterns';

/**
 * Репозиторий сниппетов (SNIP-01…08). Команда маскируется как в истории;
 * danger вычисляется при сохранении через паттерны Стража. Область видимости:
 * host_id = NULL (глобальный) или id хоста (серверный, SNIP-05).
 */

interface SnippetRow {
  id: number;
  name: string;
  command: string;
  description: string | null;
  host_id: number | null;
  danger: number;
  created_at: string;
  updated_at: string;
}

function rowToSnippet(r: SnippetRow): Snippet {
  return {
    id: r.id,
    name: r.name,
    command: r.command,
    description: r.description ?? undefined,
    hostId: r.host_id ?? undefined,
    danger: r.danger === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export interface SnippetInput {
  name: string;
  command: string;
  description?: string;
  hostId?: number; // undefined = глобальный
}

export function createSnippet(input: SnippetInput): { id: number } {
  const { masked } = maskSecrets(input.command);
  const danger = analyzeCommand(input.command) !== null;
  const now = new Date().toISOString();
  const res = openHistoryDb()
    .prepare(
      `INSERT INTO snippets (name, command, description, host_id, danger, created_at, updated_at)
       VALUES (@name, @command, @description, @hostId, @danger, @now, @now)`
    )
    .run({
      name: input.name,
      command: masked,
      description: input.description ?? null,
      hostId: input.hostId ?? null,
      danger: danger ? 1 : 0,
      now
    });
  return { id: Number(res.lastInsertRowid) };
}

export function updateSnippet(
  id: number,
  input: Partial<Pick<SnippetInput, 'name' | 'command' | 'description' | 'hostId'>>
): void {
  const existing = openHistoryDb().prepare('SELECT * FROM snippets WHERE id = ?').get(id) as
    | SnippetRow
    | undefined;
  if (!existing) return;
  const command = input.command !== undefined ? maskSecrets(input.command).masked : existing.command;
  const danger =
    input.command !== undefined ? (analyzeCommand(input.command) !== null ? 1 : 0) : existing.danger;
  openHistoryDb()
    .prepare(
      `UPDATE snippets SET name = @name, command = @command, description = @description,
         host_id = @hostId, danger = @danger, updated_at = @now WHERE id = @id`
    )
    .run({
      id,
      name: input.name ?? existing.name,
      command,
      description: input.description !== undefined ? input.description : existing.description,
      hostId: input.hostId !== undefined ? input.hostId : existing.host_id,
      danger,
      now: new Date().toISOString()
    });
}

/**
 * Список сниппетов (SNIP-06): без hostId — только глобальные; с hostId —
 * серверные этого хоста + глобальные (серверные первыми).
 */
export function listSnippets(hostId?: number): Snippet[] {
  const db = openHistoryDb();
  const rows =
    hostId === undefined
      ? (db
          .prepare('SELECT * FROM snippets WHERE host_id IS NULL ORDER BY name COLLATE NOCASE')
          .all() as SnippetRow[])
      : (db
          .prepare(
            `SELECT * FROM snippets WHERE host_id = @hostId OR host_id IS NULL
             ORDER BY (host_id IS NULL), name COLLATE NOCASE`
          )
          .all({ hostId }) as SnippetRow[]);
  return rows.map(rowToSnippet);
}

export function deleteSnippet(id: number): void {
  openHistoryDb().prepare('DELETE FROM snippets WHERE id = ?').run(id);
}

export function hostHasSnippets(hostId: number): boolean {
  return (
    openHistoryDb().prepare('SELECT 1 FROM snippets WHERE host_id = ? LIMIT 1').get(hostId) !==
    undefined
  );
}

/** При удалении хоста: удалить серверные сниппеты или сделать глобальными (SNIP-07). */
export function resolveHostSnippets(hostId: number, action: 'delete' | 'make-global'): void {
  const db = openHistoryDb();
  if (action === 'delete') {
    db.prepare('DELETE FROM snippets WHERE host_id = ?').run(hostId);
  } else {
    db.prepare('UPDATE snippets SET host_id = NULL WHERE host_id = ?').run(hostId);
  }
}
