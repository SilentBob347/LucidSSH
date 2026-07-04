import { describe, expect, it } from 'vitest';
import { mergeCommands, mergeErrors } from './merge';

/**
 * Обязательное покрытие слияния ядра контент-баз с переводом (§10):
 * связь по id/name, fallback при отсутствии ключа.
 */

describe('mergeErrors', () => {
  const core = {
    version: '1.0.0',
    patterns: [
      {
        id: 'permission-denied',
        match: '(?i)permission denied',
        category: 'filesystem',
        scope: 'command' as const,
        checks: [{ command: 'sudo {original}' }, { command: 'whoami' }]
      },
      {
        id: 'only-in-fallback',
        match: 'x',
        category: 'system',
        scope: 'command' as const,
        checks: []
      }
    ]
  };
  const ru = {
    'permission-denied': { title: 'Недостаточно прав', explanation: 'нет прав', checks: ['С sudo', 'Кто я'] },
    'only-in-fallback': { title: 'Только ру', explanation: 'e', checks: [] }
  };

  it('связывает перевод по id и выравнивает checks по порядку', () => {
    const en = {
      'permission-denied': { title: 'Permission denied', explanation: 'no rights', checks: ['With sudo', 'Who am I'] }
    };
    const merged = mergeErrors(core, en, ru);
    expect(merged[0]).toMatchObject({
      id: 'permission-denied',
      match: '(?i)permission denied',
      title: 'Permission denied',
      explanation: 'no rights'
    });
    expect(merged[0]?.checks).toEqual([
      { text: 'With sudo', command: 'sudo {original}' },
      { text: 'Who am I', command: 'whoami' }
    ]);
  });

  it('fallback на ru при отсутствии ключа в активном языке', () => {
    const en = {}; // ничего не переведено
    const merged = mergeErrors(core, en, ru);
    expect(merged[0]?.title).toBe('Недостаточно прав'); // из ru
    expect(merged[1]?.title).toBe('Только ру');
  });

  it('заглушка при полном отсутствии перевода', () => {
    const merged = mergeErrors(core, {}, {});
    expect(merged[0]?.title).toBe('permission-denied'); // id как заглушка
    expect(merged[0]?.checks[0]?.text).toBe('');
    // regex не потерян
    expect(merged[0]?.match).toBe('(?i)permission denied');
  });
});

describe('mergeCommands', () => {
  const core = {
    version: '1.0.0',
    categories: ['files'] as const,
    commands: [
      { name: 'ls', category: 'files' as const, dangerous: false, flags: [{ flag: '-l' }, { flag: '-a' }] }
    ]
  };
  const ru = {
    categories: { files: 'Файлы' },
    commands: { ls: { summary: 'Список', keywords: ['список'], flags: { '-l': 'Подробно', '-a': 'Скрытые' } } }
  };

  it('связывает по name и по flag', () => {
    const en = {
      categories: { files: 'Files' },
      commands: { ls: { summary: 'List', keywords: ['list'], flags: { '-l': 'Long', '-a': 'All' } } }
    };
    const db = mergeCommands({ ...core, categories: [...core.categories] }, en, ru);
    expect(db.categoryLabels.files).toBe('Files');
    expect(db.commands[0]).toMatchObject({ name: 'ls', summary: 'List', dangerous: false });
    expect(db.commands[0]?.flags).toEqual([
      { flag: '-l', desc: 'Long' },
      { flag: '-a', desc: 'All' }
    ]);
  });

  it('fallback на ru для категории и флага', () => {
    const en = { categories: {}, commands: { ls: { summary: 'List', keywords: ['list'], flags: { '-l': 'Long' } } } };
    const db = mergeCommands({ ...core, categories: [...core.categories] }, en, ru);
    expect(db.categoryLabels.files).toBe('Файлы'); // fallback ru
    expect(db.commands[0]?.flags[1]?.desc).toBe('Скрытые'); // -a fallback ru
    expect(db.commands[0]?.flags[0]?.desc).toBe('Long'); // -l из en
  });

  it('regex/flag-имена (техническая часть) не переводятся', () => {
    const db = mergeCommands({ ...core, categories: [...core.categories] }, { categories: {}, commands: {} }, {
      categories: {},
      commands: {}
    });
    expect(db.commands[0]?.flags.map((f) => f.flag)).toEqual(['-l', '-a']);
    expect(db.commands[0]?.summary).toBe('ls'); // заглушка = имя
  });
});
