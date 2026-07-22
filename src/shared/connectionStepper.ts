import type { ConnectionLogEntry } from './ssh';

/**
 * Живой степпер этапов подключения (CLOG-04): чистая проекция уже
 * собираемого лога соединения (CLOG-01/02) на шесть визуальных этапов —
 * новый механизм сбора данных не нужен, только интерпретация существующих
 * `ConnectionLogEntry` (см. private/TZ.md CLOG-04).
 *
 * ssh2/сессия различают только 5 значений `step` (tcp/handshake/hostkey/
 * auth/session) — DNS и «порт» физически один и тот же этап соединения
 * сокета (Node/ssh2 не сообщают отдельно об резолве DNS), поэтому оба
 * визуальных этапа управляются одними и теми же записями `step: 'tcp'`.
 */

export type StepperStageId = 'dns' | 'port' | 'handshake' | 'hostkey' | 'auth' | 'shell';

export const STEPPER_STAGE_IDS: readonly StepperStageId[] = [
  'dns',
  'port',
  'handshake',
  'hostkey',
  'auth',
  'shell'
];

export type StepperStageStatus = 'pending' | 'active' | 'done' | 'error';

export interface StepperStage {
  id: StepperStageId;
  status: StepperStageStatus;
}

export interface StepperState {
  stages: StepperStage[];
  /** true — на каком-то этапе произошла ошибка, дальнейшие записи лога игнорируются. */
  frozen: boolean;
  /** Запись лога, вызвавшая ошибку (для показа объяснения под степпером). */
  errorEntry?: ConnectionLogEntry;
}

const FINGERPRINT_ACCEPT_KEYS = new Set([
  'clog.hostkeyKnown',
  'clog.hostkeyAccepted',
  'clog.hostkeyReplaced'
]);
const FINGERPRINT_FAIL_KEYS = new Set(['clog.hostkeyRejected', 'clog.hostkeyTimeout']);

export function deriveStepperState(entries: ConnectionLogEntry[]): StepperState {
  const statuses = new Map<StepperStageId, StepperStageStatus>(
    STEPPER_STAGE_IDS.map((id, i) => [id, i === 0 ? 'active' : 'pending'])
  );
  let frozen = false;
  let errorEntry: ConnectionLogEntry | undefined;

  const firstNotDone = (): StepperStageId => {
    for (const id of STEPPER_STAGE_IDS) {
      if (statuses.get(id) !== 'done') return id;
    }
    return STEPPER_STAGE_IDS[STEPPER_STAGE_IDS.length - 1]!;
  };

  const complete = (id: StepperStageId): void => {
    statuses.set(id, 'done');
  };
  const completeThrough = (id: StepperStageId): void => {
    for (const stageId of STEPPER_STAGE_IDS) {
      if (stageId === id) return;
      complete(stageId);
    }
  };
  const activate = (id: StepperStageId): void => {
    if (statuses.get(id) === 'pending') statuses.set(id, 'active');
  };
  const fail = (id: StepperStageId, entry: ConnectionLogEntry): void => {
    statuses.set(id, 'error');
    frozen = true;
    errorEntry = entry;
  };

  for (const entry of entries) {
    if (frozen) break;

    switch (entry.step) {
      case 'tcp':
        if (entry.level === 'error') {
          fail(firstNotDone(), entry);
        } else if (entry.messageKey === 'clog.tcpConnecting') {
          activate('dns');
        } else {
          // clog.greeting и любой другой info на этапе tcp — сокет соединился.
          completeThrough('handshake');
          activate('handshake');
        }
        break;

      case 'handshake':
        completeThrough('hostkey');
        activate('hostkey');
        break;

      case 'hostkey':
        completeThrough('hostkey');
        if (FINGERPRINT_FAIL_KEYS.has(entry.messageKey)) {
          fail('hostkey', entry);
        } else if (FINGERPRINT_ACCEPT_KEYS.has(entry.messageKey)) {
          complete('hostkey');
          activate('auth');
        } else {
          // hostkeyReceived / hostkeyNew / hostkeyChanged — решение ещё не принято.
          activate('hostkey');
        }
        break;

      case 'auth':
        completeThrough('auth');
        // 'clog.error.auth' (сервер отклонил пароль/ключ) и 'clog.keyError.*'
        // (ключ не прочитан локально, до всякого обращения к серверу — establish()
        // в sessionManager.ts логирует это тем же 'auth'-этапом с level:'error',
        // Client даже не создаётся) — оба тупиковые для этого этапа.
        if (entry.level === 'error') {
          fail('auth', entry);
        } else if (entry.messageKey === 'clog.ready') {
          complete('auth');
          activate('shell');
        }
        break;

      case 'session':
        if (entry.messageKey === 'clog.shellOpen') {
          completeThrough('shell');
          complete('shell');
        } else if (entry.level === 'error') {
          completeThrough('shell');
          fail('shell', entry);
        }
        // keyDeployed/keyDeployExists/keyDeployFailed (level 'warn') и прочие
        // записи на этапе session не относятся к открытию shell — игнорируются.
        break;

      default:
        break;
    }
  }

  return {
    stages: STEPPER_STAGE_IDS.map((id) => ({ id, status: statuses.get(id)! })),
    frozen,
    errorEntry
  };
}
