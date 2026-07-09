import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import type { AppConfig } from '@shared/config';
import type { AuthPromptRequest } from '@shared/ssh';
import { getCurrentConfig } from '@/stores/config';
import { attachTerminalWriter, dropTerminalBuffer } from '@/stores/terminalBuffer';
import { Icon } from '@/components/common/Icon';

/**
 * xterm.js-вью одной сессии (TERM-01, TERM-04, TERM-07).
 * Обезвреживание недоверенного вывода:
 * — вывод пишется через write(), не innerHTML;
 * — OSC 52 (запись в clipboard) отключён по умолчанию;
 * — scrollback ограничен;
 * — ссылки НЕ открываются автоматически (web-links addon не подключаем в 1.0).
 * Многострочная вставка перехватывается и уходит в предпросмотр (TERM-05, §14 гайда).
 * Экземпляры кэшируются по sessionId — буфер сохраняется при переключении вкладок.
 */

interface Cached {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  pasteAttached: boolean;
  /** Персистентный контейнер: term.open() вызывается один раз навсегда сюда,
   *  при переключении вкладок контейнер переносится (appendChild), не пересоздаётся. */
  container: HTMLDivElement;
}

const cache = new Map<string, Cached>();

/** Уведомление React-компонента о copy-on-select (создаётся в imperative-слое xterm). */
const copyListeners = new Map<string, () => void>();

/**
 * Локальный перехват ввода на время промпта пароля/passphrase (SSH-06):
 * пока промпт активен, нажатия НЕ уходят на сервер (шелла ещё нет) — копятся
 * здесь и по Enter отдаются в main через answerAuthPrompt. Маскированный ввод
 * не даёт эха — как настоящий "Password:" в консольном ssh.
 */
const authInterceptors = new Map<string, (data: string) => void>();
/** requestId промптов, чей текст уже напечатан (терминал кэшируется между
 *  переключениями вкладок — повторная печать давала бы дубль строки). */
const printedAuthPrompts = new Set<string>();

export function destroyTerminal(sessionId: string): void {
  const c = cache.get(sessionId);
  if (c) {
    dropTerminalBuffer(sessionId);
    authInterceptors.delete(sessionId);
    c.term.dispose();
    c.container.remove();
    cache.delete(sessionId);
  }
}

export function getSearchAddon(sessionId: string): SearchAddon | undefined {
  return cache.get(sessionId)?.search;
}

/**
 * Применить настройки терминала ко всем живым сессиям без перезапуска (SET-02).
 * Меняем шрифт/размер/bold прямо в options и рефитим.
 */
export function applyTerminalConfig(cfg: AppConfig): void {
  const fontFamily = `'${cfg.terminal.font}', 'Cascadia Mono', Consolas, monospace`;
  for (const c of cache.values()) {
    c.term.options.fontFamily = fontFamily;
    c.term.options.fontSize = cfg.terminal.fontSize;
    c.term.options.drawBoldTextInBrightColors = cfg.terminal.brightBold;
    try {
      c.fit.fit();
    } catch {
      /* контейнер ещё без размера */
    }
  }
}

/** Короткий сигнал для bell='sound' (TERM-04). Терминал — жест пользователя, autoplay ок. */
function beep(): void {
  try {
    const AC = window.AudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    osc.onended = () => void ctx.close();
  } catch {
    /* нет аудио — тихо игнорируем */
  }
}

export function getSelection(sessionId: string): string {
  return cache.get(sessionId)?.term.getSelection() ?? '';
}

export function copySelection(sessionId: string): void {
  const sel = getSelection(sessionId);
  if (sel) window.lucidSSH.clipboardWrite(sel);
}

/** Отправка текста в сессию (одиночная строка вставки; Страж перехватит на Этапе 4). */
export function pasteText(sessionId: string, text: string): void {
  window.lucidSSH.sendTerminalInput(sessionId, text);
}

function createTerminal(sessionId: string): Cached {
  const cfg = getCurrentConfig();
  const term = new Terminal({
    fontFamily: `'${cfg?.terminal.font ?? 'JetBrains Mono'}', 'Cascadia Mono', Consolas, monospace`,
    fontSize: cfg?.terminal.fontSize ?? 13,
    // 1.1: не значение line-height из макета (1.55, это межстрочник div-блоков
    // с текстом, а в xterm line-height растягивает всю ячейку — курсор-блок
    // заливает её целиком). Слегка ниже 1.2 — по просьбе уменьшить высоту
    // курсора-блока (единственный рычаг для этого в xterm, т.к. блочный
    // курсор всегда = высоте ячейки). Проверено визуально 07.07.2026.
    lineHeight: 1.1,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 5000,
    drawBoldTextInBrightColors: cfg?.terminal.brightBold ?? true,
    theme: {
      background: '#1A1A22',
      foreground: '#CBD5E1',
      cursor: '#CBD5E1',
      selectionBackground: 'rgba(99,102,241,0.35)',
      black: '#15151B',
      brightBlack: '#475569',
      red: '#EF4444',
      green: '#4ADE80',
      yellow: '#FBBF24',
      blue: '#60A5FA',
      magenta: '#818CF8',
      cyan: '#22D3EE',
      white: '#CBD5E1',
      brightWhite: '#F1F5F9'
    }
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);

  term.onData((data) => {
    // Промпт пароля активен — ввод обрабатывается локально, не сервером
    const intercept = authInterceptors.get(sessionId);
    if (intercept) {
      intercept(data);
      return;
    }
    window.lucidSSH.sendTerminalInput(sessionId, data);
  });

  // TERM-04 bell: звуковой сигнал при \a, если включён в настройках
  term.onBell(() => {
    if (getCurrentConfig()?.terminal.bell === 'sound') beep();
  });

  // TERM-04 select-to-copy: выделение → буфер обмена (если включено)
  term.onSelectionChange(() => {
    if (getCurrentConfig()?.terminal.selectToCopy) {
      const sel = term.getSelection();
      if (sel) {
        window.lucidSSH.clipboardWrite(sel);
        copyListeners.get(sessionId)?.();
      }
    }
  });

  // Вывод сервера — из буфера (накопленное до монтирования + живой поток)
  attachTerminalWriter(sessionId, (data) => term.write(data));

  const container = document.createElement('div');
  container.className = 'h-full w-full';
  term.open(container);

  return { term, fit, search, pasteAttached: false, container };
}

export function XtermView({
  sessionId,
  onContextMenu,
  onMultilinePaste,
  authPrompt,
  onAuthAnswer
}: {
  sessionId: string;
  onContextMenu: (x: number, y: number) => void;
  onMultilinePaste: (text: string) => void;
  /** Активный промпт пароля/passphrase (SSH-06) — ввод в терминале, как в ssh. */
  authPrompt?: AuthPromptRequest;
  onAuthAnswer?: (answers: string[]) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onContextMenu, onMultilinePaste });
  cbRef.current = { onContextMenu, onMultilinePaste };
  const onAuthAnswerRef = useRef(onAuthAnswer);
  onAuthAnswerRef.current = onAuthAnswer;
  const [showCopied, setShowCopied] = useState(false);

  useEffect(() => {
    copyListeners.set(sessionId, () => setShowCopied(true));
    return () => {
      copyListeners.delete(sessionId);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!showCopied) return;
    const timer = setTimeout(() => setShowCopied(false), 1100);
    return () => clearTimeout(timer);
  }, [showCopied]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    let cached = cache.get(sessionId);
    if (!cached) {
      cached = createTerminal(sessionId);
      cache.set(sessionId, cached);
    }
    if (cached.container.parentElement !== el) {
      el.appendChild(cached.container);
    }

    // Перехват вставки: textarea появляется только после open() — вешаем один раз.
    // Многострочный текст уходит в предпросмотр (TERM-05); одиночная строка —
    // штатно через xterm.onData.
    const textarea = cached.term.textarea;
    if (textarea && !cached.pasteAttached) {
      cached.pasteAttached = true;
      textarea.addEventListener(
        'paste',
        (e: ClipboardEvent) => {
          const text = e.clipboardData?.getData('text') ?? '';
          if (text.includes('\n') || text.includes('\r')) {
            e.preventDefault();
            e.stopPropagation();
            cbRef.current.onMultilinePaste(text);
          }
        },
        true
      );
    }

    const doFit = (): void => {
      try {
        cached!.fit.fit();
        window.lucidSSH.resizeSession(sessionId, cached!.term.cols, cached!.term.rows);
      } catch {
        /* контейнер ещё без размера */
      }
    };
    doFit();
    cached.term.focus();

    const onCtx = (e: MouseEvent): void => {
      e.preventDefault();
      // TERM-04 правый клик = вставка: читаем буфер, многострочное — в предпросмотр
      if (getCurrentConfig()?.terminal.rightClickPaste) {
        void window.lucidSSH.clipboardRead().then((text) => {
          if (!text) return;
          if (text.includes('\n') || text.includes('\r')) cbRef.current.onMultilinePaste(text);
          else window.lucidSSH.sendTerminalInput(sessionId, text);
        });
        return;
      }
      cbRef.current.onContextMenu(e.clientX, e.clientY);
    };
    el.addEventListener('contextmenu', onCtx);

    const ro = new ResizeObserver(doFit);
    ro.observe(el);
    return () => {
      ro.disconnect();
      el.removeEventListener('contextmenu', onCtx);
    };
  }, [sessionId]);

  // Промпт пароля: печатаем текст в сам терминал и перехватываем ввод до
  // Enter — как консольный ssh. Маскированный ввод (echo=false) эха не даёт.
  // Эффект ПОСЛЕ эффекта монтирования: тот создаёт терминал в cache.
  useEffect(() => {
    if (!authPrompt) return;
    const term = cache.get(sessionId)?.term;
    if (!term) return;
    const { requestId, prompts } = authPrompt;
    if (!printedAuthPrompts.has(requestId)) {
      printedAuthPrompts.add(requestId);
      term.write(`\r\n${prompts[0]?.text ?? ''} `);
    }
    let idx = 0;
    let current = '';
    const answers: string[] = [];
    authInterceptors.set(sessionId, (data) => {
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          answers.push(current);
          current = '';
          term.write('\r\n');
          idx++;
          if (idx >= prompts.length) {
            authInterceptors.delete(sessionId);
            printedAuthPrompts.delete(requestId);
            onAuthAnswerRef.current?.(answers);
            return; // хвост чанка после Enter отбрасываем
          }
          term.write(`${prompts[idx]?.text ?? ''} `);
        } else if (ch === '\x7f' || ch === '\b') {
          if (current.length > 0) {
            current = current.slice(0, -1);
            if (prompts[idx]?.echo) term.write('\b \b');
          }
        } else if (ch >= ' ') {
          current += ch;
          if (prompts[idx]?.echo) term.write(ch);
        }
        // Остальные управляющие символы (Ctrl+C, стрелки) игнорируются
      }
    });
    term.focus();
    return () => {
      authInterceptors.delete(sessionId);
    };
  }, [sessionId, authPrompt]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {showCopied && (
        <div
          className="animate-[esh-pop_.16s_ease] pointer-events-none absolute right-3 bottom-3 flex items-center gap-1 rounded-[20px] border border-border-strong bg-bg-elevated px-3 py-[6px] text-[11.5px] text-text-strong shadow-[0_8px_20px_rgba(0,0,0,0.35)]"
          aria-hidden="true"
        >
          <Icon name="check" size={12} className="text-success-bright" />
          {t('terminal.copied')}
        </div>
      )}
    </div>
  );
}
