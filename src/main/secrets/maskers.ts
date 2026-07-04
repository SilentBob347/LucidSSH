/**
 * Маскирование секретов перед записью в историю (HIST-07, §16 Security_Guide).
 * Обязательно покрывается тестами на реальных примерах утечек (§10 CLAUDE.md).
 * Замаскированное значение нигде не восстанавливается и не попадает в
 * поиск/экспорт. Это не исчерпывающий детектор, а защита от типичных утечек.
 */

const MASK = '••••••••';

interface MaskRule {
  re: RegExp;
  /** Сборка замены из совпадения — сохраняем «безопасный» префикс, прячем значение. */
  replace: (m: RegExpMatchArray) => string;
}

const RULES: MaskRule[] = [
  // Authorization: Bearer <token> (в т.ч. в кавычках, curl -H "...")
  {
    re: /(Authorization:\s*Bearer\s+)(\S+)/gi,
    replace: (m) => `${m[1]}${MASK}`
  },
  // Authorization: Basic <base64>
  {
    re: /(Authorization:\s*Basic\s+)(\S+)/gi,
    replace: (m) => `${m[1]}${MASK}`
  },
  // --password=value / --pass=value / --token=value / --secret=value / --api-key=value
  {
    re: /(--(?:password|pass|token|secret|api[-_]?key|access[-_]?key)=)(\S+)/gi,
    replace: (m) => `${m[1]}${MASK}`
  },
  // --password value / --pass value (значение через пробел)
  {
    re: /(--(?:password|pass|token)\s+)(?!-)(\S+)/gi,
    replace: (m) => `${m[1]}${MASK}`
  },
  // -p<value> без пробела (mysql/curl стиль): -psecret. НЕ трогаем одиночный -p.
  {
    re: /(\s-p)(\S+)/g,
    replace: (m) => `${m[1]}${MASK}`
  },
  // export KEY=value / KEY=value перед командой (эвристика по UPPER_SNAKE-имени)
  {
    re: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASS|PASSWORD|PWD|CREDENTIAL|AUTH)[A-Z0-9_]*)=(\S+)/g,
    replace: (m) => `${m[1]}=${MASK}`
  },
  // sshpass -p 'value'
  {
    re: /(sshpass\s+-p\s*)('[^']*'|"[^"]*"|\S+)/gi,
    replace: (m) => `${m[1]}${MASK}`
  }
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
    masked = masked.replace(rule.re, (...args) => {
      // args: match, ...groups, offset, string
      const groups = args.slice(0, -2) as string[];
      const m = groups as RegExpMatchArray;
      const value = m[m.length - 1];
      // не считаем секретом пустое/уже замаскированное значение
      if (!value || value.includes('•')) return m[0]!;
      hasSecret = true;
      return rule.replace(m);
    });
  }
  return { masked, hasSecret };
}
