import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Snippet } from '@shared/history';
import { insertIntoComposer } from '@/stores/composerBus';
import { Icon } from '@/components/common/Icon';

/**
 * Список сниппетов (SnippetRow, Design_Brief §3.4). Разбит на группы «Обычные» и
 * «Опасные». Клик по телу вставляет команду в композер (через Стража, SNIP-04);
 * иконки play/pencil/trash. Поиск по имени и описанию (SNIP-03).
 */
export function SnippetList({
  snippets,
  onChanged,
  onEdit
}: {
  snippets: Snippet[];
  activeHostId?: number;
  onChanged: () => void;
  onEdit: (s: Snippet) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

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
  const normal = filtered.filter((s) => !s.danger);
  const danger = filtered.filter((s) => s.danger);

  if (snippets.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-5 py-[44px] text-center">
        <Icon name="bookmark" size={26} className="text-text-faint" />
        <div className="text-[13px] font-semibold text-text-body">{t('snippet.empty.title')}</div>
        <div className="text-[12px] text-text-dim">{t('snippet.empty.description')}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-5 pt-3 pb-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('snippet.searchPlaceholder')}
          className="h-8 w-full rounded-[6px] border border-border-strong bg-bg-base px-3 text-[12.5px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {normal.length > 0 && (
          <Group label={t('snippet.groupNormal')}>
            {normal.map((s) => (
              <SnippetRow key={s.id} snippet={s} onChanged={onChanged} onEdit={onEdit} />
            ))}
          </Group>
        )}
        {danger.length > 0 && (
          <Group label={t('snippet.groupDanger')} danger>
            {danger.map((s) => (
              <SnippetRow key={s.id} snippet={s} onChanged={onChanged} onEdit={onEdit} />
            ))}
          </Group>
        )}
      </div>
    </div>
  );
}

function Group({
  label,
  danger,
  children
}: {
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="mb-2">
      <div
        className={`px-2 py-1 text-[10.5px] font-semibold tracking-[0.05em] uppercase ${danger ? 'text-warning' : 'text-text-dim'}`}
      >
        {danger && '⚠ '}
        {label}
      </div>
      {children}
    </div>
  );
}

function SnippetRow({
  snippet,
  onChanged,
  onEdit
}: {
  snippet: Snippet;
  onChanged: () => void;
  onEdit: (s: Snippet) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      className="group flex items-center gap-2 rounded-[5px] border-b border-border-hairline px-2 py-[8px] hover:bg-bg-elevated"
      onClick={() => insertIntoComposer(snippet.command)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') insertIntoComposer(snippet.command);
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span
            className={`truncate text-[12.5px] font-medium ${snippet.danger ? 'text-danger-text' : 'text-text-strong'}`}
          >
            {snippet.name}
          </span>
          <span className="shrink-0 rounded-[3px] bg-bg-elevated-2 px-[5px] text-[9.5px] text-text-dim">
            {snippet.hostId != null ? t('snippet.chipServer') : t('snippet.chipGlobal')}
          </span>
        </div>
        <div className="truncate font-mono text-[11px] text-text-muted">{snippet.command}</div>
      </div>
      <div className="flex shrink-0 gap-[1px]">
        <button
          type="button"
          title={t('snippet.play')}
          aria-label={t('snippet.play')}
          onClick={(e) => {
            e.stopPropagation();
            insertIntoComposer(snippet.command);
          }}
          className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:text-success-bright"
        >
          <Icon name="play" size={13} />
        </button>
        <button
          type="button"
          title={t('snippet.edit')}
          aria-label={t('snippet.edit')}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(snippet);
          }}
          className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:text-lavender"
        >
          <Icon name="edit" size={13} />
        </button>
        <button
          type="button"
          title={t('snippet.delete')}
          aria-label={t('snippet.delete')}
          onClick={(e) => {
            e.stopPropagation();
            void window.lucidSSH.deleteSnippet(snippet.id).then(onChanged);
          }}
          className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:text-danger"
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
}
