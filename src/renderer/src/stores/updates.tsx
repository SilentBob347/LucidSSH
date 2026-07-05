import type { JSX, ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { UpdateStatus } from '@shared/updates';
import { useEvents } from './events';

/**
 * Стор автообновления (UPD-01…04): подписка на статус из main, ручная проверка,
 * скачивание и установка по согласию. При появлении обновления добавляет синее
 * событие в ленту шапки (NOTIF-03).
 */

interface UpdatesStore {
  status: UpdateStatus | null;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
}

const Ctx = createContext<UpdatesStore | null>(null);

export function UpdatesProvider({ children }: { children: ReactNode }): JSX.Element {
  const { addUpdateEvent } = useEvents();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const lastNotified = useRef<string | null>(null);

  useEffect(() => {
    void window.lucidSSH.getUpdateStatus().then(setStatus);
    return window.lucidSSH.onUpdateStatus((s) => {
      setStatus(s);
      // Одно синее событие на версию (NOTIF-03)
      if (s.state === 'available' && s.info && lastNotified.current !== s.info.version) {
        lastNotified.current = s.info.version;
        addUpdateEvent(s.info.version);
      }
    });
  }, [addUpdateEvent]);

  const value = useMemo<UpdatesStore>(
    () => ({
      status,
      check: () => window.lucidSSH.checkForUpdates(),
      download: () => window.lucidSSH.downloadUpdate(),
      install: () => window.lucidSSH.installUpdate()
    }),
    [status]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUpdates(): UpdatesStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useUpdates outside UpdatesProvider');
  return store;
}
