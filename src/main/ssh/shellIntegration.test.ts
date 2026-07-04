import { describe, expect, it } from 'vitest';
import { BreadcrumbParser, buildCdCommand } from './shellIntegration';

const US = '\x1f';
const mk = (u: string, h: string, p: string, e: string, c = '0'): string =>
  `\x1b_lucidssh${US}${u}${US}${h}${US}${p}${US}${e}${US}${c}\x1b\\`;

describe('BreadcrumbParser', () => {
  it('вырезает маркер и извлекает breadcrumb + exit code', () => {
    const parser = new BreadcrumbParser();
    const { cleaned, marks } = parser.push(`before${mk('root', 'web-01', '/var/www', '0', '0')}after`);
    expect(cleaned).toBe('beforeafter'); // маркер не попал в вывод
    expect(marks).toHaveLength(1);
    expect(marks[0]?.crumb).toMatchObject({
      username: 'root',
      host: 'web-01',
      path: '/var/www',
      privilege: 'root' // euid 0
    });
    expect(marks[0]?.exitCode).toBe(0);
  });

  it('несёт ненулевой exit code', () => {
    const parser = new BreadcrumbParser();
    const { marks } = parser.push(mk('u', 'h', '/', '1000', '127'));
    expect(marks[0]?.exitCode).toBe(127);
  });

  it('обычный пользователь → privilege normal', () => {
    const parser = new BreadcrumbParser();
    const { marks } = parser.push(mk('ubuntu', 'srv', '/home/ubuntu', '1000'));
    expect(marks[0]?.crumb.privilege).toBe('normal');
  });

  it('собирает маркер, разрезанный между двумя чанками', () => {
    const parser = new BreadcrumbParser();
    const full = mk('root', 'h', '/etc', '0');
    const mid = Math.floor(full.length / 2);
    const r1 = parser.push('x' + full.slice(0, mid));
    expect(r1.marks).toHaveLength(0); // маркер ещё не завершён
    const r2 = parser.push(full.slice(mid) + 'y');
    expect(r2.marks).toHaveLength(1);
    expect(r1.cleaned + r2.cleaned).toBe('xy');
  });

  it('обычный вывод без маркеров проходит как есть', () => {
    const parser = new BreadcrumbParser();
    const { cleaned, marks } = parser.push('total 42\r\ndrwxr-xr-x 2 root root\r\n');
    expect(cleaned).toBe('total 42\r\ndrwxr-xr-x 2 root root\r\n');
    expect(marks).toHaveLength(0);
  });

  it('несколько маркеров в одном чанке', () => {
    const parser = new BreadcrumbParser();
    const { cleaned, marks } = parser.push(mk('a', 'h', '/', '0') + 'mid' + mk('a', 'h', '/tmp', '1000'));
    expect(cleaned).toBe('mid');
    expect(marks).toHaveLength(2);
    expect(marks[1]?.crumb.path).toBe('/tmp');
  });
});

describe('buildCdCommand', () => {
  it('оборачивает путь в кавычки', () => {
    expect(buildCdCommand('/var/www')).toBe("cd '/var/www'");
  });

  it('экранирует одинарные кавычки в пути (защита от инъекции, §19)', () => {
    expect(buildCdCommand("/tmp/a'b")).toBe("cd '/tmp/a'\\''b'");
  });
});
