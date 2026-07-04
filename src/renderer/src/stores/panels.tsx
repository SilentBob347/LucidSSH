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
  const [snippetDialog, setSnippetDialog] = useState<SnippetDialogState | null>(null);
  const [snippetsRevision, setSnippetsRevision] = useState(0);

  const value = useMemo<PanelsStore>(
    () => ({
      historyOpen,
      openHistory: () => setHistoryOpen(true),
      closeHistory: () => setHistoryOpen(false),
      snippetDialog,
      openSnippetDialog: (command, editSnippet) => setSnippetDialog({ command, editSnippet }),
      closeSnippetDialog: () => setSnippetDialog(null),
      snippetsRevision,
      bumpSnippets: () => setSnippetsRevision((v) => v + 1)
    }),
    [historyOpen, snippetDialog, snippetsRevision]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePanels(): PanelsStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('usePanels outside PanelsProvider');
  return store;
}
