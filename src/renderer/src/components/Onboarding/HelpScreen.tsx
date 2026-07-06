import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePanels } from '@/stores/panels';
import { Icon } from '@/components/common/Icon';

/**
 * Полное руководство (HELP-01/02; дизайн «LucidSSH — Руководство»). Отдельная
 * полностраничная поверхность с вкладками: начало работы, сохранённые команды,
 * Страж, детектор ошибок, горячие клавиши. Только чтение.
 */

type Tab = 'start' | 'saved' | 'guard' | 'error' | 'hotkeys';

const HOTKEYS: { keys: string; key: string }[] = [
  { keys: 'Ctrl + ,', key: 'openSettings' },
  { keys: 'Ctrl + H', key: 'openHistory' },
  { keys: 'Ctrl + L', key: 'openCatalog' },
  { keys: 'Ctrl + F', key: 'search' },
  { keys: 'Ctrl + W', key: 'closeTab' },
  { keys: 'F1', key: 'guide' }
];

export function HelpScreen(): JSX.Element {
  const { t } = useTranslation();
  const { closeHelp } = usePanels();
  const [tab, setTab] = useState<Tab>('start');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeHelp();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeHelp]);

  const tabs: { k: Tab; label: string }[] = [
    { k: 'start', label: t('help.tabs.start') },
    { k: 'saved', label: t('help.tabs.saved') },
    { k: 'guard', label: t('help.tabs.guard') },
    { k: 'error', label: t('help.tabs.error') },
    { k: 'hotkeys', label: t('help.tabs.hotkeys') }
  ];

  return (
    <div className="animate-[esh-fade_.15s_ease] fixed inset-0 z-[55] flex flex-col bg-bg-base">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border-default px-5">
        <div className="flex items-center gap-2">
          <Icon name="catalog" size={16} className="text-lavender" />
          <span className="text-[15px] font-semibold text-text-primary">{t('help.title')}</span>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={closeHelp}
          className="flex size-[26px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="flex shrink-0 items-end gap-1 border-b border-border-default px-5">
        {tabs.map((tb) => (
          <button
            key={tb.k}
            type="button"
            onClick={() => setTab(tb.k)}
            className={
              tab === tb.k
                ? 'h-[36px] border-b-2 border-accent px-3 text-[12.5px] font-medium text-text-strong'
                : 'h-[36px] border-b-2 border-transparent px-3 text-[12.5px] text-text-dim hover:text-text-muted'
            }
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-[680px] space-y-4">
          {tab === 'hotkeys' ? (
            <>
              <H2>{t('help.tabs.hotkeys')}</H2>
              <div className="overflow-hidden rounded-[8px] border border-border-hairline">
                {HOTKEYS.map((h, i) => (
                  <div
                    key={h.keys}
                    className={`flex items-center justify-between px-4 py-[10px] ${i % 2 ? 'bg-bg-base' : 'bg-bg-panel'}`}
                  >
                    <span className="text-[13px] text-text-body">{t(`settings.hk.${h.key}`)}</span>
                    <span className="rounded-[4px] border border-border-strong px-[7px] py-[2px] font-mono text-[11px] text-text-muted">
                      {h.keys}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <H2>{t(`help.${tab}.title`)}</H2>
              <p className="text-[13.5px] leading-relaxed text-text-body">{t(`help.${tab}.body`)}</p>
              <ul className="space-y-2">
                {[1, 2, 3].map((n) => {
                  const item = t(`help.${tab}.item${n}`, { defaultValue: '' });
                  return item ? (
                    <li key={n} className="flex items-start gap-3">
                      <span className="mt-[1px] flex size-[22px] shrink-0 items-center justify-center rounded-full bg-bg-elevated-2 font-mono text-[12px] font-bold text-lavender-light">
                        {n}
                      </span>
                      <span className="text-[13px] leading-relaxed text-text-muted">{item}</span>
                    </li>
                  ) : null;
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className="text-[19px] font-semibold text-text-primary">{children}</h2>;
}
