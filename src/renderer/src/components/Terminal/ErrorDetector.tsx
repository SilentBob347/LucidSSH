import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ErrorExplanation } from '@shared/content';
import { insertIntoComposer } from '@/stores/composerBus';
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
      className="animate-[esh-slideup_.2s_ease] flex max-h-[212px] shrink-0 flex-col border-t border-l-[3px] border-t-border-default border-l-danger bg-bg-elevated"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="region"
      aria-label={explanation.title}
    >
      <div className="flex shrink-0 items-center justify-between px-4 pt-[13px]">
        <div className="flex items-center gap-2">
          <span className="flex size-[18px] items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white">
            !
          </span>
          <span className="text-[13.5px] font-semibold text-danger-text">{explanation.title}</span>
        </div>
        <button
          type="button"
          aria-label={t('errDetector.close')}
          onClick={onClose}
          className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-[13px]">
        <p className="text-[12.5px] leading-relaxed text-text-body">{explanation.explanation}</p>

        {explanation.checks.length > 0 && (
          <>
            <div className="mt-3 mb-1 text-[10.5px] font-semibold tracking-[0.05em] text-text-dim uppercase">
              {t('errDetector.whatToCheck')}
            </div>
            <ol className="space-y-1">
              {explanation.checks.map((check, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-[2px] text-[11px] text-text-dim">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-[12px] text-text-muted">{check.text}</span>
                    {check.command && (
                      <span className="ml-1 font-mono text-[12px] text-lavender">
                        {check.command}
                      </span>
                    )}
                  </div>
                  {check.command && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        title={t('errDetector.insert')}
                        aria-label={t('errDetector.insert')}
                        onClick={() => insertIntoComposer(check.command!)}
                        className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-lavender"
                      >
                        <Icon name="insert" size={13} />
                      </button>
                      <button
                        type="button"
                        title={t('errDetector.copy')}
                        aria-label={t('errDetector.copy')}
                        onClick={() => copy(check.command!, i)}
                        className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
                      >
                        <Icon name={copiedIdx === i ? 'check' : 'copy'} size={13} />
                      </button>
                    </div>
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
