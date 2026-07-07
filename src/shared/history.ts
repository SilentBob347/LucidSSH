/**
 * Типы истории команд и сниппетов (Data_Structures §3–4).
 * command в истории — УЖЕ замаскированная строка (HIST-07). Секретов в
 * структурах нет.
 */

export type GuardStatus = 'blocked' | 'confirmed';

export interface HistoryEntry {
  id: number;
  command: string; // маскированная
  hostId?: number;
  hostName: string; // денормализовано — читаемо после удаления хоста
  username: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  guardStatus?: GuardStatus;
  hasSecret: boolean;
  note?: string;
  output?: string; // маскированный и усечённый (см. history/repository.ts); undefined = не сохранён
  outputTruncated?: boolean;
}

export interface HistoryQuery {
  text?: string;
  hostId?: number;
  sessionId?: string; // фильтр «Эта сессия» — на стороне renderer по списку id
}

export type SnippetScope = 'global' | 'server';

export interface Snippet {
  id: number;
  name: string;
  command: string; // маскированная так же, как история
  description?: string;
  hostId?: number; // undefined/null = глобальный; число = серверный (SNIP-05)
  danger: boolean; // true если команда матчит паттерн опасных команд
  createdAt: string;
  updatedAt: string;
}

/** Запись новой команды в историю (main маскирует и проставляет метаданные). */
export interface HistoryRecordInput {
  command: string; // сырая — маскируется в main
  hostId?: number;
  hostName: string;
  username: string;
  exitCode?: number;
  guardStatus?: GuardStatus;
  output?: string; // сырой вывод команды — маскируется/усекается в main
}
