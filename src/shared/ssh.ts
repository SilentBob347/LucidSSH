/**
 * Типы SSH-сессий и лога соединения (Data_Structures.md §7.1).
 * Секретов в этих структурах нет (SEC-01, CLOG-03).
 */

export type SessionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface SessionInfo {
  sessionId: string;
  hostId: number;
  hostName: string;
  status: SessionStatus;
}

export interface HostKeyPrompt {
  requestId: string;
  hostId: number;
  hostName: string;
  address: string;
  port: number;
  fingerprintSha256: string;
  isChanged: boolean; // true → ключ изменился, соединение заблокировано (SSH-04)
  previousFingerprint?: string;
}

/** Результат пробного подключения (кнопка «Проверить соединение»). */
export interface TestConnectionResult {
  ok: boolean;
  /** Ключ i18n причины при ok=false (без секретов). */
  errorKey?: string;
}

/** Запись known_hosts для показа в Настройки → Безопасность (SET-04). Без сырого ключа. */
export interface KnownHostView {
  line: number;
  host: string;
  keyType: string;
  fingerprint: string; // SHA256:...
}

export interface ConnectionLogEntry {
  timestamp: string; // ISO 8601
  level: 'info' | 'warn' | 'error';
  /** Ключ i18n + параметры: текст собирается на стороне отображения. Без секретов (CLOG-03). */
  messageKey: string;
  params?: Record<string, string | number>;
  step?: 'tcp' | 'handshake' | 'hostkey' | 'auth' | 'session';
}
