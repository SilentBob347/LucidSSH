import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DangerousCommandPrompt } from '@shared/guard';

/**
 * Модалка Стража (GUARD-02, GUARD-03; скриншот 05-Danger).
 * Красный верхний border, реальная команда с целью, поле type-to-confirm.
 * Кнопка подтверждения активна только когда введённый текст точно совпадает
 * с именем объекта (или словом ПОДТВЕРЖДАЮ).
 */
export function DangerGuardModal({
  prompt,
  onConfirm,
  onCancel
}: {
  prompt: DangerousCommandPrompt;
  onConfirm: (text: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  const isWord = prompt.confirmationText === 'ПОДТВЕРЖДАЮ';
  const promptLabel = isWord
    ? t('guard.confirmPrompt.word')
    : t(`guard.confirmPrompt.${prompt.scope}`);
  const explanation = t([`guard.explain.${prompt.patternId}`, 'guard.explain.generic'], {
    target: prompt.target
  });
  const confirmLabel =
    prompt.patternId === 'rm-recursive' ? t('guard.confirmDelete') : t('guard.confirmRun');
  const matched = value === prompt.confirmationText;

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="animate-[esh-pop_.16s_ease] w-[480px] max-w-[92%] overflow-hidden rounded-[6px] border border-danger/40 bg-bg-elevated shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('guard.title')}
      >
        <div className="h-[3px] bg-danger" />
        <div className="flex items-center gap-2 px-5 pt-4">
          <span className="flex size-[22px] items-center justify-center rounded-full bg-danger text-[13px] font-bold text-white">
            !
          </span>
          <span className="text-[15px] font-semibold text-text-primary">{t('guard.title')}</span>
        </div>

        <div className="mx-5 mt-3 rounded-[6px] border border-danger/20 bg-bg-base px-3 py-2 font-mono text-[12.5px] break-all text-danger-text">
          {prompt.command}
        </div>

        <p className="px-5 pt-3 text-[12.5px] leading-relaxed text-text-body">{explanation}</p>

        <div className="mx-5 mt-3 rounded-[6px] border border-border-default bg-bg-base px-3 py-2 text-[12px] text-text-muted">
          {t('guard.targetLabel')}{' '}
          <span className="font-mono font-semibold text-text-strong">{prompt.target}</span>
        </div>

        <div className="px-5 pt-3">
          <label className="mb-1 block text-[12px] text-text-muted" htmlFor="guard-confirm">
            {promptLabel}
          </label>
          <input
            id="guard-confirm"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matched) onConfirm(value);
              if (e.key === 'Escape') onCancel();
            }}
            placeholder={prompt.confirmationText}
            className="h-[34px] w-full rounded-[4px] border border-border-strong bg-bg-base px-[10px] font-mono text-[13px] text-text-strong outline-none placeholder:text-text-dim focus:border-danger"
          />
        </div>

        <div className="flex justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="h-[34px] rounded-[6px] bg-bg-tab-active px-4 text-[12.5px] text-text-body hover:text-text-strong"
          >
            {t('guard.cancel')}
          </button>
          <button
            type="button"
            disabled={!matched}
            onClick={() => onConfirm(value)}
            className="h-[34px] rounded-[6px] bg-danger px-4 text-[12.5px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:bg-danger/30 disabled:text-danger-text"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
