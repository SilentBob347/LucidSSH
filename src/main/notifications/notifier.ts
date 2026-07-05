import { Notification } from 'electron';
import { loadConfig } from '../config/store';
import { getMainWindow } from '../window/mainWindow';
import { t } from '../i18n';

/**
 * Системные уведомления Windows (NOTIF-01, NOTIF-02, NOTIF-04).
 * Тост показывается только когда окно не в фокусе (или свёрнуто) и уведомления
 * включены в Настройки → Интерфейс. Клик по тосту возвращает окно.
 */

/** Окно скрыто от пользователя → есть смысл показывать тост. */
function windowInactive(): boolean {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return false;
  return win.isMinimized() || !win.isFocused();
}

function toastsEnabled(): boolean {
  return loadConfig().ui.notifications.systemToasts && Notification.isSupported();
}

function show(title: string, body: string): void {
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  n.show();
}

/** NOTIF-01: соединение с хостом потеряно, окно не в фокусе. */
export function notifyDisconnect(hostName: string): void {
  if (!toastsEnabled() || !windowInactive()) return;
  show(hostName, t('notif.disconnect'));
}

/**
 * NOTIF-02: долгая или упавшая команда завершилась, окно не в фокусе.
 * Порог 0 отключает уведомления о командах целиком.
 */
export function notifyCommandDone(
  hostName: string,
  exitCode: number | null,
  durationMs: number
): void {
  const thresholdSec = loadConfig().ui.notifications.longCommandThresholdSec;
  if (thresholdSec <= 0) return;
  const failed = exitCode !== null && exitCode !== 0;
  const long = durationMs >= thresholdSec * 1000;
  if (!failed && !long) return;
  if (!toastsEnabled() || !windowInactive()) return;
  const body = failed
    ? t('notif.commandFailed', { code: exitCode ?? 0 })
    : t('notif.commandLong', { sec: Math.round(durationMs / 1000) });
  show(hostName, body);
}
