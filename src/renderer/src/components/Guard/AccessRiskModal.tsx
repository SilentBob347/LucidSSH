import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccessRiskPrompt } from '@shared/guard';
import { useBackdropClose } from '@/hooks/useBackdropClose';
import { useEscapeClose } from '@/hooks/useEscapeClose';

/**
 * Предупреждение о риске потери SSH-доступа (GUARD-07).
 * В отличие от DangerGuardModal — рекомендация, не блокировка: две кнопки
 * («Всё равно выполнить» / «Отмена»), без поля type-to-confirm. Формулировки
 * предупредительные («может разорвать»), не утвердительные — принцип §5.1 ТЗ.
 * Оранжевый (warning) верхний border вместо красного — другой уровень угрозы.
 */
export function AccessRiskModal({
  prompt,
  onConfirm,
  onCancel
}: {
  prompt: AccessRiskPrompt;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const backdrop = useBackdropClose(onCancel);
  useEscapeClose('access-risk-modal', onCancel);

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      {...backdrop}
      role="presentation"
    >
      <div
        className="animate-[esh-pop_.16s_ease] w-[480px] max-w-[92%] overflow-hidden rounded-[6px] border-t-4 border-t-warning bg-bg-elevated shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('guard.accessRisk.title')}
      >
        <div className="flex items-center gap-[10px] px-[18px] pt-4 pb-3">
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-warning text-[14px] font-bold text-black">
            !
          </span>
          <span className="text-[16px] font-semibold text-text-strong">
            {t('guard.accessRisk.title')}
          </span>
        </div>

        <div className="px-[18px] pb-[18px]">
          <div className="rounded-[4px] border border-warning/30 bg-bg-panel px-3 py-[10px] font-mono text-[13px] break-all text-warning-text">
            {prompt.command}
          </div>

          <p className="mt-[14px] text-[13px] leading-[1.55] text-text-body">
            {t(`guard.accessRisk.explain.${prompt.riskId}`)}
          </p>

          <div className="mt-[14px] rounded-[4px] bg-bg-elevated-2 px-3 py-[9px] text-[12.5px] leading-[1.5] text-text-body">
            {t('guard.accessRisk.recommendation')}
            {prompt.riskId === 'sshd-config' && (
              <div className="mt-[6px]">{t('guard.accessRisk.sshdTest')}</div>
            )}
          </div>

          <div className="mt-[18px] flex justify-end gap-[9px]">
            <button
              type="button"
              autoFocus
              onClick={onCancel}
              className="h-[34px] rounded-[4px] border border-[rgba(255,255,255,0.1)] bg-bg-elevated-2 px-4 text-[13px] font-medium text-text-body hover:bg-bg-tab-active"
            >
              {t('guard.cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="h-[34px] rounded-[4px] bg-warning px-4 text-[13px] font-semibold text-black hover:brightness-110"
            >
              {t('guard.accessRisk.run')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
