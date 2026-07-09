import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type AppInfo } from '@shared/ipc';
import type { Host, HostGroup, HostInput, ImportPreview } from '@shared/hosts';
import type { ExternalImportResult, ImportedHost } from '@shared/import';
import type {
  AuthPromptRequest,
  ConnectionLogEntry,
  HostKeyPrompt,
  KnownHostView,
  SessionInfo,
  SessionStatus,
  TestConnectionResult
} from '@shared/ssh';
import type { AppConfig } from '@shared/config';
import type { SubmitResult } from '@shared/guard';
import type { Breadcrumb } from '@shared/breadcrumb';
import type { DashboardMetrics } from '@shared/dashboard';
import type { CommandsDatabase, ErrorExplanation } from '@shared/content';
import type { HistoryEntry, HistoryQuery, Snippet } from '@shared/history';
import type { UpdateStatus } from '@shared/updates';

/**
 * Минимальный preload (SEC-05): только конкретные операции,
 * никаких универсальных send/invoke, никакого доступа к Node из renderer.
 */

const api = {
  // --- Приложение ---
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appGetInfo),
  openReleasesPage: (): void => ipcRenderer.send(IPC.appOpenReleasesPage),

  // --- Буфер обмена ---
  clipboardRead: (): Promise<string> => ipcRenderer.invoke(IPC.clipboardRead),
  clipboardWrite: (text: string): void => ipcRenderer.send(IPC.clipboardWrite, text),

  // --- Настройки ---
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.configGet),
  updateConfig: (path: string, value: string | number | boolean): Promise<AppConfig> =>
    ipcRenderer.invoke(IPC.configUpdate, path, value),
  resetConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.configReset),
  markHint: (hintId: string): Promise<AppConfig> => ipcRenderer.invoke(IPC.configMarkHint, hintId),
  resetHintCounters: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.configResetHints),
  listKnownHosts: (): Promise<KnownHostView[]> => ipcRenderer.invoke(IPC.knownHostsList),
  deleteKnownHost: (line: number): Promise<void> => ipcRenderer.invoke(IPC.knownHostsDelete, line),

  // --- i18n ---
  i18nGetResource: (lng: string, ns: string): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke(IPC.i18nGetResource, lng, ns),
  i18nListLanguages: (): Promise<string[]> => ipcRenderer.invoke(IPC.i18nListLanguages),
  i18nGetLanguage: (): Promise<string> => ipcRenderer.invoke(IPC.i18nGetLanguage),
  i18nSetLanguage: (lng: string): Promise<void> => ipcRenderer.invoke(IPC.i18nSetLanguage, lng),

  // --- Хосты и группы (HM-01…HM-06) ---
  listHosts: (): Promise<Host[]> => ipcRenderer.invoke(IPC.hostsList),
  listGroups: (): Promise<HostGroup[]> => ipcRenderer.invoke(IPC.groupsList),
  // secret сразу уходит в keychain в main и не возвращается (SEC-01)
  createHost: (input: HostInput, secret?: string): Promise<{ id: number }> =>
    ipcRenderer.invoke(IPC.hostCreate, input, secret),
  updateHost: (id: number, input: HostInput, secret?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.hostUpdate, id, input, secret),
  deleteHost: (id: number): Promise<void> => ipcRenderer.invoke(IPC.hostDelete, id),
  hostHasSecret: (id: number): Promise<boolean> => ipcRenderer.invoke(IPC.hostHasSecret, id),
  hostDeleteSecret: (id: number): Promise<void> => ipcRenderer.invoke(IPC.hostDeleteSecret, id),
  pickKeyFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.hostPickKeyFile),
  createGroup: (name: string): Promise<{ id: number }> => ipcRenderer.invoke(IPC.groupCreate, name),
  renameGroup: (id: number, name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.groupRename, id, name),
  setGroupCollapsed: (id: number, collapsed: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.groupSetCollapsed, id, collapsed),
  deleteGroup: (id: number): Promise<void> => ipcRenderer.invoke(IPC.groupDelete, id),

  // --- Экспорт / импорт (EXP-01…04) ---
  exportHosts: (): Promise<{ saved: boolean }> => ipcRenderer.invoke(IPC.hostsExport),
  pickImportHosts: (): Promise<{ json: string; preview: ImportPreview } | null> =>
    ipcRenderer.invoke(IPC.hostsImportPick),
  applyImportHosts: (
    json: string,
    strategy: 'skip' | 'rename'
  ): Promise<{ imported: number; skipped: number }> =>
    ipcRenderer.invoke(IPC.hostsImportApply, json, strategy),
  importPuttyPreview: (): Promise<ExternalImportResult> =>
    ipcRenderer.invoke(IPC.importPuttyPreview),
  importSshConfigPreview: (): Promise<ExternalImportResult | null> =>
    ipcRenderer.invoke(IPC.importSshConfigPreview),
  applyExternalImport: (
    hosts: ImportedHost[],
    strategy: 'skip' | 'rename'
  ): Promise<{ imported: number; skipped: number }> =>
    ipcRenderer.invoke(IPC.importExternalApply, hosts, strategy),

  // --- SSH-сессии (SSH-01…07, CLOG) ---
  connectHost: (hostId: number): Promise<{ sessionId: string }> =>
    ipcRenderer.invoke(IPC.sessionConnect, hostId),
  disconnectSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sessionDisconnect, sessionId),
  destroySession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sessionDestroy, sessionId),
  listSessions: (): Promise<SessionInfo[]> => ipcRenderer.invoke(IPC.sessionList),
  getConnectionLog: (sessionId: string): Promise<ConnectionLogEntry[]> =>
    ipcRenderer.invoke(IPC.sessionGetLog, sessionId),
  confirmHostKey: (requestId: string, decision: 'accept' | 'reject'): Promise<void> =>
    ipcRenderer.invoke(IPC.hostKeyConfirm, requestId, decision),
  answerAuthPrompt: (requestId: string, answers: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.authPromptAnswer, requestId, answers),
  testConnection: (
    input: HostInput,
    secret?: string,
    hostId?: number
  ): Promise<TestConnectionResult> =>
    ipcRenderer.invoke(IPC.sessionTestConnection, input, secret, hostId),

  // --- Страж (команда идёт на сервер только через эту проверку) ---
  submitCommand: (sessionId: string, command: string): Promise<SubmitResult> =>
    ipcRenderer.invoke(IPC.guardSubmit, sessionId, command),
  confirmDangerousCommand: (requestId: string, confirmationText: string): Promise<{ allowed: boolean }> =>
    ipcRenderer.invoke(IPC.guardConfirm, requestId, confirmationText),
  cancelDangerousCommand: (requestId: string): void => ipcRenderer.send(IPC.guardCancel, requestId),
  sendTerminalInput: (sessionId: string, data: string): void =>
    ipcRenderer.send(IPC.sessionSendInput, sessionId, data),
  resizeSession: (sessionId: string, cols: number, rows: number): void =>
    ipcRenderer.send(IPC.sessionResize, sessionId, cols, rows),
  onTerminalData: (cb: (sessionId: string, data: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, sessionId: string, data: string): void =>
      cb(sessionId, data);
    ipcRenderer.on(IPC.evTerminalData, listener);
    return () => ipcRenderer.removeListener(IPC.evTerminalData, listener);
  },
  onSessionStatus: (cb: (sessionId: string, status: SessionStatus) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, sessionId: string, status: SessionStatus): void =>
      cb(sessionId, status);
    ipcRenderer.on(IPC.evSessionStatus, listener);
    return () => ipcRenderer.removeListener(IPC.evSessionStatus, listener);
  },
  onHostKeyPrompt: (cb: (prompt: HostKeyPrompt) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, prompt: HostKeyPrompt): void => cb(prompt);
    ipcRenderer.on(IPC.evHostKeyPrompt, listener);
    return () => ipcRenderer.removeListener(IPC.evHostKeyPrompt, listener);
  },
  onAuthPrompt: (cb: (prompt: AuthPromptRequest) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, prompt: AuthPromptRequest): void => cb(prompt);
    ipcRenderer.on(IPC.evAuthPrompt, listener);
    return () => ipcRenderer.removeListener(IPC.evAuthPrompt, listener);
  },
  onConnectionLog: (
    cb: (sessionId: string, entry: ConnectionLogEntry) => void
  ): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      sessionId: string,
      entry: ConnectionLogEntry
    ): void => cb(sessionId, entry);
    ipcRenderer.on(IPC.evConnectionLog, listener);
    return () => ipcRenderer.removeListener(IPC.evConnectionLog, listener);
  },
  onBreadcrumb: (cb: (sessionId: string, crumb: Breadcrumb) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, sessionId: string, crumb: Breadcrumb): void =>
      cb(sessionId, crumb);
    ipcRenderer.on(IPC.evBreadcrumb, listener);
    return () => ipcRenderer.removeListener(IPC.evBreadcrumb, listener);
  },
  onHistoryRecorded: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.evHistoryRecorded, listener);
    return () => ipcRenderer.removeListener(IPC.evHistoryRecorded, listener);
  },
  onDashboard: (cb: (sessionId: string, metrics: DashboardMetrics) => void): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      sessionId: string,
      metrics: DashboardMetrics
    ): void => cb(sessionId, metrics);
    ipcRenderer.on(IPC.evDashboard, listener);
    return () => ipcRenderer.removeListener(IPC.evDashboard, listener);
  },
  onError: (cb: (sessionId: string, explanation: ErrorExplanation) => void): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      sessionId: string,
      explanation: ErrorExplanation
    ): void => cb(sessionId, explanation);
    ipcRenderer.on(IPC.evError, listener);
    return () => ipcRenderer.removeListener(IPC.evError, listener);
  },

  // --- Каталог команд ---
  getCommandCatalog: (): Promise<CommandsDatabase> => ipcRenderer.invoke(IPC.catalogGet),

  // --- Автообновление (UPD-01…04) ---
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateGetStatus),
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: UpdateStatus): void => cb(status);
    ipcRenderer.on(IPC.evUpdateStatus, listener);
    return () => ipcRenderer.removeListener(IPC.evUpdateStatus, listener);
  },

  // --- История команд ---
  listHistory: (query?: HistoryQuery): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke(IPC.historyList, query),
  historyCount: (): Promise<number> => ipcRenderer.invoke(IPC.historyCount),
  addHistoryNote: (id: number, note: string): Promise<void> =>
    ipcRenderer.invoke(IPC.historyAddNote, id, note),
  deleteHistoryEntry: (id: number): Promise<void> => ipcRenderer.invoke(IPC.historyDelete, id),
  clearHistory: (): Promise<void> => ipcRenderer.invoke(IPC.historyClear),

  // --- Сниппеты / избранное ---
  listSnippets: (hostId?: number): Promise<Snippet[]> =>
    ipcRenderer.invoke(IPC.snippetsList, hostId),
  createSnippet: (input: {
    name: string;
    command: string;
    description?: string;
    hostId?: number;
  }): Promise<{ id: number }> => ipcRenderer.invoke(IPC.snippetCreate, input),
  updateSnippet: (
    id: number,
    // hostId: undefined — не трогать, null — явно сделать глобальным (SNIP-05)
    input: { name?: string; command?: string; description?: string; hostId?: number | null }
  ): Promise<void> => ipcRenderer.invoke(IPC.snippetUpdate, id, input),
  deleteSnippet: (id: number): Promise<void> => ipcRenderer.invoke(IPC.snippetDelete, id),
  resolveHostSnippets: (hostId: number, action: 'delete' | 'make-global'): Promise<void> =>
    ipcRenderer.invoke(IPC.snippetResolveHost, hostId, action),
  hostHasSnippets: (hostId: number): Promise<boolean> =>
    ipcRenderer.invoke(IPC.snippetHostHas, hostId),

  // --- Onboarding (OB-01…03) ---
  puttySessionsCount: (): Promise<number> => ipcRenderer.invoke(IPC.puttySessionsCount),
  onboardingComplete: (): Promise<void> => ipcRenderer.invoke(IPC.onboardingComplete),
  onboardingStatus: (): Promise<boolean> => ipcRenderer.invoke(IPC.onboardingStatus),

  // --- Окно (кастомный тайтл-бар) ---
  windowMinimize: (): void => ipcRenderer.send(IPC.windowMinimize),
  windowToggleMaximize: (): void => ipcRenderer.send(IPC.windowToggleMaximize),
  windowClose: (): void => ipcRenderer.send(IPC.windowClose),
  windowConfirmClose: (): void => ipcRenderer.send(IPC.windowConfirmClose),
  onConfirmWindowClose: (cb: (activeCount: number) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, activeCount: number): void => cb(activeCount);
    ipcRenderer.on(IPC.evConfirmWindowClose, listener);
    return () => ipcRenderer.removeListener(IPC.evConfirmWindowClose, listener);
  },
  onWindowMaximized: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, maximized: boolean): void => {
      cb(maximized === true);
    };
    ipcRenderer.on(IPC.evWindowMaximized, listener);
    return () => ipcRenderer.removeListener(IPC.evWindowMaximized, listener);
  }
} as const;

export type LucidSSHBridge = typeof api;

contextBridge.exposeInMainWorld('lucidSSH', api);
