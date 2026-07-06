import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DangerousCommandPrompt } from '@shared/guard';
import { setComposerInsertHandler, setComposerValueGetter } from '@/stores/composerBus';
import { Icon } from '@/components/common/Icon';

/**
 * Композер команд (BottomInputBar, Design_Brief §3.3): `~$` + ввод + История +
 * каталог. Enter отправляет команду ЧЕРЕЗ Стража (submitCommand): безопасная
 * уходит на сервер, опасная — открывает DangerGuard (onDanger). Это основной
 * перехватываемый путь ввода (GUARD-02/04). Прямой ввод в xterm — для
 * интерактивных программ (vim/htop).
 */
export function BottomInputBar({
  sessionId,
  onDanger,
  onOpenHistory,
  onToggleCatalog,
  catalogOpen,
  onCommandSent
}: {
  sessionId: string;
  onDanger: (prompt: DangerousCommandPrompt) => void;
  onOpenHistory: () => void;
  onToggleCatalog: () => void;
  /** Панель каталога открыта — кнопка подсвечивается (дизайн catalogBtnStyle). */
  catalogOpen?: boolean;
  /** Вызывается после успешной отправки команды на сервер (для SNIP-08). */
  onCommandSent?: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Каталог/история/сниппеты вставляют команду сюда (GUARD-04)
  const valueRef = useRef('');
  valueRef.current = value;

  useEffect(() => {
    setComposerInsertHandler((text) => {
      setValue(text);
      inputRef.current?.focus();
    });
    setComposerValueGetter(() => valueRef.current);
    return () => {
      setComposerInsertHandler(null);
      setComposerValueGetter(null);
    };
  }, []);

  const submit = async (): Promise<void> => {
    const command = value;
    if (command.trim().length === 0) return;
    const result = await window.lucidSSH.submitCommand(sessionId, command);
    if (result.status === 'blocked') {
      onDanger(result.prompt); // опасная — ждём подтверждения, поле не чистим
    } else {
      setValue(''); // отправлена на сервер
      onCommandSent?.(); // счётчик команд сессии (SNIP-08)
    }
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t border-border-default bg-bg-panel px-[14px]">
      <span className="font-mono text-[13px] font-semibold text-accent">~$</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        placeholder={t('input.placeholder')}
        className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text-strong outline-none placeholder:text-text-dim"
      />
      <button
        type="button"
        onClick={onOpenHistory}
        className="flex h-[26px] items-center gap-[5px] rounded-[4px] border border-[rgba(255,255,255,0.07)] px-[9px] text-[11.5px] text-text-muted hover:border-[rgba(255,255,255,0.14)] hover:bg-bg-elevated hover:text-text-strong"
      >
        <Icon name="history" size={13} /> {t('input.history')}
      </button>
      <button
        type="button"
        title={t('input.toggleCatalog')}
        aria-label={t('input.toggleCatalog')}
        onClick={onToggleCatalog}
        className={`flex size-[26px] items-center justify-center rounded-[4px] hover:bg-bg-elevated ${
          catalogOpen ? 'bg-accent/15 text-lavender' : 'text-text-muted hover:text-text-strong'
        }`}
      >
        <Icon name="catalog" size={15} />
      </button>
    </div>
  );
}
