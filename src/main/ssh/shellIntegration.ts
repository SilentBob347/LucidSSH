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
 * чтобы эхо длинной команды-настройки не висело вверху сессии. Это совпадает с
 * чистым стартом терминала на макетах. Префикс-пробел не даёт команде попасть в
 * историю при HISTCONTROL=ignorespace.
 */
export const SHELL_INTEGRATION_SETUP =
  ` __lucidssh_mark() { printf '\\033_lucidssh${US}%s${US}%s${US}%s${US}%s\\033\\\\' ` +
  `"\${USER:-$(id -un 2>/dev/null)}" "\${HOSTNAME:-$(hostname 2>/dev/null)}" "$PWD" "$(id -u 2>/dev/null)"; }; ` +
  `if [ -n "$ZSH_VERSION" ]; then autoload -Uz add-zsh-hook 2>/dev/null; add-zsh-hook precmd __lucidssh_mark 2>/dev/null || precmd_functions+=(__lucidssh_mark); ` +
  `else case "$PROMPT_COMMAND" in *__lucidssh_mark*) ;; *) PROMPT_COMMAND="__lucidssh_mark;$PROMPT_COMMAND";; esac; fi; ` +
  `printf '\\033[H\\033[2J'; __lucidssh_mark\n`;

// eslint-disable-next-line no-control-regex
const MARKER_RE = /\x1b_lucidssh([\s\S]*?)\x1b\\/;

/**
 * Потоковый парсер маркеров: удерживает «хвост» на случай, если APC-маркер
 * разрезан между чанками. Возвращает очищенный вывод и распознанные breadcrumb.
 */
export class BreadcrumbParser {
  private pending = '';

  push(chunk: string): { cleaned: string; crumbs: Breadcrumb[] } {
    let buf = this.pending + chunk;
    this.pending = '';
    const crumbs: Breadcrumb[] = [];
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
        return { cleaned, crumbs };
      }
      cleaned += buf.slice(0, startIdx);
      const marker = buf.slice(startIdx, endIdx + APC_END.length);
      const crumb = parseMarker(marker);
      if (crumb) crumbs.push(crumb);
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
    return { cleaned, crumbs };
  }
}

function parseMarker(marker: string): Breadcrumb | null {
  const m = marker.match(MARKER_RE);
  if (!m || !m[1]) return null;
  // Формат содержимого: US u US h US p US e → split даёт ['', u, h, p, e].
  const parts = m[1].split(US);
  const fields = parts[0] === '' ? parts.slice(1) : parts;
  if (fields.length < 4) return null;
  const [username, host, path, euidStr] = fields;
  const euid = Number(euidStr);
  const privilege: Breadcrumb['privilege'] =
    euid === 0 ? 'root' : process.env['SUDO_USER'] ? 'sudo' : 'normal';
  return {
    username: (username ?? '').slice(0, 64),
    host: (host ?? '').slice(0, 128),
    path: (path ?? '').slice(0, 4096),
    // sudo определяется по факту euid=0 при непустом исходном пользователе;
    // без euid считаем normal
    privilege: Number.isFinite(euid) ? privilege : 'normal'
  };
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
