import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSearchAddon } from './XtermView';
import { Icon } from '@/components/common/Icon';

/**
 * Поиск по буферу терминала (FIND-01/02): строка поверх терминала, не блокирует
 * ввод. Подсветка и навигация через xterm SearchAddon; опции регистра и regex.
 */
export function TerminalSearchBar({
  sessionId,
  onClose
}: {
  sessionId: string;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const opts = { caseSensitive, regex };

  const findNext = (): void => {
    if (query) getSearchAddon(sessionId)?.findNext(query, opts);
  };
  const findPrev = (): void => {
    if (query) getSearchAddon(sessionId)?.findPrevious(query, opts);
  };

  useEffect(() => {
    // При изменении запроса/опций — подсветить с начала
    if (query) getSearchAddon(sessionId)?.findNext(query, { caseSensitive, regex });
  }, [query, caseSensitive, regex, sessionId]);

  const toggle =
    'flex h-[22px] items-center rounded-[4px] px-[6px] text-[11px] font-medium border';

  return (
    <div className="absolute top-2 right-3 z-20 flex items-center gap-1 rounded-[6px] border border-border-strong bg-bg-elevated px-2 py-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (e.shiftKey) findPrev();
            else findNext();
          }
          if (e.key === 'Escape') onClose();
        }}
        placeholder={t('find.placeholder')}
        className="h-[26px] w-[180px] rounded-[4px] border border-border-default bg-bg-base px-2 text-[12px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent"
      />
      <button
        type="button"
        title={t('find.caseSensitive')}
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive((v) => !v)}
        className={`${toggle} ${caseSensitive ? 'border-accent bg-accent/15 text-lavender-light' : 'border-transparent text-text-dim hover:text-text-body'}`}
      >
        Aa
      </button>
      <button
        type="button"
        title={t('find.regex')}
        aria-pressed={regex}
        onClick={() => setRegex((v) => !v)}
        className={`${toggle} ${regex ? 'border-accent bg-accent/15 text-lavender-light' : 'border-transparent text-text-dim hover:text-text-body'}`}
      >
        .*
      </button>
      <button
        type="button"
        title={t('find.prev')}
        aria-label={t('find.prev')}
        onClick={findPrev}
        className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
      >
        ↑
      </button>
      <button
        type="button"
        title={t('find.next')}
        aria-label={t('find.next')}
        onClick={findNext}
        className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
      >
        ↓
      </button>
      <button
        type="button"
        title={t('find.close')}
        aria-label={t('find.close')}
        onClick={onClose}
        className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
