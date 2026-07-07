import { describe, expect, it } from 'vitest';
import { BreadcrumbParser, EchoGate, buildCdCommand } from './shellIntegration';

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

  it('pieces: текст разбит по позициям маркеров, длина = marks + 1', () => {
    const parser = new BreadcrumbParser();
    const { pieces, marks } = parser.push('echo' + mk('u', 'h', '/', '1000') + 'prompt$ ');
    expect(marks).toHaveLength(1);
    expect(pieces).toEqual(['echo', 'prompt$ ']);
  });

  it('pieces: чанк без маркеров — один кусок', () => {
    const parser = new BreadcrumbParser();
    const { pieces } = parser.push('plain output');
    expect(pieces).toEqual(['plain output']);
  });

  it('pieces: маркер, разрезанный между чанками, не создаёт ложных границ', () => {
    const parser = new BreadcrumbParser();
    const full = mk('u', 'h', '/', '1000');
    const mid = Math.floor(full.length / 2);
    const r1 = parser.push('a' + full.slice(0, mid));
    expect(r1.pieces).toEqual(['a']); // незавершённый маркер придержан
    const r2 = parser.push(full.slice(mid) + 'b');
    expect(r2.marks).toHaveLength(1);
    expect(r2.pieces).toEqual(['', 'b']);
  });
});

describe('EchoGate — подавление эха setup-команды (MOTD без прокрутки)', () => {
  it('неактивный гейт пропускает всё как есть', () => {
    const gate = new EchoGate();
    expect(gate.filter(['motd line\r\n'], 0)).toBe('motd line\r\n');
    expect(gate.active).toBe(false);
  });

  it('после arm() копит текст до маркера и не пересылает его', () => {
    const gate = new EchoGate();
    gate.arm();
    expect(gate.filter([' __lucidssh_mark() { …эхо…'], 0)).toBe('');
    expect(gate.filter(['…хвост эха…\r\n'], 0)).toBe('');
    expect(gate.active).toBe(true);
  });

  it('первый маркер: эхо отброшено, строка стёрта (\\r ESC[K), хвост чанка пересылается', () => {
    const gate = new EchoGate();
    gate.arm();
    gate.filter(['…эхо…'], 0);
    // чанк, где пришёл маркер: до маркера — остаток эха, после — новое приглашение
    const out = gate.filter(['конец эха', 'user@host:~$ '], 1);
    expect(out).toBe('\r\x1b[Kuser@host:~$ ');
    expect(gate.active).toBe(false);
  });

  it('после закрытия гейт снова прозрачен, повторные маркеры не влияют', () => {
    const gate = new EchoGate();
    gate.arm();
    gate.filter(['x', 'y'], 1);
    expect(gate.filter(['ls output', 'prompt$ '], 1)).toBe('ls outputprompt$ ');
  });

  it('flush по таймауту возвращает накопленное и выключает подавление', () => {
    const gate = new EchoGate();
    gate.arm();
    gate.filter(['вывод shell без маркеров'], 0);
    expect(gate.flush()).toBe('вывод shell без маркеров');
    expect(gate.active).toBe(false);
    expect(gate.filter(['дальше как обычно'], 0)).toBe('дальше как обычно');
  });

  it('два маркера в одном чанке (явный вызов + PROMPT_COMMAND): пересылается всё после первого', () => {
    const gate = new EchoGate();
    gate.arm();
    const out = gate.filter(['эхо', '', 'prompt$ '], 2);
    expect(out).toBe('\r\x1b[Kprompt$ ');
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
