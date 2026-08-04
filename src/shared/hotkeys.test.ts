import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOTKEYS,
  FIXED_HOTKEYS,
  HOTKEY_ACTIONS,
  findHotkeyConflict,
  formatComboForDisplay,
  isValidHotkeyCombo,
  normalizeCombo
} from './hotkeys';

/**
 * SET-10 (issue #1): нормализация нажатия в каноническую строку, проверка
 * конфликтов при ребиндинге и заводские комбинации без коллизий.
 */

function key(
  k: string,
  mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}
): { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean } {
  return {
    key: k,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false
  };
}

describe('normalizeCombo', () => {
  it('буква с Ctrl — заглавная буква после Ctrl+', () => {
    expect(normalizeCombo(key('l', { ctrl: true }))).toBe('Ctrl+L');
  });

  it('Ctrl+Shift — оба модификатора в фиксированном порядке', () => {
    expect(normalizeCombo(key('c', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+C');
  });

  it('пробел маппится в именованный токен Space', () => {
    expect(normalizeCombo(key(' ', { ctrl: true }))).toBe('Ctrl+Space');
  });

  it('именованные клавиши (F1, Escape) проходят как есть', () => {
    expect(normalizeCombo(key('F1'))).toBe('F1');
    expect(normalizeCombo(key('Escape'))).toBe('Escape');
  });

  it('metaKey трактуется как Ctrl (наравне с существующим соглашением в коде)', () => {
    expect(normalizeCombo(key('k', { meta: true }))).toBe('Ctrl+K');
  });

  it('нажатие самого модификатора без основной клавиши — null', () => {
    expect(normalizeCombo(key('Control', { ctrl: true }))).toBeNull();
    expect(normalizeCombo(key('Shift', { shift: true }))).toBeNull();
  });
});

describe('isValidHotkeyCombo', () => {
  it('комбинация с модификатором — валидна', () => {
    expect(isValidHotkeyCombo('Ctrl+L')).toBe(true);
    expect(isValidHotkeyCombo('Ctrl+Shift+C')).toBe(true);
  });

  it('без модификатора — невалидна (сломало бы обычный ввод)', () => {
    expect(isValidHotkeyCombo('L')).toBe(false);
  });

  it('повторяющийся модификатор — невалидна', () => {
    expect(isValidHotkeyCombo('Ctrl+Ctrl+L')).toBe(false);
  });

  it('модификатор сам по себе в роли основной клавиши — невалидна', () => {
    expect(isValidHotkeyCombo('Ctrl+Shift')).toBe(false);
  });

  it('Esc/F1 без модификатора — невалидны как и любая другая комбинация без модификатора: остаются зафиксированы без исключений (решение по тикету 01, 05.08.2026)', () => {
    expect(isValidHotkeyCombo(FIXED_HOTKEYS.closePanel)).toBe(false);
    expect(isValidHotkeyCombo(FIXED_HOTKEYS.help)).toBe(false);
  });
});

describe('findHotkeyConflict', () => {
  const map = { ...DEFAULT_HOTKEYS };

  it('свободная комбинация — null', () => {
    expect(findHotkeyConflict('Ctrl+Alt+Z', map)).toBeNull();
  });

  it('занято другим редактируемым действием — возвращает его id', () => {
    expect(findHotkeyConflict('Ctrl+K', map)).toBe('quickConnect');
  });

  it('своя собственная текущая комбинация не конфликтует сама с собой (excludeAction)', () => {
    expect(findHotkeyConflict('Ctrl+K', map, 'quickConnect')).toBeNull();
  });

  it('биндинг на Esc или F1 запрещён (зафиксированные хоткеи) — оставлено для защиты на уровне findHotkeyConflict, даже если оба вызывающих места (capture в Настройках, IPC-хендлер) уже отсекают Esc/F1 раньше через isValidHotkeyCombo', () => {
    expect(findHotkeyConflict(FIXED_HOTKEYS.closePanel, map)).toBe('closePanel');
    expect(findHotkeyConflict(FIXED_HOTKEYS.help, map)).toBe('help');
  });
});

describe('formatComboForDisplay', () => {
  it('вставляет пробелы вокруг +', () => {
    expect(formatComboForDisplay('Ctrl+Shift+C')).toBe('Ctrl + Shift + C');
  });
});

describe('DEFAULT_HOTKEYS (issue #1)', () => {
  it('Ctrl+L не занят ни одним заводским действием — доходит до shell, очищает экран', () => {
    expect(Object.values(DEFAULT_HOTKEYS)).not.toContain('Ctrl+L');
  });

  it('каталог команд получил новую комбинацию, отличную от Ctrl+L', () => {
    expect(DEFAULT_HOTKEYS.openCatalog).not.toBe('Ctrl+L');
  });

  it('ни одна заводская комбинация не конфликтует ни с другой заводской, ни с Esc/F1', () => {
    for (const action of HOTKEY_ACTIONS) {
      expect(findHotkeyConflict(DEFAULT_HOTKEYS[action], DEFAULT_HOTKEYS, action)).toBeNull();
    }
  });
});
