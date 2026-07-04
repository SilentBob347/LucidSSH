import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { HostKeyPrompt, SessionInfo, SessionStatus } from '@shared/ssh';
import type { Breadcrumb } from '@shared/breadcrumb';
import type { DashboardMetrics } from '@shared/dashboard';
import type { ErrorExplanation } from '@shared/content';

/**
 * Стор SSH-сессий: список вкладок, активная сессия, ожидающие подтверждения
 * host key, breadcrumb и метрики дашборда по сессии. Renderer знает только
 * sessionId, статусы и данные-значения (SEC-05).
 */

interface SessionsStore {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  hostKeyPrompt: HostKeyPrompt | null;
  breadcrumbs: Record<string, Breadcrumb>;
  dashboards: Record<string, DashboardMetrics>;
  errors: Record<string, ErrorExplanation>;
  dismissError: (sessionId: string) => void;
  connect: (hostId: number) => Promise<void>;
  select: (sessionId: string) => void;
  closeTab: (sessionId: string) => Promise<void>;
  reconnect: (hostId: number, oldSessionId: string) => Promise<void>;
  answerHostKey: (decision: 'accept' | 'reject') => Promise<void>;
  /** Локальное переименование вкладки (TERM-02); имя не уходит в main. */
  renameTab: (sessionId: string, name: string) => void;
  /** Drag-to-reorder вкладок: переместить sessionId перед targetId (null → в конец). */
  reorderTab: (sessionId: string, beforeId: string | null) => void;
}

const Ctx = createContext<SessionsStore | null>(null);

export function SessionsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPrompt | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Record<string, Breadcrumb>>({});
  const [dashboards, setDashboards] = useState<Record<string, DashboardMetrics>>({});
  const [errors, setErrors] = useState<Record<string, ErrorExplanation>>({});

  useEffect(() => {
    const offStatus = window.lucidSSH.onSessionStatus(
      (sessionId: string, status: SessionStatus) => {
        setSessions((prev) =>
          prev.map((s) => (s.sessionId === sessionId ? { ...s, status } : s))
        );
      }
    );
    const offPrompt = window.lucidSSH.onHostKeyPrompt(setHostKeyPrompt);
    const offCrumb = window.lucidSSH.onBreadcrumb((sessionId, crumb) => {
      setBreadcrumbs((prev) => ({ ...prev, [sessionId]: crumb }));
    });
    const offDash = window.lucidSSH.onDashboard((sessionId, metrics) => {
      setDashboards((prev) => ({ ...prev, [sessionId]: metrics }));
    });
    const offError = window.lucidSSH.onError((sessionId, explanation) => {
      setErrors((prev) => ({ ...prev, [sessionId]: explanation }));
    });
    return () => {
      offStatus();
      offPrompt();
      offCrumb();
      offDash();
      offError();
    };
  }, []);

  const dismissError = useCallback((sessionId: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  const [labels, setLabels] = useState<Record<string, string>>({});

  const applyLabels = useCallback(
    (list: SessionInfo[], overrides: Record<string, string>): SessionInfo[] =>
      list.map((s) => (overrides[s.sessionId] ? { ...s, hostName: overrides[s.sessionId]! } : s)),
    []
  );

  const connect = useCallback(
    async (hostId: number) => {
      const { sessionId } = await window.lucidSSH.connectHost(hostId);
      const list = await window.lucidSSH.listSessions();
      setSessions(applyLabels(list, labels));
      setActiveSessionId(sessionId);
    },
    [applyLabels, labels]
  );

  const renameTab = useCallback((sessionId: string, name: string) => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    setLabels((prev) => ({ ...prev, [sessionId]: trimmed }));
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, hostName: trimmed } : s))
    );
  }, []);

  const reorderTab = useCallback((sessionId: string, beforeId: string | null) => {
    setSessions((prev) => {
      const moving = prev.find((s) => s.sessionId === sessionId);
      if (!moving) return prev;
      const without = prev.filter((s) => s.sessionId !== sessionId);
      if (beforeId === null) return [...without, moving];
      const idx = without.findIndex((s) => s.sessionId === beforeId);
      if (idx < 0) return [...without, moving];
      return [...without.slice(0, idx), moving, ...without.slice(idx)];
    });
  }, []);

  const closeTab = useCallback(
    async (sessionId: string) => {
      await window.lucidSSH.destroySession(sessionId);
      setSessions((prev) => {
        const next = prev.filter((s) => s.sessionId !== sessionId);
        setActiveSessionId((cur) =>
          cur === sessionId ? (next[next.length - 1]?.sessionId ?? null) : cur
        );
        return next;
      });
      setBreadcrumbs((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setDashboards((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setErrors((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    },
    []
  );

  const reconnect = useCallback(
    async (hostId: number, oldSessionId: string) => {
      await closeTab(oldSessionId);
      await connect(hostId);
    },
    [closeTab, connect]
  );

  const answerHostKey = useCallback(
    async (decision: 'accept' | 'reject') => {
      if (!hostKeyPrompt) return;
      await window.lucidSSH.confirmHostKey(hostKeyPrompt.requestId, decision);
      setHostKeyPrompt(null);
    },
    [hostKeyPrompt]
  );

  const value = useMemo<SessionsStore>(
    () => ({
      sessions,
      activeSessionId,
      hostKeyPrompt,
      breadcrumbs,
      dashboards,
      errors,
      dismissError,
      connect,
      select: setActiveSessionId,
      closeTab,
      reconnect,
      answerHostKey,
      renameTab,
      reorderTab
    }),
    [
      sessions,
      activeSessionId,
      hostKeyPrompt,
      breadcrumbs,
      dashboards,
      errors,
      dismissError,
      connect,
      closeTab,
      reconnect,
      answerHostKey,
      renameTab,
      reorderTab
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessions(): SessionsStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useSessions outside SessionsProvider');
  return store;
}
