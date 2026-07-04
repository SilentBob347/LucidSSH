/**
 * Типы Стража для IPC (Data_Structures.md §7.1).
 */

export type DangerScope = 'file' | 'directory' | 'disk' | 'other';

export interface DangerousCommandPrompt {
  requestId: string;
  sessionId: string;
  command: string;
  patternId: string;
  target: string; // реальный путь/объект (GUARD-03)
  scope: DangerScope;
  /** Что ввести для подтверждения: имя объекта или слово ПОДТВЕРЖДАЮ. */
  confirmationText: string;
}

/** Результат отправки команды через Стража. */
export type SubmitResult = { status: 'sent' } | { status: 'blocked'; prompt: DangerousCommandPrompt };
