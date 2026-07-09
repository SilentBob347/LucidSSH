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
import { OnboardingHints } from './OnboardingHints';
import { DangerGuardModal } from '@/components/Guard/DangerGuardModal';
import { BreadcrumbBar } from '@/components/Breadcrumb/BreadcrumbBar';
import { ServerDashboardModal } from './ServerDashboardModal';
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
  const { openHistory, openSnippetDialog } = usePanels();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dashboardModalOpen, setDashboardModalOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(
    null
  );
  const [pastePreview, setPastePreview] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dangerPrompt, setDangerPrompt] = useState<DangerousCommandPrompt | null>(null);
  const [activeHint, setActiveHint] = useState<'ctrlc' | 'snippet' | null>(null);
  const [onboardingDone, setOnboardingDone] = useState(false);
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
        setActiveHint('snippet');
        void markHint('snippetHint');
      }
    },
    [markHint]
  );

  // Одноразовая подсказка: сочетания вроде Ctrl+C работают только когда
  // фокус в выводе терминала, не в композере (§14 фидбека, 10.07.2026) —
  // показывается при первом фокусе в поле ввода.
  const handleComposerFocus = useCallback(() => {
    const cfg = getCurrentConfig();
    if (cfg && !cfg.ui.expertMode && (cfg.shownCounts['ctrlcHint'] ?? 0) < 2) {
      setActiveHint('ctrlc');
      void markHint('ctrlcHint');
    }
  }, [markHint]);

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
      <TabBar onToggleDetails={() => setDetailsOpen((v) => !v)} />

      {/* Breadcrumb + мини-дашборд (BRD-01, DASH-01) — для живой сессии */}
      {showTerminal && active && (
        <BreadcrumbBar
          crumb={breadcrumbs[active.sessionId]}
          metrics={dashboards[active.sessionId]}
          onOpenDashboard={() => setDashboardModalOpen(true)}
        />
      )}
      {active && dashboardModalOpen && (
        <ServerDashboardModal
          hostName={active.hostName}
          metrics={dashboards[active.sessionId]}
          onClose={() => setDashboardModalOpen(false)}
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
                  <button
                    type="button"
                    onClick={() => void reconnect(active.hostId, active.sessionId)}
                    className="h-8 w-[168px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover"
                  >
                    {t('tabs.reconnect')}
                  </button>
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

      {/* Онбординг-подсказки «Совет N из 3» — над композером, до режима эксперта (§5.1) */}
      {showOnboarding && showTerminal && active && !config?.terminal.inlineInput && (
        <OnboardingHints
          onDone={() => {
            setOnboardingDone(true);
            void markHint('onboardingTips');
          }}
        />
      )}

      {/* Одноразовая подсказка (SNIP-08 или про фокус терминала) — над композером */}
      {!showOnboarding && activeHint && showTerminal && active && !config?.terminal.inlineInput && (
        <HintBar
          textKey={activeHint === 'ctrlc' ? 'hint.ctrlc' : undefined}
          onClose={() => setActiveHint(null)}
        />
      )}

      {/* Композер команд — перехватывается Стражем (GUARD-02). В режиме «ввод
          прямо в консоли» поле ~$ скрыто (ввод идёт в pty), но кнопки
          Истории/Команд остаются — иначе им негде быть (TERM-02). */}
      {showTerminal && active && (
        <BottomInputBar
          sessionId={active.sessionId}
          onDanger={setDangerPrompt}
          onOpenHistory={openHistory}
          onToggleCatalog={() => void update('ui.catalogPanelOpen', !(config?.ui.catalogPanelOpen ?? false))}
          catalogOpen={config?.ui.catalogPanelOpen ?? false}
          onCommandSent={() => handleCommandSent(active.sessionId)}
          hideInput={config?.terminal.inlineInput}
          onInputFocus={handleComposerFocus}
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
