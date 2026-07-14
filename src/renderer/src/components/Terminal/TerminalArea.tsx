import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessions } from '@/stores/sessions';
import { TabBar } from './TabBar';
import { ConnectionLogPanel } from './ConnectionLogPanel';
import type { DangerousCommandPrompt } from '@shared/guard';
import {
  XtermView,
  destroyTerminal,
  copySelection,
  getSelection,
  insertText,
  getPendingLine,
  confirmPendingLine,
  pasteText
} from './XtermView';
import { PastePreviewDialog } from './PastePreviewDialog';
import { TerminalContextMenu } from './TerminalContextMenu';
import { SnippetPalette } from './SnippetPalette';
import { TerminalSearchBar } from './TerminalSearchBar';
import { HintBar } from './HintBar';
import { OnboardingHints } from './OnboardingHints';
import { DangerGuardModal } from '@/components/Guard/DangerGuardModal';
import { BreadcrumbBar } from '@/components/Breadcrumb/BreadcrumbBar';
import { ServerDashboardModal } from './ServerDashboardModal';
import { ErrorDetector } from './ErrorDetector';
import { useConfig, getCurrentConfig } from '@/stores/config';
import { usePanels } from '@/stores/panels';
import { useHosts } from '@/stores/hosts';
import { useEvents } from '@/stores/events';
import { setComposerInsertHandler, setComposerValueGetter } from '@/stores/composerBus';

/**
 * Центральная область (Design_Brief §3.3): таб-бар, xterm.js, контекстное меню
 * (CTX-01), предпросмотр многострочной вставки (TERM-05), поиск Ctrl+F (FIND-01),
 * лог соединения. Терминалы кэшируются по sessionId — буфер сохраняется.
 */
export function TerminalArea(): JSX.Element {
  const { t } = useTranslation();
  const {
    sessions,
    activeSessionId,
    reconnect,
    closeTab,
    breadcrumbs,
    dashboards,
    errors,
    dismissError,
    authPrompts,
    answerAuthPrompt
  } = useSessions();
  const { config, update, markHint } = useConfig();
  const { openSnippetDialog, openQuickConnect, openSettings, snippetsRevision } = usePanels();
  const { hosts, openDrawer } = useHosts();
  const { addGuardUncertainEvent, removeGuardUncertainEvent } = useEvents();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dashboardModalOpen, setDashboardModalOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(
    null
  );
  // SNIP-09: позиция курсора в области терминала (не всей страницы) для
  // открытия палитры сниппетов рядом с курсором по Ctrl+Space.
  const mousePosRef = useRef({ x: 0, y: 0 });
  const [palettePos, setPalettePos] = useState<{ x: number; y: number } | null>(null);
  const [pastePreview, setPastePreview] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dangerPrompt, setDangerPrompt] = useState<DangerousCommandPrompt | null>(null);
  const [activeHint, setActiveHint] = useState<'snippet' | 'palette' | null>(null);
  const prevSnippetsRevision = useRef(snippetsRevision);
  const [onboardingDone, setOnboardingDone] = useState(false);
  /** Не удалось определить «на промпте ли» сессия (busybox без shell-интеграции
   *  и т.п.) — индикатор в BreadcrumbBar (§ плана «единый терминал-ввод»). */
  const [shellStateUnknown, setShellStateUnknown] = useState<Record<string, boolean>>({});
  const commandCounts = useRef<Map<string, number>>(new Map());
  const knownIds = useRef<Set<string>>(new Set());
  /** Сессии, где auth-диалог (промпт пароля) уже начался — терминал у них
   *  остаётся смонтированным на всё время подключения, без мигания. */
  const authTouched = useRef<Set<string>>(new Set());

  useEffect(() => {
    const current = new Set(sessions.map((s) => s.sessionId));
    for (const id of knownIds.current) {
      if (!current.has(id)) {
        destroyTerminal(id);
        authTouched.current.delete(id);
      }
    }
    knownIds.current = current;
  }, [sessions]);

  const active = sessions.find((s) => s.sessionId === activeSessionId);

  // Мост composerBus → терминал активной сессии: каталог/история/сниппеты/
  // breadcrumb-«cd» по-прежнему зовут insertIntoComposer/getComposerValue, не
  // зная о sessionId — раньше это разруливал BottomInputBar, теперь роль
  // «текущего поля ввода» у терминала активной сессии (GUARD-04).
  useEffect(() => {
    if (!active) {
      setComposerInsertHandler(null);
      setComposerValueGetter(null);
      return;
    }
    const sessionId = active.sessionId;
    setComposerInsertHandler((text) => insertText(sessionId, text));
    setComposerValueGetter(() => getPendingLine(sessionId));
    return () => {
      setComposerInsertHandler(null);
      setComposerValueGetter(null);
    };
  }, [active?.sessionId]);

  const showTerminal = active && active.status !== 'disconnected' && active.status !== 'connecting';
  // Промпт пароля/passphrase показывается прямо в терминале (SSH-06) — на
  // время подключения xterm монтируется раньше открытия шелла. Сессии, где
  // auth-диалог уже начался, держат терминал смонтированным до конца
  // подключения (между попытками промпта нет, но терминал не должен мигать).
  const activeAuthPrompt =
    active && active.status === 'connecting' ? authPrompts[active.sessionId] : undefined;
  if (active && activeAuthPrompt) authTouched.current.add(active.sessionId);
  const showAuthTerminal =
    active && active.status === 'connecting' && authTouched.current.has(active.sessionId);
  // Онбординг-подсказки: до «Режима эксперта» и пока не пройдены (§5.1)
  const showOnboarding =
    !onboardingDone &&
    !config?.ui.expertMode &&
    (config?.shownCounts['onboardingTips'] ?? 0) < 1;

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
      } else if (e.key === ' ' && showTerminal && active) {
        // SNIP-09: без активной сессии палитра не открывается вовсе (как и
        // остальные терминал-хоткеи выше, привязанные к showTerminal).
        // Ctrl+Space исторически маппится терминалами на управляющий символ
        // NUL (0x00) — xterm.js может перехватить его на textarea раньше,
        // чем событие всплывёт сюда. stopPropagation, чтобы xterm не отправил
        // символ в сессию поверх открытия палитры.
        e.preventDefault();
        e.stopPropagation();
        setPalettePos(mousePosRef.current);
      }
    };
    // capture: true — перехватываем раньше, чем xterm.js на своей textarea
    // успеет обработать Ctrl+Space по-своему (см. комментарий выше).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    setSearchOpen(false);
    setPalettePos(null);
  }, [activeSessionId]);

  // SNIP-08: после 5-й команды в сессии — одноразовая подсказка о сниппетах.
  // Не более 2 показов суммарно (shownCounts) и никогда в «Режиме эксперта».
  const handleCommandSent = useCallback(
    (sessionId: string) => {
      const n = (commandCounts.current.get(sessionId) ?? 0) + 1;
      commandCounts.current.set(sessionId, n);
      const cfg = getCurrentConfig();
      if (n === 5 && cfg && !cfg.ui.expertMode && (cfg.shownCounts['snippetHint'] ?? 0) < 2) {
        setActiveHint('snippet');
        void markHint('snippetHint');
      }
    },
    [markHint]
  );

  // SNIP-09: сразу после сохранения любого сниппета — одноразовая подсказка
  // про Ctrl+Space (пропускает самый первый рендер, срабатывает только на
  // реальное увеличение snippetsRevision). Тот же лимит показов, что SNIP-08.
  useEffect(() => {
    if (snippetsRevision === prevSnippetsRevision.current) return;
    prevSnippetsRevision.current = snippetsRevision;
    const cfg = getCurrentConfig();
    if (showTerminal && cfg && !cfg.ui.expertMode && (cfg.shownCounts['snippetPaletteHint'] ?? 0) < 2) {
      setActiveHint('palette');
      void markHint('snippetPaletteHint');
    }
  }, [snippetsRevision, showTerminal, markHint]);

  const handlePaste = useCallback((sessionId: string) => {
    void window.lucidSSH.clipboardRead().then((text) => {
      if (!text) return;
      if (text.includes('\n') || text.includes('\r')) {
        setPastePreview(text); // многострочная — предпросмотр (TERM-05)
      } else {
        insertText(sessionId, text);
      }
    });
  }, []);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <TabBar
        onToggleDetails={() => setDetailsOpen((v) => !v)}
        onToggleCatalog={() => void update('ui.catalogPanelOpen', !(config?.ui.catalogPanelOpen ?? false))}
        catalogOpen={config?.ui.catalogPanelOpen ?? false}
      />

      {/* Breadcrumb + мини-дашборд (BRD-01, DASH-01) — для живой сессии */}
      {showTerminal && active && (
        <BreadcrumbBar
          crumb={breadcrumbs[active.sessionId]}
          metrics={dashboards[active.sessionId]}
          onOpenDashboard={() => setDashboardModalOpen(true)}
          guardEnabled={
            (config?.guard.globalEnabled ?? true) &&
            (hosts.find((h) => h.id === active.hostId)?.guardEnabled ?? true)
          }
          guardOffReason={
            !(config?.guard.globalEnabled ?? true)
              ? 'global'
              : !(hosts.find((h) => h.id === active.hostId)?.guardEnabled ?? true)
                ? 'host'
                : undefined
          }
          shellStateUnknown={shellStateUnknown[active.sessionId] ?? false}
          onOpenGuardSettings={
            !(config?.guard.globalEnabled ?? true)
              ? () => openSettings('security')
              : active.hostId !== 0
                ? () => {
                    const host = hosts.find((h) => h.id === active.hostId);
                    if (host) openDrawer({ editHost: host });
                  }
                : undefined
          }
        />
      )}
      {active && dashboardModalOpen && (
        <ServerDashboardModal
          hostName={active.hostName}
          metrics={dashboards[active.sessionId]}
          onClose={() => setDashboardModalOpen(false)}
        />
      )}

      <div
        className="relative flex min-h-0 flex-1 flex-col bg-bg-terminal"
        onMouseMove={(e) => {
          mousePosRef.current = { x: e.clientX, y: e.clientY };
        }}
      >
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1">
            <div className="text-[14px] font-medium text-text-dim">{t('terminal.empty.title')}</div>
            <div className="text-[12px] text-text-faint">{t('terminal.empty.description')}</div>
            <button
              type="button"
              onClick={openQuickConnect}
              className="mt-[14px] text-[12px] text-lavender hover:underline"
            >
              {t('terminal.empty.quickConnectPrefix')} <span className="font-mono">user@host</span>
            </button>
          </div>
        ) : (
          <>
            {(showTerminal || showAuthTerminal) && (
              <div className="relative min-h-0 flex-1 px-4 py-3">
                <XtermView
                  key={active.sessionId}
                  sessionId={active.sessionId}
                  onContextMenu={(x, y) =>
                    setCtxMenu({ x, y, hasSelection: getSelection(active.sessionId).length > 0 })
                  }
                  onMultilinePaste={(text) => setPastePreview(text)}
                  authPrompt={activeAuthPrompt}
                  onAuthAnswer={(answers) => void answerAuthPrompt(active.sessionId, answers)}
                  onDanger={setDangerPrompt}
                  onCommandSent={() => handleCommandSent(active.sessionId)}
                  onShellStateChange={(unknown) => {
                    setShellStateUnknown((prev) => ({ ...prev, [active.sessionId]: unknown }));
                    if (unknown) addGuardUncertainEvent(active.hostName);
                    else removeGuardUncertainEvent(active.hostName);
                  }}
                />
                {searchOpen && (
                  <TerminalSearchBar
                    sessionId={active.sessionId}
                    onClose={() => setSearchOpen(false)}
                  />
                )}
              </div>
            )}

            {/* absolute inset-0, не flex-1: иначе открытие «Детали подключения»
                (нормальный flex-сиблинг снизу) сжимало эту центрированную
                область и весь блок «прыгал» вверх (§ баг с прыжком, 10.07.2026).
                pointer-events-none на обёртке: позиционированные элементы
                рисуются поверх обычных независимо от порядка в DOM, иначе
                прозрачная область перекрывала клики по панели деталей ниже —
                включаем события точечно только там, где реально есть контролы. */}
            {active.status === 'connecting' && !showAuthTerminal && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-medium text-text-body">
                {t('tabs.status.connecting')}
              </div>
            )}

            {active.status === 'disconnected' && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
                <div className="text-[13px] font-medium text-text-body">
                  {t('tabs.status.disconnected')}
                </div>
                <div className="text-[12px] text-text-dim">
                  {t('tabs.disconnectedNote', { name: active.hostName })}
                </div>
                <div className="pointer-events-auto mt-1 flex flex-col items-center gap-2">
                  {/* HM-11: у Quick Connect сессии (hostId=0) нет сохранённого хоста —
                      переподключаться нечем, только «Закрыть» (крестик на вкладке) и детали. */}
                  {active.hostId !== 0 && (
                    <button
                      type="button"
                      onClick={() => void reconnect(active.hostId, active.sessionId)}
                      className="h-8 w-[168px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover"
                    >
                      {t('tabs.reconnect')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDetailsOpen(true)}
                    className="h-8 w-[168px] rounded-[6px] border border-border-strong px-4 text-[12.5px] font-medium text-text-body hover:bg-bg-elevated"
                  >
                    {t('tabs.details')}
                  </button>
                </div>
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

      {/* Онбординг-подсказки «Совет N из 3» (§5.1) */}
      {showOnboarding && showTerminal && active && (
        <OnboardingHints
          onDone={() => {
            setOnboardingDone(true);
            void markHint('onboardingTips');
          }}
        />
      )}

      {/* Одноразовая подсказка SNIP-08 / SNIP-09 */}
      {!showOnboarding && activeHint && showTerminal && active && (
        <HintBar
          textKey={activeHint === 'palette' ? 'hint.snippetPalette' : undefined}
          onClose={() => setActiveHint(null)}
        />
      )}

      {palettePos && active && (
        <SnippetPalette
          x={palettePos.x}
          y={palettePos.y}
          hostId={active.hostId}
          onClose={() => setPalettePos(null)}
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
            // Сохраняем выделение терминала или текущий незавершённый ввод (SNIP-02)
            const text = getSelection(active.sessionId) || getPendingLine(active.sessionId);
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
            confirmPendingLine(dangerPrompt.sessionId); // команда ушла на сервер — чистим буфер терминала
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
