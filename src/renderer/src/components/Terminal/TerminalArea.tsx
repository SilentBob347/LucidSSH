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
import { DangerGuardModal } from '@/components/Guard/DangerGuardModal';
import { BreadcrumbBar } from '@/components/Breadcrumb/BreadcrumbBar';
import { insertIntoComposer } from '@/stores/composerBus';

/**
 * Центральная область (Design_Brief §3.3): таб-бар, xterm.js, контекстное меню
 * (CTX-01), предпросмотр многострочной вставки (TERM-05), поиск Ctrl+F (FIND-01),
 * лог соединения. Терминалы кэшируются по sessionId — буфер сохраняется.
 */
export function TerminalArea(): JSX.Element {
  const { t } = useTranslation();
  const { sessions, activeSessionId, reconnect, breadcrumbs, dashboards } = useSessions();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(
    null
  );
  const [pastePreview, setPastePreview] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dangerPrompt, setDangerPrompt] = useState<DangerousCommandPrompt | null>(null);
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

  // Ctrl+F открывает поиск по буферу активной сессии (FIND-01)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && showTerminal) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showTerminal]);

  useEffect(() => {
    setSearchOpen(false);
  }, [activeSessionId]);

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
      </div>

      {/* Композер команд — перехватывается Стражем (GUARD-02). Показан для живой сессии. */}
      {showTerminal && active && (
        <BottomInputBar
          sessionId={active.sessionId}
          onDanger={setDangerPrompt}
          onOpenHistory={() => {
            /* Панель истории — Этап 7 */
          }}
          onToggleCatalog={() => {
            /* Переключение каталога — Этап 6 */
          }}
        />
      )}

      {ctxMenu && active && (
        <TerminalContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          hasSelection={ctxMenu.hasSelection}
          onCopy={() => copySelection(active.sessionId)}
          onPaste={() => handlePaste(active.sessionId)}
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
