/**
 * Шина вставки текста в командный композер (нижняя строка ввода).
 * Каталог команд, история и сниппеты вставляют команду сюда — и она проходит
 * через Стража при отправке (GUARD-04, CAT-04, HIST-04). Компоненты-источники
 * не знают о композере напрямую.
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
