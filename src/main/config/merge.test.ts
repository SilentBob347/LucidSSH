import { describe, expect, it } from 'vitest';
import { mergeWithDefaults } from './merge';

const defaults = {
  version: '1.0.0',
  language: 'ru',
  window: { width: 1280, height: 800, maximized: false },
  history: { enabled: true, perHostDisabled: [] as number[] },
  shownCounts: {} as Record<string, number>
};

describe('mergeWithDefaults', () => {
  it('возвращает дефолты для повреждённого файла', () => {
    expect(mergeWithDefaults(defaults, null)).toEqual(defaults);
    expect(mergeWithDefaults(defaults, 'garbage')).toEqual(defaults);
    expect(mergeWithDefaults(defaults, [1, 2])).toEqual(defaults);
  });

  it('накладывает сохранённые значения на дефолты', () => {
    const merged = mergeWithDefaults(defaults, {
      language: 'en',
      window: { width: 900, maximized: true }
    });
    expect(merged.language).toBe('en');
    expect(merged.window).toEqual({ width: 900, height: 800, maximized: true });
  });

  it('отбрасывает неизвестные ключи', () => {
    const merged = mergeWithDefaults(defaults, { evil: 'x', language: 'en' });
    expect('evil' in merged).toBe(false);
  });

  it('заменяет значения с неверным типом дефолтом', () => {
    const merged = mergeWithDefaults(defaults, {
      language: 42,
      window: { width: 'wide' },
      history: { enabled: 'yes', perHostDisabled: [1, 2] }
    });
    expect(merged.language).toBe('ru');
    expect(merged.window.width).toBe(1280);
    expect(merged.history.enabled).toBe(true);
    expect(merged.history.perHostDisabled).toEqual([1, 2]);
  });

  it('в shownCounts принимает только числовые значения', () => {
    const merged = mergeWithDefaults(defaults, {
      shownCounts: { hintA: 2, hintB: 'many', hintC: Infinity }
    });
    expect(merged.shownCounts).toEqual({ hintA: 2 });
  });
});
