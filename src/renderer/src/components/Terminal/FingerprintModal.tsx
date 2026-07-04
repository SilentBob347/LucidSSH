import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HostKeyPrompt } from '@shared/ssh';

/**
 * Модалка проверки отпечатка (SSH-03/04; скриншот 04-Fingerprint).
 * Первое подключение: fingerprint + «Подтвердить и подключиться».
 * Смена ключа: danger-вариант, кнопка активна только после явного
 * подтверждения проверки через независимый источник (SSH-04).
 */
export function FingerprintModal({
  prompt,
  onAnswer
}: {
  prompt: HostKeyPrompt;
  onAnswer: (decision: 'accept' | 'reject') => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [acked, setAcked] = useState(false);

  const copy = (): void => {
    window.lucidSSH.clipboardWrite(prompt.fingerprintSha256);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const changed = prompt.isChanged;

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      role="presentation"
    >
      <div
        className={`animate-[esh-pop_.16s_ease] w-[460px] max-w-[92%] rounded-[6px] border bg-bg-elevated shadow-[0_24px_60px_rgba(0,0,0,0.5)] ${
          changed ? 'border-danger/40 border-t-2 border-t-danger' : 'border-border-strong'
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="px-5 pt-4 text-[15px] font-semibold text-text-primary">
          {changed ? t('fp.titleChanged') : t('fp.titleFirst')}
        </div>
        <div className="px-5 pt-2 text-[12.5px] leading-relaxed text-text-muted">
          {changed
            ? t('fp.bodyChanged', { host: `${prompt.hostName} (${prompt.address})` })
            : t('fp.bodyFirst')}
        </div>

        {changed && prompt.previousFingerprint && (
          <div className="mx-5 mt-3 rounded-[6px] border border-border-default bg-bg-base px-3 py-2">
            <div className="text-[10.5px] font-semibold text-text-dim uppercase">
              {t('fp.previous')}
            </div>
            <div className="font-mono text-[11.5px] break-all text-text-muted">
              {prompt.previousFingerprint}
            </div>
          </div>
        )}

        <div
          className={`mx-5 mt-3 flex items-start gap-2 rounded-[6px] border px-3 py-2 ${
            changed ? 'border-danger/30 bg-danger/5' : 'border-border-default bg-bg-base'
          }`}
        >
          <div className="min-w-0 flex-1">
            {changed && (
              <div className="text-[10.5px] font-semibold text-text-dim uppercase">
                {t('fp.current')}
              </div>
            )}
            <div
              className={`font-mono text-[11.5px] break-all ${changed ? 'text-warning-text' : 'text-success-bright'}`}
            >
              {prompt.fingerprintSha256}
            </div>
          </div>
          <button
            type="button"
            onClick={copy}
            className="h-[26px] shrink-0 rounded-[4px] border border-border-strong bg-bg-elevated-2 px-2 text-[11px] text-text-body hover:border-accent hover:text-text-strong"
          >
            {copied ? t('fp.copied') : t('fp.copy')}
          </button>
        </div>

        {!changed && (
          <div className="px-5 pt-2 text-[11.5px] leading-relaxed text-text-dim">
            {t('fp.explain')}
          </div>
        )}

        {changed && (
          <label className="mx-5 mt-3 flex cursor-pointer items-start gap-2 text-[12px] text-text-body">
            <input
              type="checkbox"
              checked={acked}
              onChange={(e) => setAcked(e.target.checked)}
              className="mt-[2px] accent-[#EF4444]"
            />
            {t('fp.ackChanged')}
          </label>
        )}

        <div className="flex justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={() => onAnswer('reject')}
            className="h-[34px] rounded-[6px] bg-bg-tab-active px-4 text-[12.5px] text-text-body hover:text-text-strong"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={changed && !acked}
            onClick={() => onAnswer('accept')}
            className={
              changed
                ? 'h-[34px] rounded-[6px] bg-danger px-4 text-[12.5px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40'
                : 'h-[34px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover'
            }
          >
            {changed ? t('fp.confirmChanged') : t('fp.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
