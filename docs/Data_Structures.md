# LucidSSH for Windows — Спецификация структур данных

| Поле | Значение |
|---|---|
| Версия документа | 1.1 |
| Дата | 27 июня 2026 |
| Назначение | Схемы БД, форматы встроенных баз, IPC-контракты и формат настроек для Claude Code |
| Базовые документы | `LucidSSH_TZ_v1.4.md`, `LucidSSH_Security_Guide.md` |

> Всё, что касается хранения и обмена данными, описано здесь, чтобы реализация была единообразной. TypeScript-типы — целевая форма; конкретные имена столбцов можно адаптировать, но семантика и ограничения безопасности обязательны. Секреты не хранятся в SQLite/JSON и не передаются в renderer — это сквозное правило (SEC-01, §10 гайда).

---

## 1. Хранилища (обзор)

| Данные | Хранилище | Файл | Секреты |
|---|---|---|---|
| Хосты и группы | SQLite | `%APPDATA%\LucidSSH\hosts.db` | Нет — только ссылка `LucidSSH/{hostId}` |
| История команд | SQLite | `%APPDATA%\LucidSSH\history.db` | Нет — секреты замаскированы (HIST-07) |
| Пароли и passphrase | Windows Credential Manager | системное | Да — через keytar |
| Known hosts | Файл | `%APPDATA%\LucidSSH\known_hosts` | Нет |
| Настройки | JSON | `%APPDATA%\LucidSSH\config.json` | Нет |
| База ошибок | Встроена в пакет | `assets/errors.json` | Нет |
| Каталог команд | Встроена в пакет | `assets/commands.json` | Нет |

Файлы создаются с доступом только для текущего пользователя Windows (насколько поддерживает ОС). Все SQL-запросы параметризованы; конкатенация значений в SQL запрещена. История и хосты — в **раздельных** файлах БД, чтобы отключение/очистка истории не затрагивала хосты.

---

## 2. SQLite — hosts.db

### 2.1 Таблица `groups`

```sql
CREATE TABLE groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  collapsed   INTEGER NOT NULL DEFAULT 0,   -- 0/1, состояние дерева (HM-02)
  created_at  TEXT    NOT NULL              -- ISO 8601
);
```

### 2.2 Таблица `hosts`

```sql
CREATE TABLE hosts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,            -- отображаемое имя
  address       TEXT    NOT NULL,            -- IP или домен
  port          INTEGER NOT NULL DEFAULT 22,
  username      TEXT    NOT NULL,
  auth_method   TEXT    NOT NULL,            -- 'password' | 'key'
  key_path      TEXT,                        -- путь к ОРИГИНАЛЬНОМУ файлу ключа, не копия (SEC-02)
  group_id      INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  proxy_jump    TEXT,                        -- host id или строка ProxyJump (SSH-05)
  note          TEXT,
  guard_enabled INTEGER NOT NULL DEFAULT 1,  -- отключение стража на хост (GUARD-05)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
  -- ВАЖНО: ни password, ни passphrase, ни содержимого ключа здесь нет.
  -- Секрет в Credential Manager под ключом LucidSSH/{id}.
);
```

### 2.3 TypeScript-типы

```ts
type AuthMethod = 'password' | 'key';

interface HostGroup {
  id: number;
  name: string;
  sortOrder: number;
  collapsed: boolean;
  createdAt: string;
}

interface Host {
  id: number;
  name: string;
  address: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  keyPath?: string;        // путь к оригиналу
  groupId?: number;
  proxyJump?: string;
  note?: string;
  guardEnabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// Форма для создания/редактирования. Секрет передаётся ОТДЕЛЬНО и сразу
// уходит в keychain, не сохраняясь в объекте хоста и не возвращаясь в renderer.
interface HostInput {
  name: string;
  address: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  keyPath?: string;
  groupId?: number;
  proxyJump?: string;
  note?: string;
  guardEnabled: boolean;
}
```

### 2.4 Связь с Credential Manager

```ts
// keychain/ — единственное место работы с секретами
const CRED_SERVICE = 'LucidSSH';
// account = String(hostId); пароль ИЛИ passphrase ключа
keytar.setPassword(CRED_SERVICE, String(hostId), secret);
keytar.getPassword(CRED_SERVICE, String(hostId)); // только в main, не в IPC-ответ
keytar.deletePassword(CRED_SERVICE, String(hostId)); // при удалении хоста, после подтверждения
```

UI пароля никогда не подставляет реальное значение — показывает только состояние «пароль сохранён» (§10 гайда).

---

## 3. SQLite — history.db

### 3.1 Таблица `history`

```sql
CREATE TABLE history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  command     TEXT    NOT NULL,             -- УЖЕ замаскированная строка (HIST-07)
  host_id     INTEGER,                       -- может быть NULL, если хост удалён
  host_name   TEXT    NOT NULL,             -- денормализовано: остаётся читаемым после удаления хоста
  username    TEXT    NOT NULL,
  started_at  TEXT    NOT NULL,             -- ISO 8601
  finished_at TEXT,
  exit_code   INTEGER,                       -- NULL пока не завершилась
  guard_status TEXT,                         -- NULL | 'blocked' | 'confirmed' (HIST-05)
  has_secret  INTEGER NOT NULL DEFAULT 0,   -- 1 если в команде было замаскировано значение
  note        TEXT
);

CREATE INDEX idx_history_command ON history(command);
CREATE INDEX idx_history_host    ON history(host_id);
CREATE INDEX idx_history_time    ON history(started_at);
```

### 3.2 TypeScript-тип

```ts
type GuardStatus = 'blocked' | 'confirmed';

interface HistoryEntry {
  id: number;
  command: string;          // маскированная
  hostId?: number;
  hostName: string;
  username: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  guardStatus?: GuardStatus;
  hasSecret: boolean;
  note?: string;
}
```

### 3.3 Правила маскирования (HIST-07)

Маскирование выполняется в main **до** записи. Замаскированное значение нигде не восстанавливается и не попадает в поиск/экспорт. Минимальный набор детектируемых паттернов:

```ts
// secrets/maskers.ts — паттерны выносятся отдельно и покрываются тестами,
// по аналогии с guard/patterns.ts
const SECRET_PATTERNS: { re: RegExp; mask: (m: RegExpMatchArray) => string }[] = [
  // export KEY=value / KEY=value перед командой
  { re: /\b([A-Z_][A-Z0-9_]*)=(\S+)/g, mask: m => `${m[1]}=••••••••` },
  // --password=value / --pass value
  { re: /(--password=|--pass(word)?[= ])(\S+)/gi, mask: m => `${m[1]}••••••••` },
  // -p<value> (mysql/curl стиль, без пробела)
  { re: /(\s-p)(\S+)/g, mask: m => `${m[1]}••••••••` },
  // Authorization: Bearer <token>
  { re: /(Authorization:\s*Bearer\s+)(\S+)/gi, mask: m => `${m[1]}••••••••` },
  // mysql --password=...  (покрывается общим --password= выше)
];
```

> Это не исчерпывающий детектор, а защита от типичных утечек. Список расширяется тестами на реальных примерах из §15 гайда. Пользователь дополнительно может не сохранять отдельную команду и отключить историю (HIST-07).

### 3.4 FIFO-лимит

Лимит 10 000 записей (HIST-06). При превышении удаляется старейшая по `started_at`, **кроме** записей, отмеченных как избранное (`is_favorite = 1`). Terminal output по умолчанию не сохраняется.

---

## 4. SQLite — snippets (в history.db)

```sql
CREATE TABLE snippets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,             -- короткое имя сниппета
  command     TEXT    NOT NULL,             -- команда (секреты маскируются так же, как в history)
  description TEXT,                         -- необязательное описание
  host_id     INTEGER,                      -- привязка к хосту (NULL = глобальный, SNIP-05)
                                            -- при удалении хоста: NULL (перевести в глобальные)
                                            -- или запись удаляется — по выбору пользователя (SNIP-07)
  danger      INTEGER NOT NULL DEFAULT 0,   -- 1 если команда матчит паттерн опасных команд
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE INDEX idx_snippets_host ON snippets(host_id);
CREATE INDEX idx_snippets_danger ON snippets(danger);
```

```ts
interface Snippet {
  id: number;
  name: string;
  command: string;
  description?: string;
  hostId?: number;        // undefined / null = глобальный; число = серверный (SNIP-05)
  danger: boolean;        // true если команда матчит паттерн опасных команд (определяется при сохранении)
  createdAt: string;
  updatedAt: string;
}

// Используется при отображении: глобальные + серверные текущего хоста (SNIP-06)
type SnippetScope = 'global' | 'server';
```

> **Правило удаления хоста (SNIP-07):** при удалении хоста main process проверяет наличие сниппетов с `host_id = deletedHostId`. При наличии показывает диалог с двумя вариантами: «Удалить сниппеты» (DELETE WHERE host_id = ?) или «Сделать глобальными» (UPDATE SET host_id = NULL WHERE host_id = ?). Молчаливое удаление или обнуление без диалога запрещено.

---

## 4. Встроенная база — errors.json

### 4.1 Формат

```json
{
  "version": "1.0.0",
  "patterns": [
    {
      "id": "permission-denied",
      "match": "(?i)permission denied",
      "category": "filesystem",
      "title": "Недостаточно прав",
      "explanation": "У текущего пользователя нет прав на это действие. Файл или каталог принадлежит другому пользователю (часто root).",
      "checks": [
        { "text": "Запустить с sudo", "command": "sudo {original}" },
        { "text": "Посмотреть владельца", "command": "ls -la {target}" },
        { "text": "Проверить текущего пользователя", "command": "whoami" }
      ],
      "scope": "command"
    }
  ]
}
```

### 4.2 TypeScript-тип

```ts
type ErrorScope = 'command' | 'ssh-connection';

interface ErrorCheck {
  text: string;             // что проверить, по-русски
  command?: string;         // подсказка-команда; {original}/{target} подставляются БЕЗОПАСНО
}

interface ErrorPattern {
  id: string;
  match: string;            // регулярное выражение (компилируется при загрузке)
  category: string;
  title: string;
  explanation: string;      // только русский (NFR-07)
  checks: ErrorCheck[];
  scope: ErrorScope;
}

interface ErrorsDatabase {
  version: string;          // semver, сверяется с версией приложения
  patterns: ErrorPattern[];
}
```

### 4.3 Обязательное покрытие (ERR-04, ERR-05)

permission denied, no such file or directory, command not found, connection refused, disk full, out of memory, segmentation fault, syntax error; SSH: Connection refused, Permission denied (publickey), Host key verification failed, Connection timed out.

### 4.4 Точка расширения под 1.2

Детектор возвращает результат вида `{ matched: ErrorPattern } | { matched: null, fallback: FallbackRef }`. В 1.0 `fallback` ведёт в общий шаблон / поиск документации (ERR-06). В 1.2 этот же `fallback` направляется в локальную LLM (§12.13 ТЗ). Контракт детектора менять при этом не нужно.

```ts
interface FallbackRef {
  kind: 'doc-search' | 'llm';   // в 1.0 всегда 'doc-search'
  command: string;
  exitCode?: number;
  stderrExcerpt: string;        // минимальный фрагмент, после маскирования секретов
}
```

---

## 5. Встроенная база — commands.json

### 5.1 Формат

```json
{
  "version": "1.0.0",
  "categories": ["files", "processes", "network", "system", "text"],
  "commands": [
    {
      "name": "ls",
      "category": "files",
      "summary": "Показать содержимое каталога",
      "keywords": ["список", "файлы", "каталог", "посмотреть"],
      "flags": [
        { "flag": "-l", "desc": "Подробный список с правами и размером" },
        { "flag": "-la", "desc": "Подробно и со скрытыми файлами" },
        { "flag": "-h", "desc": "Размеры в человекочитаемом виде" },
        { "flag": "-R", "desc": "Рекурсивно по подкаталогам" }
      ],
      "dangerous": false
    }
  ]
}
```

### 5.2 TypeScript-тип

```ts
type CommandCategory = 'files' | 'processes' | 'network' | 'system' | 'text';

interface CommandFlag {
  flag: string;             // например "-la"
  desc: string;             // русское пояснение (NFR-07)
}

interface CatalogCommand {
  name: string;
  category: CommandCategory;
  summary: string;          // однострочное объяснение, русский
  keywords: string[];       // для русского поиска: «удалить» → rm (CAT-05)
  flags: CommandFlag[];
  dangerous: boolean;       // подсказка для UI; решение принимает Страж, не это поле
}

interface CommandsDatabase {
  version: string;
  categories: CommandCategory[];
  commands: CatalogCommand[];
}
```

Клик по флагу формирует строку и **отправляет её через Стража** (CAT-04 + GUARD-04), а не напрямую в SSH.

---

## 6. config.json

```ts
interface AppConfig {
  version: string;
  window: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    maximized: boolean;           // WIN-01
  };
  onboarding: {
    completed: boolean;           // OB-03: первый запуск пройден
  };
  ui: {
    expertMode: boolean;          // быстрое отключение ВСЕХ подсказок (SET-05)
    // гранулярные переключатели (SET-05) — expertMode выставляет все в false
    hints: {
      commandCatalog: boolean;    // подсказки каталога команд (CAT-06)
      outputTooltips: boolean;    // тултипы вывода команд
      errorPanel: boolean;        // панель детектора ошибок (ERR-03)
      connectionDialog: boolean;  // обучающие подсказки в диалоге подключения
    };
    theme: 'dark';                // в 1.0 только тёмная; 'light' | string добавятся в 1.1/1.2
    notifications: {
      systemToasts: boolean;      // системные уведомления Windows (NOTIF-04)
      longCommandThresholdSec: number; // 0 = выкл. (NOTIF-02)
    };
    dashboardVisible: boolean;    // DASH-04
    catalogPanelOpen: boolean;
  };
  terminal: {
    font: string;                 // TERM-04
    fontSize: number;
    opacity: number;              // 0..1
    bell: 'off' | 'sound' | 'visual'; // TERM-04
    brightBold: boolean;          // яркие цвета для bold (TERM-04)
    selectToCopy: boolean;        // TERM-04
    rightClickPaste: boolean;     // TERM-04
  };
  connection: {
    autoreconnect: boolean;       // SSH-06, SET-03
    keepaliveIntervalSec: number;
    connectTimeoutSec: number;
  };
  guard: {
    globalEnabled: boolean;       // GUARD-05
  };
  history: {
    enabled: boolean;             // HIST-07: глобальное отключение
    perHostDisabled: number[];    // hostId, для которых история выключена
  };
  shownCounts: Record<string, number>; // id подсказки → сколько раз показана (лимит 3)
  updates: {
    autoCheck: boolean;           // OQ-09
    source: string;               // URL источника обновлений
  };
}
```

config.json **не содержит секретов** (SEC-01). `hints.shownCounts` реализует «не более 3 показов» из §5.1 ТЗ.

---

## 7. IPC-контракт

> Каждый метод — одна операция. Универсальных `invoke(channel, data)` нет. Все аргументы валидируются в main (тип, формат, длина, диапазон). `sessionId`/`hostId` проверяются на существование и принадлежность окну. Секреты в ответах не возвращаются (SEC-05, §4 гайда).

```ts
interface LucidSSHBridge {
  // --- Хосты ---
  listHosts(): Promise<Host[]>;
  listGroups(): Promise<HostGroup[]>;
  createHost(input: HostInput, secret?: string): Promise<{ id: number }>; // secret сразу в keychain
  updateHost(id: number, input: HostInput, secret?: string): Promise<void>;
  deleteHost(id: number): Promise<void>;                 // чистит и Credential Manager
  hostHasSecret(id: number): Promise<boolean>;           // для UI «пароль сохранён», без значения

  // --- Сессии ---
  connectHost(hostId: number): Promise<{ sessionId: string; status: SessionStatus }>;
  disconnectSession(sessionId: string): Promise<void>;
  sendTerminalInput(sessionId: string, text: string): Promise<void>;
  confirmHostKey(requestId: string, decision: 'accept' | 'reject'): Promise<void>;
  confirmDangerousCommand(requestId: string, confirmationText: string): Promise<{ allowed: boolean }>;

  // --- Каталог / ошибки (только чтение встроенных баз) ---
  getCommandCatalog(): Promise<CommandsDatabase>;
  explainError(ref: FallbackRef): Promise<ErrorExplanation>; // в 1.0 doc-search

  // --- Сниппеты ---
  // listSnippets: без аргументов — только глобальные; с hostId — глобальные + серверные хоста (SNIP-06)
  listSnippets(hostId?: number): Promise<Snippet[]>;
  createSnippet(input: Omit<Snippet, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ id: number }>;
  // updateSnippet: hostId включён, чтобы позволить смену области видимости сниппета
  updateSnippet(id: number, input: Partial<Pick<Snippet, 'name' | 'command' | 'description' | 'hostId'>>): Promise<void>;
  deleteSnippet(id: number): Promise<void>;
  // Вызывается перед удалением хоста, если у него есть серверные сниппеты (SNIP-07)
  resolveHostSnippets(hostId: number, action: 'delete' | 'make-global'): Promise<void>;

  // --- Лог соединения ---
  getConnectionLog(sessionId: string): Promise<ConnectionLogEntry[]>;

  // --- Экспорт / импорт хостов ---
  exportHosts(): Promise<string>;                        // возвращает JSON-строку (EXP-01)
  previewImportHosts(json: string): Promise<ImportPreview>; // EXP-03
  importHosts(json: string, conflictStrategy: 'skip' | 'rename'): Promise<{ imported: number; skipped: number }>; // EXP-02
  listHistory(query?: HistoryQuery): Promise<HistoryEntry[]>;
  addHistoryNote(id: number, note: string): Promise<void>;
  deleteHistoryEntry(id: number): Promise<void>;
  clearHistory(): Promise<void>;

  // --- Импорт ---
  importPuttySessions(): Promise<{ imported: number }>;
  importSshConfig(): Promise<{ imported: number; skippedDirectives: string[] }>;

  // --- Обновления ---
  checkForUpdate(): Promise<UpdateInfo | null>;
  startUpdateDownload(): Promise<void>;
  applyUpdate(): Promise<void>;                           // после подтверждения

  // --- События (main → renderer) ---
  onTerminalData(cb: (sessionId: string, data: string) => void): void;
  onSessionStatus(cb: (sessionId: string, status: SessionStatus) => void): void;
  onHostKeyPrompt(cb: (req: HostKeyPrompt) => void): void;
  onDangerousCommand(cb: (req: DangerousCommandPrompt) => void): void;
  onError(cb: (sessionId: string, explanation: ErrorExplanation) => void): void;
  onDashboard(cb: (sessionId: string, metrics: DashboardMetrics) => void): void;
  onBreadcrumb(cb: (sessionId: string, crumb: Breadcrumb) => void): void;
  onNotification(cb: (event: AppNotification) => void): void; // NOTIF-03: fingerprint + update
}
```

### 7.1 Вспомогательные типы

```ts
type SessionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface HostKeyPrompt {
  requestId: string;
  hostId: number;
  fingerprintSha256: string;
  isChanged: boolean;          // true → изменился, блокировка (SSH-04)
  previousFingerprint?: string;
}

interface DangerousCommandPrompt {
  requestId: string;
  sessionId: string;
  command: string;
  target: string;              // реальный путь/объект (GUARD-03)
  scope: 'file' | 'directory' | 'disk' | 'other';
  explanation: string;         // русский
}

interface DashboardMetrics {
  cpuPercent: number | null;   // null → «—» (DASH-05)
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  diskPercent: number | null;
  uptimeSeconds: number | null;
}

interface Breadcrumb {
  username: string;
  host: string;
  path: string;
  privilege: 'normal' | 'sudo' | 'root';  // BRD-03
}

interface ErrorExplanation {
  title: string;
  explanation: string;
  checks: ErrorCheck[];
  source: 'database' | 'fallback';        // в 1.2 добавится 'llm'
}

interface HistoryQuery {
  text?: string;
  hostId?: number;
  sessionOnly?: boolean;
}

interface UpdateInfo {
  currentVersion: string;
  newVersion: string;
  notes: string;
  downloadSizeBytes: number;
}

type AppNotificationKind = 'fingerprint-changed' | 'update-available';

interface ConnectionLogEntry {
  timestamp: string;            // ISO 8601
  level: 'info' | 'warn' | 'error';
  message: string;              // без секретов (CLOG-03)
  step?: 'tcp' | 'handshake' | 'hostkey' | 'auth' | 'session';
}

interface ImportPreview {
  toAdd: number;
  toSkip: number;
  conflicts: Array<{ name: string; address: string; username: string }>;
}

interface AppNotification {
  id: string;                         // уникальный, для дедупликации
  kind: AppNotificationKind;
  severity: 'info' | 'warning' | 'error';
  title: string;
  body: string;
  hostId?: number;                    // для fingerprint-changed
  createdAt: string;                  // ISO 8601
  read: boolean;
}
```

---

## 8. known_hosts

Формат OpenSSH (`known_hosts`), управляется в main. При первом подключении запись добавляется после подтверждения (SSH-03). Изменение ключа не перезаписывает запись автоматически — только после явного решения пользователя (SSH-04). Файл — доступ только текущего пользователя.

---

## 9. Сквозные правила для всех структур

1. Секреты (пароли, passphrase, содержимое ключей) — только в Credential Manager, никогда в SQLite/JSON/логах/IPC-ответах (SEC-01, §10, §17 гайда).
2. Пути к ключам хранятся как ссылка на оригинал; ключ не копируется (SEC-02).
3. Любая строка от сервера (stderr, breadcrumb, метрики, man/--help) — недоверенный ввод: парсится как данные, не исполняется, маскируется на секреты перед сохранением/логом.
4. Версии встроенных баз (`errors.json`, `commands.json`) сверяются с версией приложения; стратегия их обновления — OQ-06.
5. Точки расширения под 1.2 (`FallbackRef.kind`, `ErrorExplanation.source`) заложены, но реализация LLM в 1.0 отсутствует.
6. Денормализация `host_name`/`username` в истории намеренная: запись остаётся читаемой после удаления хоста.

*— конец документа —*
