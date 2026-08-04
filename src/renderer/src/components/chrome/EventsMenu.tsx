import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEvents } from '@/stores/events';
import { usePanels } from '@/stores/panels';
import { Icon } from '@/components/common/Icon';

/**
 * Иконка событий в шапке (NOTIF-03): цифровой бейдж — красный при изменении
 * отпечатка сервера (требует действия), синий при доступном обновлении. Клик
 * раскрывает компактный список с переходом к источнику.
 * Update-событие ведёт в Settings → О программе и НЕ удаляется по клику —
 * обновление остаётся актуальным, пока не установлено (тема: changelog при
 * обновлении).
 */
export function EventsMenu(): JSX.Element {
  const { t } = useTranslation();
  const { events, removeEvent, clearEvents } = useEvents();
  const { openSettings } = usePanels();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const onEventClick = (id: string, type: (typeof events)[number]['type']): void => {
    if (type === 'update') {
      openSettings('about');
      setOpen(false);
      return;
    }
    removeEvent(id);
  };

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
        className="flex size-[22px] items-center justify-center rounded-full text-text-muted hover:bg-bg-elevated hover:text-lavender-light"
      >
        <Icon name="bell" size={16} />
        {count > 0 && (
          <span
            className={`absolute top-[1px] -right-[3px] flex h-[13px] min-w-[13px] items-center justify-center rounded-full px-[3px] text-[8.5px] leading-none font-bold text-white ${
              hasFingerprint ? 'bg-danger' : 'bg-accent'
            }`}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="animate-[esh-pop_.14s_ease] absolute top-[26px] right-0 z-[70] w-[280px] rounded-[8px] border border-border-strong bg-bg-elevated shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
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
                  onClick={() => onEventClick(e.id, e.type)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') onEventClick(e.id, e.type);
                  }}
                >
                  <span
                    className={`mt-[4px] size-[8px] shrink-0 rounded-full ${
                      e.type === 'fingerprint'
                        ? 'bg-danger'
                        : e.type === 'guardUncertain'
                          ? 'bg-warning'
                          : 'bg-accent'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-text-strong">
                      {e.type === 'fingerprint'
                        ? t('events.fingerprintTitle')
                        : e.type === 'guardUncertain'
                          ? t('events.guardUncertainTitle')
                          : t('events.updateTitle')}
                    </div>
                    <div className="text-[11.5px] text-text-dim">
                      {e.type === 'fingerprint'
                        ? t('events.fingerprintBody', { host: e.hostName ?? '' })
                        : e.type === 'guardUncertain'
                          ? t('events.guardUncertainBody', { host: e.hostName ?? '' })
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
