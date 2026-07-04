import type { BackendModule, ReadCallback } from 'i18next';

/**
 * Backend i18next для renderer: словари приходят из main через preload-мост
 * (renderer в sandbox и не читает файлы сам). Добавление языка — новая папка
 * в assets/locales, код не меняется (CLAUDE.md §5a).
 */
export const ipcBackend: BackendModule = {
  type: 'backend',
  init() {
    // конфигурация не требуется
  },
  read(language: string, namespace: string, callback: ReadCallback) {
    window.lucidSSH
      .i18nGetResource(language, namespace)
      .then((data) => callback(null, data))
      .catch((err: unknown) => callback(err as Error, false));
  }
};
