/**
 * Имена IPC-каналов. Каждый канал — одна конкретная операция (SEC-05, §4 гайда).
 * Универсальных каналов нет; renderer не передаёт имя канала как аргумент.
 */

export const IPC = {
  // --- Приложение ---
  appGetInfo: 'app:get-info',

  // --- Буфер обмена (через main, renderer без clipboard-permission) ---
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',

  // --- Настройки (config.json, без секретов) ---
  configGet: 'config:get',
  configUpdate: 'config:update',

  // --- i18n ---
  i18nGetResource: 'i18n:get-resource',
  i18nListLanguages: 'i18n:list-languages',
  i18nGetLanguage: 'i18n:get-language',
  i18nSetLanguage: 'i18n:set-language',

  // --- Хосты и группы (HM-01…HM-06) ---
  hostsList: 'hosts:list',
  hostCreate: 'hosts:create',
  hostUpdate: 'hosts:update',
  hostDelete: 'hosts:delete',
  hostHasSecret: 'hosts:has-secret',
  hostDeleteSecret: 'hosts:delete-secret',
  hostPickKeyFile: 'hosts:pick-key-file',
  groupsList: 'groups:list',
  groupCreate: 'groups:create',
  groupRename: 'groups:rename',
  groupSetCollapsed: 'groups:set-collapsed',
  groupDelete: 'groups:delete',

  // --- Экспорт / импорт (EXP-01…04) ---
  hostsExport: 'hosts:export',
  hostsImportPick: 'hosts:import-pick',
  hostsImportApply: 'hosts:import-apply',

  // --- SSH-сессии (SSH-01…07, CLOG) ---
  sessionConnect: 'session:connect',
  sessionDisconnect: 'session:disconnect',
  sessionDestroy: 'session:destroy',
  sessionList: 'session:list',
  sessionGetLog: 'session:get-log',
  sessionSendInput: 'session:send-input',
  sessionResize: 'session:resize',
  hostKeyConfirm: 'session:host-key-confirm',

  // --- Страж опасных команд (GUARD-01…06) ---
  guardSubmit: 'guard:submit',
  guardConfirm: 'guard:confirm',
  guardCancel: 'guard:cancel',

  // --- Onboarding (OB-01…03) ---
  puttySessionsCount: 'onboarding:putty-count',
  onboardingComplete: 'onboarding:complete',
  onboardingStatus: 'onboarding:status',

  // --- Управление окном (кастомный тайтл-бар) ---
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowConfirmClose: 'window:confirm-close',

  // --- События main → renderer ---
  evWindowMaximized: 'ev:window-maximized',
  evSessionStatus: 'ev:session-status',
  evHostKeyPrompt: 'ev:host-key-prompt',
  evConnectionLog: 'ev:connection-log',
  evTerminalData: 'ev:terminal-data',
  evConfirmWindowClose: 'ev:confirm-window-close',
  evBreadcrumb: 'ev:breadcrumb',
  evDashboard: 'ev:dashboard'
} as const;

export interface AppInfo {
  version: string;
  language: string;
}
