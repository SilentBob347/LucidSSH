/**
 * Breadcrumb «где я» (BRD-01…04, Data_Structures §7.1).
 * Путь и привилегия приходят от сервера как ДАННЫЕ (не исполняются),
 * экранируются при отображении и при построении `cd` (§19 гайда).
 */
export interface Breadcrumb {
  username: string;
  host: string;
  path: string;
  privilege: 'normal' | 'sudo' | 'root';
}

/**
 * Безопасное построение команды `cd` по клику на сегмент breadcrumb (BRD-02).
 * Путь берётся из данных сервера — оборачиваем в одинарные кавычки с
 * экранированием, чтобы недоверенный путь не расширялся shell'ом. Живёт в
 * shared: строит команду renderer (BreadcrumbBar), main её не вызывает.
 * Голый `~` — единственное исключение: в кавычках он перестал бы раскрываться.
 */
export function buildCdCommand(path: string): string {
  if (path === '~') return 'cd ~';
  const escaped = path.replace(/'/g, `'\\''`);
  return `cd '${escaped}'`;
}
