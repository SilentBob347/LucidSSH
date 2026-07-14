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
  sort_order: number;
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
    sortOrder: r.sort_order,
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
  input: Partial<Pick<SnippetInput, 'name' | 'command' | 'description'>> & {
    // undefined = поле не трогать, null = явно сделать глобальным (SNIP-05)
    hostId?: number | null;
  }
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
 * серверные этого хоста + глобальные (серверные первыми). Внутри каждой
 * группы — по ручному порядку sort_order (SNIP-10), затем по имени.
 */
export function listSnippets(hostId?: number): Snippet[] {
  const db = openHistoryDb();
  const rows =
    hostId === undefined
      ? (db
          .prepare(
            'SELECT * FROM snippets WHERE host_id IS NULL ORDER BY sort_order, name COLLATE NOCASE'
          )
          .all() as SnippetRow[])
      : (db
          .prepare(
            `SELECT * FROM snippets WHERE host_id = @hostId OR host_id IS NULL
             ORDER BY (host_id IS NULL), sort_order, name COLLATE NOCASE`
          )
          .all({ hostId }) as SnippetRow[]);
  return rows.map(rowToSnippet);
}

/**
 * Дубликат по совпадению команды в том же скоупе (undefined/null hostId —
 * глобальные, число — конкретный хост; глобальные и серверные не смешиваются).
 * Сравнение — по замаскированной команде (как она реально хранится),
 * excludeId исключает сам редактируемый сниппет из проверки.
 */
export function findDuplicateSnippet(
  command: string,
  hostId?: number,
  excludeId?: number
): Snippet | null {
  const { masked } = maskSecrets(command);
  const db = openHistoryDb();
  const row = (
    hostId === undefined
      ? db.prepare('SELECT * FROM snippets WHERE host_id IS NULL AND command = @command AND id != @excludeId')
      : db.prepare(
          'SELECT * FROM snippets WHERE host_id = @hostId AND command = @command AND id != @excludeId'
        )
  ).get({ hostId, command: masked, excludeId: excludeId ?? -1 }) as SnippetRow | undefined;
  return row ? rowToSnippet(row) : null;
}

export function getSnippet(id: number): Snippet | null {
  const row = openHistoryDb().prepare('SELECT * FROM snippets WHERE id = ?').get(id) as
    | SnippetRow
    | undefined;
  return row ? rowToSnippet(row) : null;
}

/** Ручной порядок сниппетов внутри одного скоупа (SNIP-10, drag-and-drop). */
export function reorderSnippets(orderedIds: number[]): void {
  const db = openHistoryDb();
  const update = db.prepare('UPDATE snippets SET sort_order = ? WHERE id = ?');
  const run = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => update.run(index, id));
  });
  run(orderedIds);
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
