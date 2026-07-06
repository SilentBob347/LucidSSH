import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/common/Icon';
import { usePanels } from '@/stores/panels';

/**
 * FeatureGuide — модалка «Возможности LucidSSH» (скриншот 15-Guide):
 * сетка 2×2 из карточек Навигация / Безопасность / Инструменты / Терминал.
 * Ссылка «Открыть полное руководство» появится вместе с HelpWindow (Этап 7.5).
 */

const CARDS = [
  { key: 'navigation', icon: '◎', color: 'text-lavender', bg: 'bg-accent/15' },
  { key: 'security', icon: '🛡', color: 'text-warning', bg: 'bg-warning/15' },
  { key: 'tools', icon: '🔧', color: 'text-success-bright', bg: 'bg-success/15' },
  { key: 'terminal', icon: '>_', color: 'text-info', bg: 'bg-info/15' }
] as const;

export function FeatureGuide({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { openHelp } = usePanels();

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="animate-[esh-pop_.16s_ease] w-[760px] max-w-[94%] rounded-[10px] border border-border-strong bg-bg-panel shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('guide.title')}
      >
        <div className="flex items-center justify-between border-b border-border-hairline px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-[22px] items-center justify-center rounded-full border border-border-default text-lavender">
              <Icon name="help" size={13} />
            </span>
            <span className="text-[15px] font-semibold text-text-primary">{t('guide.title')}</span>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="flex size-[24px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-[14px] p-5">
          {CARDS.map((card) => {
            const items = t(`guide.cards.${card.key}.items`, { returnObjects: true });
            return (
              <div
                key={card.key}
                className="rounded-[6px] border border-border-default bg-bg-elevated p-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex size-[26px] items-center justify-center rounded-[6px] text-[12px] ${card.bg} ${card.color}`}
                    aria-hidden="true"
                  >
                    {card.icon}
                  </span>
                  <span className="text-[13px] font-semibold text-text-strong">
                    {t(`guide.cards.${card.key}.title`)}
                  </span>
                </div>
                <ul className="mt-3 space-y-2">
                  {Array.isArray(items) &&
                    items.map((item, i) => (
                      <li
                        key={i}
                        className="border-l-2 border-border-default pl-3 text-[12px] leading-relaxed text-text-muted"
                      >
                        {String(item)}
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border-hairline px-5 py-3">
          <button
            type="button"
            onClick={() => {
              openHelp();
              onClose();
            }}
            className="flex items-center gap-[6px] text-[13px] font-medium text-lavender hover:text-lavender-light"
          >
            {t('guide.openFull')} →
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-[34px] rounded-[6px] bg-accent px-5 text-[12.5px] font-medium text-white hover:bg-accent-hover"
          >
            {t('guide.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
