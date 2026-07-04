import { randomUUID } from 'node:crypto';
import type { DangerousCommandPrompt, SubmitResult } from '@shared/guard';
import { getHost } from '../hosts/repository';
import { loadConfig } from '../config/store';
import {
  getSession,
  recordBlockedCommand,
  sendInput,
  setLastCommand
} from '../ssh/sessionManager';
import { analyzeCommand } from './patterns';

/**
 * Перехват команд Стражем в main process ДО отправки по SSH (GUARD-02).
 * Проверяются команды из всех источников: композер, каталог, история, сниппеты
 * (GUARD-04) — все они приходят через submitCommand.
 * Логирование в историю (blocked/confirmed, GUARD-06) добавится на Этапе 7.
 */

interface Pending {
  sessionId: string;
  command: string;
  confirmationText: string;
}

const pending = new Map<string, Pending>();

/** Активен ли Страж для сессии: глобально И для конкретного хоста (GUARD-05). */
function guardEnabledFor(sessionId: string): boolean {
  if (!loadConfig().guard.globalEnabled) return false;
  const session = getSession(sessionId);
  if (!session) return true;
  const host = getHost(session.hostId);
  return host ? host.guardEnabled : true;
}

/**
 * Отправка команды в сессию. Если Страж включён и команда распознана как
 * опасная — команда НЕ уходит на сервер, возвращается запрос подтверждения.
 * Иначе команда отправляется с переводом строки.
 */
export function submitCommand(sessionId: string, command: string): SubmitResult {
  const session = getSession(sessionId);
  if (!session) return { status: 'sent' }; // неизвестная сессия — IPC-слой уже отверг

  if (guardEnabledFor(sessionId)) {
    const danger = analyzeCommand(command);
    if (danger) {
      const requestId = randomUUID();
      pending.set(requestId, {
        sessionId,
        command,
        confirmationText: danger.confirmationText
      });
      const prompt: DangerousCommandPrompt = {
        requestId,
        sessionId,
        command,
        patternId: danger.patternId,
        target: danger.target,
        scope: danger.scope,
        confirmationText: danger.confirmationText
      };
      return { status: 'blocked', prompt };
    }
  }

  setLastCommand(sessionId, command); // для {original} в детекторе ошибок
  sendInput(sessionId, command + '\n');
  return { status: 'sent' };
}

/**
 * Подтверждение опасной команды: отправляется только при точном совпадении
 * введённого текста с именем объекта/словом подтверждения (GUARD-02).
 * Возвращает allowed — выполнилась ли отправка.
 */
export function confirmDangerousCommand(requestId: string, confirmationText: string): boolean {
  const p = pending.get(requestId);
  if (!p) return false;
  pending.delete(requestId);
  if (confirmationText !== p.confirmationText) return false;
  // Подтверждённая опасная команда попадёт в историю со статусом confirmed (HIST-05)
  setLastCommand(p.sessionId, p.command, 'confirmed');
  sendInput(p.sessionId, p.command + '\n');
  return true;
}

/** Отмена опасной команды пользователем — в историю как «заблокировано» (HIST-05). */
export function cancelDangerousCommand(requestId: string): void {
  const p = pending.get(requestId);
  pending.delete(requestId);
  if (p) recordBlockedCommand(p.sessionId, p.command);
}
