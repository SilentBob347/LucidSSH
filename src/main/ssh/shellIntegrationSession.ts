import type { Breadcrumb } from '@shared/breadcrumb';
import type { GuardStatus } from '@shared/history';
import type { InteractiveProgramName } from '@shared/interactivePrograms';
import {
  BreadcrumbParser,
  CommandGate,
  EchoGate,
  SHELL_INTEGRATION_SETUP,
  detectInteractiveProgram,
  endsWithInputPrompt,
  isShellEscalationCommand,
  matchesPasswordPromptPattern
} from './shellIntegration';

/**
 * Оркестровка конвейера разбора вывода shell-интеграции (BRD-03/04, TERM-09,
 * ERR-01) — deep module вокруг `BreadcrumbParser`/`EchoGate`/`CommandGate`
 * (см. `.scratch/shell-integration-session/spec.md`). Сама коробка «не имеет
 * рук»: не пишет в provод и не заводит настоящих таймеров — только сообщает
 * вызывающему (`sessionManager.ts`), что сделать. Новый экземпляр создаётся на
 * каждое открытие shell-канала (в т.ч. после переподключения/эскалации),
 * старый выбрасывается — чистое состояние гарантирует конструктор, метода
 * reset() нет.
 */

// Отправка настройки: ждём паузу в выводе после MOTD (иначе окно подавления
// эха съест приветствие), но не дольше капа (см. sessionManager.ts, откуда
// эти константы переехали без изменения значений).
const SETUP_SILENCE_MS = 300;
// Экспортируется: sessionManager.ts заводит этот таймер сразу при открытии
// shell-канала (до первого feed()) — единственный таймер, который коробка не
// может попросить сама, т.к. её интерфейс не включает метод «канал открылся».
export const SETUP_CAP_MS = 2000;
const ECHO_FLUSH_TIMEOUT_MS = 3000;
const REINJECT_SILENCE_MS = 800;
const PENDING_ECHO_TIMEOUT_MS = 1500;

/** Именованные таймеры, которыми управляет коробка. Реальные `setTimeout`
 *  остаются у вызывающего — коробка только просит завести/отменить их и
 *  ожидает вызова `tick(timer)`, когда время вышло. */
export type ShellIntegrationTimer = 'setup-silence' | 'setup-cap' | 'echo-flush' | 'reinject';

export type TimerAction =
  | { timer: ShellIntegrationTimer; action: 'schedule'; ms: number }
  | { timer: ShellIntegrationTimer; action: 'cancel' };

export type ShellIntegrationEvent =
  | { kind: 'breadcrumb'; crumb: Breadcrumb }
  | {
      kind: 'command-finished';
      command: string;
      exitCode: number | null;
      output: string;
      guardStatus?: GuardStatus;
      typed: boolean;
      /** Для NOTIF-02 (тост о долгой/упавшей команде) — сколько прошло с writeCommand(). */
      durationMs: number;
    }
  | { kind: 'password-prompt' }
  /** BRD-05: команда запускает известную интерактивную программу (nano/vim/…) —
   *  renderer показывает статус-строку над breadcrumb до следующего маркера
   *  (см. 'breadcrumb' — конец интерактивной программы отдельным событием не
   *  сигналится, скрытие переиспользует уже существующий маркер прихода на промпт). */
  | { kind: 'interactive-program'; program: InteractiveProgramName }
  /** `close()` без единого маркера (nologin/ash-сценарии) — накопленный вывод
   *  для сверки с базой паттернов scope 'ssh-connection'. */
  | { kind: 'unmarked-output'; output: string }
  /** echo-flush сработал, а маркер после последней отправки настройки
   *  (первичной или реинжекта) так и не пришёл — shell-интеграция не
   *  подтвердилась (см. .scratch/prompt-confirmation-signal/spec.md). */
  | { kind: 'integration-unconfirmed' };

/** Ответ коробки на любой из её методов: что показать в терминале, что
 *  записать в provод, какие таймеры (пере)завести/отменить, что произошло —
 *  в этом порядке вызывающий и должен применить результат. */
export interface ShellIntegrationResult {
  display: string;
  toWrite: string;
  events: ShellIntegrationEvent[];
  timerActions: TimerAction[];
}

function emptyResult(): ShellIntegrationResult {
  return { display: '', toWrite: '', events: [], timerActions: [] };
}

export class ShellIntegrationSession {
  private readonly breadcrumbParser = new BreadcrumbParser();
  private readonly echoGate = new EchoGate();
  private readonly commandGate = new CommandGate();

  /** Вывод с момента предыдущего маркера — для детектора ошибок (ERR-01). */
  private outputSinceMark = '';
  /** Последняя команда, отправленная через writeCommand (для истории/{original}). */
  private lastCommand = '';
  private lastCommandStartedAt = 0;
  private pendingGuardStatus: GuardStatus | undefined;
  /** Первый маркер после подключения — приветствие, не результат команды. */
  private firstMarkSeen = false;
  /** Взводится при каждой отправке настройки (первичной и реинжекте),
   *  снимается любым пришедшим маркером — «ждём ли мы ещё маркер после
   *  ПОСЛЕДНЕЙ отправки настройки». Отдельно от firstMarkSeen: реинжект
   *  после sudo/su должен снова требовать подтверждения, даже если исходное
   *  подключение маркер уже видело. */
  private awaitingFirstMarkAfterSetup = false;
  /** Отправлена ли настройка shell integration в текущий shell. */
  private setupSent = false;
  /** Ожидаемое эхо только что отправленной через writeCommand команды —
   *  вырезается из вывода сервера, терминал уже показал её локально при наборе. */
  private pendingEcho: { text: string; armedAt: number } | undefined;
  /** Взведён реинжект интеграции после команды эскалации (фикс BRD-03/04). */
  private reinjectArmed = false;
  /** Хвост вывода с момента взвода реинжекта — распознавание запроса пароля. */
  private reinjectTail = '';
  /** Хвост вывода для детекции запроса пароля (TERM-09), независим от реинжекта. */
  private passwordPromptTail = '';
  /** true между «увидели запрос пароля» и следующим маркером. */
  private passwordPromptActive = false;

  /** Разобрать очередной кусок вывода сервера. */
  feed(chunk: string): ShellIntegrationResult {
    const result = emptyResult();
    const raw = this.stripPendingEcho(chunk);
    const { pieces, marks } = this.breadcrumbParser.push(raw);

    if (!this.setupSent) {
      // MOTD ещё идёт — настройка уходит после паузы в выводе; таймер
      // перезаводится на каждый чанк, пока настройка не отправлена.
      result.timerActions.push({ timer: 'setup-silence', action: 'schedule', ms: SETUP_SILENCE_MS });
    }

    const effective = this.echoGate.filter(pieces, marks.length);
    const display = effective.join('');
    result.display = display;

    if (this.reinjectArmed) {
      if (marks.length > 0) {
        this.disarmReinject(result);
      } else {
        this.reinjectTail = (this.reinjectTail + display).slice(-256);
        result.timerActions.push({ timer: 'reinject', action: 'cancel' });
        if (!endsWithInputPrompt(this.reinjectTail)) {
          result.timerActions.push({ timer: 'reinject', action: 'schedule', ms: REINJECT_SILENCE_MS });
        }
      }
    }

    // TERM-09: явный запрос пароля — событие только на нарастающем фронте.
    if (display) {
      this.passwordPromptTail = (this.passwordPromptTail + display).slice(-256);
      if (!this.passwordPromptActive && matchesPasswordPromptPattern(this.passwordPromptTail)) {
        this.passwordPromptActive = true;
        result.events.push({ kind: 'password-prompt' });
      }
    }

    // Приписываем вывод СВОЕМУ маркеру: effective[i] — то, что пришло между
    // (i-1)-м и i-м маркером в этом чанке (несколько маркеров могут прийти
    // в одном chunk).
    for (let i = 0; i < marks.length; i++) {
      this.appendOutput(effective[i] ?? '');
      const mark = marks[i]!;
      this.awaitingFirstMarkAfterSetup = false;
      result.events.push({ kind: 'breadcrumb', crumb: mark.crumb });
      this.handleCommandFinished(mark.exitCode, result);
      this.passwordPromptActive = false;
      this.passwordPromptTail = '';
    }
    this.appendOutput(effective[effective.length - 1] ?? '');

    return result;
  }

  /** Команда уходит на сервер (композер/Страж/каталог/сниппеты/история). */
  writeCommand(command: string, guardStatus?: GuardStatus): ShellIntegrationResult {
    const result = emptyResult();
    this.lastCommand = command.trim();
    this.lastCommandStartedAt = Date.now();
    this.pendingGuardStatus = guardStatus;

    // Команда эскалации (su/sudo/вложенный shell) сменит процесс шелла и хук
    // интеграции пропадёт — взводим реинжект (только если интеграция вообще
    // работала: без первого маркера повтор настройки бессмысленен).
    if (this.setupSent && this.firstMarkSeen && isShellEscalationCommand(command)) {
      this.armReinject(result);
    }

    // BRD-05: статус-строка над breadcrumb. writeCommand зовётся только для
    // команды, отправленной с реального промпта (композер/Страж/каталог/
    // сниппеты/история) — сырой ввод внутри уже запущенной программы идёт
    // через sendRawInput и сюда не попадает.
    if (this.firstMarkSeen) {
      const program = detectInteractiveProgram(command);
      if (program) result.events.push({ kind: 'interactive-program', program });
    }

    this.pendingEcho = { text: `${command}\r\n`, armedAt: Date.now() };
    this.writeRaw(`${command}\n`, result);
    return result;
  }

  /** Сырой пользовательский ввод (прямой ввод в терминал, посимвольно или вставкой). */
  sendRawInput(data: string): ShellIntegrationResult {
    const result = emptyResult();
    this.writeRaw(data, result);
    return result;
  }

  /** Команда отправлена через writeCommand, но маркер её завершения (реальный
   *  cycle.ran, см. handleCommandFinished) ещё не пришёл (WIN-04). */
  isBusy(): boolean {
    return this.runningCommand() !== null;
  }

  /** Текст выполняющейся сейчас команды (WIN-04, для конкретного текста в
   *  диалоге закрытия — «команда X будет прервана», не безликое «команда»)
   *  — null, если сессия свободна. */
  runningCommand(): string | null {
    return this.lastCommand !== '' ? this.lastCommand : null;
  }

  /** Канал закрылся — накопленный с последнего маркера вывод (если есть) для
   *  сверки с базой паттернов 'ssh-connection' (nologin-shell и т.п.). */
  close(): ShellIntegrationResult {
    const result = emptyResult();
    if (this.outputSinceMark.trim()) {
      result.events.push({ kind: 'unmarked-output', output: this.outputSinceMark });
    }
    return result;
  }

  /** Таймер, заведённый по просьбе коробки, истёк. */
  tick(timer: ShellIntegrationTimer): ShellIntegrationResult {
    const result = emptyResult();
    switch (timer) {
      case 'setup-silence':
      case 'setup-cap':
        this.armSetupIfNeeded(result);
        break;
      case 'echo-flush': {
        // Страховка: маркер не пришёл (shell без bash/zsh) — показать
        // накопленное вместо того, чтобы молча его проглотить.
        const buffered = this.echoGate.flush();
        if (buffered) {
          result.display = buffered;
          this.appendOutput(buffered);
        }
        // То же самое обстоятельство («настройка ушла, маркер за 3 сек. не
        // пришёл») сигналит и renderer'у — пора вернуться под защиту Стража.
        if (this.awaitingFirstMarkAfterSetup) {
          result.events.push({ kind: 'integration-unconfirmed' });
        }
        break;
      }
      case 'reinject':
        this.handleReinjectTick(result);
        break;
    }
    return result;
  }

  private handleCommandFinished(exitCode: number | null, result: ShellIntegrationResult): void {
    const output = this.outputSinceMark;
    this.outputSinceMark = '';

    if (!this.firstMarkSeen) {
      this.firstMarkSeen = true;
      return;
    }

    // Маркер без Enter'а с прошлого маркера — перерисовка приглашения
    // (SIGWINCH/Ctrl+L/completion), а не завершение команды.
    const cycle = this.commandGate.consume();
    if (!cycle.ran) return;

    const command = this.lastCommand;
    const guardStatus = this.pendingGuardStatus;
    const durationMs = Date.now() - this.lastCommandStartedAt;
    this.lastCommand = '';
    this.pendingGuardStatus = undefined;

    result.events.push({
      kind: 'command-finished',
      command,
      exitCode,
      output,
      guardStatus,
      typed: cycle.typed,
      durationMs
    });
  }

  /** Общее тело первичной отправки ввода и отправки команды: настройка уходит
   *  первой, если ещё не отправлена, дальше — сам ввод, с учётом кредита Enter. */
  private writeRaw(data: string, result: ShellIntegrationResult): void {
    this.armSetupIfNeeded(result);
    this.commandGate.noteInput(data);
    result.toWrite += data;
  }

  private armSetupIfNeeded(result: ShellIntegrationResult): void {
    if (this.setupSent) return;
    this.setupSent = true;
    result.timerActions.push({ timer: 'setup-silence', action: 'cancel' });
    result.timerActions.push({ timer: 'setup-cap', action: 'cancel' });
    this.emitSetupWrite(result);
  }

  private handleReinjectTick(result: ShellIntegrationResult): void {
    if (!this.reinjectArmed) return;
    this.reinjectArmed = false;
    this.reinjectTail = '';
    this.emitSetupWrite(result);
  }

  /** Общее тело первичной настройки и реинжекта: подавление эха + страховка. */
  private emitSetupWrite(result: ShellIntegrationResult): void {
    this.echoGate.arm();
    this.awaitingFirstMarkAfterSetup = true;
    result.toWrite += SHELL_INTEGRATION_SETUP;
    result.timerActions.push({ timer: 'echo-flush', action: 'schedule', ms: ECHO_FLUSH_TIMEOUT_MS });
  }

  private armReinject(result: ShellIntegrationResult): void {
    this.reinjectArmed = true;
    this.reinjectTail = '';
    result.timerActions.push({ timer: 'reinject', action: 'cancel' });
  }

  /** Отбой реинжекта: обычный маркер = старый шелл снова на промпте
   *  (эскалация сорвалась/завершилась). */
  private disarmReinject(result: ShellIntegrationResult): void {
    this.reinjectArmed = false;
    this.reinjectTail = '';
    result.timerActions.push({ timer: 'reinject', action: 'cancel' });
  }

  /** Накопление вывода между маркерами с тем же капом, что и раньше (ERR-01). */
  private appendOutput(text: string): void {
    if (!text) return;
    this.outputSinceMark += text;
    if (this.outputSinceMark.length > 65536) {
      this.outputSinceMark = this.outputSinceMark.slice(-65536);
    }
  }

  /** Вырезает из чанка вывода ожидаемое эхо только что отправленной команды
   *  (см. writeCommand). Хвост, разрезанный между чанками, докапливается через
   *  укороченный pendingEcho.text, как в BreadcrumbParser.pending. */
  private stripPendingEcho(raw: string): string {
    const pending = this.pendingEcho;
    if (!pending) return raw;
    if (Date.now() - pending.armedAt > PENDING_ECHO_TIMEOUT_MS) {
      this.pendingEcho = undefined;
      return raw;
    }
    if (raw.length === 0) return raw;
    if (raw.startsWith(pending.text)) {
      this.pendingEcho = undefined;
      return raw.slice(pending.text.length);
    }
    if (pending.text.startsWith(raw)) {
      this.pendingEcho = { text: pending.text.slice(raw.length), armedAt: pending.armedAt };
      return '';
    }
    // Не совпало (сервер прислал что-то раньше эха, echo выключен и т.п.) —
    // сдаёмся, реальный вывод важнее.
    this.pendingEcho = undefined;
    return raw;
  }
}
