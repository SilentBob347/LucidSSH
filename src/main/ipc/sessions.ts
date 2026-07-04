import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc';
import type { ConnectionLogEntry, SessionStatus } from '@shared/ssh';
import {
  confirmHostKey,
  connectHost,
  destroySession,
  disconnectSession,
  getSession,
  getSessionLog,
  listSessions,
  resizeSession,
  sendInput
} from '../ssh/sessionManager';
import {
  cancelDangerousCommand,
  confirmDangerousCommand,
  submitCommand
} from '../guard/manager';
import type { SubmitResult } from '@shared/guard';
import { validateId } from '../hosts/validate';
import { assertSenderIsMainWindow, assertString, IpcValidationError } from './validate';

/**
 * IPC сессий (SSH-01…07, CLOG-01…03). Renderer оперирует только sessionId;
 * секреты и объекты соединений не пересекают границу процесса (SEC-05).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function validateSessionId(v: unknown): string {
  const id = assertString(v, 'sessionId', 36, UUID_RE);
  if (!getSession(id)) throw new IpcValidationError('sessionId: unknown');
  return id;
}

export function registerSessionIpcHandlers(): void {
  ipcMain.handle(IPC.sessionConnect, (event, rawHostId: unknown): Promise<{ sessionId: string }> => {
    assertSenderIsMainWindow(event);
    const hostId = validateId(rawHostId, 'hostId');
    return connectHost(hostId);
  });

  ipcMain.handle(IPC.sessionDisconnect, (event, rawSessionId: unknown): void => {
    assertSenderIsMainWindow(event);
    disconnectSession(validateSessionId(rawSessionId));
  });

  ipcMain.handle(IPC.sessionDestroy, (event, rawSessionId: unknown): void => {
    assertSenderIsMainWindow(event);
    destroySession(validateSessionId(rawSessionId));
  });

  ipcMain.handle(
    IPC.sessionList,
    (
      event
    ): Array<{ sessionId: string; hostId: number; hostName: string; status: SessionStatus }> => {
      assertSenderIsMainWindow(event);
      return listSessions();
    }
  );

  ipcMain.handle(IPC.sessionGetLog, (event, rawSessionId: unknown): ConnectionLogEntry[] => {
    assertSenderIsMainWindow(event);
    return getSessionLog(validateSessionId(rawSessionId));
  });

  // Ввод в терминал. Ограничение длины — защита от гигантских payload'ов;
  // распознавание опасных команд добавит Страж (Этап 4, GUARD-02).
  ipcMain.on(IPC.sessionSendInput, (event, rawSessionId: unknown, rawData: unknown): void => {
    assertSenderIsMainWindow(event);
    const id = validateSessionId(rawSessionId);
    if (typeof rawData !== 'string' || rawData.length > 100_000) {
      throw new IpcValidationError('data: invalid');
    }
    sendInput(id, rawData);
  });

  ipcMain.on(
    IPC.sessionResize,
    (event, rawSessionId: unknown, rawCols: unknown, rawRows: unknown): void => {
      assertSenderIsMainWindow(event);
      const id = validateSessionId(rawSessionId);
      const cols = Number(rawCols);
      const rows = Number(rawRows);
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || cols > 1000 || rows < 1 || rows > 1000) {
        throw new IpcValidationError('size: invalid');
      }
      resizeSession(id, cols, rows);
    }
  );

  ipcMain.handle(
    IPC.hostKeyConfirm,
    (event, rawRequestId: unknown, rawDecision: unknown): void => {
      assertSenderIsMainWindow(event);
      const requestId = assertString(rawRequestId, 'requestId', 36, UUID_RE);
      if (rawDecision !== 'accept' && rawDecision !== 'reject') {
        throw new IpcValidationError('decision: accept|reject expected');
      }
      confirmHostKey(requestId, rawDecision);
    }
  );

  // --- Страж (GUARD-02…04): команда проходит проверку в main до отправки ---
  ipcMain.handle(IPC.guardSubmit, (event, rawSessionId: unknown, rawCommand: unknown): SubmitResult => {
    assertSenderIsMainWindow(event);
    const sessionId = validateSessionId(rawSessionId);
    if (typeof rawCommand !== 'string' || rawCommand.length > 10_000) {
      throw new IpcValidationError('command: invalid');
    }
    return submitCommand(sessionId, rawCommand);
  });

  ipcMain.handle(
    IPC.guardConfirm,
    (event, rawRequestId: unknown, rawText: unknown): { allowed: boolean } => {
      assertSenderIsMainWindow(event);
      const requestId = assertString(rawRequestId, 'requestId', 36, UUID_RE);
      if (typeof rawText !== 'string' || rawText.length > 300) {
        throw new IpcValidationError('confirmationText: invalid');
      }
      return { allowed: confirmDangerousCommand(requestId, rawText) };
    }
  );

  ipcMain.on(IPC.guardCancel, (event, rawRequestId: unknown): void => {
    assertSenderIsMainWindow(event);
    const requestId = assertString(rawRequestId, 'requestId', 36, UUID_RE);
    cancelDangerousCommand(requestId);
  });
}
