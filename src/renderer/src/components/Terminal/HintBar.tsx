import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/common/Icon';
import { useConfig } from '@/stores/config';

/**
 * Одноразовая обучающая подсказка над композером. Два варианта, вызывающий
 * (TerminalArea) решает какой показать и следит за лимитом показов:
 * — SNIP-08: после 5-й команды в сессии — предложить сохранить в сниппеты;
 * — фокус в терминале нужен для Ctrl+C и других сочетаний (не работают из
 *   композера) — показывается один раз при первом фокусе в поле ввода.
 * Показывается не более 2 раз суммарно и никогда в «Режиме эксперта».
 */
export function HintBar({
  textKey,
  onClose
}: {
  /** Если не задан — стандартная подсказка про сниппеты (SNIP-08). */
  textKey?: string;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { config } = useConfig();
  const hintKey = textKey ?? (config?.terminal.rightClickPaste ? 'hint.snippetPasteMode' : 'hint.snippet');
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-t border-accent/25 bg-accent/10 px-[14px] text-[12px] text-lavender-light">
      <Icon name="lightbulb" size={14} className="shrink-0 text-lavender-light" />
      <span className="min-w-0 flex-1 truncate">{t(hintKey)}</span>
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="flex size-[20px] shrink-0 items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
