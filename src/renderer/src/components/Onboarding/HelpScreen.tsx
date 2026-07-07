import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePanels } from '@/stores/panels';
import { Icon } from '@/components/common/Icon';

/**
 * Полное руководство (HELP-01/02; дизайн «LucidSSH — Руководство»). Модалка
 * 800×600 с мини-титлбаром и вкладками: начало работы, сохранённые команды,
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
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-[55] flex items-center justify-center bg-black/70"
      role="presentation"
    >
      <div
        className="animate-[esh-pop_.18s_ease] flex h-[600px] max-h-[94%] w-[800px] max-w-[96%] flex-col overflow-hidden rounded-[8px] border border-border-strong bg-bg-base shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        aria-label={t('help.title')}
      >
        <div className="flex h-9 min-h-9 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-bg-panel pr-2 pl-3">
          <div className="flex items-center gap-2">
            <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-accent">
              <Icon name="terminal" size={11} strokeWidth={2.4} className="text-white" />
            </span>
            <span className="text-[12.5px] font-semibold text-text-body">{t('help.title')}</span>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={closeHelp}
            className="flex h-7 w-[30px] items-center justify-center rounded-[4px] text-text-muted hover:bg-bg-elevated-2 hover:text-text-strong"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="flex h-[38px] min-h-[38px] shrink-0 items-stretch overflow-x-auto bg-bg-base px-2">
          {tabs.map((tb) => (
            <button
              key={tb.k}
              type="button"
              onClick={() => setTab(tb.k)}
              className={
                tab === tb.k
                  ? 'flex items-center rounded-t-[4px] border-b-2 border-accent bg-bg-elevated px-[14px] text-[12.5px] font-medium whitespace-nowrap text-text-strong'
                  : 'flex items-center border-b-2 border-transparent px-[14px] text-[12.5px] whitespace-nowrap text-text-dim'
              }
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[28px] py-6">
          {tab === 'hotkeys' ? (
            <>
              <H2>{t('help.tabs.hotkeys')}</H2>
              <div className="mt-[18px] max-w-[560px]">
                {HOTKEYS.map((h) => (
                  <div
                    key={h.keys}
                    className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] py-[11px]"
                  >
                    <span className="text-[13px] text-text-body">{t(`settings.hk.${h.key}`)}</span>
                    <span className="rounded-[4px] border border-border-strong px-[6px] py-[2px] font-mono text-[11.5px] text-text-body">
                      {h.keys}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <H2>{t(`help.${tab}.title`)}</H2>
              <p className="mt-[14px] max-w-[640px] text-[13.5px] leading-[1.65] text-text-body">
                {t(`help.${tab}.body`)}
              </p>
              <ul className="mt-[14px] flex flex-col gap-[14px]">
                {[1, 2, 3].map((n) => {
                  const item = t(`help.${tab}.item${n}`, { defaultValue: '' });
                  return item ? (
                    <li key={n} className="flex items-start gap-[13px]">
                      <span className="mt-[1px] flex size-6 shrink-0 items-center justify-center rounded-full bg-bg-elevated-2 font-mono text-[12px] font-bold text-lavender-light">
                        {n}
                      </span>
                      <span className="text-[12.5px] leading-[1.55] text-text-muted">{item}</span>
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
  return (
    <h2 className="text-[21px] font-semibold tracking-[-0.01em] text-text-strong">{children}</h2>
  );
}
