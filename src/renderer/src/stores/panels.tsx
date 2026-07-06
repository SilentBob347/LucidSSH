import type { JSX, ReactNode } from 'react';
import { createContext, useContext, useMemo, useState } from 'react';
import type { Snippet } from '@shared/history';

/**
 * Состояние выдвижных панелей/модалок истории и сниппетов. Триггерится из разных
 * мест (кнопка «История», контекстное меню терминала, строки истории), поэтому
 * вынесено в отдельный стор.
 */

interface SnippetDialogState {
  command: string;
  editSnippet?: Snippet;
}

interface PanelsStore {
  historyOpen: boolean;
  openHistory: () => void;
  closeHistory: () => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  guideOpen: boolean;
  openGuide: () => void;
  closeGuide: () => void;
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  snippetDialog: SnippetDialogState | null;
  openSnippetDialog: (command: string, editSnippet?: Snippet) => void;
  closeSnippetDialog: () => void;
  /** Ревизия сниппетов: инкремент после сохранения → HistoryDrawer перечитывает список. */
  snippetsRevision: number;
  bumpSnippets: () => void;
}

const Ctx = createContext<PanelsStore | null>(null);

export function PanelsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [snippetDialog, setSnippetDialog] = useState<SnippetDialogState | null>(null);
  const [snippetsRevision, setSnippetsRevision] = useState(0);

  const value = useMemo<PanelsStore>(
    () => ({
      historyOpen,
      openHistory: () => setHistoryOpen(true),
      closeHistory: () => setHistoryOpen(false),
      settingsOpen,
      openSettings: () => setSettingsOpen(true),
      closeSettings: () => setSettingsOpen(false),
      guideOpen,
      openGuide: () => setGuideOpen(true),
      closeGuide: () => setGuideOpen(false),
      helpOpen,
      openHelp: () => setHelpOpen(true),
      closeHelp: () => setHelpOpen(false),
      snippetDialog,
      openSnippetDialog: (command, editSnippet) => setSnippetDialog({ command, editSnippet }),
      closeSnippetDialog: () => setSnippetDialog(null),
      snippetsRevision,
      bumpSnippets: () => setSnippetsRevision((v) => v + 1)
    }),
    [historyOpen, settingsOpen, guideOpen, helpOpen, snippetDialog, snippetsRevision]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePanels(): PanelsStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('usePanels outside PanelsProvider');
  return store;
}
