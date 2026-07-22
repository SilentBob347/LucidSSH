import type { Breadcrumb } from '@shared/breadcrumb';
import type { InteractiveProgramName } from '@shared/interactivePrograms';
import { isInteractiveProgramName } from '@shared/interactivePrograms';
import { splitCompound } from '../guard/patterns';

/**
 * Shell integration для breadcrumb (BRD-04, §19 Security_Guide).
 *
 * После открытия shell в сессию отправляется СТАТИЧЕСКАЯ настройка
 * PROMPT_COMMAND (bash) / precmd (zsh), которая перед каждым приглашением
 * печатает маркер с текущими user/host/cwd/euid. Значения подставляет сам
 * удалённый shell из своих переменных — недоверенный текст в команду не
 * вставляется. Маркер обёрнут в APC-последовательность (ESC _ … ESC \\) и
 * ВЫРЕЗАЕТСЯ из потока в main до попадания в xterm, поэтому на экране не виден.
 */

// Разделитель полей — Unit Separator (0x1f), не встречается в путях/именах.
const US = '\x1f';
// APC: ESC _  …  ESC \
const APC_START = '\x1b_lucidssh';
const APC_END = '\x1b\\';

/**
 * Команда настройки интеграции. ДВЕ строки (определение функции + диспетчер);
 * отправляются одной pty-записью, shell читает их последовательно. `printf` с
 * фиксированным форматом — статическая строка. Префикс-пробел в начале каждой
 * строки не даёт командам попасть в историю при HISTCONTROL=ignorespace.
 *
 * Почему не одна строка (найдено на реальном Keenetic/Xkeen 10.07.2026):
 * редактор строки BusyBox обрезает интерактивный ввод по буферу
 * CONFIG_FEATURE_EDITING_MAX_LEN (на роутерах обычно 512). Слитная настройка
 * была 633 байта — ash принял ровно 511, кавычка PROMPT_COMMAND=" осталась
 * незакрытой, shell завис в PS2-продолжении, маркер не выполнился, и через
 * ECHO_FLUSH_TIMEOUT_MS сырое эхо вываливалось в терминал. Каждая строка
 * обязана оставаться < ~500 байт (см. тест на лимит).
 *
 * Экран НЕ очищается: MOTD сервера остаётся видимым сразу после подключения.
 * Эхо самой команды-настройки прячется на стороне main процесса (EchoGate
 * ниже): всё между отправкой настройки и первым маркером — это её эхо, оно
 * не пересылается в xterm. Финальный вызов `__lucidssh_mark` в конце строки —
 * детерминированный сигнал «эхо закончилось». (Прошлые попытки стирать эхо
 * ANSI-кодами на стороне сервера ломались о непредсказуемость readline —
 * см. docs/Ideas_Backlog.md.)
 *
 * POSIX-совместимость (найдено на реальном BusyBox/ash-сервере 08.07.2026):
 * `precmd_functions+=(...)` — bash/zsh-расширение (array-append), не валидный
 * POSIX-синтаксис. `ash`/`dash` разбирают грамматику ВСЕГО `if/else/fi` до
 * выполнения, включая недостижимую ветку — и падают с syntax error ещё до
 * `__lucidssh_mark` в конце строки, из-за чего маркер не приходит вовсе
 * (EchoGate тогда полагается на flush-таймаут, см. sessionManager.ts).
 * Обёрнуто в `eval '...'`: для внешнего парсера это просто eval с одним
 * quoted-словом, содержимое кавычек не разбирается как грамматика и не может
 * сломать парсинг ash — а выполнится оно только если сам eval будет вызван
 * (т.е. только в zsh, где ZSH_VERSION непуст).
 */
export const SHELL_INTEGRATION_SETUP =
  // __lc=$? — код возврата последней команды снимается ПЕРВЫМ, до любых операций (ERR-01).
  // Разделитель US — октавой \037 ВНУТРИ формата printf (как \033 для ESC), НЕ сырым
  // байтом в команде: сырой 0x1f — это Ctrl+_, в интерактивном bash readline
  // выполняет его как undo и корёжит команду (на реальных серверах маркер
  // склеивался без разделителей и breadcrumb не работал; мок без readline это скрывал).
  // 6-е поле — SUDO_USER удалённого шелла: отличает root-через-sudo (амбер
  // «sudo», BRD-03) от настоящего root-логина (красный). sudo проставляет её
  // сам даже при env_reset; `su -` окружение чистит — там поле пустое → root.
  ` __lucidssh_mark() { __lc=$?; printf '\\033_lucidssh\\037%s\\037%s\\037%s\\037%s\\037%s\\037%s\\033\\\\' ` +
  `"\${USER:-$(id -un 2>/dev/null)}" "\${HOSTNAME:-$(hostname 2>/dev/null)}" "$PWD" "$(id -u 2>/dev/null)" "$__lc" "\${SUDO_USER:-}"; }\n` +
  ` if [ -n "$ZSH_VERSION" ]; then autoload -Uz add-zsh-hook 2>/dev/null; add-zsh-hook precmd __lucidssh_mark 2>/dev/null || eval 'precmd_functions+=(__lucidssh_mark)'; ` +
  // bash: маркер через PROMPT_COMMAND, НЕ через встраивание в PS1. Маркер в PS1
  // становится частью СТРОКИ приглашения: readline перепечатывает её при
  // SIGWINCH/Ctrl+L/completion — повторный маркер со старым $? (источник бага
  // с самопереоткрытием детектора ошибок), а невидимые APC-байты вне \[ \]
  // ломают readline'у подсчёт ширины промпта (глюки переноса длинных команд).
  // Вывод PROMPT_COMMAND в строку приглашения не входит и не перепечатывается.
  `elif [ -n "$BASH_VERSION" ]; then case "$PROMPT_COMMAND" in *__lucidssh_mark*) ;; *) PROMPT_COMMAND="__lucidssh_mark\${PROMPT_COMMAND:+;$PROMPT_COMMAND}";; esac; ` +
  // ash/dash (BusyBox, роутеры): ни PROMPT_COMMAND, ни precmd нет — остаётся
  // встраивание в PS1 ($(...) переразворачивается перед каждым приглашением;
  // найдено на реальном Keenetic/ash-сервере 09.07.2026). Повторные маркеры от
  // перерисовок приглашения отсекает CommandGate на стороне main.
  `else case "$PS1" in *__lucidssh_mark*) ;; *) PS1='$(__lucidssh_mark)'"$PS1";; esac; fi; ` +
  `__lucidssh_mark\n`;

// eslint-disable-next-line no-control-regex
const MARKER_RE = /\x1b_lucidssh([\s\S]*?)\x1b\\/;

/** Результат одного маркера: breadcrumb + код возврата последней команды. */
export interface ShellMark {
  crumb: Breadcrumb;
  exitCode: number | null;
}

/** Результат push: очищенный вывод целиком + он же кусками между маркерами. */
export interface ParseResult {
  cleaned: string;
  /**
   * Текст, разбитый по позициям маркеров: pieces[i] — до marks[i],
   * pieces[последний] — после последнего маркера. Всегда pieces.length ===
   * marks.length + 1. Нужен EchoGate, чтобы отбросить текст ДО первого маркера
   * (эхо настройки), не тронув текст после.
   */
  pieces: string[];
  marks: ShellMark[];
}

/**
 * Потоковый парсер маркеров: удерживает «хвост» на случай, если APC-маркер
 * разрезан между чанками. Возвращает очищенный вывод и распознанные маркеры.
 */
export class BreadcrumbParser {
  private pending = '';

  push(chunk: string): ParseResult {
    let buf = this.pending + chunk;
    this.pending = '';
    const marks: ShellMark[] = [];
    const pieces: string[] = [];
    let cur = '';

    for (;;) {
      const startIdx = buf.indexOf(APC_START);
      if (startIdx === -1) break;
      const endIdx = buf.indexOf(APC_END, startIdx);
      if (endIdx === -1) {
        // маркер не завершён — выводим всё до него, хвост оставляем на потом
        cur += buf.slice(0, startIdx);
        this.pending = buf.slice(startIdx);
        // защита от бесконечного накопления мусора без завершителя
        if (this.pending.length > 4096) {
          cur += this.pending;
          this.pending = '';
        }
        pieces.push(cur);
        return { cleaned: pieces.join(''), pieces, marks };
      }
      cur += buf.slice(0, startIdx);
      const marker = buf.slice(startIdx, endIdx + APC_END.length);
      const mark = parseMarker(marker);
      if (mark) {
        marks.push(mark);
        pieces.push(cur);
        cur = '';
      }
      buf = buf.slice(endIdx + APC_END.length);
    }

    // Возможен незавершённый APC_START, разрезанный по последним байтам —
    // придержим небольшой хвост, если он выглядит как начало ESC-последовательности.
    const tailEsc = buf.lastIndexOf('\x1b');
    if (tailEsc !== -1 && buf.length - tailEsc < APC_START.length && APC_START.startsWith(buf.slice(tailEsc))) {
      cur += buf.slice(0, tailEsc);
      this.pending = buf.slice(tailEsc);
    } else {
      cur += buf;
    }
    pieces.push(cur);
    return { cleaned: pieces.join(''), pieces, marks };
  }
}

/**
 * Гейт подавления эха setup-команды (MOTD виден сразу, без прокрутки).
 *
 * Между отправкой SHELL_INTEGRATION_SETUP и первым маркером поток содержит
 * только эхо самой настройки — arm() включает подавление, filter() копит этот
 * текст вместо пересылки в xterm. Первый маркер завершает подавление: эхо
 * отбрасывается, вместо него в xterm уходит `\r ESC[K` — стирает устаревшее
 * приглашение с текущей строки, чтобы новое (напечатанное shell после
 * настройки) не приклеилось к старому. flush() — страховка для shell без
 * bash/zsh (маркер не придёт): накопленное показывается, а не теряется.
 */
export class EchoGate {
  private suppressing = false;
  private buffer = '';

  get active(): boolean {
    return this.suppressing;
  }

  arm(): void {
    this.suppressing = true;
    this.buffer = '';
  }

  /**
   * Фильтр очередного чанка: возвращает массив той же длины, что и pieces —
   * i-й элемент - эффективное (после подавления эха) содержимое i-го куска.
   * join() всего результата даёт то же, что раньше возвращала единая строка;
   * поэлементно нужен sessionManager, чтобы верно приписать вывод СВОЕМУ
   * маркеру, когда в одном чанке их несколько (иначе весь текст чанка
   * достаётся только первому маркеру, а остальные получают пустой вывод и
   * ошибочно уходят в fallback детектора).
   */
  filter(pieces: string[], markCount: number): string[] {
    if (!this.suppressing) return pieces;
    if (markCount === 0) {
      this.buffer += pieces.join('');
      return pieces.map(() => '');
    }
    this.suppressing = false;
    this.buffer = '';
    return pieces.map((p, i) => (i === 0 ? '\r\x1b[K' : p));
  }

  /** Аварийный сброс по таймауту: вернуть накопленное, выключить подавление. */
  flush(): string {
    const buffered = this.buffer;
    this.buffer = '';
    this.suppressing = false;
    return buffered;
  }
}

/**
 * Гейт «команда действительно выполнялась» (баг: детектор переоткрывается сам).
 *
 * Маркер встроен в PS1, т.е. является частью СТРОКИ приглашения. Readline (bash)
 * перепечатывает приглашение при SIGWINCH, Ctrl+L и tab-completion — вместе с
 * APC-маркером и СТАРЫМ $?. Открытие/закрытие панели детектора меняет размер
 * xterm → resize pty → SIGWINCH → «новый» маркер со старым ненулевым exit code →
 * панель переоткрывается сама, по кругу. То же с пустым Enter: $? не сбрасывается.
 *
 * Отличительный признак настоящего завершения команды: с момента прошлого
 * маркера в pty был отправлен Enter (перерисовки происходят без ввода).
 * noteInput() считает Enter'ы («кредиты» — многострочная вставка даёт маркер на
 * каждую строку), consume() тратит кредит на маркер. Кредиты капятся: Enter'ы,
 * съеденные интерактивной программой (не shell'ом), не должны копиться вечно.
 */
export class CommandGate {
  private credits = 0;
  private hadContent = false;

  noteInput(data: string): void {
    const enters = data.match(/\r\n|\r|\n/g);
    if (enters) this.credits = Math.min(this.credits + enters.length, 20);
    if (/[^\s]/.test(data)) this.hadContent = true;
  }

  /**
   * Вызывается на каждый маркер. ran=false — перерисовка приглашения, команда
   * не выполнялась. typed=false при ran=true — «пустой» Enter без единого
   * печатного символа: команды не было, $? в маркере остался от предыдущей.
   */
  consume(): { ran: boolean; typed: boolean } {
    if (this.credits === 0) return { ran: false, typed: false };
    this.credits -= 1;
    const typed = this.hadContent;
    // Пока есть кредиты (многострочная вставка), введённый текст относится и к
    // следующим маркерам; сбрасываем признак только когда кредиты исчерпаны.
    if (this.credits === 0) this.hadContent = false;
    return { ran: true, typed };
  }

  /** Новый shell (переподключение) — прежний ввод не в счёт. */
  reset(): void {
    this.credits = 0;
    this.hadContent = false;
  }
}

function parseMarker(marker: string): ShellMark | null {
  const m = marker.match(MARKER_RE);
  if (!m || !m[1]) return null;
  // Формат: US u US h US p US euid US exit US sudoUser → split даёт ['', u, h, p, euid, exit, su].
  const parts = m[1].split(US);
  const fields = parts[0] === '' ? parts.slice(1) : parts;
  if (fields.length < 4) return null;
  const [username, host, path, euidStr, exitStr, sudoUser] = fields;
  const euid = Number(euidStr);
  const exitNum = exitStr === undefined ? NaN : Number(exitStr);
  // sudo = root с сохранённым SUDO_USER удалённого шелла (6-е поле маркера);
  // root без него — настоящий root-логин или `su -` (окружение вычищено).
  const privilege: Breadcrumb['privilege'] =
    euid === 0 ? (sudoUser ? 'sudo' : 'root') : 'normal';
  const crumb: Breadcrumb = {
    username: (username ?? '').slice(0, 64),
    host: (host ?? '').slice(0, 128),
    path: (path ?? '').slice(0, 4096),
    privilege: Number.isFinite(euid) ? privilege : 'normal'
  };
  return { crumb, exitCode: Number.isInteger(exitNum) ? exitNum : null };
}

/**
 * Безопасное построение команды `cd` по клику на сегмент breadcrumb (BRD-02).
 * Путь берётся из данных сервера — оборачиваем в одинарные кавычки с
 * экранированием, чтобы недоверенный путь не расширялся shell'ом.
 */
export function buildCdCommand(path: string): string {
  const escaped = path.replace(/'/g, `'\\''`);
  return `cd '${escaped}'`;
}

// ---------------------------------------------------------------------------
// Реинжект интеграции после эскалации привилегий (фикс BRD-03/04, 15.07.2026).
// su/sudo/вложенный shell — НОВЫЙ процесс без хука PROMPT_COMMAND (он не
// экспортируется, а sudo и так чистит окружение): маркеры перестают приходить,
// breadcrumb замирает, а renderer навсегда считает «выполняется программа» —
// Страж/детектор/история молча отключаются. Лечение: распознать команду
// эскалации при отправке и повторить SHELL_INTEGRATION_SETUP, когда новый шелл
// покажет промпт (см. ReinjectGate-логику в sessionManager.ts).
// ---------------------------------------------------------------------------

/** Шеллы, голый запуск которых теряет хук (вложенный bash — тот же баг). */
const SHELL_NAMES = new Set(['bash', 'sh', 'zsh', 'dash', 'ash', 'ksh']);
/** Флаги sudo/doas, принимающие отдельное значение следующим словом. */
const VALUE_FLAGS = new Set(['-u', '-g', '-p', '-U', '-C', '-D', '-R', '-T', '-t', '-h']);

/**
 * Команда, после которой текущий shell сменяется новым (эскалация или вложенный
 * shell). Консервативно: ложный пропуск = сегодняшнее поведение (интеграция
 * замирает), ложное срабатывание = видимый мусор настройки в чужом REPL —
 * поэтому произвольные `sudo <команда>` не считаются.
 */
export function isShellEscalationCommand(command: string): boolean {
  return splitCompound(command).some(isEscalationSegment);
}

/**
 * Запуск известной интерактивной программы (BRD-05) — в т.ч. с `sudo`-префиксом
 * или в составной команде (`cd /var && less log`, разбивается через
 * splitCompound). Возвращает первую распознанную программу среди сегментов
 * составной команды. Детекция ограничена фиксированным списком (§ ТЗ BRD-05) —
 * распознавание произвольного foreground-процесса не входит в это требование.
 */
export function detectInteractiveProgram(command: string): InteractiveProgramName | null {
  for (const segment of splitCompound(command)) {
    const words = segment.trim().split(/\s+/).filter((w) => w.length > 0);
    const head = words[0] === 'sudo' ? words[1] : words[0];
    if (!head) continue;
    const name = head.slice(head.lastIndexOf('/') + 1);
    if (isInteractiveProgramName(name)) return name;
  }
  return null;
}

function isEscalationSegment(segment: string): boolean {
  const words = segment.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words[0] === 'exec') words.shift(); // `exec su -` / `exec bash`

  let interactiveFlag = false;
  while (words[0] === 'sudo' || words[0] === 'doas') {
    words.shift();
    while (words[0]?.startsWith('-')) {
      const flag = words.shift()!;
      // -i (login shell) / -s (shell) — в т.ч. слитно: -iu, -su
      if (/^-[a-z]*[is]/.test(flag) || flag === '--login') interactiveFlag = true;
      // Флаг со значением следующим словом — в т.ч. слитный `-iu deploy`
      if (VALUE_FLAGS.has(flag) || /^-[a-z]*u$/i.test(flag) || flag === '--user') {
        words.shift();
      }
    }
  }

  if (words.length === 0) return interactiveFlag; // `sudo -i`, `sudo -s`
  const head = words[0]!;
  if (head === 'su') return true; // su / su - / su - user / sudo su …
  // Голый запуск шелла: без аргументов либо только -l/-i (`bash deploy.sh` — нет)
  const name = head.slice(head.lastIndexOf('/') + 1);
  if (!SHELL_NAMES.has(name)) return false;
  return words.slice(1).every((w) => w === '-l' || w === '-i' || w === '--login');
}

/**
 * Явные паттерны запроса пароля (статический список + русские варианты).
 * Экспорт: TERM-09 (подсказка «ввод скрыт») переиспользует этот же список.
 */
export const PASSWORD_PROMPT_RE =
  /(\[sudo\] password for [^\n]*|password[^\n]*:|пароль[^\n]*:|enter passphrase[^\n]*:)[ \t]*$/i;

/**
 * Хвост вывода похож на ожидание ввода (запрос пароля и т.п.) — реинжект
 * настройки нужно придержать, иначе её текст уйдёт как «пароль». Локале-
 * независимая эвристика: незавершённая строка, оканчивающаяся двоеточием
 * (промпты шеллов кончаются на #/$/%/>, запросы ввода — почти всегда на «:»).
 */
export function endsWithInputPrompt(output: string): boolean {
  const lastLine = output.slice(output.lastIndexOf('\n') + 1).replace(/[ \t\r]+$/, '');
  if (lastLine.endsWith(':')) return true;
  return PASSWORD_PROMPT_RE.test(lastLine);
}

/**
 * TERM-09: подсказка «ввод пароля скрыт» показывается только на известные,
 * явные приглашения — в отличие от endsWithInputPrompt (реинжект, BRD-03/04)
 * здесь НЕТ локале-независимой эвристики по «:» (произвольные приглашения
 * намеренно не распознаются, чтобы не подсказывать невпопад).
 */
export function matchesPasswordPromptPattern(output: string): boolean {
  const lastLine = output.slice(output.lastIndexOf('\n') + 1).replace(/[ \t\r]+$/, '');
  return PASSWORD_PROMPT_RE.test(lastLine);
}
