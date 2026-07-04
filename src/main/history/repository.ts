import type {
  GuardStatus,
  HistoryEntry,
  HistoryQuery,
  HistoryRecordInput
} from '@shared/history';
import { openHistoryDb } from './db';
import { maskSecrets } from '../secrets/maskers';

/**
 * Репозиторий истории (HIST-01…07). Команда маскируется ПЕРЕД записью (HIST-07);
 * замаскированное значение нигде не восстанавливается. FIFO-лимит 10 000 (HIST-06).
 */

const FIFO_LIMIT = 10_000;

interface HistoryRow {
  id: number;
  command: string;
  host_id: number | null;
  host_name: string;
  username: string;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  guard_status: string | null;
  has_secret: number;
  note: string | null;
}

function rowToEntry(r: HistoryRow): HistoryEntry {
  return {
    id: r.id,
    command: r.command,
    hostId: r.host_id ?? undefined,
    hostName: r.host_name,
    username: r.username,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? undefined,
    exitCode: r.exit_code ?? undefined,
    guardStatus: (r.guard_status as GuardStatus | null) ?? undefined,
    hasSecret: r.has_secret === 1,
    note: r.note ?? undefined
  };
}

/** Записать команду. Возвращает id и признак наличия секрета (для бейджа). */
export function recordHistory(input: HistoryRecordInput): { id: number; hasSecret: boolean } {
  const { masked, hasSecret } = maskSecrets(input.command); // HIST-07
  const now = new Date().toISOString();
  const db = openHistoryDb();
  const res = db
    .prepare(
      `INSERT INTO history (command, host_id, host_name, username, started_at, finished_at,
         exit_code, guard_status, has_secret, note)
       VALUES (@command, @hostId, @hostName, @username, @startedAt, @finishedAt,
         @exitCode, @guardStatus, @hasSecret, NULL)`
    )
    .run({
      command: masked,
      hostId: input.hostId ?? null,
      hostName: input.hostName,
      username: input.username,
      startedAt: now,
      finishedAt: now,
      exitCode: input.exitCode ?? null,
      guardStatus: input.guardStatus ?? null,
      hasSecret: hasSecret ? 1 : 0
    });

  // FIFO: при превышении лимита удаляем старейшие, кроме избранных (HIST-06, §3.4)
  const count = db.prepare('SELECT COUNT(*) c FROM history').get() as { c: number };
  if (count.c > FIFO_LIMIT) {
    db.prepare(
      `DELETE FROM history WHERE id IN (
         SELECT id FROM history WHERE is_favorite = 0 ORDER BY started_at ASC LIMIT ?
       )`
    ).run(count.c - FIFO_LIMIT);
  }
  return { id: Number(res.lastInsertRowid), hasSecret };
}

export function listHistory(query?: HistoryQuery): HistoryEntry[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (query?.text) {
    // Поиск по команде и заметке (HIST-03). Секрет замаскирован → не всплывёт.
    clauses.push("(command LIKE @text OR IFNULL(note, '') LIKE @text)");
    params['text'] = `%${query.text}%`;
  }
  if (query?.hostId !== undefined) {
    clauses.push('host_id = @hostId');
    params['hostId'] = query.hostId;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = openHistoryDb()
    .prepare(`SELECT * FROM history ${where} ORDER BY started_at DESC LIMIT 2000`)
    .all(params) as HistoryRow[];
  return rows.map(rowToEntry);
}

export function totalHistoryCount(): number {
  return (openHistoryDb().prepare('SELECT COUNT(*) c FROM history').get() as { c: number }).c;
}

export function addHistoryNote(id: number, note: string): void {
  openHistoryDb().prepare('UPDATE history SET note = ? WHERE id = ?').run(note, id);
}

export function deleteHistoryEntry(id: number): void {
  openHistoryDb().prepare('DELETE FROM history WHERE id = ?').run(id);
}

export function clearHistory(): void {
  openHistoryDb().prepare('DELETE FROM history').run();
}
