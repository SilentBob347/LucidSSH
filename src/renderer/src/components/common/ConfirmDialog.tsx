import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useBackdropClose } from '@/hooks/useBackdropClose';

/**
 * Малая модалка подтверждения (esh-pop поверх бэкдропа, Design_Brief §4.2).
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const backdrop = useBackdropClose(onCancel);
  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      {...backdrop}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      role="presentation"
    >
      <div
        className="animate-[esh-pop_.16s_ease] w-[400px] max-w-[92%] rounded-[6px] border border-border-strong bg-bg-elevated shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="px-5 pt-4 text-[14.5px] font-semibold text-text-strong">{title}</div>
        <div className="px-5 py-3 text-[12.5px] leading-relaxed text-text-muted">{children}</div>
        <div className="flex justify-end gap-2 px-5 pb-4">
          <button
            type="button"
            onClick={onCancel}
            className="h-[34px] rounded-[6px] bg-bg-tab-active px-4 text-[12.5px] text-text-body hover:text-text-strong"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              danger
                ? 'h-[34px] rounded-[6px] bg-danger px-4 text-[12.5px] font-medium text-white hover:brightness-110'
                : 'h-[34px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
