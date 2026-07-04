import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppConfig } from '@shared/config';

/**
 * Стор настроек: кэш config.json + точечное обновление (SET-07 пишет немедленно).
 * Модульная копия `currentConfig` нужна коду вне React (создание xterm), который
 * читает актуальные настройки терминала синхронно.
 */

let currentConfig: AppConfig | null = null;
export function getCurrentConfig(): AppConfig | null {
  return currentConfig;
}

interface ConfigStore {
  config: AppConfig | null;
  update: (path: string, value: string | number | boolean) => Promise<void>;
}

const Ctx = createContext<ConfigStore | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(currentConfig);

  useEffect(() => {
    void window.lucidSSH.getConfig().then((c) => {
      currentConfig = c;
      setConfig(c);
    });
  }, []);

  const update = useCallback(async (path: string, value: string | number | boolean) => {
    const next = await window.lucidSSH.updateConfig(path, value);
    currentConfig = next;
    setConfig(next);
  }, []);

  const value = useMemo<ConfigStore>(() => ({ config, update }), [config, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConfig(): ConfigStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useConfig outside ConfigProvider');
  return store;
}
