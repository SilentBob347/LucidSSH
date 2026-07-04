import type { JSX } from 'react';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Правая панель — каталог команд (Design_Brief §3.4).
 * Категории, карточки и поиск — Этап 6.3. Ширина ресайзится (200–480).
 */
export const CatalogPanel = forwardRef<HTMLElement, { width: number }>(function CatalogPanel(
  { width },
  ref
): JSX.Element {
  const { t } = useTranslation();

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
          className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
        >
          ×
        </button>
      </div>
      <div className="px-3 pt-[10px] pb-2">
        <input
          type="text"
          placeholder={t('catalog.searchPlaceholder')}
          className="h-7 w-full rounded-[4px] border border-border-default bg-bg-base px-2 text-[12px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent"
        />
      </div>
      <div className="flex-1" />
    </aside>
  );
});
