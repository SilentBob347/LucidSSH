/**
 * Чистые правила для текста, попадающего в строку ввода НЕ с клавиатуры
 * (вставка из буфера обмена, каталог, история, сниппеты, breadcrumb-«cd»).
 * Вынесены из XtermView, чтобы покрываться тестами без DOM/xterm.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_TAB_RE = /[\x00-\x08\x0a-\x1f\x7f-\x9f]/g;

/**
 * Убирает C0 (кроме таба), DEL и C1. Этим же определением «печатного»
 * пользуется processCommandChunk для набранного текста — фильтр один на оба
 * пути. Иначе ESC-последовательности во вставленном тексте
 * (`ESC[s … ESC[u ESC[K`) двигают/стирают локальное эхо, и на экране видна
 * не та строка, которая уйдёт на сервер по Enter.
 */
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_EXCEPT_TAB_RE, '');
}

/**
 * Принимает ли строка ввода программную вставку (каталог, история, сниппеты,
 * breadcrumb-«cd»). Активный промпт пароля её НЕ берёт: сниппет может быть
 * секретом, а вставка в промпт напечатала бы его открытым текстом и прилипла
 * бы к первой команде после входа. Пароль на промпт — только набором или
 * вставкой из буфера (classifyPaste → 'mask').
 */
export function acceptsInsert(authPromptActive: boolean, shellChannelOpen: boolean): boolean {
  return !authPromptActive && acceptsInput(authPromptActive, shellChannelOpen);
}

export type PasteRoute = 'ignore' | 'mask' | 'preview' | 'insert';

/**
 * Принимает ли терминал ввод вообще. Без Канала (подключение, переподключение,
 * обрыв) Набранной строки быть не может: единственное, что берёт ввод, —
 * активный промпт пароля (SSH-06). Остальное отбрасывается молча, не копится
 * и не эхуется — иначе пароль, набранный чуть раньше или позже промпта, виден
 * открытым текстом и прилипает к первой команде после входа.
 */
export function acceptsInput(authPromptActive: boolean, shellChannelOpen: boolean): boolean {
  return authPromptActive || shellChannelOpen;
}

/**
 * Куда уходит текст из буфера обмена — одно решение для всех маршрутов
 * вставки (правый клик, пункт контекстного меню, хоткей). Активный промпт
 * пароля/passphrase (SSH-06) важнее всего остального: секрет идёт в
 * маскированный перехватчик, а не в предпросмотр и не в строку ввода.
 */
export function classifyPaste(
  text: string,
  authPromptActive: boolean,
  shellChannelOpen: boolean
): PasteRoute {
  if (!text || !acceptsInput(authPromptActive, shellChannelOpen)) return 'ignore';
  if (authPromptActive) return 'mask';
  if (text.includes('\n') || text.includes('\r')) return 'preview';
  return 'insert';
}
