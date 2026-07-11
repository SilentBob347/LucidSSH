import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseQuickConnect } from '@shared/quickConnect';
import { Icon } from '@/components/common/Icon';

/**
 * HM-11: «Быстрое подключение» — ввод `user@host[:port]`, соединение сразу
 * через существующий SSH-модуль, без диалога создания хоста и без записи в
 * БД. Пароль (если нужен) спрашивается уже в терминале — тот же интерактивный
 * флоу, что и для хоста без сохранённого секрета (SSH-06).
 */
export function QuickConnectDialog({
  onConnect,
  onClose
}: {
  onConnect: (input: string) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(false);

  const trimmed = value.trim();
  const valid = trimmed.length > 0 && parseQuickConnect(trimmed) !== null;

  const submit = async (): Promise<void> => {
    if (!valid || connecting) return;
    setConnecting(true);
    setError(false);
    try {
      await onConnect(trimmed);
      onClose();
    } catch {
      setError(true);
      setConnecting(false);
    }
  };

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="animate-[esh-pop_.16s_ease] w-[420px] max-w-[92%] rounded-[6px] border border-border-strong bg-bg-elevated shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('quickConnect.title')}
      >
        <div className="flex items-center gap-[10px] px-5 pt-4 pb-1">
          <Icon name="terminal" size={16} className="text-lavender" />
          <span className="text-[14.5px] font-semibold text-text-strong">
            {t('quickConnect.title')}
          </span>
        </div>
        <div className="px-5 pt-2 pb-1">
          <input
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') onClose();
            }}
            placeholder={t('quickConnect.placeholder')}
            spellCheck={false}
            autoComplete="off"
            className="h-[36px] w-full rounded-[4px] border border-border-default bg-bg-base px-[11px] font-mono text-[13px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent"
          />
          <div className="mt-[7px] text-[11px] text-text-muted">{t('quickConnect.helper')}</div>
          {error && (
            <div className="mt-2 rounded-[4px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger-text">
              {t('quickConnect.error')}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 pt-3 pb-4">
          <button
            type="button"
            onClick={onClose}
            className="h-[34px] rounded-[6px] bg-bg-tab-active px-4 text-[12.5px] text-text-body hover:text-text-strong"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!valid || connecting}
            onClick={() => void submit()}
            className="h-[34px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connecting ? t('quickConnect.connecting') : t('quickConnect.connect')}
          </button>
        </div>
      </div>
    </div>
  );
}
