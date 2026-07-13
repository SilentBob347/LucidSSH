/**
 * Шина вставки текста в текущую активную сессию терминала. Каталог команд,
 * история, сниппеты и breadcrumb («cd») вставляют команду сюда — и она
 * проходит через Стража на Enter (GUARD-04, CAT-04, HIST-04). Компоненты-
 * источники не знают о sessionId напрямую; мост на реальный терминал
 * регистрирует TerminalArea (см. `insertText`/`getPendingLine` в XtermView).
 */

type InsertHandler = (text: string) => void;

let handler: InsertHandler | null = null;
let valueGetter: (() => string) | null = null;

export function setComposerInsertHandler(h: InsertHandler | null): void {
  handler = h;
}

/** Регистрация геттера текущего текста композера (для «сохранить как сниппет»). */
export function setComposerValueGetter(g: (() => string) | null): void {
  valueGetter = g;
}

/** Вставить команду в композер (заменяет текущий ввод и фокусирует). */
export function insertIntoComposer(text: string): void {
  handler?.(text);
}

/** Текущий текст композера (для сохранения введённой команды как сниппета). */
export function getComposerValue(): string {
  return valueGetter?.() ?? '';
}
