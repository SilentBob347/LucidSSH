import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EventsMenu } from './EventsMenu';
import { Icon } from '@/components/common/Icon';
import { LogoFull } from '@/components/common/LogoFull';
import { usePanels } from '@/stores/panels';

/**
 * Кастомный тайтл-бар 32px (Design_Brief §3.1): лого + имя + справка слева,
 * свернуть/развернуть/закрыть справа. Close hover — #E81123.
 */
export function TitleBar(): JSX.Element {
  const { t } = useTranslation();
  const { openHelp, openSettings, openHistory } = usePanels();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    return window.lucidSSH.onWindowMaximized(setMaximized);
  }, []);

  return (
    <header className="app-drag flex h-9 shrink-0 items-center border-b border-border-hairline bg-bg-base">
      <div className="flex items-center gap-[11px] pl-[11px]">
        <LogoFull height={26} />
        <button
          type="button"
          title={t('titleBar.help')}
          aria-label={t('titleBar.help')}
          onClick={() => openHelp()}
          className="app-no-drag flex size-[22px] shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-bg-elevated hover:text-lavender-light"
        >
          <Icon name="help" size={16} />
        </button>
      </div>
      <div className="flex-1" />
      <div className="app-no-drag flex items-center gap-[11px] pr-[11px]">
        <button
          type="button"
          title={t('titleBar.history')}
          aria-label={t('titleBar.history')}
          onClick={openHistory}
          className="app-no-drag flex size-[22px] shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-bg-elevated hover:text-lavender-light"
        >
          <Icon name="history" size={16} />
        </button>
        <EventsMenu />
        <button
          type="button"
          title={t('titleBar.settings')}
          aria-label={t('titleBar.settings')}
          onClick={() => openSettings()}
          className="app-no-drag flex size-[22px] shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-bg-elevated hover:text-lavender-light"
        >
          <Icon name="settings" size={16} />
        </button>
      </div>
      <div className="app-no-drag flex h-full">
        <button
          type="button"
          title={t('titleBar.minimize')}
          aria-label={t('titleBar.minimize')}
          onClick={() => window.lucidSSH.windowMinimize()}
          className="flex h-full w-11 items-center justify-center text-text-muted hover:bg-bg-elevated hover:text-text-strong"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1.5" y="5.5" width="9" height="1" fill="currentColor" />
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
            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="3" y="1.5" width="7.5" height="7.5" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="1.5" y="3" width="7.5" height="7.5" fill="var(--color-bg-base)" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
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
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      </div>
    </header>
  );
}
