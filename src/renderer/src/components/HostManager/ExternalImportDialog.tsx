import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExternalImportResult, ImportSource } from '@shared/import';
import { useHosts } from '@/stores/hosts';
import { Icon } from '@/components/common/Icon';

/**
 * Импорт хостов из внешних источников (HM-03 PuTTY, HM-04 ssh_config).
 * Показывает разобранные хосты (выбор галочками), неисполняемые директивы —
 * как предупреждение (§12 гайда). Дубликаты по адресу+пользователю можно
 * пропустить или переименовать. Разбор и валидация — в main.
 */
export function ExternalImportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { refresh } = useHosts();
  const [source, setSource] = useState<ImportSource>('putty');
  const [result, setResult] = useState<ExternalImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [strategy, setStrategy] = useState<'skip' | 'rename'>('skip');
  const [applied, setApplied] = useState<{ imported: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPutty = useCallback(async () => {
    setLoading(true);
    setResult(null);
    setApplied(null);
    try {
      const res = await window.lucidSSH.importPuttyPreview();
      setResult(res);
      setSelected(new Set(res.hosts.map((_, i) => i)));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSshConfig = useCallback(async () => {
    setLoading(true);
    setApplied(null);
    try {
      const res = await window.lucidSSH.importSshConfigPreview();
      if (res) {
        setResult(res);
        setSelected(new Set(res.hosts.map((_, i) => i)));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (source === 'putty') void loadPutty();
    else setResult(null); // ssh-config ждёт выбора файла
  }, [source, loadPutty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (i: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const apply = async (): Promise<void> => {
    if (busy || !result) return;
    const chosen = result.hosts.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const res = await window.lucidSSH.applyExternalImport(chosen, strategy);
      setApplied(res);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const tab = (key: ImportSource, label: string): JSX.Element => (
    <button
      type="button"
      onClick={() => setSource(key)}
      className={
        source === key
          ? 'h-8 rounded-t-[7px] border-b-2 border-accent px-3 text-[12.5px] font-medium text-text-strong'
          : 'h-8 rounded-t-[7px] border-b-2 border-transparent px-3 text-[12.5px] text-text-dim hover:text-text-muted'
      }
    >
      {label}
    </button>
  );

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="animate-[esh-pop_.16s_ease] flex max-h-[80vh] w-[480px] max-w-[92%] flex-col rounded-[8px] border border-border-strong bg-bg-elevated shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-[14.5px] font-semibold text-text-strong">{t('import.title')}</span>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="flex size-[24px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="mt-2 flex gap-1 border-b border-border-hairline px-5">
          {tab('putty', t('import.tabPutty'))}
          {tab('ssh-config', t('import.tabSshConfig'))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {applied ? (
            <div className="py-6 text-center text-[13px] text-text-body">
              {t('import.resultBody', applied)}
            </div>
          ) : loading ? (
            <div className="py-8 text-center text-[12.5px] text-text-dim">{t('import.loading')}</div>
          ) : source === 'ssh-config' && !result ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="text-[12.5px] text-text-dim">{t('import.ssh.hint')}</div>
              <button
                type="button"
                onClick={() => void loadSshConfig()}
                className="h-[34px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover"
              >
                {t('import.ssh.pickBtn')}
              </button>
            </div>
          ) : result && !result.available ? (
            <div className="py-8 text-center text-[12.5px] text-text-dim">
              {source === 'putty' ? t('import.putty.none') : t('import.ssh.none')}
            </div>
          ) : result ? (
            <>
              {result.hosts.length === 0 ? (
                <div className="py-6 text-center text-[12.5px] text-text-dim">
                  {t('import.empty')}
                </div>
              ) : (
                <div className="space-y-1">
                  {result.hosts.map((h, i) => (
                    <label
                      key={`${h.name}-${i}`}
                      className="flex cursor-pointer items-center gap-3 rounded-[6px] border border-border-hairline bg-bg-panel px-3 py-2 hover:border-border-strong"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => toggle(i)}
                        className="size-[15px] accent-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium text-text-strong">
                          {h.name}
                        </div>
                        <div className="truncate font-mono text-[11px] text-text-dim">
                          {h.username ? `${h.username}@` : ''}
                          {h.address}:{h.port}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-[3px] bg-bg-elevated-2 px-[6px] py-[1px] text-[10px] text-text-dim">
                        {h.authMethod === 'key' ? t('import.authKey') : t('import.authPassword')}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {result.unsupported.length > 0 && (
                <div className="mt-3 rounded-[6px] border border-warning/25 bg-warning/10 px-3 py-2">
                  <div className="flex items-center gap-1 text-[11.5px] font-semibold text-warning-text">
                    <Icon name="alert" size={13} /> {t('import.unsupported')}
                  </div>
                  <div className="mt-1 space-y-[2px]">
                    {result.unsupported.map((u, i) => (
                      <div key={i} className="truncate font-mono text-[10.5px] text-text-dim">
                        {u.host}: {u.directive} {u.value}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Футер: стратегия дубликатов + действие */}
        {!applied && result && result.hosts.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-border-hairline px-5 py-3">
            <div className="flex items-center gap-2 text-[11.5px] text-text-dim">
              <span>{t('import.dupes')}</span>
              <div className="flex rounded-[6px] bg-bg-base p-[2px]">
                {(['skip', 'rename'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStrategy(s)}
                    className={
                      strategy === s
                        ? 'rounded-[4px] bg-bg-tab-active px-2 py-[3px] text-[11px] text-text-strong'
                        : 'rounded-[4px] px-2 py-[3px] text-[11px] text-text-dim hover:text-text-muted'
                    }
                  >
                    {s === 'skip' ? t('import.dupeSkip') : t('import.dupeRename')}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() => void apply()}
              className="h-[34px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('import.importBtn', { count: selected.size })}
            </button>
          </div>
        )}
        {applied && (
          <div className="flex justify-end border-t border-border-hairline px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="h-[34px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover"
            >
              {t('import.ok')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
