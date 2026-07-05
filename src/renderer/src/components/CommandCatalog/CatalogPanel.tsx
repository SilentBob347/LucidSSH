import type { JSX } from 'react';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogCommand, CommandsDatabase } from '@shared/content';
import type { Snippet } from '@shared/history';
import { insertIntoComposer } from '@/stores/composerBus';
import { useSessions } from '@/stores/sessions';
import { usePanels } from '@/stores/panels';
import { SnippetList } from '@/components/Snippets/SnippetList';
import { Icon } from '@/components/common/Icon';

/**
 * Правая панель — каталог команд (CAT-01…05; Design_Brief §3.4).
 * Категории с горизонтальным скроллом, карточки команд с флаг-чипами; клик по
 * имени/флагу вставляет команду в композер (проходит через Стража, CAT-04).
 * Русский поиск по имени и keywords (CAT-05). Сниппет-вкладки — Этап 7.
 */
export const CatalogPanel = forwardRef<HTMLElement, { width: number; onClose: () => void }>(
  function CatalogPanel({ width, onClose }, ref): JSX.Element {
    const { t } = useTranslation();
    const { sessions, activeSessionId } = useSessions();
    const { openSnippetDialog, snippetsRevision } = usePanels();
    const active = sessions.find((s) => s.sessionId === activeSessionId);
    const [db, setDb] = useState<CommandsDatabase | null>(null);
    const [category, setCategory] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [tab, setTab] = useState<'catalog' | 'server' | 'global'>('catalog');
    const [snippets, setSnippets] = useState<Snippet[]>([]);
    const catStripRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      void window.lucidSSH.getCommandCatalog().then((d) => {
        setDb(d);
        setCategory(d.categories[0] ?? null);
      });
    }, []);

    // Сниппеты для вкладок [хост]/Глобальные; обновляются при сохранении (SNIP-05)
    const refreshSnippets = useCallback(() => {
      void window.lucidSSH.listSnippets(active?.hostId).then(setSnippets);
    }, [active?.hostId]);
    useEffect(() => {
      refreshSnippets();
    }, [refreshSnippets, snippetsRevision]);

    // Если активный хост исчез, а открыта его вкладка — вернуться к каталогу
    useEffect(() => {
      if (tab === 'server' && !active) setTab('catalog');
    }, [tab, active]);

    const serverSnips = snippets.filter((s) => s.hostId != null && s.hostId === active?.hostId);
    const globalSnips = snippets.filter((s) => s.hostId == null);

    const q = query.trim().toLowerCase();
    const filtered = useMemo(() => {
      if (!db) return [];
      const inCategory = (c: CatalogCommand): boolean => q !== '' || c.category === category;
      const matchesQuery = (c: CatalogCommand): boolean =>
        q === '' ||
        c.name.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.keywords.some((k) => k.toLowerCase().includes(q));
      return db.commands.filter((c) => inCategory(c) && matchesQuery(c));
    }, [db, category, q]);

    const scrollCats = (dir: number): void => {
      catStripRef.current?.scrollBy({ left: dir * 90, behavior: 'smooth' });
    };

    return (
      <aside
        ref={ref}
        style={{ width }}
        className="flex shrink-0 flex-col border-l border-border-default bg-bg-panel"
      >
        <div className="flex h-[38px] shrink-0 items-center justify-between pr-2 pl-3">
          <span className="text-[11px] font-semibold tracking-[0.05em] text-text-muted uppercase">
            {t('catalog.title')}
          </span>
          <button
            type="button"
            title={t('catalog.close')}
            aria-label={t('catalog.close')}
            onClick={onClose}
            className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        {/* Вкладки: Каталог · [хост] · Глобальные (SNIP-05) */}
        <div className="flex h-[32px] shrink-0 items-end gap-[2px] overflow-x-auto border-b border-border-default px-3 [scrollbar-width:none]">
          <TabButton active={tab === 'catalog'} onClick={() => setTab('catalog')}>
            {t('catalog.tabCatalog')}
          </TabButton>
          {active && (
            <TabButton active={tab === 'server'} onClick={() => setTab('server')}>
              {active.hostName}
            </TabButton>
          )}
          <TabButton active={tab === 'global'} onClick={() => setTab('global')}>
            {t('catalog.tabGlobal')}
          </TabButton>
        </div>

        {tab !== 'catalog' ? (
          <SnippetList
            snippets={tab === 'server' ? serverSnips : globalSnips}
            activeHostId={active?.hostId}
            onChanged={refreshSnippets}
            onEdit={(s) => openSnippetDialog(s.command, s)}
          />
        ) : (
          <>
        <div className="px-3 pt-[10px] pb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('catalog.searchPlaceholder')}
            className="h-7 w-full rounded-[4px] border border-border-default bg-bg-base px-2 text-[12px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent"
          />
        </div>

        {/* Категории (скрыты во время поиска) */}
        {q === '' && db && (
          <div className="flex shrink-0 items-center gap-1 px-2 pb-2">
            <button
              type="button"
              onClick={() => scrollCats(-1)}
              aria-label="‹"
              className="flex size-[20px] shrink-0 items-center justify-center rounded-[4px] text-text-dim hover:text-text-strong"
            >
              <Icon name="chevron-left" size={14} />
            </button>
            <div
              ref={catStripRef}
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]"
            >
              {db.categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={
                    category === cat
                      ? 'shrink-0 border-b-2 border-accent px-2 pb-1 text-[12px] font-medium text-text-strong'
                      : 'shrink-0 border-b-2 border-transparent px-2 pb-1 text-[12px] text-text-dim hover:text-text-muted'
                  }
                >
                  {db.categoryLabels[cat] ?? cat}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => scrollCats(1)}
              aria-label="›"
              className="flex size-[20px] shrink-0 items-center justify-center rounded-[4px] text-text-dim hover:text-text-strong"
            >
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-[14px] overflow-y-auto px-3 pt-1 pb-3">
          {filtered.map((cmd) => (
            <CommandCard key={cmd.name} cmd={cmd} />
          ))}
        </div>
          </>
        )}
      </aside>
    );
  }
);

function TabButton({
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
          ? 'flex h-[32px] shrink-0 items-center rounded-t-[7px] border-b-2 border-accent bg-bg-tab-active px-[11px] text-[12px] font-medium whitespace-nowrap text-text-strong'
          : 'flex h-[32px] shrink-0 items-center rounded-t-[7px] border-b-2 border-transparent px-[11px] text-[12px] whitespace-nowrap text-text-dim hover:text-text-muted'
      }
    >
      {children}
    </button>
  );
}

function CommandCard({ cmd }: { cmd: CatalogCommand }): JSX.Element {
  return (
    <div className="rounded-[6px] border border-border-default bg-bg-elevated p-[14px]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => insertIntoComposer(`${cmd.name} `)}
          className="font-mono text-[13px] font-medium text-lavender hover:underline"
        >
          {cmd.name}
        </button>
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-muted">{cmd.summary}</span>
        {cmd.dangerous && <Icon name="alert" size={14} className="shrink-0 text-warning" />}
      </div>
      {cmd.flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-[6px]">
          {cmd.flags.map((f) => (
            <button
              key={f.flag}
              type="button"
              title={f.desc}
              onClick={() => insertIntoComposer(`${cmd.name} ${f.flag} `)}
              className="flex items-center gap-1 rounded-[4px] border border-border-strong bg-bg-elevated-2 px-2 py-[3px] text-[11px] hover:border-accent"
            >
              <span className="font-mono text-text-body">{f.flag}</span>
              <span className="text-text-dim">{f.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
