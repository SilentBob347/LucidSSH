/**
 * Типы импорта хостов из внешних источников (HM-03 PuTTY, HM-04 ssh_config).
 * Импортируемые данные недоверенные (§12 гайда): исполняемые директивы
 * (ProxyCommand, LocalCommand, Match exec, KnownHostsCommand) НЕ выполняются,
 * а показываются как неподдерживаемые.
 */

export type ImportSource = 'putty' | 'ssh-config';

/** Хост, разобранный из внешнего источника (ещё не сохранён). */
export interface ImportedHost {
  name: string;
  address: string;
  port: number;
  username: string;
  authMethod: 'password' | 'key';
  keyPath?: string;
  proxyJump?: string;
  note?: string;
}

/** Неподдерживаемая/неисполняемая директива — показывается пользователю. */
export interface UnsupportedDirective {
  host: string;
  directive: string;
  value: string;
}

/** Результат разбора внешнего источника перед применением. */
export interface ExternalImportResult {
  source: ImportSource;
  hosts: ImportedHost[];
  unsupported: UnsupportedDirective[];
  /** Источник найден (реестр/файл существует), даже если хостов нет. */
  available: boolean;
}
