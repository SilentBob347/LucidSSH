import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

/** Ссылка на карточку tmux в каталоге (WIN-04) — общий блок для диалогов
 *  закрытия вкладки и окна. Что такое tmux — уже написано в самой карточке
 *  каталога (открывается по клику), в диалоге это не дублируется. */
export function TmuxHintLink({ onOpen }: { onOpen: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <p className="mt-2">
      <button
        type="button"
        onClick={onOpen}
        className="text-left text-lavender underline hover:text-accent"
      >
        {t('tabs.closeConfirm.tmuxLink')}
      </button>
    </p>
  );
}
