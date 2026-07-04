import type { JSX } from 'react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Контекстное меню терминала (CTX-01): Копировать (активно при выделении),
 * Вставить, Найти. «Сохранить как сниппет» появится с Этапом 7 (SNIP-02).
 */
export function TerminalContextMenu({
  x,
  y,
  hasSelection,
  onCopy,
  onPaste,
  onFind,
  onClose
}: {
  x: number;
  y: number;
  hasSelection: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onFind: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();

  useEffect(() => {
    const close = (): void => onClose();
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const item =
    'flex w-full items-center px-3 py-[6px] text-left text-[12.5px] text-text-body hover:bg-bg-elevated-2 hover:text-text-strong disabled:cursor-default disabled:text-text-faint disabled:hover:bg-transparent';

  // Меню не должно выходить за правый/нижний край
  const left = Math.min(x, window.innerWidth - 190);
  const top = Math.min(y, window.innerHeight - 140);

  return (
    <div
      className="animate-[esh-pop_.12s_ease] fixed z-50 w-[180px] rounded-[6px] border border-border-strong bg-bg-elevated py-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        disabled={!hasSelection}
        onClick={() => {
          onCopy();
          onClose();
        }}
        className={item}
      >
        {t('ctx.copy')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onPaste();
          onClose();
        }}
        className={item}
      >
        {t('ctx.paste')}
      </button>
      <div className="my-1 h-px bg-border-hairline" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onFind();
          onClose();
        }}
        className={item}
      >
        {t('ctx.find')}
      </button>
    </div>
  );
}
