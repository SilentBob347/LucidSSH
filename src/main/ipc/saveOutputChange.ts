import type { AppConfig } from '@shared/config';
import { loadConfig } from '../config/store';
import { eraseStoredOutput } from '../history/repository';

/**
 * Применяет изменение конфига; если оно выключило «Сохранять вывод команд»
 * (HIST-09), стирает уже сохранённый вывод. Один хелпер для всех путей,
 * способных сбросить `history.saveOutput`: config:update и сброс до заводских
 * (SET-08) — иначе правило «выключили → стереть» пришлось бы помнить в каждом.
 */
export function applyConfigChange(change: () => AppConfig): AppConfig {
  const hadOutput = loadConfig().history.saveOutput;
  const next = change();
  if (hadOutput && !next.history.saveOutput) eraseStoredOutput();
  return next;
}
