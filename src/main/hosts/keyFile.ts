import { statSync } from 'node:fs';

/**
 * Проверка существования файла ключа на диске (HM-12, тикет 01).
 * Переиспользуется формой хоста (показ/скрытие «Создать новый ключ»)
 * и превью импорта хостов (тикет 03) — единая точка проверки.
 */
export function keyFileExists(path: string): boolean {
  if (path.trim().length === 0) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
