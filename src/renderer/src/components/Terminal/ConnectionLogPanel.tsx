import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/common/Icon';
import { useConnectionLog } from '@/hooks/useConnectionLog';
import { formatLogEntry } from './connectionLogText';

/**
 * Лог соединения SSH-уровня (CLOG-01…03): шаги tcp/handshake/hostkey/auth,
 * алгоритмы, fingerprint, причины отказа. Секретов в логе нет — main
 * отправляет только ключи i18n и безопасные параметры.
 */
export function ConnectionLogPanel({
  sessionId,
  onClose
}: {
  sessionId: string;
  onClose: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const entries = useConnectionLog(sessionId);

  const levelColor = {
    info: 'text-text-muted',
    warn: 'text-warning-text',
    error: 'text-danger-text'
  } as const;

  return (
    <div className="mt-auto flex max-h-[220px] shrink-0 flex-col border-t border-border-default bg-bg-panel">
      <div className="flex h-8 shrink-0 items-center justify-between px-3">
        <span className="text-[11px] font-semibold tracking-[0.04em] text-text-muted uppercase">
          {t('clog.title')}
        </span>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="flex size-[20px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 font-mono text-[11px]">
        {entries.map((e, i) => (
          <div key={i} className="flex gap-2 py-[2px]">
            <span className="shrink-0 text-text-faint">
              {new Date(e.timestamp).toLocaleTimeString(i18n.language)}
            </span>
            <span className={levelColor[e.level]}>{formatLogEntry(t, e)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
