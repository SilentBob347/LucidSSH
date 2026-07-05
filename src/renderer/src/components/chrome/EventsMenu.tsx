import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEvents } from '@/stores/events';

/**
 * Иконка событий в шапке (NOTIF-03): цифровой бейдж — красный при изменении
 * отпечатка сервера (требует действия), синий при доступном обновлении. Клик
 * раскрывает компактный список с переходом к источнику.
 */
export function EventsMenu(): JSX.Element {
  const { t } = useTranslation();
  const { events, removeEvent, clearEvents } = useEvents();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const hasFingerprint = events.some((e) => e.type === 'fingerprint');
  const count = events.length;

  return (
    <div ref={ref} className="app-no-drag relative">
      <button
        type="button"
        title={t('events.title')}
        aria-label={t('events.title')}
        onClick={() => setOpen((v) => !v)}
        className="ml-1 flex size-[22px] items-center justify-center rounded-full border border-border-default text-[11px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 1.5a4 4 0 0 0-4 4v2.6L2.8 10.5A.5.5 0 0 0 3.2 11.3h9.6a.5.5 0 0 0 .4-.8L12 8.1V5.5a4 4 0 0 0-4-4Z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M6.4 12.6a1.6 1.6 0 0 0 3.2 0" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        {count > 0 && (
          <span
            className={`absolute -top-[3px] -right-[3px] flex min-w-[13px] items-center justify-center rounded-full px-[3px] text-[8.5px] font-bold text-white ${
              hasFingerprint ? 'bg-danger' : 'bg-accent'
            }`}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="animate-[esh-pop_.14s_ease] absolute top-[26px] left-0 z-[70] w-[280px] rounded-[8px] border border-border-strong bg-bg-elevated shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between border-b border-border-hairline px-3 py-2">
            <span className="text-[12.5px] font-semibold text-text-strong">{t('events.title')}</span>
            {count > 0 && (
              <button
                type="button"
                onClick={clearEvents}
                className="text-[11px] text-text-dim hover:text-text-strong"
              >
                {t('events.clear')}
              </button>
            )}
          </div>
          {count === 0 ? (
            <div className="px-3 py-5 text-center text-[12px] text-text-dim">{t('events.empty')}</div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto py-1">
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-start gap-2 px-3 py-2 hover:bg-bg-base"
                  role="button"
                  tabIndex={0}
                  onClick={() => removeEvent(e.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') removeEvent(e.id);
                  }}
                >
                  <span
                    className={`mt-[4px] size-[8px] shrink-0 rounded-full ${
                      e.type === 'fingerprint' ? 'bg-danger' : 'bg-accent'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-text-strong">
                      {e.type === 'fingerprint'
                        ? t('events.fingerprintTitle')
                        : t('events.updateTitle')}
                    </div>
                    <div className="text-[11.5px] text-text-dim">
                      {e.type === 'fingerprint'
                        ? t('events.fingerprintBody', { host: e.hostName ?? '' })
                        : t('events.updateBody', { version: e.version ?? '' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
