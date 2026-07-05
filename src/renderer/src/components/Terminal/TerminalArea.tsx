import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessions } from '@/stores/sessions';
import { TabBar } from './TabBar';
import { ConnectionLogPanel } from './ConnectionLogPanel';
import type { DangerousCommandPrompt } from '@shared/guard';
import { XtermView, destroyTerminal, copySelection, getSelection, pasteText } from './XtermView';
import { PastePreviewDialog } from './PastePreviewDialog';
import { TerminalContextMenu } from './TerminalContextMenu';
import { TerminalSearchBar } from './TerminalSearchBar';
import { BottomInputBar } from './BottomInputBar';
import { HintBar } from './HintBar';
import { DangerGuardModal } from '@/components/Guard/DangerGuardModal';
import { BreadcrumbBar } from '@/components/Breadcrumb/BreadcrumbBar';
import { ErrorDetector } from './ErrorDetector';
import { insertIntoComposer, getComposerValue } from '@/stores/composerBus';
import { useConfig, getCurrentConfig } from '@/stores/config';
import { usePanels } from '@/stores/panels';

/**
 * Центральная область (Design_Brief §3.3): таб-бар, xterm.js, контекстное меню
 * (CTX-01), предпросмотр многострочной вставки (TERM-05), поиск Ctrl+F (FIND-01),
 * лог соединения. Терминалы кэшируются по sessionId — буфер сохраняется.
 */
export function TerminalArea(): JSX.Element {
  const { t } = useTranslation();
  const { sessions, activeSessionId, reconnect, closeTab, breadcrumbs, dashboards, errors, dismissError } =
    useSessions();
  const { config, update, markHint } = useConfig();
  const { openHistory, openSnippetDialog } = usePanels();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(
    null
  );
  const [pastePreview, setPastePreview] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dangerPrompt, setDangerPrompt] = useState<DangerousCommandPrompt | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const commandCounts = useRef<Map<string, number>>(new Map());
  const knownIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const current = new Set(sessions.map((s) => s.sessionId));
    for (const id of knownIds.current) {
      if (!current.has(id)) destroyTerminal(id);
    }
    knownIds.current = current;
  }, [sessions]);

  const active = sessions.find((s) => s.sessionId === activeSessionId);
  const showTerminal = active && active.status !== 'disconnected' && active.status !== 'connecting';

  // Хоткеи терминала (SET-06): Ctrl+F поиск, Ctrl+L каталог, Ctrl+W закрыть вкладку,
  // Ctrl+Shift+C/V копировать/вставить активной сессии.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'f' && showTerminal) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (key === 'l') {
        e.preventDefault();
        void update('ui.catalogPanelOpen', !(config?.ui.catalogPanelOpen ?? false));
      } else if (key === 'w' && active) {
        e.preventDefault();
        void closeTab(active.sessionId);
      } else if (e.shiftKey && key === 'c' && active) {
        e.preventDefault();
        copySelection(active.sessionId);
      } else if (e.shiftKey && key === 'v' && showTerminal && active) {
        e.preventDefault();
        handlePaste(active.sessionId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    setSearchOpen(false);
  }, [activeSessionId]);

  // SNIP-08: после 5-й команды в сессии — одноразовая подсказка о сниппетах.
  // Не более 2 показов суммарно (shownCounts) и никогда в «Режиме эксперта».
  const handleCommandSent = useCallback(
    (sessionId: string) => {
      const n = (commandCounts.current.get(sessionId) ?? 0) + 1;
      commandCounts.current.set(sessionId, n);
      const cfg = getCurrentConfig();
      if (n === 5 && cfg && !cfg.ui.expertMode && (cfg.shownCounts['snippetHint'] ?? 0) < 2) {
        setHintVisible(true);
        void markHint('snippetHint');
      }
    },
    [markHint]
  );

  const handlePaste = useCallback((sessionId: string) => {
    void window.lucidSSH.clipboardRead().then((text) => {
      if (!text) return;
      if (text.includes('\n') || text.includes('\r')) {
        setPastePreview(text); // многострочная — предпросмотр (TERM-05)
      } else {
        pasteText(sessionId, text);
      }
    });
  }, []);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <TabBar onToggleDetails={() => setDetailsOpen((v) => !v)} detailsOpen={detailsOpen} />

      {/* Breadcrumb + мини-дашборд (BRD-01, DASH-01) — для живой сессии */}
      {showTerminal && active && (
        <BreadcrumbBar
          crumb={breadcrumbs[active.sessionId]}
          metrics={dashboards[active.sessionId]}
        />
      )}

      <div className="relative flex min-h-0 flex-1 flex-col bg-bg-terminal">
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1">
            <div className="text-[14px] font-medium text-text-dim">{t('terminal.empty.title')}</div>
            <div className="text-[12px] text-text-faint">{t('terminal.empty.description')}</div>
          </div>
        ) : (
          <>
            {showTerminal && (
              <div className="relative min-h-0 flex-1 p-2">
                <XtermView
                  key={active.sessionId}
                  sessionId={active.sessionId}
                  onContextMenu={(x, y) =>
                    setCtxMenu({ x, y, hasSelection: getSelection(active.sessionId).length > 0 })
                  }
                  onMultilinePaste={(text) => setPastePreview(text)}
                />
                {searchOpen && (
                  <TerminalSearchBar
                    sessionId={active.sessionId}
                    onClose={() => setSearchOpen(false)}
                  />
                )}
              </div>
            )}

            {active.status === 'connecting' && (
              <div className="flex flex-1 items-center justify-center text-[13px] font-medium text-text-body">
                {t('tabs.status.connecting')}
              </div>
            )}

            {active.status === 'disconnected' && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2">
                <div className="text-[13px] font-medium text-text-body">
                  {t('tabs.status.disconnected')}
                </div>
                <div className="text-[12px] text-text-dim">
                  {t('tabs.disconnectedNote', { name: active.hostName })}
                </div>
                <button
                  type="button"
                  onClick={() => void reconnect(active.hostId, active.sessionId)}
                  className="mt-1 h-8 rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover"
                >
                  {t('tabs.reconnect')}
                </button>
              </div>
            )}
          </>
        )}
        {active && detailsOpen && (
          <ConnectionLogPanel sessionId={active.sessionId} onClose={() => setDetailsOpen(false)} />
        )}
        {/* Детектор ошибок выезжает снизу, не перекрывая строку ввода (ERR-03) */}
        {active && errors[active.sessionId] && (
          <ErrorDetector
            sessionId={active.sessionId}
            explanation={errors[active.sessionId]!}
            onClose={() => dismissError(active.sessionId)}
          />
        )}
      </div>

      {/* Одноразовая подсказка о сниппетах (SNIP-08) — над композером */}
      {hintVisible && showTerminal && active && !config?.terminal.inlineInput && (
        <HintBar onClose={() => setHintVisible(false)} />
      )}

      {/* Композер команд — перехватывается Стражем (GUARD-02). Показан для живой
          сессии, кроме режима «ввод прямо в консоли» (тогда ввод идёт в pty). */}
      {showTerminal && active && !config?.terminal.inlineInput && (
        <BottomInputBar
          sessionId={active.sessionId}
          onDanger={setDangerPrompt}
          onOpenHistory={openHistory}
          onToggleCatalog={() => void update('ui.catalogPanelOpen', !(config?.ui.catalogPanelOpen ?? false))}
          onCommandSent={() => handleCommandSent(active.sessionId)}
        />
      )}

      {ctxMenu && active && (
        <TerminalContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          hasSelection={ctxMenu.hasSelection}
          onCopy={() => copySelection(active.sessionId)}
          onPaste={() => handlePaste(active.sessionId)}
          onSaveSnippet={() => {
            // Сохраняем выделение терминала или текущий ввод композера (SNIP-02)
            const text = getSelection(active.sessionId) || getComposerValue();
            if (text.trim()) openSnippetDialog(text.trim());
          }}
          onFind={() => setSearchOpen(true)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {pastePreview !== null && active && (
        <PastePreviewDialog
          text={pastePreview}
          onConfirm={(text) => {
            pasteText(active.sessionId, text);
            setPastePreview(null);
          }}
          onCancel={() => setPastePreview(null)}
        />
      )}

      {dangerPrompt && (
        <DangerGuardModal
          prompt={dangerPrompt}
          onConfirm={(text) => {
            void window.lucidSSH.confirmDangerousCommand(dangerPrompt.requestId, text);
            insertIntoComposer(''); // команда ушла на сервер — очищаем композер
            setDangerPrompt(null);
          }}
          onCancel={() => {
            window.lucidSSH.cancelDangerousCommand(dangerPrompt.requestId);
            setDangerPrompt(null);
          }}
        />
      )}
    </main>
  );
}
