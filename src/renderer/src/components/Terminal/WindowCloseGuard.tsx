import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

/**
 * WIN-02: при закрытии окна с активными сессиями main блокирует закрытие и
 * присылает событие; здесь показываем подтверждение и, при согласии, даём
 * команду принудительного закрытия.
 */
export function WindowCloseGuard(): JSX.Element | null {
  const { t } = useTranslation();
  const [activeCount, setActiveCount] = useState<number | null>(null);

  useEffect(() => {
    return window.lucidSSH.onConfirmWindowClose((count) => setActiveCount(count));
  }, []);

  if (activeCount === null) return null;

  return (
    <ConfirmDialog
      title={t('tabs.windowCloseConfirm.title')}
      confirmLabel={t('tabs.windowCloseConfirm.confirm')}
      danger
      onConfirm={() => {
        setActiveCount(null);
        window.lucidSSH.windowConfirmClose();
      }}
      onCancel={() => setActiveCount(null)}
    >
      {t('tabs.windowCloseConfirm.body', { count: activeCount })}
    </ConfirmDialog>
  );
}
