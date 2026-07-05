import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import type { AppConfig } from '@shared/config';
import { getCurrentConfig } from '@/stores/config';
import { attachTerminalWriter, dropTerminalBuffer } from '@/stores/terminalBuffer';

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
}

const cache = new Map<string, Cached>();

export function destroyTerminal(sessionId: string): void {
  const c = cache.get(sessionId);
  if (c) {
    dropTerminalBuffer(sessionId);
    c.term.dispose();
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
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    drawBoldTextInBrightColors: cfg?.terminal.brightBold ?? true,
    theme: {
      background: '#1A1A22',
      foreground: '#CBD5E1',
      cursor: '#818CF8',
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

  term.onData((data) => window.lucidSSH.sendTerminalInput(sessionId, data));

  // TERM-04 bell: звуковой сигнал при \a, если включён в настройках
  term.onBell(() => {
    if (getCurrentConfig()?.terminal.bell === 'sound') beep();
  });

  // TERM-04 select-to-copy: выделение → буфер обмена (если включено)
  term.onSelectionChange(() => {
    if (getCurrentConfig()?.terminal.selectToCopy) {
      const sel = term.getSelection();
      if (sel) window.lucidSSH.clipboardWrite(sel);
    }
  });

  // Вывод сервера — из буфера (накопленное до монтирования + живой поток)
  attachTerminalWriter(sessionId, (data) => term.write(data));

  return { term, fit, search, pasteAttached: false };
}

export function XtermView({
  sessionId,
  onContextMenu,
  onMultilinePaste
}: {
  sessionId: string;
  onContextMenu: (x: number, y: number) => void;
  onMultilinePaste: (text: string) => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onContextMenu, onMultilinePaste });
  cbRef.current = { onContextMenu, onMultilinePaste };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    let cached = cache.get(sessionId);
    if (!cached) {
      cached = createTerminal(sessionId);
      cache.set(sessionId, cached);
    }
    if (cached.term.element?.parentElement !== el) {
      cached.term.open(el);
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

  return <div ref={hostRef} className="h-full w-full" />;
}
