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
  /** 'target' — подтверждение именем объекта, 'word' — общим словом подтверждения. */
  confirmationKind: 'target' | 'word';
  /** Текст, который нужно ввести для подтверждения (уже локализован). */
  confirmationText: string;
}

/** Категория риска потери SSH-доступа (GUARD-07). */
export type AccessRiskId = 'sshd-config' | 'firewall' | 'passwd' | 'sshd-service';

/**
 * Предупреждение о риске потери SSH-доступа (GUARD-07): не блокировка, а
 * рекомендация — модалка с двумя кнопками, без type-to-confirm.
 */
export interface AccessRiskPrompt {
  requestId: string;
  sessionId: string;
  command: string;
  riskId: AccessRiskId;
}

/** Результат отправки команды через Стража. */
export type SubmitResult =
  | { status: 'sent' }
  | { status: 'blocked'; prompt: DangerousCommandPrompt }
  | { status: 'access-risk'; prompt: AccessRiskPrompt };
