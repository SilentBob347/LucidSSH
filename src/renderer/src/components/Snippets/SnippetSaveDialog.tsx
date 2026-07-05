import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Snippet } from '@shared/history';
import { Icon } from '@/components/common/Icon';

/**
 * SnippetSaveDialog (SNIP-01, SNIP-05; Design_Brief §3.5). Модалка 440px:
 * превью команды (только чтение), предупреждение об опасной команде, сегмент
 * области видимости (сервер/глобальная, дефолт — сервер), обязательное имя,
 * описание. «Сохранить» активна только при непустом имени.
 */

// Эвристика подсветки опасной команды в превью (окончательно — Страж).
const DANGER_HINT =
  /\b(rm\s+-[rf]|mkfs|dd\s+if=|:\(\)\{|chmod\s+-R\s+777|kill\s+-9|drop\s+database|>\s*\/dev\/|--force)/i;

export function SnippetSaveDialog({
  command,
  editSnippet,
  hostId,
  hostName,
  onSaved,
  onClose
}: {
  command: string;
  editSnippet?: Snippet;
  hostId?: number; // хост активной сессии (для области «сервер»)
  hostName?: string;
  onSaved: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState(editSnippet?.name ?? '');
  const [description, setDescription] = useState(editSnippet?.description ?? '');
  // По умолчанию «Для сервера», если есть активный хост (SNIP-05)
  const initialScope: 'server' | 'global' = editSnippet
    ? editSnippet.hostId != null
      ? 'server'
      : 'global'
    : hostId != null
      ? 'server'
      : 'global';
  const [scope, setScope] = useState<'server' | 'global'>(initialScope);
  const [busy, setBusy] = useState(false);

  const cmd = editSnippet?.command ?? command;
  const danger = DANGER_HINT.test(cmd);
  const canSave = name.trim().length > 0 && !busy;
  const canPickServer = hostId != null || editSnippet?.hostId != null;
  const serverHostId = hostId ?? editSnippet?.hostId;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setBusy(true);
    const targetHostId = scope === 'server' ? serverHostId : undefined;
    try {
      if (editSnippet) {
        await window.lucidSSH.updateSnippet(editSnippet.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          hostId: targetHostId
        });
      } else {
        await window.lucidSSH.createSnippet({
          name: name.trim(),
          command: cmd,
          description: description.trim() || undefined,
          hostId: targetHostId
        });
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'h-[34px] w-full rounded-[4px] border border-border-strong bg-bg-base px-[10px] text-[13px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent';

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-[60] flex items-center justify-center bg-black/55"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="animate-[esh-pop_.16s_ease] w-[440px] max-w-[92%] rounded-[10px] border border-border-strong bg-bg-elevated shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-2 px-[18px] pt-[15px]">
          <Icon name="bookmark" size={16} className="text-lavender" />
          <span className="text-[14.5px] font-semibold text-text-strong">
            {editSnippet ? t('snippet.editTitle') : t('snippet.saveTitle')}
          </span>
        </div>

        <div className="space-y-3 px-[18px] pt-[14px] pb-[18px]">
          {/* Превью команды */}
          <div className="rounded-[6px] bg-bg-panel px-[11px] py-[10px] font-mono text-[12px] break-all text-text-body">
            {cmd}
          </div>

          {danger && (
            <div className="flex items-center gap-2 rounded-[6px] border border-warning/25 bg-warning/10 px-3 py-2 text-[11.5px] text-warning-text">
              <Icon name="alert" size={14} className="shrink-0" /> {t('snippet.dangerWarn')}
            </div>
          )}

          {/* Область видимости */}
          <div>
            <span className="mb-1 block text-[12px] text-text-muted">{t('snippet.scopeLabel')}</span>
            <div className="flex rounded-[7px] bg-bg-base p-[3px]">
              <button
                type="button"
                disabled={!canPickServer}
                onClick={() => setScope('server')}
                className={
                  scope === 'server'
                    ? 'h-[28px] flex-1 rounded-[3px] bg-bg-tab-active text-[12px] font-medium text-text-strong'
                    : 'h-[28px] flex-1 rounded-[3px] text-[12px] text-text-dim hover:text-text-muted disabled:opacity-40'
                }
              >
                {hostName ? `${t('snippet.scopeServer')}: ${hostName}` : t('snippet.scopeServer')}
              </button>
              <button
                type="button"
                onClick={() => setScope('global')}
                className={
                  scope === 'global'
                    ? 'h-[28px] flex-1 rounded-[3px] bg-bg-tab-active text-[12px] font-medium text-text-strong'
                    : 'h-[28px] flex-1 rounded-[3px] text-[12px] text-text-dim hover:text-text-muted'
                }
              >
                {t('snippet.scopeGlobal')}
              </button>
            </div>
            <div className="mt-1 text-[11px] text-text-dim">{t('snippet.scopeHint')}</div>
          </div>

          <div>
            <label className="mb-1 block text-[12px] text-text-muted" htmlFor="snip-name">
              {t('snippet.name')} <span className="text-danger">*</span>
            </label>
            <input
              id="snip-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) void save();
                if (e.key === 'Escape') onClose();
              }}
              placeholder={t('snippet.namePlaceholder')}
              maxLength={100}
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1 block text-[12px] text-text-muted" htmlFor="snip-desc">
              {t('snippet.description')}
            </label>
            <input
              id="snip-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('snippet.descriptionPlaceholder')}
              maxLength={2000}
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-[18px] pb-[18px]">
          <button
            type="button"
            onClick={onClose}
            className="h-[34px] rounded-[6px] bg-bg-tab-active px-4 text-[12.5px] text-text-body hover:text-text-strong"
          >
            {t('snippet.cancel')}
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void save()}
            className="h-[34px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('snippet.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
