import { describe, expect, it } from 'vitest';
import { detectError, isEmptyOutput, isNonErrorExitCode } from './detector';
import type { ErrorPattern } from '@shared/content';

const patterns: ErrorPattern[] = [
  {
    id: 'permission-denied',
    match: '(?i)permission denied',
    category: 'filesystem',
    scope: 'command',
    title: 'Недостаточно прав',
    explanation: 'нет прав',
    checks: [
      { text: 'С sudo', command: 'sudo {original}' },
      { text: 'Владелец', command: 'ls -la {target}' }
    ]
  },
  {
    id: 'ssh-connection-refused',
    match: '(?i)connection refused',
    category: 'network',
    scope: 'ssh-connection',
    title: 'Отклонено',
    explanation: 'нет сервиса',
    checks: []
  }
];

describe('detectError (ERR-01..06)', () => {
  it('распознаёт permission denied и подставляет {original}/{target}', () => {
    const r = detectError(patterns, 'command', 'nano: Permission denied', 1, 'nano /etc/nginx/nginx.conf');
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.explanation.title).toBe('Недостаточно прав');
      expect(r.explanation.source).toBe('database');
      expect(r.explanation.id).toBe('permission-denied');
      expect(r.explanation.checks[0]?.command).toBe('sudo nano /etc/nginx/nginx.conf');
      expect(r.explanation.checks[1]?.command).toBe('ls -la /etc/nginx/nginx.conf');
    }
  });

  it('уважает scope: command-паттерн не матчит ssh-ошибку и наоборот', () => {
    const r = detectError(patterns, 'ssh-connection', 'ssh: connect to host: Connection refused', null, '');
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.explanation.title).toBe('Отклонено');
    // permission denied есть только в scope command — в ssh-connection не сматчится
    const r2 = detectError(patterns, 'ssh-connection', 'Permission denied', null, '');
    expect(r2.matched).toBe(false);
  });

  it('ERR-08: command и stderr в explanation замаскированы (секрет не утекает в блок «для вопроса»)', () => {
    const r = detectError(
      patterns,
      'command',
      'nano: Permission denied',
      1,
      'export API_KEY=secret123 && nano /etc/nginx/nginx.conf'
    );
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.explanation.command).not.toContain('secret123');
      expect(r.explanation.command).toContain('API_KEY=••••••••');
      expect(r.explanation.exitCode).toBe(1);
      expect(r.explanation.stderr).toBe('nano: Permission denied');
    }
  });

  it('секрет не утекает через подстановку {original}/{target} в checks[].command', () => {
    const r = detectError(
      patterns,
      'command',
      'nano: Permission denied',
      1,
      'export API_KEY=secret123 && nano /etc/nginx/nginx.conf'
    );
    expect(r.matched).toBe(true);
    if (r.matched) {
      const checkCommands = r.explanation.checks.map((c) => c.command).join(' ');
      expect(checkCommands).not.toContain('secret123');
      expect(checkCommands).toContain('sudo export API_KEY=••••••••');
    }
  });

  it('нераспознанная ошибка → fallback doc-search (ERR-06)', () => {
    const r = detectError(patterns, 'command', 'weird custom error blah', 2, 'mycmd --foo');
    expect(r.matched).toBe(false);
    if (!r.matched) {
      expect(r.fallback.kind).toBe('doc-search');
      expect(r.fallback.command).toBe('mycmd --foo');
      expect(r.fallback.exitCode).toBe(2);
      expect(r.fallback.stderrExcerpt).toContain('weird custom error');
    }
  });

  it('повреждённый regex не роняет детектор', () => {
    const bad: ErrorPattern[] = [
      { id: 'x', match: '(unclosed', category: 'c', scope: 'command', title: 't', explanation: 'e', checks: [] }
    ];
    expect(() => detectError(bad, 'command', 'anything', 1, 'cmd')).not.toThrow();
  });

  it('isEmptyOutput распознаёт пустой stderr', () => {
    expect(isEmptyOutput('   \n  \r\n ')).toBe(true);
    expect(isEmptyOutput('error!')).toBe(false);
  });
});

describe('isNonErrorExitCode (исключения из ERR-01, найдены при тестировании 2026-07-24)', () => {
  it('systemctl status с кодом 1/2/3 (unit dead/not running) — не ошибка', () => {
    const output = 'football-bot.service - Football Predict Bot\n   Active: inactive (dead)';
    expect(isNonErrorExitCode('sudo systemctl status football-bot', output, 3)).toBe(true);
    expect(isNonErrorExitCode('systemctl status football-bot', output, 1)).toBe(true);
    expect(isNonErrorExitCode('systemctl status football-bot', output, 2)).toBe(true);
  });

  it('systemctl status с кодом 4 (unit не найден/статус неизвестен) — это ошибка', () => {
    const output = 'Unit football-boot.service could not be found.';
    expect(isNonErrorExitCode('systemctl status football-boot', output, 4)).toBe(false);
  });

  it('service <юнит> status с кодом 3 — не ошибка', () => {
    expect(isNonErrorExitCode('service ssh status', 'ssh is not running', 3)).toBe(true);
  });

  it('составная команда с явным 2>/dev/null и пустым stderr — не ошибка', () => {
    const cmd = 'ls -la ~/venv_broken_backup_* 2>/dev/null && rm -rf ~/venv_broken_backup_*';
    expect(isNonErrorExitCode(cmd, '', 2)).toBe(true);
  });

  it('та же составная команда без 2>/dev/null — по-прежнему ошибка', () => {
    const cmd = 'mkdir /root/protected && cd /root/protected';
    expect(isNonErrorExitCode(cmd, '', 1)).toBe(false);
  });

  it('составная команда с 2>/dev/null, но непустым stderr — по-прежнему ошибка', () => {
    const cmd = 'grep foo file.txt 2>/dev/null && rm file.txt';
    expect(isNonErrorExitCode(cmd, 'rm: cannot remove file.txt: Permission denied', 1)).toBe(false);
  });

  it('отказ от Y/n-подтверждения (реальный кейс apt --reinstall) — не ошибка', () => {
    const output = [
      'Need to get 3173 kB of archives.',
      'After this operation, 0 B of additional disk space will be used.',
      'Do you want to continue? [Y/n] n',
      'Abort.'
    ].join('\n');
    expect(isNonErrorExitCode('sudo apt install --reinstall python3.12', output, 1)).toBe(true);
  });

  it('согласие на Y/n-подтверждение с реальной ошибкой позже — по-прежнему ошибка', () => {
    const output = [
      'Do you want to continue? [Y/n] y',
      'Setting up somepkg ...',
      'somepkg: E: dependency not satisfiable'
    ].join('\n');
    expect(isNonErrorExitCode('apt install somepkg', output, 100)).toBe(false);
  });

  it('exitCode null — не триггерит ни одно исключение', () => {
    expect(isNonErrorExitCode('systemctl status foo', 'inactive', null)).toBe(false);
  });
});
