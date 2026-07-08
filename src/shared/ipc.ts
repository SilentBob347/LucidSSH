/**
 * Имена IPC-каналов. Каждый канал — одна конкретная операция (SEC-05, §4 гайда).
 * Универсальных каналов нет; renderer не передаёт имя канала как аргумент.
 */

export const IPC = {
  // --- Приложение ---
  appGetInfo: 'app:get-info',
  appOpenReleasesPage: 'app:open-releases-page', // §9.1 Release_and_Update_Strategy.md — ссылка на SHA-256 в About

  // --- Буфер обмена (через main, renderer без clipboard-permission) ---
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',

  // --- Настройки (config.json, без секретов) ---
  configGet: 'config:get',
  configUpdate: 'config:update',
  configMarkHint: 'config:mark-hint', // счётчик показов подсказок (§5.1, SNIP-08)
  configResetHints: 'config:reset-hints', // «Сбросить счётчик показов подсказок» (SET-05)
  configReset: 'config:reset', // SET-08 сброс до заводских
  knownHostsList: 'security:known-hosts-list', // SET-04
  knownHostsDelete: 'security:known-hosts-delete',

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

  // --- Импорт из внешних источников (HM-03 PuTTY, HM-04 ssh_config) ---
  importPuttyPreview: 'import:putty-preview',
  importSshConfigPreview: 'import:ssh-config-preview',
  importExternalApply: 'import:external-apply',

  // --- SSH-сессии (SSH-01…07, CLOG) ---
  sessionConnect: 'session:connect',
  sessionDisconnect: 'session:disconnect',
  sessionDestroy: 'session:destroy',
  sessionList: 'session:list',
  sessionGetLog: 'session:get-log',
  sessionSendInput: 'session:send-input',
  sessionResize: 'session:resize',
  sessionTestConnection: 'session:test-connection',
  hostKeyConfirm: 'session:host-key-confirm',

  // --- Страж опасных команд (GUARD-01…06) ---
  guardSubmit: 'guard:submit',
  guardConfirm: 'guard:confirm',
  guardCancel: 'guard:cancel',

  // --- Каталог команд / детектор ошибок (встроенные базы) ---
  catalogGet: 'catalog:get',

  // --- Автообновление (UPD-01…04) ---
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateGetStatus: 'update:get-status',

  // --- История команд (HIST-01…07) ---
  historyList: 'history:list',
  historyCount: 'history:count',
  historyAddNote: 'history:add-note',
  historyDelete: 'history:delete',
  historyClear: 'history:clear',

  // --- Сниппеты / избранное (SNIP-01…08) ---
  snippetsList: 'snippets:list',
  snippetCreate: 'snippets:create',
  snippetUpdate: 'snippets:update',
  snippetDelete: 'snippets:delete',
  snippetResolveHost: 'snippets:resolve-host',
  snippetHostHas: 'snippets:host-has',

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
  evDashboard: 'ev:dashboard',
  evError: 'ev:error',
  evUpdateStatus: 'ev:update-status'
} as const;

export interface AppInfo {
  version: string;
  language: string;
}
