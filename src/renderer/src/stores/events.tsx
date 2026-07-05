import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Лента событий приложения для иконки в шапке (NOTIF-03): изменение отпечатка
 * сервера (красное, требует действия) и доступное обновление (синее, Этап 9).
 * Хранится в памяти — это не история, а активные оповещения.
 */

export interface AppEvent {
  id: string;
  type: 'fingerprint' | 'update';
  hostName?: string;
  version?: string;
  createdAt: number;
}

interface EventsStore {
  events: AppEvent[];
  addFingerprintEvent: (hostName: string) => void;
  addUpdateEvent: (version: string) => void;
  removeEvent: (id: string) => void;
  clearEvents: () => void;
}

const Ctx = createContext<EventsStore | null>(null);

export function EventsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [events, setEvents] = useState<AppEvent[]>([]);

  const addFingerprintEvent = useCallback((hostName: string) => {
    setEvents((prev) => {
      // Не дублируем событие для одного и того же хоста
      if (prev.some((e) => e.type === 'fingerprint' && e.hostName === hostName)) return prev;
      return [
        { id: `fp-${hostName}-${Date.now()}`, type: 'fingerprint', hostName, createdAt: Date.now() },
        ...prev
      ];
    });
  }, []);

  const addUpdateEvent = useCallback((version: string) => {
    setEvents((prev) => {
      if (prev.some((e) => e.type === 'update' && e.version === version)) return prev;
      return [
        { id: `upd-${version}`, type: 'update', version, createdAt: Date.now() },
        ...prev
      ];
    });
  }, []);

  const removeEvent = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  const value = useMemo<EventsStore>(
    () => ({ events, addFingerprintEvent, addUpdateEvent, removeEvent, clearEvents }),
    [events, addFingerprintEvent, addUpdateEvent, removeEvent, clearEvents]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEvents(): EventsStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useEvents outside EventsProvider');
  return store;
}
