import { useEffect, useState } from 'react';
import type { ConnectionLogEntry } from '@shared/ssh';

/**
 * Живая подписка на лог соединения одной сессии (CLOG-01…03): начальный
 * снимок через getConnectionLog + новые записи через onConnectionLog.
 * Общий хук для ConnectionLogPanel и ConnectionStepper (CLOG-04) — оба
 * читают один и тот же поток, только по-разному его показывают.
 */
export function useConnectionLog(sessionId: string): ConnectionLogEntry[] {
  const [entries, setEntries] = useState<ConnectionLogEntry[]>([]);

  useEffect(() => {
    let alive = true;
    setEntries([]);
    void window.lucidSSH.getConnectionLog(sessionId).then((log) => {
      if (alive) setEntries(log);
    });
    const off = window.lucidSSH.onConnectionLog((sid, entry) => {
      if (sid === sessionId) setEntries((prev) => [...prev, entry]);
    });
    return () => {
      alive = false;
      off();
    };
  }, [sessionId]);

  return entries;
}
