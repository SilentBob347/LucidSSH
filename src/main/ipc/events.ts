import type { RendererEvents } from '@shared/ipc';
import { getMainWindow } from '../window/mainWindow';

/**
 * Единственная дверь для событий main → renderer (ADR-0011).
 *
 * До неё отправка была размазана по шести хелперам разной формы (три дословные
 * копии `send(channel, ...args: unknown[])`, две специализированные в dashboard,
 * одна нульарная в updater) плюс три голых вызова в mainWindow — и копии уже
 * разошлись: три точки не проверяли `isDestroyed()`, пока семнадцать проверяли.
 *
 * Полезная нагрузка связана типами через `RendererEvents`; правило ESLint
 * запрещает `webContents.send` где-либо ещё.
 */
export function emit<K extends keyof RendererEvents>(
  channel: K,
  ...args: RendererEvents[K]
): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}
