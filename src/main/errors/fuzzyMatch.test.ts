import { describe, expect, it } from 'vitest';
import { extractCommandName, findCommandSuggestions, levenshteinDistance } from './fuzzyMatch';

describe('levenshteinDistance', () => {
  it('расстояние 0 для одинаковых строк', () => {
    expect(levenshteinDistance('ls', 'ls')).toBe(0);
  });

  it('считает вставку/удаление/замену', () => {
    expect(levenshteinDistance('cd', 'cat')).toBe(2);
  });

  it('перестановка соседних символов считается за одну правку (Дамерау-Левенштейн)', () => {
    expect(levenshteinDistance('sl', 'ls')).toBe(1);
    expect(levenshteinDistance('gerp', 'grep')).toBe(1);
  });

  it('пустая строка — длина другой строки', () => {
    expect(levenshteinDistance('', 'ls')).toBe(2);
    expect(levenshteinDistance('ls', '')).toBe(2);
  });
});

describe('extractCommandName', () => {
  it('берёт первое слово команды', () => {
    expect(extractCommandName('sl -la /var/log')).toBe('sl');
    expect(extractCommandName('  ls  ')).toBe('ls');
  });

  it('пустая строка → пустое имя', () => {
    expect(extractCommandName('')).toBe('');
  });
});

describe('findCommandSuggestions (ERR-07)', () => {
  const catalog = ['ls', 'cd', 'cat', 'cp', 'grep', 'ps', 'top'];

  it('находит единственного ближайшего кандидата (sl → ls) без более дальних cd/cp (дистанция 2)', () => {
    expect(findCommandSuggestions('sl', catalog)).toEqual(['ls']);
  });

  it('на коротких именах минимальный ярус может содержать несвязанные тай-варианты (sl → ls и ss, обе на дистанции 1) — это ожидаемо по ERR-07', () => {
    expect(findCommandSuggestions('sl', [...catalog, 'ss'])).toEqual(expect.arrayContaining(['ls', 'ss']));
  });

  it('не предлагает ничего при расстоянии > 2', () => {
    expect(findCommandSuggestions('qwzx', catalog)).toEqual([]);
  });

  it('пустая команда → нет кандидатов', () => {
    expect(findCommandSuggestions('', catalog)).toEqual([]);
  });

  it('несколько кандидатов на одинаковом минимальном расстоянии — до 3', () => {
    const near = ['ab', 'ac', 'ad', 'ae', 'zzzzz'];
    const result = findCommandSuggestions('aa', near);
    expect(result).toHaveLength(3);
    expect(result).toEqual(['ab', 'ac', 'ad']);
  });

  it('точное совпадение в каталоге не предлагается как «похожее» самому себе', () => {
    expect(findCommandSuggestions('ls', ['ls'])).toEqual([]);
  });
});
