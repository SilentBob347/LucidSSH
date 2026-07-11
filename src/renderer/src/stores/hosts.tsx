import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Host, HostGroup } from '@shared/hosts';

/**
 * Стор хостов/групп: кэш списка + действия через IPC-мост.
 * Секреты в renderer не хранятся никогда (SEC-01).
 */

export interface DrawerState {
  open: boolean;
  editHost?: Host;
  presetGroupId?: number;
  /** HM-11: предзаполнение из Quick Connect — хост ещё не существует. */
  presetQuickConnect?: { address: string; port: number; username: string };
}

interface HostsStore {
  hosts: Host[];
  groups: HostGroup[];
  loaded: boolean;
  refresh: () => Promise<void>;
  drawer: DrawerState;
  openDrawer: (state?: Partial<DrawerState>) => void;
  closeDrawer: () => void;
}

const Ctx = createContext<HostsStore | null>(null);

export function HostsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [groups, setGroups] = useState<HostGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>({ open: false });

  const refresh = useCallback(async () => {
    const [h, g] = await Promise.all([window.lucidSSH.listHosts(), window.lucidSSH.listGroups()]);
    setHosts(h);
    setGroups(g);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<HostsStore>(
    () => ({
      hosts,
      groups,
      loaded,
      refresh,
      drawer,
      openDrawer: (state) => setDrawer({ open: true, ...state }),
      closeDrawer: () => setDrawer({ open: false })
    }),
    [hosts, groups, loaded, refresh, drawer]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHosts(): HostsStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useHosts outside HostsProvider');
  return store;
}
