import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/common/Icon';

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

  useEffect(() => {
    void window.lucidSSH.puttySessionsCount().then(setPuttyCount);
    void window.lucidSSH.getAppInfo().then((i) => setVersion(i.version));
  }, []);

  return (
    <div className="animate-[esh-fade_.18s_ease] flex flex-1 flex-col items-center justify-center bg-bg-base">
      <div
        className="flex size-[72px] items-center justify-center rounded-[18px] bg-accent text-[26px] font-bold text-white"
        style={{ boxShadow: '0 12px 32px rgba(99,102,241,0.35)' }}
        aria-hidden="true"
      >
        &gt;_
      </div>
      <h1 className="mt-6 text-[23px] font-semibold text-text-primary">{t('welcome.title')}</h1>
      <p className="mt-3 max-w-[420px] text-center text-[14px] leading-relaxed text-text-muted">
        {t('welcome.subtitle')}
      </p>
      <button
        type="button"
        onClick={onAddFirst}
        className="mt-8 flex h-10 items-center gap-2 rounded-[8px] bg-accent px-6 text-[14px] font-semibold text-white hover:bg-accent-hover"
      >
        <Icon name="plus" size={16} /> {t('welcome.addFirst')}
      </button>
      {puttyCount > 0 && (
        <button
          type="button"
          className="mt-5 flex items-center gap-[6px] text-[12.5px] text-text-body hover:text-text-strong hover:underline"
        >
          <Icon name="download" size={14} /> {t('welcome.importPutty')}
        </button>
      )}
      <button
        type="button"
        onClick={onOpenGuide}
        className="mt-4 flex items-center gap-[6px] text-[12.5px] text-lavender hover:text-lavender-light hover:underline"
      >
        <Icon name="help" size={14} /> {t('welcome.how')}
      </button>
      <div className="absolute bottom-8 text-[11.5px] text-text-faint">
        {version ? t('welcome.footer', { version }) : ''}
      </div>
    </div>
  );
}
