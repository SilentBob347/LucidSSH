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
 *
 * Хвост очищает экран после установки (`ESC[H ESC[2J` — home + clear screen,
 * БЕЗ ESC[3J, поэтому scrollback с MOTD сохраняется и доступен прокруткой),
 * чтобы эхо длинной команды-настройки не висело вверху сессии. Префикс-пробел
 * не даёт команде попасть в историю при HISTCONTROL=ignorespace.
 *
 * (Попытка точечного стирания только своего эха, чтобы не прятать MOTD за
 * прокруткой, — см. docs/Ideas_Backlog.md; откачена 07.07.2026 после двух
 * неудачных попыток на живом сервере, ломавших исполнение команды целиком.)
 */
export const SHELL_INTEGRATION_SETUP =
  // __lc=$? — код возврата последней команды снимается ПЕРВЫМ, до любых операций (ERR-01).
  // Разделитель US — октавой \037 ВНУТРИ формата printf (как \033 для ESC), НЕ сырым
  // байтом в команде: сырой 0x1f — это Ctrl+_, в интерактивном bash readline
  // выполняет его как undo и корёжит команду (на реальных серверах маркер
  // склеивался без разделителей и breadcrumb не работал; мок без readline это скрывал).
  ` __lucidssh_mark() { __lc=$?; printf '\\033_lucidssh\\037%s\\037%s\\037%s\\037%s\\037%s\\033\\\\' ` +
  `"\${USER:-$(id -un 2>/dev/null)}" "\${HOSTNAME:-$(hostname 2>/dev/null)}" "$PWD" "$(id -u 2>/dev/null)" "$__lc"; }; ` +
  `if [ -n "$ZSH_VERSION" ]; then autoload -Uz add-zsh-hook 2>/dev/null; add-zsh-hook precmd __lucidssh_mark 2>/dev/null || precmd_functions+=(__lucidssh_mark); ` +
  `else case "$PROMPT_COMMAND" in *__lucidssh_mark*) ;; *) PROMPT_COMMAND="__lucidssh_mark;$PROMPT_COMMAND";; esac; fi; ` +
  `printf '\\033[H\\033[2J'; __lucidssh_mark\n`;

// eslint-disable-next-line no-control-regex
const MARKER_RE = /\x1b_lucidssh([\s\S]*?)\x1b\\/;

/** Результат одного маркера: breadcrumb + код возврата последней команды. */
export interface ShellMark {
  crumb: Breadcrumb;
  exitCode: number | null;
}

/**
 * Потоковый парсер маркеров: удерживает «хвост» на случай, если APC-маркер
 * разрезан между чанками. Возвращает очищенный вывод и распознанные маркеры.
 */
export class BreadcrumbParser {
  private pending = '';

  push(chunk: string): { cleaned: string; marks: ShellMark[] } {
    let buf = this.pending + chunk;
    this.pending = '';
    const marks: ShellMark[] = [];
    let cleaned = '';

    for (;;) {
      const startIdx = buf.indexOf(APC_START);
      if (startIdx === -1) break;
      const endIdx = buf.indexOf(APC_END, startIdx);
      if (endIdx === -1) {
        // маркер не завершён — выводим всё до него, хвост оставляем на потом
        cleaned += buf.slice(0, startIdx);
        this.pending = buf.slice(startIdx);
        // защита от бесконечного накопления мусора без завершителя
        if (this.pending.length > 4096) {
          cleaned += this.pending;
          this.pending = '';
        }
        return { cleaned, marks };
      }
      cleaned += buf.slice(0, startIdx);
      const marker = buf.slice(startIdx, endIdx + APC_END.length);
      const mark = parseMarker(marker);
      if (mark) marks.push(mark);
      buf = buf.slice(endIdx + APC_END.length);
    }

    // Возможен незавершённый APC_START, разрезанный по последним байтам —
    // придержим небольшой хвост, если он выглядит как начало ESC-последовательности.
    const tailEsc = buf.lastIndexOf('\x1b');
    if (tailEsc !== -1 && buf.length - tailEsc < APC_START.length && APC_START.startsWith(buf.slice(tailEsc))) {
      cleaned += buf.slice(0, tailEsc);
      this.pending = buf.slice(tailEsc);
    } else {
      cleaned += buf;
    }
    return { cleaned, marks };
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
