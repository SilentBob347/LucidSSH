import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/common/Icon';

/**
 * Одноразовая обучающая подсказка над композером (SNIP-08): после 5-й команды
 * в сессии предлагает сохранить часто используемую команду в сниппеты.
 * Показывается не более 2 раз суммарно и никогда в «Режиме эксперта» — эту
 * логику обеспечивает вызывающий (TerminalArea).
 */
export function HintBar({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-t border-accent/25 bg-accent/10 px-[14px] text-[12px] text-lavender-light">
      <Icon name="lightbulb" size={14} className="shrink-0 text-lavender-light" />
      <span className="min-w-0 flex-1 truncate">{t('hint.snippet')}</span>
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="flex size-[20px] shrink-0 items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
