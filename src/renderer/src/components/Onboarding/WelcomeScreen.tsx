import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/common/Icon';
import { ExternalImportDialog } from '@/components/HostManager/ExternalImportDialog';

/**
 * Экран первого запуска (OB-01…OB-02; скриншот 14-Firstrun):
 * лого, приветствие без жаргона, CTA, «Импортировать из PuTTY» — только
 * если в реестре найдены сессии, ссылка «Как это работает».
 */
export function WelcomeScreen({
  onAddFirst,
  onOpenGuide
}: {
  onAddFirst: () => void;
  onOpenGuide: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [puttyCount, setPuttyCount] = useState(0);
  const [version, setVersion] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    void window.lucidSSH.puttySessionsCount().then(setPuttyCount);
    void window.lucidSSH.getAppInfo().then((i) => setVersion(i.version));
  }, []);

  return (
    <div className="animate-[esh-fade_.18s_ease] relative flex flex-1 flex-col items-center justify-center bg-bg-base">
      <div
        className="flex size-[76px] items-center justify-center rounded-[18px]"
        style={{
          background: 'linear-gradient(145deg,#6366F1,#4F46E5)',
          boxShadow: '0 12px 32px rgba(99,102,241,0.35)'
        }}
        aria-hidden="true"
      >
        <Icon name="terminal" size={38} className="text-white" />
      </div>
      <h1 className="mt-6 text-[23px] font-semibold tracking-[-0.01em] text-text-primary">
        {t('welcome.title')}
      </h1>
      <p className="mt-[11px] max-w-[420px] text-center text-[14px] leading-[1.6] text-text-muted">
        {t('welcome.subtitle')}
      </p>
      <div className="mt-[30px] flex w-full flex-col items-center gap-[13px]">
        <button
          type="button"
          onClick={onAddFirst}
          className="flex h-[44px] w-[280px] items-center justify-center gap-[9px] rounded-[8px] bg-accent text-[14px] font-semibold text-white hover:bg-accent-hover"
        >
          <Icon name="plus" size={16} strokeWidth={2.4} /> {t('welcome.addFirst')}
        </button>
        {puttyCount > 0 && (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 rounded-[7px] px-[14px] py-2 text-[13px] text-text-body hover:bg-bg-elevated hover:text-text-strong"
          >
            <Icon name="download" size={14} /> {t('welcome.importPutty')}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenGuide}
          className="flex items-center gap-[7px] px-3 py-[6px] text-[12.5px] text-lavender hover:underline"
        >
          <Icon name="help" size={14} /> {t('welcome.how')}
        </button>
      </div>
      <div className="absolute bottom-[22px] text-[11.5px] text-text-faint">
        {version ? t('welcome.footer', { version }) : ''}
      </div>
      {importOpen && <ExternalImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}
