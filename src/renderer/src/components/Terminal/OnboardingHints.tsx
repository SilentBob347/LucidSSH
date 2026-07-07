import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/common/Icon';

/**
 * Онбординг-подсказки над композером (§5.1; дизайн 01-Main): 3 общих совета с
 * счётчиком «Совет N из 3» и кнопкой «Дальше»/«Скрыть». Показ/скрытие целиком
 * (не в «Режиме эксперта») контролирует TerminalArea; здесь — только шаги.
 */
export function OnboardingHints({ onDone }: { onDone: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const tips = [t('tips.tip1'), t('tips.tip2'), t('tips.tip3')];
  const last = step >= tips.length - 1;

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-t border-accent/25 bg-accent/10 px-[14px] text-[12px] text-text-body">
      <Icon name="lightbulb" size={14} className="shrink-0 text-lavender" />
      <span className="min-w-0 flex-1 truncate">{tips[step]}</span>
      <span className="shrink-0 font-mono text-[11px] text-lavender">
        {t('tips.counter', { n: step + 1, total: tips.length })}
      </span>
      <button
        type="button"
        onClick={() => (last ? onDone() : setStep((s) => s + 1))}
        className="h-[24px] shrink-0 rounded-[4px] bg-accent/20 px-[11px] text-[11.5px] font-medium text-text-strong hover:bg-accent/30"
      >
        {last ? t('tips.hide') : t('tips.next')}
      </button>
    </div>
  );
}
