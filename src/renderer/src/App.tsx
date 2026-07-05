import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { TitleBar } from './components/chrome/TitleBar';
import { StatusBar } from './components/chrome/StatusBar';
import { HostPanel } from './components/HostManager/HostPanel';
import { NewConnectionDrawer } from './components/HostManager/NewConnectionDrawer';
import { TerminalArea } from './components/Terminal/TerminalArea';
import { FingerprintModal } from './components/Terminal/FingerprintModal';
import { CatalogPanel } from './components/CommandCatalog/CatalogPanel';
import { WelcomeScreen } from './components/Onboarding/WelcomeScreen';
import { FeatureGuide } from './components/Onboarding/FeatureGuide';
import { WindowCloseGuard } from './components/Terminal/WindowCloseGuard';
import { ResizeDivider } from './components/common/ResizeDivider';
import { HistoryDrawer } from './components/History/HistoryDrawer';
import { SnippetSaveDialog } from './components/Snippets/SnippetSaveDialog';
import { SettingsScreen } from './components/Settings/SettingsScreen';
import { HostsProvider, useHosts } from './stores/hosts';
import { SessionsProvider, useSessions } from './stores/sessions';
import { ConfigProvider, useConfig } from './stores/config';
import { PanelsProvider, usePanels } from './stores/panels';

/**
 * Welcome-экран показывается вместо основного UI, пока нет ни одного хоста
 * и onboarding не пройден (OB-01, OB-03); справка открывается из него и из
 * тайтл-бара (позже — по F1, HELP-02).
 */
function AppBody(): JSX.Element {
  const { hosts, loaded, openDrawer } = useHosts();
  const { hostKeyPrompt, answerHostKey, sessions, activeSessionId } = useSessions();
  const { config, update } = useConfig();
  const { historyOpen, snippetDialog, closeSnippetDialog, bumpSnippets, settingsOpen, openSettings, openHistory } =
    usePanels();
  const [guideOpen, setGuideOpen] = useState(false);

  // Глобальные хоткеи (SET-01 Ctrl+, · SET-06). Ctrl+F/поиск живёт в TerminalArea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        openSettings();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        openHistory();
      } else if (e.key === 'F1') {
        e.preventDefault();
        setGuideOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSettings, openHistory]);

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);

  const showWelcome = loaded && hosts.length === 0;
  const leftWidth = config?.ui.leftPanelWidth ?? 220;
  const rightWidth = config?.ui.rightPanelWidth ?? 320;
  const catalogOpen = config?.ui.catalogPanelOpen ?? false;

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      {showWelcome ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <WelcomeScreen onAddFirst={() => openDrawer()} onOpenGuide={() => setGuideOpen(true)} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <HostPanel ref={leftRef} width={leftWidth} />
          <ResizeDivider
            side="left"
            targetRef={leftRef}
            min={160}
            max={340}
            onCommit={(w) => void update('ui.leftPanelWidth', w)}
          />
          <TerminalArea />
          {catalogOpen && (
            <>
              <ResizeDivider
                side="right"
                targetRef={rightRef}
                min={200}
                max={480}
                onCommit={(w) => void update('ui.rightPanelWidth', w)}
              />
              <CatalogPanel
                ref={rightRef}
                width={rightWidth}
                onClose={() => void update('ui.catalogPanelOpen', false)}
              />
            </>
          )}
        </div>
      )}
      <StatusBar />
      <NewConnectionDrawer />
      {guideOpen && <FeatureGuide onClose={() => setGuideOpen(false)} />}
      {hostKeyPrompt && (
        <FingerprintModal
          prompt={hostKeyPrompt}
          onAnswer={(decision) => void answerHostKey(decision)}
        />
      )}
      <WindowCloseGuard />
      {historyOpen && <HistoryDrawer activeHostId={activeSession?.hostId} />}
      {settingsOpen && <SettingsScreen onOpenGuide={() => setGuideOpen(true)} />}
      {snippetDialog && (
        <SnippetSaveDialog
          command={snippetDialog.command}
          editSnippet={snippetDialog.editSnippet}
          hostId={activeSession?.hostId}
          hostName={activeSession?.hostName}
          onSaved={() => {
            bumpSnippets();
            closeSnippetDialog();
          }}
          onClose={closeSnippetDialog}
        />
      )}
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <ConfigProvider>
      <HostsProvider>
        <SessionsProvider>
          <PanelsProvider>
            <AppBody />
          </PanelsProvider>
        </SessionsProvider>
      </HostsProvider>
    </ConfigProvider>
  );
}
