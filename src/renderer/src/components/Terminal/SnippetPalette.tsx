import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Snippet } from '@shared/history';
import { insertIntoComposer } from '@/stores/composerBus';
import { Icon } from '@/components/common/Icon';

/**
 * Плавающая палитра быстрой вставки сниппетов (SNIP-09), Ctrl+Space рядом с
 * курсором. listSnippets(hostId) уже возвращает нужный порядок (серверные
 * хоста первыми, глобальные ниже, внутри группы — ручной sort_order/имя,
 * SNIP-10) — дополнительная сортировка на клиенте не нужна. Вставка —
 * insertIntoComposer, тот же путь через Стража, что у SnippetList/CatalogPanel.
 */
export function SnippetPalette({
  x,
  y,
  hostId,
  onClose
}: {
  x: number;
  y: number;
  hostId?: number;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    void window.lucidSSH.listSnippets(hostId).then(setSnippets);
  }, [hostId]);

  useEffect(() => {
    const close = (): void => onClose();
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      snippets.filter(
        (s) =>
          q === '' ||
          s.name.toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q)
      ),
    [snippets, q]
  );

  useEffect(() => {
    setSelected(0);
  }, [q]);

  const insert = (s: Snippet): void => {
    insertIntoComposer(s.command);
    onClose();
  };

  // Панель не должна выходить за правый/нижний край (как TerminalContextMenu)
  const left = Math.min(x, window.innerWidth - 340);
  const top = Math.min(y, window.innerHeight - 320);

  return (
    <div
      className="animate-[esh-pop_.12s_ease] fixed z-50 flex max-h-[320px] w-[320px] flex-col rounded-[6px] border border-border-strong bg-bg-elevated shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      role="listbox"
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('snippet.palette.placeholder')}
        className="h-8 shrink-0 rounded-t-[6px] border-b border-border-hairline bg-transparent px-[10px] text-[12.5px] text-text-strong outline-none placeholder:text-text-dim"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filtered.length > 0) setSelected((i) => (i + 1) % filtered.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (filtered.length > 0) setSelected((i) => (i - 1 + filtered.length) % filtered.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered[selected]) insert(filtered[selected]);
          }
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-center text-[12px] text-text-dim">
            {t('snippet.palette.empty')}
          </div>
        ) : (
          filtered.map((s, i) => (
            <div
              key={s.id}
              role="option"
              aria-selected={i === selected}
              onMouseEnter={() => setSelected(i)}
              onClick={() => insert(s)}
              className={
                i === selected
                  ? 'flex cursor-default items-center gap-2 bg-bg-elevated-2 px-3 py-[6px]'
                  : 'flex cursor-default items-center gap-2 px-3 py-[6px]'
              }
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span
                    className={`truncate text-[12px] font-medium ${s.danger ? 'text-danger-text' : 'text-text-strong'}`}
                  >
                    {s.name}
                  </span>
                  <span className="shrink-0 rounded-[3px] bg-bg-elevated-2 px-[5px] text-[9px] text-text-dim">
                    {s.hostId != null ? t('snippet.chipServer') : t('snippet.chipGlobal')}
                  </span>
                  {s.danger && <Icon name="alert" size={11} className="shrink-0 text-warning" />}
                </div>
                <div className="truncate font-mono text-[10.5px] text-text-muted">{s.command}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
