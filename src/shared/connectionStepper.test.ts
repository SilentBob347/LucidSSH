import { describe, expect, it } from 'vitest';
import { deriveStepperState, STEPPER_STAGE_IDS } from './connectionStepper';
import type { ConnectionLogEntry } from './ssh';

function entry(
  messageKey: string,
  step: ConnectionLogEntry['step'],
  level: ConnectionLogEntry['level'] = 'info'
): ConnectionLogEntry {
  return { timestamp: new Date().toISOString(), level, messageKey, step };
}

function statusOf(state: ReturnType<typeof deriveStepperState>, id: (typeof STEPPER_STAGE_IDS)[number]) {
  return state.stages.find((s) => s.id === id)?.status;
}

describe('deriveStepperState (CLOG-04)', () => {
  it('пустой лог — dns активен, остальные ожидают', () => {
    const state = deriveStepperState([]);
    expect(statusOf(state, 'dns')).toBe('active');
    for (const id of ['port', 'handshake', 'hostkey', 'auth', 'shell'] as const) {
      expect(statusOf(state, id)).toBe('pending');
    }
    expect(state.frozen).toBe(false);
  });

  it('успешный проход всех шести этапов по порядку', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.greeting', 'tcp'),
      entry('clog.handshake', 'handshake'),
      entry('clog.hostkeyReceived', 'hostkey'),
      entry('clog.hostkeyKnown', 'hostkey'),
      entry('clog.ready', 'auth'),
      entry('clog.shellOpen', 'session')
    ];
    const state = deriveStepperState(entries);
    for (const id of STEPPER_STAGE_IDS) {
      expect(statusOf(state, id)).toBe('done');
    }
    expect(state.frozen).toBe(false);
    expect(state.errorEntry).toBeUndefined();
  });

  it('после greeting dns и порт завершены, handshake — в процессе', () => {
    const state = deriveStepperState([entry('clog.tcpConnecting', 'tcp'), entry('clog.greeting', 'tcp')]);
    expect(statusOf(state, 'dns')).toBe('done');
    expect(statusOf(state, 'port')).toBe('done');
    expect(statusOf(state, 'handshake')).toBe('active');
    expect(statusOf(state, 'hostkey')).toBe('pending');
  });

  it('сетевая ошибка на этапе tcp останавливает степпер на dns/порт', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.error.socket', 'tcp', 'error')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'dns')).toBe('error');
    expect(state.frozen).toBe(true);
    expect(state.errorEntry?.messageKey).toBe('clog.error.socket');
  });

  it('таймаут подключения тоже останавливает степпер на текущем незавершённом этапе', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.error.timeout', 'tcp', 'error')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'dns')).toBe('error');
    expect(state.frozen).toBe(true);
  });

  it('новый отпечаток сервера — hostkey остаётся «в процессе» пока не пришло решение', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.greeting', 'tcp'),
      entry('clog.handshake', 'handshake'),
      entry('clog.hostkeyReceived', 'hostkey'),
      entry('clog.hostkeyNew', 'hostkey')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'hostkey')).toBe('active');
    expect(statusOf(state, 'auth')).toBe('pending');
    expect(state.frozen).toBe(false);
  });

  it('подтверждение нового отпечатка продолжает степпер к авторизации', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.greeting', 'tcp'),
      entry('clog.handshake', 'handshake'),
      entry('clog.hostkeyReceived', 'hostkey'),
      entry('clog.hostkeyNew', 'hostkey'),
      entry('clog.hostkeyAccepted', 'hostkey', 'warn')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'hostkey')).toBe('done');
    expect(statusOf(state, 'auth')).toBe('active');
  });

  it('отказ подтвердить изменившийся отпечаток — ошибка на этапе hostkey', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.greeting', 'tcp'),
      entry('clog.handshake', 'handshake'),
      entry('clog.hostkeyReceived', 'hostkey'),
      entry('clog.hostkeyChanged', 'hostkey', 'warn'),
      entry('clog.hostkeyRejected', 'hostkey', 'warn')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'hostkey')).toBe('error');
    expect(state.frozen).toBe(true);
    expect(state.errorEntry?.messageKey).toBe('clog.hostkeyRejected');
  });

  it('таймаут решения по отпечатку — ошибка на этапе hostkey', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.greeting', 'tcp'),
      entry('clog.handshake', 'handshake'),
      entry('clog.hostkeyReceived', 'hostkey'),
      entry('clog.hostkeyNew', 'hostkey'),
      entry('clog.hostkeyTimeout', 'hostkey', 'warn')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'hostkey')).toBe('error');
    expect(state.frozen).toBe(true);
  });

  it('ошибка аутентификации останавливает степпер на этапе auth, не доходя до shell', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.greeting', 'tcp'),
      entry('clog.handshake', 'handshake'),
      entry('clog.hostkeyReceived', 'hostkey'),
      entry('clog.hostkeyKnown', 'hostkey'),
      entry('clog.error.auth', 'auth', 'error')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'auth')).toBe('error');
    expect(statusOf(state, 'shell')).toBe('pending');
    expect(state.frozen).toBe(true);
  });

  it('ошибка открытия shell-канала останавливает степпер на последнем этапе', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.greeting', 'tcp'),
      entry('clog.handshake', 'handshake'),
      entry('clog.hostkeyReceived', 'hostkey'),
      entry('clog.hostkeyKnown', 'hostkey'),
      entry('clog.ready', 'auth'),
      entry('clog.shellError', 'session', 'error')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'shell')).toBe('error');
    expect(state.frozen).toBe(true);
  });

  it('записи о дозаписи публичного ключа (HM-12) не влияют на этап shell', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.greeting', 'tcp'),
      entry('clog.handshake', 'handshake'),
      entry('clog.hostkeyReceived', 'hostkey'),
      entry('clog.hostkeyKnown', 'hostkey'),
      entry('clog.ready', 'auth'),
      entry('clog.keyDeployFailed', 'session', 'warn'),
      entry('clog.shellOpen', 'session')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'shell')).toBe('done');
    expect(state.frozen).toBe(false);
  });

  it('ошибка чтения приватного ключа (до создания Client) тоже останавливает степпер на auth', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.keyError.needs-passphrase', 'auth', 'error')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'auth')).toBe('error');
    expect(statusOf(state, 'shell')).toBe('pending');
    expect(state.frozen).toBe(true);
    expect(state.errorEntry?.messageKey).toBe('clog.keyError.needs-passphrase');
  });

  it('после заморозки на ошибке последующие записи лога игнорируются', () => {
    const entries: ConnectionLogEntry[] = [
      entry('clog.tcpConnecting', 'tcp'),
      entry('clog.error.socket', 'tcp', 'error'),
      entry('clog.handshake', 'handshake')
    ];
    const state = deriveStepperState(entries);
    expect(statusOf(state, 'dns')).toBe('error');
    expect(statusOf(state, 'handshake')).toBe('pending');
  });
});
