import type { JSX } from 'react';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogCommand, CommandsDatabase } from '@shared/content';
import { insertIntoComposer } from '@/stores/composerBus';

/**
 * Правая панель — каталог команд (CAT-01…05; Design_Brief §3.4).
 * Категории с горизонтальным скроллом, карточки команд с флаг-чипами; клик по
 * имени/флагу вставляет команду в композер (проходит через Стража, CAT-04).
 * Русский поиск по имени и keywords (CAT-05). Сниппет-вкладки — Этап 7.
 */
export const CatalogPanel = forwardRef<HTMLElement, { width: number; onClose: () => void }>(
  function CatalogPanel({ width, onClose }, ref): JSX.Element {
    const { t } = useTranslation();
    const [db, setDb] = useState<CommandsDatabase | null>(null);
    const [category, setCategory] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const catStripRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      void window.lucidSSH.getCommandCatalog().then((d) => {
        setDb(d);
        setCategory(d.categories[0] ?? null);
      });
    }, []);

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
            ×
          </button>
        </div>

        {/* Вкладка «Каталог» (сниппет-вкладки — Этап 7) */}
        <div className="flex h-[32px] shrink-0 items-end gap-[2px] border-b border-border-default px-3">
          <div className="flex h-[32px] items-center rounded-t-[7px] border-b-2 border-accent bg-bg-tab-active px-[11px] text-[12px] font-medium text-text-strong">
            {t('catalog.tabCatalog')}
          </div>
        </div>

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
              ‹
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
              ›
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-[14px] overflow-y-auto px-3 pt-1 pb-3">
          {filtered.map((cmd) => (
            <CommandCard key={cmd.name} cmd={cmd} />
          ))}
        </div>
      </aside>
    );
  }
);

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
        {cmd.dangerous && <span className="shrink-0 text-warning">⚠</span>}
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
