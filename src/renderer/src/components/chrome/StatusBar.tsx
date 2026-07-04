import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Статус-бар 24px, фон #0B0B0F (Design_Brief §3.1):
 * слева — шифр SSH (пока пусто, появится с Этапом 2), справа — версия + «локально».
 */
export function StatusBar(): JSX.Element {
  const { t } = useTranslation();
  const [version, setVersion] = useState('');

  useEffect(() => {
    void window.lucidSSH.getAppInfo().then((info) => setVersion(info.version));
  }, []);

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border-hairline bg-bg-base-deep px-3 font-mono text-[11px] text-text-dim">
      <span />
      <span>
        {version ? t('statusBar.version', { version }) : ''}
        {version ? ' · ' : ''}
        {t('statusBar.local')}
      </span>
    </footer>
  );
}
