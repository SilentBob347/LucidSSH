import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ErrorExplanation } from '@shared/content';
import { Icon } from '@/components/common/Icon';

/**
 * Панель детектора ошибок (ERR-03; скриншот 02-Error). Выезжает снизу области
 * терминала, левый border 3px danger, не перекрывает строку ввода. Закрытие по
 * Esc или ×. Нумерованные шаги «что проверить» с копированием/вставкой команды.
 */
export function ErrorDetector({
  sessionId,
  explanation,
  onClose
}: {
  sessionId: string;
  explanation: ErrorExplanation;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  void sessionId;

  const copy = (cmd: string, idx: number): void => {
    window.lucidSSH.clipboardWrite(cmd);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1200);
  };

  return (
    <div
      className="animate-[esh-slideup_.2s_ease] flex max-h-[212px] shrink-0 flex-col border-t border-l-[3px] border-t-[rgba(255,255,255,0.1)] border-l-danger bg-bg-elevated"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="region"
      aria-label={explanation.title}
    >
      <div className="flex shrink-0 items-center gap-[9px] px-4 pt-[13px]">
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-danger text-[12px] font-bold text-white">
          !
        </span>
        <span className="flex-1 text-[13px] font-semibold text-danger-text">
          {explanation.title}
        </span>
        <button
          type="button"
          aria-label={t('errDetector.close')}
          onClick={onClose}
          className="flex size-[22px] shrink-0 items-center justify-center rounded-[4px] text-text-muted hover:bg-[rgba(255,255,255,0.08)] hover:text-text-strong"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-[13px]">
        <div className="mt-[9px] rounded-[4px] bg-bg-panel px-[10px] py-[6px] font-mono text-[12px] text-text-muted">
          {explanation.command}
        </div>
        <p className="mt-[10px] text-[12.5px] leading-[1.55] text-text-body">
          {explanation.explanation}
        </p>

        {explanation.checks.length > 0 && (
          <>
            <div className="mt-[13px] mb-2 text-[11px] font-semibold tracking-[0.04em] text-text-muted uppercase">
              {t('errDetector.whatToCheck')}
            </div>
            <ol className="flex flex-col gap-[7px]">
              {explanation.checks.map((check, i) => (
                <li key={i} className="flex items-center gap-[9px]">
                  <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-bg-elevated-2 text-[11px] font-semibold text-text-muted">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-[12px] text-text-body">
                    {check.text}
                    {check.command && (
                      <span className="ml-1 rounded-[4px] bg-bg-panel px-[6px] py-px font-mono text-text-strong">
                        {check.command}
                      </span>
                    )}
                  </span>
                  {check.command && (
                    <button
                      type="button"
                      title={t('errDetector.copy')}
                      aria-label={t('errDetector.copy')}
                      onClick={() => copy(check.command!, i)}
                      className="flex size-[24px] shrink-0 items-center justify-center rounded-[4px] text-text-muted hover:bg-bg-elevated-2 hover:text-text-strong"
                    >
                      <Icon name={copiedIdx === i ? 'check' : 'copy'} size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
