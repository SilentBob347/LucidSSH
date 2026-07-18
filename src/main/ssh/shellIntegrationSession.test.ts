import { describe, expect, it } from 'vitest';
import { ShellIntegrationSession } from './shellIntegrationSession';
import { SHELL_INTEGRATION_SETUP } from './shellIntegration';

const US = '\x1f';
const mk = (u: string, h: string, p: string, e: string, c = '0', sudoUser = ''): string =>
  `\x1b_lucidssh${US}${u}${US}${h}${US}${p}${US}${e}${US}${c}${US}${sudoUser}\x1b\\`;

/** Полный цикл подключения: MOTD → настройка (по таймеру тишины) → первый
 *  маркер (приветствие, тот самый, который отправляет сама настройка). После
 *  этого коробка в устойчивом состоянии — setupSent и firstMarkSeen истинны,
 *  EchoGate снова прозрачен — как в реальной сессии перед первой командой
 *  пользователя. Общий сетап для тестов, которым нужна именно эта точка. */
function warmUp(box: ShellIntegrationSession): void {
  box.feed('Welcome to Ubuntu 24.04\r\n');
  box.tick('setup-silence');
  box.feed(mk('u', 'h', '/home/u', '1000', '0'));
}

describe('ShellIntegrationSession.feed — MOTD и первый маркер', () => {
  it('MOTD до первой настройки виден в терминале как есть', () => {
    const box = new ShellIntegrationSession();
    const result = box.feed('Welcome to Ubuntu 24.04\r\n');
    expect(result.display).toBe('Welcome to Ubuntu 24.04\r\n');
    expect(result.timerActions).toContainEqual({ timer: 'setup-silence', action: 'schedule', ms: 300 });
  });

  it('первый маркер — приветствие, не порождает command-finished, но порождает breadcrumb', () => {
    const box = new ShellIntegrationSession();
    const result = box.feed(mk('nikita', 'web-01', '/home/nikita', '1000', '0'));
    expect(result.events).toEqual([
      { kind: 'breadcrumb', crumb: expect.objectContaining({ username: 'nikita' }) }
    ]);
  });
});

describe('ShellIntegrationSession.feed — обычная команда', () => {
  it('команда с ненулевым кодом выхода порождает command-finished после breadcrumb', () => {
    const box = new ShellIntegrationSession();
    warmUp(box);
    box.writeCommand('cat missing.txt');
    const result = box.feed(`cat: missing.txt: No such file or directory\r\n${mk('u', 'h', '/home/u', '1000', '1')}`);
    expect(result.events.map((e) => e.kind)).toEqual(['breadcrumb', 'command-finished']);
    const finished = result.events[1];
    if (finished?.kind !== 'command-finished') throw new Error('expected command-finished');
    expect(finished.command).toBe('cat missing.txt');
    expect(finished.exitCode).toBe(1);
    expect(finished.output).toBe('cat: missing.txt: No such file or directory\r\n');
    expect(finished.typed).toBe(true);
  });

  it('маркер-перерисовка приглашения без Enter (SIGWINCH) — без command-finished', () => {
    const box = new ShellIntegrationSession();
    warmUp(box);
    box.writeCommand('ls');
    const first = box.feed(mk('u', 'h', '/home/u', '1000', '0'));
    expect(first.events.map((e) => e.kind)).toEqual(['breadcrumb', 'command-finished']);

    // resize (открытие/закрытие панели детектора) — readline перепечатал
    // промпт со старым $?, Enter не отправлялся.
    const repaint = box.feed(mk('u', 'h', '/home/u', '1000', '0'));
    expect(repaint.events.map((e) => e.kind)).toEqual(['breadcrumb']);
  });
});

describe('ShellIntegrationSession — эскалация и реинжект (фикс BRD-03/04)', () => {
  it('эскалация взводит реинжект; тишина нового шелла запускает повтор настройки', () => {
    const box = new ShellIntegrationSession();
    warmUp(box);

    const cmdResult = box.writeCommand('sudo -i');
    expect(cmdResult.timerActions).toContainEqual({ timer: 'reinject', action: 'cancel' });

    // Новый шелл печатает что-то без маркера — тишина взводит таймер реинжекта.
    const dataResult = box.feed('root@web-01:~# ');
    expect(dataResult.timerActions).toContainEqual({ timer: 'reinject', action: 'cancel' });
    expect(dataResult.timerActions).toContainEqual({ timer: 'reinject', action: 'schedule', ms: 800 });

    const tickResult = box.tick('reinject');
    expect(tickResult.toWrite).toBe(SHELL_INTEGRATION_SETUP);
    expect(tickResult.timerActions).toContainEqual({ timer: 'echo-flush', action: 'schedule', ms: 3000 });
  });

  it('обычный маркер во время реинжекта — отбой (эскалация сорвалась/завершилась)', () => {
    const box = new ShellIntegrationSession();
    warmUp(box);
    box.writeCommand('su -');

    const result = box.feed(mk('u', 'h', '/home/u', '1000', '0'));
    expect(result.timerActions).toContainEqual({ timer: 'reinject', action: 'cancel' });
    // после отбоя следующая тишина без маркера больше не взводит реинжект
    const after = box.feed('some later output without marker');
    expect(after.timerActions).not.toContainEqual(
      expect.objectContaining({ timer: 'reinject', action: 'schedule' })
    );
  });

  it('запрос пароля во время реинжекта придерживает инжект (не отправляет настройку как пароль)', () => {
    const box = new ShellIntegrationSession();
    warmUp(box);
    box.writeCommand('sudo -i');

    const result = box.feed('[sudo] password for nikita:');
    // хвост оканчивается на приглашение ввода — таймер реинжекта НЕ взводится
    expect(result.timerActions).not.toContainEqual(
      expect.objectContaining({ timer: 'reinject', action: 'schedule' })
    );
    expect(result.timerActions).toContainEqual({ timer: 'reinject', action: 'cancel' });
  });
});

describe('ShellIntegrationSession — запрос пароля (TERM-09)', () => {
  it('явный запрос пароля вне эскалации порождает событие один раз, до следующего маркера', () => {
    const box = new ShellIntegrationSession();
    warmUp(box);
    const first = box.feed('Password:');
    expect(first.events).toEqual([{ kind: 'password-prompt' }]);
    const second = box.feed(' still waiting');
    expect(second.events).toEqual([]);
    // маркер сбрасывает признак — следующий запрос снова породит событие
    const afterMark = box.feed(mk('u', 'h', '/', '1000', '0'));
    expect(afterMark.events.some((e) => e.kind === 'password-prompt')).toBe(false);
  });
});

describe('ShellIntegrationSession — ash/BusyBox (маркер через PS1, без PROMPT_COMMAND)', () => {
  it('маркер, встроенный в PS1, разбирается так же, как маркер PROMPT_COMMAND', () => {
    const box = new ShellIntegrationSession();
    warmUp(box);
    box.writeCommand('ls /tmp');
    const result = box.feed(`file1  file2\r\n${mk('root', 'router', '/tmp', '0', '0')}`);
    const finished = result.events.find((e) => e.kind === 'command-finished');
    expect(finished).toBeDefined();
    if (finished?.kind !== 'command-finished') throw new Error('expected command-finished');
    expect(finished.exitCode).toBe(0);
  });
});

describe('ShellIntegrationSession.close — без единого маркера (nologin-паттерн)', () => {
  it('накопленный вывод возвращается как unmarked-output', () => {
    const box = new ShellIntegrationSession();
    box.feed('This account is currently not available.\r\n');
    const result = box.close();
    expect(result.events).toEqual([
      { kind: 'unmarked-output', output: 'This account is currently not available.\r\n' }
    ]);
  });

  it('пустой/пробельный вывод — событие не порождается', () => {
    const box = new ShellIntegrationSession();
    box.feed('   \r\n');
    expect(box.close().events).toEqual([]);
  });
});

describe('ShellIntegrationSession — отправка настройки (первый ввод/таймер)', () => {
  it('первый пользовательский ввод до истечения таймера сам отправляет настройку', () => {
    const box = new ShellIntegrationSession();
    const result = box.sendRawInput('l');
    expect(result.toWrite).toBe(SHELL_INTEGRATION_SETUP + 'l');
    expect(result.timerActions).toContainEqual({ timer: 'setup-silence', action: 'cancel' });
    expect(result.timerActions).toContainEqual({ timer: 'setup-cap', action: 'cancel' });
  });

  it('настройка отправляется один раз — повторный ввод не дублирует её', () => {
    const box = new ShellIntegrationSession();
    box.sendRawInput('l');
    const second = box.sendRawInput('s');
    expect(second.toWrite).toBe('s');
  });

  it('тишина после MOTD (тик setup-silence) отправляет настройку сама', () => {
    const box = new ShellIntegrationSession();
    box.feed('Welcome\r\n');
    const result = box.tick('setup-silence');
    expect(result.toWrite).toBe(SHELL_INTEGRATION_SETUP);
  });

  it('эхо-флаш по таймауту показывает накопленное и не теряет его как вывод (ERR-01)', () => {
    const box = new ShellIntegrationSession();
    box.sendRawInput('x'); // отправляет настройку, вооружает EchoGate
    box.feed('нераспознанное эхо без маркера');
    const result = box.tick('echo-flush');
    expect(result.display).toBe('нераспознанное эхо без маркера');
  });
});

describe('ShellIntegrationSession.writeCommand — эхо отправленной команды не дублируется', () => {
  it('эхо команды вырезается из следующего чанка вывода', () => {
    const box = new ShellIntegrationSession();
    warmUp(box);
    box.writeCommand('echo hi');
    const result = box.feed('echo hi\r\nhi\r\n');
    expect(result.display).toBe('hi\r\n');
  });
});
