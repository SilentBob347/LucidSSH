import { describe, expect, it } from 'vitest';
import { parseReleaseNotes } from './releaseNotes';

/**
 * Разбор release notes GitHub-релиза на секции `## RU` / `## EN` (тема:
 * changelog при обновлении). Технический текст пишется разработчиком вручную
 * при публикации — маркеры регистронезависимы, порядок секций произвольный.
 */

describe('parseReleaseNotes', () => {
  const both = ['## RU', '- Исправлен баг с подключением', '- Ускорен запуск', '', '## EN', '- Fixed connection bug', '- Faster startup'].join('\n');

  it('возвращает пункты нужного языка, когда есть обе секции', () => {
    expect(parseReleaseNotes(both, 'ru')).toEqual(['Исправлен баг с подключением', 'Ускорен запуск']);
    expect(parseReleaseNotes(both, 'en')).toEqual(['Fixed connection bug', 'Faster startup']);
  });

  it('падает обратно на EN, если RU-секции нет', () => {
    const enOnly = ['## EN', '- Fixed connection bug', '- Faster startup'].join('\n');
    expect(parseReleaseNotes(enOnly, 'ru')).toEqual(['Fixed connection bug', 'Faster startup']);
  });

  it('падает обратно на RU, если EN-секции нет', () => {
    const ruOnly = ['## RU', '- Исправлен баг с подключением', '- Ускорен запуск'].join('\n');
    expect(parseReleaseNotes(ruOnly, 'en')).toEqual(['Исправлен баг с подключением', 'Ускорен запуск']);
  });

  it('без маркеров секций возвращает весь текст одним пунктом', () => {
    expect(parseReleaseNotes('Просто текст без секций', 'ru')).toEqual(['Просто текст без секций']);
  });

  it('пустой или отсутствующий текст → пустой список', () => {
    expect(parseReleaseNotes(undefined, 'ru')).toEqual([]);
    expect(parseReleaseNotes('', 'ru')).toEqual([]);
  });
});
