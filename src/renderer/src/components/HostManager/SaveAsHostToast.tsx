import type { JSX } from 'react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SaveAsHostPrompt } from '@/stores/sessions';
import { Icon } from '@/components/common/Icon';

const AUTO_DISMISS_MS = 8000;

/**
 * HM-11: плавающий тост «Сохранить как хост?» после первого разрешения
 * Quick Connect (успех или неуспех — в обоих случаях полезно сохранить и
 * донастроить). Не блокирует терминал, закрывается сам или по клику.
 */
export function SaveAsHostToast({
  prompt,
  onSave,
  onDismiss
}: {
  prompt: SaveAsHostPrompt;
  onSave: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const { t } = useTranslation();

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [prompt.sessionId, onDismiss]);

  return (
    <div className="animate-[esh-fade_.15s_ease] fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-[8px] border border-border-strong bg-bg-elevated px-4 py-[10px] shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
      <Icon name="terminal" size={15} className="shrink-0 text-lavender" />
      <span className="text-[12.5px] text-text-body">
        {t('quickConnect.saveAsHostPrompt', { target: `${prompt.username}@${prompt.address}` })}
      </span>
      <button
        type="button"
        onClick={onSave}
        className="h-[28px] shrink-0 rounded-[5px] bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent-hover"
      >
        {t('quickConnect.saveAsHost')}
      </button>
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onDismiss}
        className="flex size-[22px] shrink-0 items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
