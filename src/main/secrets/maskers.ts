/**
 * Маскирование секретов перед записью в историю (HIST-07, §16 Security_Guide).
 * Обязательно покрывается тестами на реальных примерах утечек (§10 CLAUDE.md).
 * Замаскированное значение нигде не восстанавливается и не попадает в
 * поиск/экспорт. Это не исчерпывающий детектор, а защита от типичных утечек.
 *
 * Текст бывает выводом сервера (до 64 КБ, недоверенный), поэтому каждое правило
 * линейно: регэксп ищет только префикс с одним неограниченным классом, значение
 * читается отдельным sticky-регэкспом без отката.
 */

const MASK = '••••••••';

/**
 * Значение секрета — одно shell-слово: в кавычках целиком (с пробелами внутри)
 * вместе с приклеенным хвостом (`"p1"$SUFFIX`), или до пробела. Незакрытая
 * кавычка (вывод обрезан посреди значения) прячет остаток строки, а не первое слово.
 */
const VALUE = /(?:'[^']*'|"[^"]*"|'[^'\n]*|"[^"\n]*)\S*|\S+/y;

const KEYWORDS = 'KEY|TOKEN|SECRET|PASS|PWD|CREDENTIAL|AUTH';
/**
 * Имя переменной секретное, если ключевое слово стоит внутри (API_KEY, PGPASSWORD,
 * MYSQL_PWD) или имя само — голое ключевое слово (PASSWORD=, TOKEN=, KEY=).
 * Не секрет: KEYMAP=, AUTHOR=, PASSWORD_FILE= (ключевое слово лишь начало имени)
 * и голый PWD= — это рабочий каталог shell, он есть в каждом выводе `env`.
 */
const SECRET_NAME = new RegExp(`^(?:PASSWORD|TOKEN|SECRET|PASS|KEY|AUTH)=|.(?:${KEYWORDS})`);

interface MaskRule {
  /** Безопасный префикс перед значением — он остаётся, значение после него прячется. */
  prefix: RegExp;
  /** Доп. проверка префикса (эвристика по имени переменной). */
  isSecret?: (prefix: string) => boolean;
}

const RULES: MaskRule[] = [
  // Authorization: Bearer <token> (в т.ч. в кавычках, curl -H "...")
  { prefix: /Authorization:\s*Bearer\s+/gi },
  // Authorization: Basic <base64>
  { prefix: /Authorization:\s*Basic\s+/gi },
  // --password=value / --pass=value / --token=value / --secret=value / --api-key=value
  { prefix: /--(?:password|pass|token|secret|api[-_]?key|access[-_]?key)=/gi },
  // --password value / --pass value (значение через пробел)
  { prefix: /--(?:password|pass|token)\s+(?!-)/gi },
  // -p<value> без пробела (mysql/curl стиль): -psecret. НЕ трогаем одиночный -p.
  { prefix: /\s-p/g },
  // export KEY=value / KEY=value перед командой (эвристика по UPPER_SNAKE-имени)
  { prefix: /\b[A-Z][A-Z0-9_]*=/g, isSecret: (p) => SECRET_NAME.test(p) },
  // sshpass -p 'value'
  { prefix: /sshpass\s+-p\s*/gi }
];

export interface MaskResult {
  masked: string;
  hasSecret: boolean;
}

/**
 * Маскирует секреты в команде. Возвращает замаскированную строку и признак,
 * что что-то было скрыто (для бейджа «СЕКРЕТ СКРЫТ» и флага has_secret).
 */
export function maskSecrets(command: string): MaskResult {
  let masked = command;
  let hasSecret = false;
  for (const rule of RULES) {
    let out = '';
    let last = 0;
    for (const m of masked.matchAll(rule.prefix)) {
      // префикс внутри уже обработанного значения или несекретное имя — пропускаем
      if (m.index < last || (rule.isSecret && !rule.isSecret(m[0]))) continue;
      const start = m.index + m[0].length;
      VALUE.lastIndex = start;
      const value = VALUE.exec(masked)?.[0];
      if (!value) continue;
      // уже замаскированное значение оставляем как есть и секретом не считаем;
      // маска внутри кавычек (от другого правила) не делает значение замаскированным
      const already = value.startsWith('•');
      out += masked.slice(last, start) + (already ? value : MASK);
      last = start + value.length;
      hasSecret ||= !already;
    }
    masked = out + masked.slice(last);
  }
  return { masked, hasSecret };
}
