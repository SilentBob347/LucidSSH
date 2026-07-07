import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryEntry } from '@shared/history';
import { insertIntoComposer } from '@/stores/composerBus';
import { usePanels } from '@/stores/panels';
import { Icon } from '@/components/common/Icon';

/**
 * Панель истории команд (HistoryDrawer, Design_Brief §3.5; скриншот 06).
 * Выезжает справа. Поиск, фильтр-чипы, строки с копированием/вставкой/
 * сохранением в сниппет, заметками, статусами Стража, маскированными
 * секретами (HIST-01…07). Без вкладки «Избранное» — по ТЗ §3.13 ★-избранное
 * заменено кнопкой-закладкой → SnippetSaveDialog, отдельный список снипетов
 * уже есть в панели «Команды» (CatalogPanel), дублировать здесь не нужно.
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
  const { closeHistory, openSnippetDialog } = usePanels();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [hostFilter, setHostFilter] = useState<number | 'all' | 'session'>('all');
  const [noteEditing, setNoteEditing] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const refreshHistory = useCallback(() => {
    void window.lucidSSH.listHistory(query ? { text: query } : undefined).then(setEntries);
    void window.lucidSSH.historyCount().then(setTotal);
  }, [query]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

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
        className="animate-[esh-slidein_.22s_cubic-bezier(.2,.7,.3,1)] absolute top-0 right-0 flex h-full w-[560px] max-w-[92%] flex-col border-l border-border-strong bg-bg-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="shrink-0 border-b border-border-default px-[18px] pt-[15px] pb-3">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold text-text-strong">{t('history.title')}</span>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={closeHistory}
              className="flex size-[24px] items-center justify-center rounded-[4px] text-text-muted hover:bg-bg-elevated hover:text-text-strong"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('history.searchPlaceholder')}
            className="mt-[11px] h-8 w-full rounded-[4px] border border-border-default bg-bg-base px-3 text-[12.5px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent"
          />
          <div className="mt-[10px] flex flex-wrap gap-[6px]">
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
                <div className="flex flex-col items-center gap-3 px-6 pt-[54px] text-center">
                  <Icon name="history" size={34} strokeWidth={1.6} className="text-text-faint" />
                  <div className="text-[13px] font-medium text-text-body">
                    {query ? t('history.noMatches') : t('history.empty.title')}
                  </div>
                  <div className="max-w-[260px] text-[12px] leading-[1.5] text-text-muted">
                    {query ? t('history.noMatchesDesc') : t('history.empty.description')}
                  </div>
                </div>
              ) : (
                visible.map((e) => {
                  const expandable = e.guardStatus !== 'blocked';
                  const expanded = expandedId === e.id;
                  return (
                  <div key={e.id} className="border-b border-border-hairline py-[10px]">
                    <div className="flex items-center gap-[10px]">
                      <button
                        type="button"
                        disabled={!expandable}
                        onClick={() => expandable && setExpandedId(expanded ? null : e.id)}
                        className="flex min-w-0 flex-1 items-center gap-[6px] text-left font-mono text-[12.5px] text-text-strong hover:text-lavender disabled:cursor-default disabled:hover:text-text-strong"
                      >
                        {expandable && (
                          <Icon
                            name="chevron-right"
                            size={11}
                            className={`shrink-0 text-text-dim transition-transform ${expanded ? 'rotate-90' : ''}`}
                          />
                        )}
                        <span className="min-w-0 truncate">{e.command}</span>
                      </button>
                      {e.hasSecret && (
                        <span className="flex shrink-0 items-center gap-1 text-text-dim">
                          <Icon name="lock" size={13} />
                          <span className="text-[9.5px] font-semibold tracking-[0.03em]">
                            {t('history.secretHidden')}
                          </span>
                        </span>
                      )}
                      <div className="flex shrink-0 gap-1">
                        <IconBtn title={t('history.copy')} onClick={() => window.lucidSSH.clipboardWrite(e.command)}><Icon name="copy" size={13} /></IconBtn>
                        <IconBtn title={t('history.insert')} onClick={() => insertIntoComposer(e.command)}><Icon name="insert" size={13} /></IconBtn>
                        <button
                          type="button"
                          title={t('history.saveSnippet')}
                          aria-label={t('history.saveSnippet')}
                          onClick={() => openSnippetDialog(e.command)}
                          className="relative flex size-[24px] shrink-0 items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
                        >
                          <Icon name="save" size={15} />
                          <span className="pointer-events-none absolute -right-[1px] -bottom-[1px] flex size-[11px] items-center justify-center">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth={4} strokeLinecap="round" aria-hidden="true">
                              <path d="M12 6v12" />
                              <path d="M6 12h12" />
                            </svg>
                          </span>
                        </button>
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
                        <span className="rounded-[4px] bg-warning/15 px-2 py-[1px] text-[10px] text-warning">
                          {t('history.confirmed')}
                        </span>
                      )}
                      {e.guardStatus === 'blocked' && (
                        <span className="rounded-[4px] bg-danger/15 px-2 py-[1px] text-[10px] text-danger">
                          {t('history.blocked')}
                        </span>
                      )}
                      {e.exitCode !== undefined && e.exitCode !== 0 && (
                        <span className="rounded-[4px] bg-danger/15 px-2 py-[1px] text-[10px] text-danger">
                          {t('history.error')}
                        </span>
                      )}
                    </div>
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
                        className="mt-[7px] h-7 w-full rounded-[4px] border border-border-strong bg-bg-base px-2 text-[12px] text-text-strong outline-none focus:border-accent"
                      />
                    ) : e.note ? (
                      <div className="mt-[7px] flex items-center gap-[7px] rounded-[4px] bg-warning/10 px-[9px] py-[6px] text-[11.5px] leading-[1.45] text-warning-text">
                        <Icon name="edit" size={11} className="shrink-0" />
                        <button
                          type="button"
                          onClick={() => {
                            setNoteEditing(e.id);
                            setNoteText(e.note ?? '');
                          }}
                          className="min-w-0 flex-1 truncate text-left hover:underline"
                        >
                          {e.note}
                        </button>
                        <button
                          type="button"
                          title={t('history.deleteNote')}
                          aria-label={t('history.deleteNote')}
                          onClick={() => void window.lucidSSH.addHistoryNote(e.id, '').then(refreshHistory)}
                          className="shrink-0 text-warning-text/70 hover:text-warning-text"
                        >
                          <Icon name="close" size={11} />
                        </button>
                      </div>
                    ) : (
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
                    )}
                    {expanded && (
                      <div className="mt-[8px] rounded-[4px] border border-border-default bg-bg-base p-[9px]">
                        {e.output ? (
                          <>
                            <pre className="max-h-[220px] overflow-y-auto font-mono text-[11.5px] leading-[1.5] whitespace-pre-wrap text-text-body">
                              {e.output}
                            </pre>
                            {e.outputTruncated && (
                              <div className="mt-[6px] text-[10.5px] text-text-dim">
                                {t('history.output.truncated', { limit: 4000 })}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-[11.5px] text-text-dim">
                            {e.hasSecret ? t('history.output.hiddenSecret') : t('history.output.empty')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })
              )}
            </div>

        <div className="shrink-0 border-t border-border-default px-[16px] py-[10px] font-mono text-[11.5px] text-text-muted">
          {t('history.footer', { shown: visible.length, total })}
        </div>
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
          ? 'rounded-[20px] border border-accent bg-accent/15 px-[11px] py-1 text-[11.5px] text-lavender-light'
          : 'rounded-[20px] border border-border-default px-[11px] py-1 text-[11.5px] text-text-muted hover:text-text-body'
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
