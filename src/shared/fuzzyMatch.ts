/**
 * Общая (main + renderer) часть fuzzy-подбора команды (ERR-07). Замена
 * командного слова в исходной строке при клике на подсказку «возможно, вы
 * имели в виду: X?» — аргументы исходной команды сохраняются.
 */

/** Заменить командное слово в исходной строке, сохранив остальные аргументы (`sl -la` → `ls -la`). */
export function applyCommandSuggestion(command: string, suggestion: string): string {
  const trimmed = command.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return suggestion;
  return suggestion + trimmed.slice(firstSpace);
}
