/**
 * Типы контент-баз ошибок и команд (Data_Structures §4–6).
 * Схема мультиязычна (CLAUDE.md §5a): техническая часть (regex `match`, `id`,
 * `category`, `flag`, имена команд) — общая, не переводится; переводится только
 * человекочитаемый текст (`title`, `explanation`, `summary`, `desc`,
 * `checks[].text`, `keywords`) в locales/{lang}/. Regex по языкам не дублируется.
 */

// ---- Ошибки ----

export type ErrorScope = 'command' | 'ssh-connection';

export interface ErrorCheck {
  text: string; // что проверить, по-русски/локализованно
  command?: string; // подсказка-команда; {original}/{target} подставляются БЕЗОПАСНО (как данные)
}

export interface ErrorPattern {
  id: string;
  match: string; // регулярное выражение (компилируется при загрузке)
  category: string;
  title: string;
  explanation: string;
  checks: ErrorCheck[];
  scope: ErrorScope;
}

// ---- Точка расширения под 1.2 (не реализуется в 1.0) ----

export interface FallbackRef {
  kind: 'doc-search' | 'llm'; // в 1.0 всегда 'doc-search'
  command: string;
  exitCode?: number;
  stderrExcerpt: string; // минимальный фрагмент, после маскирования секретов
}

export interface ErrorExplanation {
  title: string;
  explanation: string;
  checks: ErrorCheck[];
  source: 'database' | 'fallback'; // в 1.2 добавится 'llm'
  /** Упавшая команда — показывается в панели над объяснением (скриншот 02-Error). */
  command: string;
  /** id сматчившегося паттерна (ERR-07: чтобы отличить command-not-found от прочих). */
  id?: string;
  /** ERR-07: имена команд-кандидатов («возможно, вы имели в виду: X?»), расстояние Левенштейна ≤ 2. */
  suggestions?: string[];
  /** ERR-08: exit code упавшей команды — для блока «Скопировать для вопроса». Нет для ssh-connection. */
  exitCode?: number;
  /** ERR-08: фрагмент stderr/вывода, уже прошедший маскирование секретов (maskSecrets) — для блока «Скопировать для вопроса». */
  stderr?: string;
}

// ---- Каталог команд ----

export type CommandCategory = 'files' | 'processes' | 'network' | 'system' | 'text';

export interface CommandFlag {
  flag: string; // например "-la"
  desc: string; // локализованное пояснение
}

export interface CatalogCommand {
  name: string;
  category: CommandCategory;
  summary: string;
  keywords: string[]; // для локализованного поиска: «удалить» → rm
  flags: CommandFlag[];
  dangerous: boolean; // подсказка для UI; решение принимает Страж
}

export interface CommandsDatabase {
  version: string;
  categories: CommandCategory[];
  categoryLabels: Record<string, string>;
  commands: CatalogCommand[];
}
