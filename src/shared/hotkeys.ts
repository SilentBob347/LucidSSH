/**
 * Хоткеи приложения (SET-06 «Горячие клавиши» в Настройках, SET-10 —
 * редактирование биндингов). 11 задокументированных хоткеев: 9 редактируемых
 * (этот файл) + 2 зафиксированных, Esc и F1 (FIXED_HOTKEYS) — они всегда
 * закрывают текущую панель/диалог и открывают руководство соответственно,
 * в Настройках показаны без элемента редактирования (issue #1, тикет 01).
 *
 * Комбинация хранится и сравнивается как каноническая строка (normalizeCombo) —
 * один и тот же формат используют оба keydown-слушателя приложения (App.tsx —
 * глобальный, TerminalArea.tsx — терминальный) и захват новой комбинации в
 * Настройках, вместо разрозненных сравнений `e.key === '...'` по каждому месту.
 */

export const HOTKEY_ACTIONS = [
  'quickConnect',
  'openSettings',
  'openHistory',
  'openCatalog',
  'snippetPalette',
  'search',
  'closeTab',
  'copy',
  'paste'
] as const;

export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number];

export type FixedHotkeyAction = 'closePanel' | 'help';

/** Зафиксированные хоткеи — не редактируются, но участвуют в проверке
 *  конфликтов: биндинг редактируемого действия на Esc или F1 запрещён. */
export const FIXED_HOTKEYS: Record<FixedHotkeyAction, string> = {
  closePanel: 'Escape',
  help: 'F1'
};

/**
 * Заводские комбинации (SET-10, issue #1). Ctrl+L больше не перехватывается
 * приложением (раньше открывал каталог команд) — нажатие долетает до shell'а
 * непроцарапанным и по общей конвенции терминалов очищает экран; это не
 * двенадцатое действие приложения, а отсутствие перехвата. Каталог команд
 * получил новую комбинацию.
 */
export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  quickConnect: 'Ctrl+K',
  openSettings: 'Ctrl+,',
  openHistory: 'Ctrl+H',
  openCatalog: 'Ctrl+Shift+L',
  snippetPalette: 'Ctrl+Space',
  search: 'Ctrl+F',
  closeTab: 'Ctrl+W',
  copy: 'Ctrl+Shift+C',
  paste: 'Ctrl+Shift+V'
};

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space'
};

interface KeyLikeEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * Каноническая строка для keydown-события (например `"Ctrl+Shift+C"`), либо
 * null, если событие — само по себе нажатие клавиши-модификатора без основной
 * клавиши (нечего распознавать/захватывать).
 */
export function normalizeCombo(e: KeyLikeEvent): string | null {
  if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const token = NAMED_KEYS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (!token) return null;
  return [...mods, token].join('+');
}

/**
 * Комбинация допустима для редактируемого хоткея: хотя бы один модификатор
 * (Ctrl/Alt/Shift, без повторов) плюс одна основная клавиша — без модификатора
 * биндинг сломал бы обычный ввод в терминале/полях (issue #1, обсуждение).
 *
 * Esc и F1 (без модификатора) намеренно не проходят это условие — они должны
 * оставаться зафиксированными «по умолчанию» без исключений (решение в
 * обсуждении тикета 01, 05.08.2026): попытка нажать их во время захвата в
 * Настройках просто не засчитывается как готовая комбинация (см. капча-
 * обработчик HotkeysSection в SettingsScreen.tsx, Esc там же отдельно
 * отменяет захват — обычная конвенция, не «попытка биндинга»).
 */
export function isValidHotkeyCombo(combo: string): boolean {
  const parts = combo.split('+');
  if (parts.length < 2) return false;
  const key = parts[parts.length - 1];
  if (!key || key.length === 0 || key.length > 12) return false;
  const mods = parts.slice(0, -1);
  const seen = new Set<string>();
  for (const m of mods) {
    if (m !== 'Ctrl' && m !== 'Alt' && m !== 'Shift') return false;
    if (seen.has(m)) return false;
    seen.add(m);
  }
  if (key === 'Ctrl' || key === 'Alt' || key === 'Shift') return false;
  return true;
}

/** Отображение канонической комбинации в UI: `"Ctrl+Shift+C"` → `"Ctrl + Shift + C"`. */
export function formatComboForDisplay(combo: string): string {
  return combo.split('+').join(' + ');
}

/**
 * i18n-ключ действия (`settings.hk.<key>`) — общее место для двух экранов,
 * что показывают список из всех 11 хоткеев (Настройки → Горячие клавиши и
 * Справка → Горячие клавиши): у `help` действие исторически подписано
 * "guide" (открыть руководство), остальные id совпадают с ключом сами по себе.
 */
export function hotkeyLabelKey(id: HotkeyAction | FixedHotkeyAction): string {
  return id === 'help' ? 'guide' : id;
}

/**
 * id действия, уже занимающего `combo` — редактируемого (кроме `excludeAction`)
 * либо зафиксированного (Esc/F1) — или null, если комбинация свободна.
 */
export function findHotkeyConflict(
  combo: string,
  hotkeys: Record<HotkeyAction, string>,
  excludeAction?: HotkeyAction
): HotkeyAction | FixedHotkeyAction | null {
  for (const [id, value] of Object.entries(FIXED_HOTKEYS)) {
    if (value === combo) return id as FixedHotkeyAction;
  }
  for (const action of HOTKEY_ACTIONS) {
    if (action === excludeAction) continue;
    if (hotkeys[action] === combo) return action;
  }
  return null;
}
