import type { Host } from '@shared/hosts';

/**
 * Разрешение алиаса ProxyJump/старого текстового proxy_jump в id хоста —
 * точное совпадение по `name`, с учётом регистра (Jump-хост, спека §"Резолв
 * по имени"). Используется миграцией БД (db.ts) и резолвом при импорте.
 */
export function resolveHostRefByName(
  hosts: Array<Pick<Host, 'id' | 'name'>>,
  name: string
): number | null {
  const match = hosts.find((h) => h.name === name);
  return match ? match.id : null;
}

/**
 * Подбор свободного имени «name (2)», «name (3)»… без запроса в БД на кандидата.
 * `used` пополняется выданными именами; счётчик на базу не даёт квадратичного
 * перебора при тысячах одинаковых имён.
 */
export function createNamePicker(used: Set<string>): (base: string) => string {
  const next = new Map<string, number>();
  return (base) => {
    let candidate = base;
    let n = next.get(base) ?? 2;
    while (used.has(candidate)) candidate = `${base} (${n++})`;
    next.set(base, n);
    used.add(candidate);
    return candidate;
  };
}
