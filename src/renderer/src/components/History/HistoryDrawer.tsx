import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryEntry, Snippet } from '@shared/history';
import { insertIntoComposer } from '@/stores/composerBus';
import { usePanels } from '@/stores/panels';
import { SnippetList } from '@/components/Snippets/SnippetList';
import { Icon } from '@/components/common/Icon';

/**
 * Панель истории и избранного (HistoryDrawer, Design_Brief §3.5; скриншот 06).
 * Выезжает справа. Вкладки «История» и «Избранное». История: поиск, фильтр-чипы,
 * строки с копированием/вставкой/сохранением в сниппет, заметками, статусами
 * Стража, маскированными секретами (HIST-01…07).
 */

function relativeTime(iso: string, t: (k: string, o?: Record<string, number>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('history.time.now');
  if (min < 60) return t('history.time.minutes', { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('history.time.hours', { count: h });
  return t('history.time.days', { count: Math.floor(h / 24) });
}

export function HistoryDrawer({ activeHostId }: { activeHostId?: number }): JSX.Element {
  const { t } = useTranslation();
  const { closeHistory, openSnippetDialog, snippetsRevision } = usePanels();
  const [tab, setTab] = useState<'history' | 'favorites'>('history');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [query, setQuery] = useState('');
  const [hostFilter, setHostFilter] = useState<number | 'all' | 'session'>('all');
  const [noteEditing, setNoteEditing] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');

  const refreshHistory = useCallback(() => {
    void window.lucidSSH.listHistory(query ? { text: query } : undefined).then(setEntries);
    void window.lucidSSH.historyCount().then(setTotal);
  }, [query]);

  const refreshSnippets = useCallback(() => {
    void window.lucidSSH.listSnippets(activeHostId).then(setSnippets);
    // snippetsRevision в зависимостях: перечитать после сохранения через диалог.
  }, [activeHostId, snippetsRevision]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);
  useEffect(() => {
    refreshSnippets();
  }, [refreshSnippets]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeHistory();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeHistory]);

  const hostChips = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of entries) if (e.hostId !== undefined) map.set(e.hostId, e.hostName);
    return [...map.entries()];
  }, [entries]);

  const visible = useMemo(
    () =>
      entries.filter((e) => {
        if (hostFilter === 'all') return true;
        if (hostFilter === 'session') return e.hostId === activeHostId;
        return e.hostId === hostFilter;
      }),
    [entries, hostFilter, activeHostId]
  );

  const saveNote = async (id: number): Promise<void> => {
    await window.lucidSSH.addHistoryNote(id, noteText);
    setNoteEditing(null);
    setNoteText('');
    refreshHistory();
  };

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 bg-black/70"
      onClick={closeHistory}
      role="presentation"
    >
      <aside
        className="animate-[esh-slidein_.22s_cubic-bezier(.2,.7,.3,1)] absolute top-0 right-0 flex h-full w-[560px] max-w-[92%] flex-col border-l border-border-default bg-bg-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex h-[52px] shrink-0 items-center justify-between px-5">
          <span className="text-[15px] font-semibold text-text-primary">{t('history.title')}</span>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={closeHistory}
            className="flex size-[24px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* Вкладки */}
        <div className="flex shrink-0 items-end gap-[2px] border-b border-border-default px-5">
          {(['history', 'favorites'] as const).map((tb) => (
            <button
              key={tb}
              type="button"
              onClick={() => setTab(tb)}
              className={
                tab === tb
                  ? 'h-[32px] rounded-t-[7px] border-b-2 border-accent px-3 text-[12.5px] font-medium text-text-strong'
                  : 'h-[32px] rounded-t-[7px] border-b-2 border-transparent px-3 text-[12.5px] text-text-dim hover:text-text-muted'
              }
            >
              {tb === 'history' ? t('history.tabHistory') : t('history.tabFavorites')}
            </button>
          ))}
        </div>

        {tab === 'history' ? (
          <>
            <div className="shrink-0 px-5 pt-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('history.searchPlaceholder')}
                className="h-8 w-full rounded-[6px] border border-border-strong bg-bg-base px-3 text-[12.5px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent"
              />
              <div className="mt-2 flex flex-wrap gap-1">
                <Chip active={hostFilter === 'all'} onClick={() => setHostFilter('all')}>
                  {t('history.filterAll')}
                </Chip>
                {hostChips.map(([id, name]) => (
                  <Chip key={id} active={hostFilter === id} onClick={() => setHostFilter(id)}>
                    {name}
                  </Chip>
                ))}
                {activeHostId !== undefined && (
                  <Chip active={hostFilter === 'session'} onClick={() => setHostFilter('session')}>
                    {t('history.filterSession')}
                  </Chip>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2">
              {visible.length === 0 ? (
                <div className="pt-10 text-center text-[12.5px] text-text-dim">
                  {query ? t('history.noMatches') : t('history.empty.title')}
                </div>
              ) : (
                visible.map((e) => (
                  <div key={e.id} className="border-b border-border-hairline py-[10px]">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => insertIntoComposer(e.command)}
                        className="min-w-0 flex-1 text-left font-mono text-[12.5px] break-all text-text-strong hover:text-lavender"
                      >
                        {e.command}
                      </button>
                      {e.hasSecret && (
                        <span className="flex shrink-0 items-center gap-1 rounded-[3px] bg-bg-elevated-2 px-[5px] py-[2px] text-[9.5px] font-semibold text-text-dim">
                          <Icon name="lock" size={10} /> {t('history.secretHidden')}
                        </span>
                      )}
                      <div className="flex shrink-0 gap-1">
                        <IconBtn title={t('history.copy')} onClick={() => window.lucidSSH.clipboardWrite(e.command)}><Icon name="copy" size={13} /></IconBtn>
                        <IconBtn title={t('history.insert')} onClick={() => insertIntoComposer(e.command)}><Icon name="insert" size={13} /></IconBtn>
                        <IconBtn title={t('history.saveSnippet')} onClick={() => openSnippetDialog(e.command)}><Icon name="bookmark" size={13} /></IconBtn>
                        <IconBtn
                          title={t('history.delete')}
                          onClick={() => void window.lucidSSH.deleteHistoryEntry(e.id).then(refreshHistory)}
                        >
                          <Icon name="trash" size={13} />
                        </IconBtn>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                      <span
                        className={`size-[7px] rounded-full ${e.exitCode === 0 || e.exitCode === undefined ? 'bg-success' : 'bg-danger'}`}
                      />
                      <span>
                        {e.hostName} · {e.username} · {relativeTime(e.startedAt, t)}
                        {e.exitCode !== undefined && ` · ${t('history.exit', { code: e.exitCode })}`}
                      </span>
                      {e.guardStatus === 'confirmed' && (
                        <span className="rounded-[10px] bg-warning/15 px-2 py-[1px] text-[10px] text-warning-text">
                          {t('history.confirmed')}
                        </span>
                      )}
                      {e.guardStatus === 'blocked' && (
                        <span className="rounded-[10px] bg-danger/15 px-2 py-[1px] text-[10px] text-danger-text">
                          {t('history.blocked')}
                        </span>
                      )}
                      {e.exitCode !== undefined && e.exitCode !== 0 && (
                        <span className="rounded-[10px] bg-danger/15 px-2 py-[1px] text-[10px] text-danger-text">
                          {t('history.error')}
                        </span>
                      )}
                    </div>
                    {e.note && (
                      <div className="mt-1 flex items-center gap-1 rounded-[4px] bg-warning/10 px-2 py-1 text-[11.5px] text-warning-text">
                        <Icon name="edit" size={11} className="shrink-0" /> {e.note}
                      </div>
                    )}
                    {noteEditing === e.id ? (
                      <input
                        autoFocus
                        value={noteText}
                        onChange={(ev) => setNoteText(ev.target.value)}
                        onBlur={() => void saveNote(e.id)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') void saveNote(e.id);
                          if (ev.key === 'Escape') setNoteEditing(null);
                        }}
                        placeholder={t('history.notePlaceholder')}
                        className="mt-1 h-7 w-full rounded-[4px] border border-border-strong bg-bg-base px-2 text-[12px] text-text-strong outline-none focus:border-accent"
                      />
                    ) : (
                      !e.note && (
                        <button
                          type="button"
                          onClick={() => {
                            setNoteEditing(e.id);
                            setNoteText('');
                          }}
                          className="mt-1 text-[11px] text-text-dim hover:text-text-muted"
                        >
                          + {t('history.addNote')}
                        </button>
                      )
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="shrink-0 border-t border-border-default px-5 py-2 text-[11px] text-text-dim">
              {t('history.footer', { shown: visible.length, total })}
            </div>
          </>
        ) : (
          <SnippetList
            snippets={snippets}
            activeHostId={activeHostId}
            onChanged={refreshSnippets}
            onEdit={(s) => openSnippetDialog(s.command, s)}
          />
        )}
      </aside>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-[11px] border border-accent bg-accent/15 px-[10px] py-[2px] text-[11px] text-lavender-light'
          : 'rounded-[11px] border border-border-strong px-[10px] py-[2px] text-[11px] text-text-dim hover:text-text-muted'
      }
    >
      {children}
    </button>
  );
}

function IconBtn({
  title,
  onClick,
  children
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex size-[24px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
    >
      {children}
    </button>
  );
}
