import { execFile } from 'node:child_process';

/**
 * Детекция сессий PuTTY в реестре (для OB-01: кнопка «Импортировать из PuTTY»
 * показывается только при наличии сессий). Сам импорт — Этап 8 (HM-03).
 * Команда статическая, пользовательский ввод не подставляется (§19 гайда).
 */

const PUTTY_SESSIONS_KEY = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions';

export function countPuttySessions(): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', PUTTY_SESSIONS_KEY],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve(0); // ключа нет или reg недоступен — PuTTY-сессий нет
          return;
        }
        const count = stdout
          .split(/\r?\n/)
          .filter((line) => line.trim().startsWith(PUTTY_SESSIONS_KEY + '\\')).length;
        resolve(count);
      }
    );
  });
}
