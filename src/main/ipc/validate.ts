import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { getMainWindow } from '../window/mainWindow';

/**
 * Валидация IPC в main process (SEC-05, §4 Security_Guide):
 * каждый аргумент проверяется по типу/формату/длине независимо от UI,
 * отправитель — только webContents главного окна.
 */

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcValidationError';
  }
}

export function assertSenderIsMainWindow(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const win = getMainWindow();
  if (!win || event.sender !== win.webContents) {
    throw new IpcValidationError('IPC from unknown sender rejected');
  }
  // Фреймы (iframe) не имеют права слать IPC — только top-level.
  if (event.senderFrame && event.senderFrame !== win.webContents.mainFrame) {
    throw new IpcValidationError('IPC from subframe rejected');
  }
}

export function assertString(value: unknown, name: string, maxLen: number, pattern?: RegExp): string {
  if (typeof value !== 'string') throw new IpcValidationError(`${name}: string expected`);
  if (value.length === 0 || value.length > maxLen) {
    throw new IpcValidationError(`${name}: invalid length`);
  }
  if (pattern && !pattern.test(value)) throw new IpcValidationError(`${name}: invalid format`);
  return value;
}
