import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportPreview } from '@shared/hosts';
import { useHosts } from '@/stores/hosts';
import { useBackdropClose } from '@/hooks/useBackdropClose';

/**
 * Импорт хостов (EXP-02…04): предпросмотр (сколько добавится / конфликтов),
 * выбор стратегии skip/rename, результат. Файл уже провалидирован в main.
 */
export function ImportDialog({
  json,
  preview,
  onClose
}: {
  json: string;
  preview: ImportPreview;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { refresh } = useHosts();
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (strategy: 'skip' | 'rename'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await window.lucidSSH.applyImportHosts(json, strategy);
      setResult(res);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const backdrop = useBackdropClose(onClose);

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      {...backdrop}
      role="presentation"
    >
      <div
        className="animate-[esh-pop_.16s_ease] w-[440px] max-w-[92%] rounded-[6px] border border-border-strong bg-bg-elevated shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="px-5 pt-4 text-[14.5px] font-semibold text-text-strong">
          {result ? t('hosts.import.resultTitle') : t('hosts.import.previewTitle')}
        </div>
        <div className="px-5 py-3 text-[12.5px] leading-relaxed text-text-muted">
          {result
            ? t('hosts.import.resultBody', result)
            : t('hosts.import.previewBody', { toAdd: preview.toAdd, toSkip: preview.toSkip })}
          {!result && preview.toSkip > 0 && (
            <div className="mt-2 text-[11.5px] text-text-dim">
              {t('hosts.import.conflictHint')}
            </div>
          )}
          {!result && preview.missingKeyCount > 0 && (
            <div className="mt-2 text-[11.5px] text-text-dim">
              {t('hosts.import.missingKeyHint', { count: preview.missingKeyCount })}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4">
          {result ? (
            <button
              type="button"
              onClick={onClose}
              className="h-[34px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover"
            >
              {t('hosts.import.ok')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="h-[34px] rounded-[6px] bg-bg-tab-active px-4 text-[12.5px] text-text-body hover:text-text-strong"
              >
                {t('common.cancel')}
              </button>
              {preview.toSkip > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void apply('rename')}
                  className="h-[34px] rounded-[6px] bg-bg-elevated-2 px-4 text-[12.5px] text-text-body hover:border-accent hover:text-text-strong disabled:opacity-50"
                >
                  {t('hosts.import.applyRename')}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void apply('skip')}
                className="h-[34px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {preview.toSkip > 0 ? t('hosts.import.applySkip') : t('hosts.import.previewTitle')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
