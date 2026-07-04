import type { JSX } from 'react';
import { useRef, useState } from 'react';
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
import { HostsProvider, useHosts } from './stores/hosts';
import { SessionsProvider, useSessions } from './stores/sessions';
import { ConfigProvider, useConfig } from './stores/config';

/**
 * Welcome-экран показывается вместо основного UI, пока нет ни одного хоста
 * и onboarding не пройден (OB-01, OB-03); справка открывается из него и из
 * тайтл-бара (позже — по F1, HELP-02).
 */
function AppBody(): JSX.Element {
  const { hosts, loaded, openDrawer } = useHosts();
  const { hostKeyPrompt, answerHostKey } = useSessions();
  const { config, update } = useConfig();
  const [guideOpen, setGuideOpen] = useState(false);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);

  const showWelcome = loaded && hosts.length === 0;
  const leftWidth = config?.ui.leftPanelWidth ?? 220;
  const rightWidth = config?.ui.rightPanelWidth ?? 320;

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
          <ResizeDivider
            side="right"
            targetRef={rightRef}
            min={200}
            max={480}
            onCommit={(w) => void update('ui.rightPanelWidth', w)}
          />
          <CatalogPanel ref={rightRef} width={rightWidth} />
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
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <ConfigProvider>
      <HostsProvider>
        <SessionsProvider>
          <AppBody />
        </SessionsProvider>
      </HostsProvider>
    </ConfigProvider>
  );
}
