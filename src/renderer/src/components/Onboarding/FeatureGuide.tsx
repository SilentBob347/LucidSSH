import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '@/components/common/Icon';
import { usePanels } from '@/stores/panels';

/**
 * FeatureGuide — модалка «Возможности LucidSSH» (скриншот 15-Guide):
 * сетка 2×2 из карточек Навигация / Безопасность / Инструменты / Терминал.
 */

const CARDS: { key: string; icon: IconName; color: string; bg: string }[] = [
  { key: 'navigation', icon: 'map-pin', color: 'text-lavender-light', bg: 'bg-accent/15' },
  { key: 'security', icon: 'shield', color: 'text-warning-text', bg: 'bg-warning/15' },
  { key: 'tools', icon: 'wrench', color: 'text-success-bright', bg: 'bg-success/15' },
  { key: 'terminal', icon: 'terminal', color: 'text-info', bg: 'bg-info/15' }
];

export function FeatureGuide({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { openHelp } = usePanels();

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 flex items-center justify-center bg-black/70"
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
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <div className="flex items-center gap-[10px]">
            <Icon name="help" size={17} className="text-lavender" />
            <span className="text-[15px] font-semibold text-text-strong">{t('guide.title')}</span>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="flex size-[26px] items-center justify-center rounded-[5px] text-text-muted hover:bg-bg-elevated hover:text-text-strong"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-[14px] gap-y-[18px] px-5 py-[18px]">
          {CARDS.map((card) => {
            const items = t(`guide.cards.${card.key}.items`, { returnObjects: true });
            return (
              <div
                key={card.key}
                className="flex min-h-[120px] flex-col gap-[11px] rounded-[6px] border border-[rgba(255,255,255,0.06)] bg-bg-elevated p-4"
              >
                <div className="flex items-center gap-[10px]">
                  <span
                    className={`flex size-[28px] shrink-0 items-center justify-center rounded-[7px] ${card.bg} ${card.color}`}
                  >
                    <Icon name={card.icon} size={14} />
                  </span>
                  <span className="text-[13px] font-medium text-white">
                    {t(`guide.cards.${card.key}.title`)}
                  </span>
                </div>
                <ul className="flex flex-col gap-2">
                  {Array.isArray(items) &&
                    items.map((item, i) => (
                      <li
                        key={i}
                        className="border-l-2 border-[rgba(255,255,255,0.12)] pl-2 text-[12px] leading-[1.5] text-text-muted"
                      >
                        {String(item)}
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border-default px-5 py-[13px]">
          <button
            type="button"
            onClick={() => {
              openHelp();
              onClose();
            }}
            className="flex items-center gap-2 text-[13px] font-medium text-lavender-light hover:text-[#C7D2FE]"
          >
            {t('guide.openFull')} <span className="text-[14px]">→</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-[34px] rounded-[7px] bg-accent px-5 text-[13px] font-medium text-white hover:bg-accent-hover"
          >
            {t('guide.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
