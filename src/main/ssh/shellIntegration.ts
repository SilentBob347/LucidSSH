import type { Breadcrumb } from '@shared/breadcrumb';

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
 * Команда настройки интеграции. Одна строка; отправляется один раз после
 * открытия shell. `printf` с фиксированным форматом — статическая строка.
 * Префикс-пробел не даёт команде попасть в историю при HISTCONTROL=ignorespace.
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
  ` __lucidssh_mark() { __lc=$?; printf '\\033_lucidssh\\037%s\\037%s\\037%s\\037%s\\037%s\\033\\\\' ` +
  `"\${USER:-$(id -un 2>/dev/null)}" "\${HOSTNAME:-$(hostname 2>/dev/null)}" "$PWD" "$(id -u 2>/dev/null)" "$__lc"; }; ` +
  `if [ -n "$ZSH_VERSION" ]; then autoload -Uz add-zsh-hook 2>/dev/null; add-zsh-hook precmd __lucidssh_mark 2>/dev/null || eval 'precmd_functions+=(__lucidssh_mark)'; ` +
  `else case "$PROMPT_COMMAND" in *__lucidssh_mark*) ;; *) PROMPT_COMMAND="__lucidssh_mark;$PROMPT_COMMAND";; esac; fi; ` +
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

  /** Фильтр очередного чанка: что из него реально переслать в xterm. */
  filter(pieces: string[], markCount: number): string {
    if (!this.suppressing) return pieces.join('');
    if (markCount === 0) {
      this.buffer += pieces.join('');
      return '';
    }
    this.suppressing = false;
    this.buffer = '';
    return '\r\x1b[K' + pieces.slice(1).join('');
  }

  /** Аварийный сброс по таймауту: вернуть накопленное, выключить подавление. */
  flush(): string {
    const buffered = this.buffer;
    this.buffer = '';
    this.suppressing = false;
    return buffered;
  }
}

function parseMarker(marker: string): ShellMark | null {
  const m = marker.match(MARKER_RE);
  if (!m || !m[1]) return null;
  // Формат содержимого: US u US h US p US euid US exit → split даёт ['', u, h, p, euid, exit].
  const parts = m[1].split(US);
  const fields = parts[0] === '' ? parts.slice(1) : parts;
  if (fields.length < 4) return null;
  const [username, host, path, euidStr, exitStr] = fields;
  const euid = Number(euidStr);
  const exitNum = exitStr === undefined ? NaN : Number(exitStr);
  const privilege: Breadcrumb['privilege'] =
    euid === 0 ? 'root' : process.env['SUDO_USER'] ? 'sudo' : 'normal';
  const crumb: Breadcrumb = {
    username: (username ?? '').slice(0, 64),
    host: (host ?? '').slice(0, 128),
    path: (path ?? '').slice(0, 4096),
    // sudo определяется по факту euid=0 при непустом исходном пользователе;
    // без euid считаем normal
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
