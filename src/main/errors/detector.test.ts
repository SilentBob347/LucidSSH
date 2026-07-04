import { describe, expect, it } from 'vitest';
import { detectError, isEmptyOutput } from './detector';
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
