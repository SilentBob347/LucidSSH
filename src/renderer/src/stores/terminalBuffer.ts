/**
 * Буфер терминального вывода. Подписка на onTerminalData ставится один раз при
 * старте приложения — раньше, чем монтируется XtermView. Вывод, пришедший до
 * появления вью вкладки (например приветствие shell сразу после открытия
 * канала), накапливается и отдаётся вью при подключении. Без этого ранние
 * данные терялись из-за гонки connect ↔ mount.
 */

const backlog = new Map<string, string[]>();
const writers = new Map<string, (data: string) => void>();
let initialized = false;

export function initTerminalBuffer(): void {
  if (initialized) return;
  initialized = true;
  window.lucidSSH.onTerminalData((sessionId, data) => {
    const writer = writers.get(sessionId);
    if (writer) {
      writer(data);
    } else {
      const arr = backlog.get(sessionId) ?? [];
      arr.push(data);
      // ограничение на случай, если вкладка так и не открылась
      if (arr.length > 2000) arr.shift();
      backlog.set(sessionId, arr);
    }
  });
}

/** Вью вкладки начинает получать вывод: сперва накопленное, потом живой поток. */
export function attachTerminalWriter(sessionId: string, writer: (data: string) => void): void {
  const pending = backlog.get(sessionId);
  if (pending) {
    for (const chunk of pending) writer(chunk);
    backlog.delete(sessionId);
  }
  writers.set(sessionId, writer);
}

export function detachTerminalWriter(sessionId: string): void {
  writers.delete(sessionId);
}

export function dropTerminalBuffer(sessionId: string): void {
  writers.delete(sessionId);
  backlog.delete(sessionId);
}
