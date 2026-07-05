import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EventsMenu } from './EventsMenu';

/**
 * Кастомный тайтл-бар 32px (Design_Brief §3.1): лого + имя + справка слева,
 * свернуть/развернуть/закрыть справа. Close hover — #E81123.
 */
export function TitleBar(): JSX.Element {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    return window.lucidSSH.onWindowMaximized(setMaximized);
  }, []);

  return (
    <header className="app-drag flex h-8 shrink-0 items-center border-b border-border-hairline bg-bg-base">
      <div className="flex items-center gap-2 pl-3">
        <div className="flex size-[18px] items-center justify-center rounded-[5px] bg-accent text-[10px] font-bold text-white">
          &gt;_
        </div>
        <span className="text-[12.5px] font-semibold text-text-strong">{t('app.name')}</span>
        <button
          type="button"
          title={t('titleBar.help')}
          aria-label={t('titleBar.help')}
          className="app-no-drag ml-1 flex size-[22px] items-center justify-center rounded-full border border-border-default text-[11px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
        >
          ?
        </button>
        <EventsMenu />
      </div>
      <div className="flex-1" />
      <div className="app-no-drag flex h-full">
        <button
          type="button"
          title={t('titleBar.minimize')}
          aria-label={t('titleBar.minimize')}
          onClick={() => window.lucidSSH.windowMinimize()}
          className="flex h-full w-11 items-center justify-center text-text-muted hover:bg-bg-elevated hover:text-text-strong"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          title={maximized ? t('titleBar.restore') : t('titleBar.maximize')}
          aria-label={maximized ? t('titleBar.restore') : t('titleBar.maximize')}
          onClick={() => window.lucidSSH.windowToggleMaximize()}
          className="flex h-full w-11 items-center justify-center text-text-muted hover:bg-bg-elevated hover:text-text-strong"
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="2" y="0.5" width="7" height="7" fill="none" stroke="currentColor" />
              <rect x="0.5" y="2.5" width="7" height="7" fill="var(--color-bg-base)" stroke="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
            </svg>
          )}
        </button>
        <button
          type="button"
          title={t('titleBar.close')}
          aria-label={t('titleBar.close')}
          onClick={() => window.lucidSSH.windowClose()}
          className="flex h-full w-[46px] items-center justify-center text-text-muted hover:bg-close-hover hover:text-white"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </header>
  );
}
