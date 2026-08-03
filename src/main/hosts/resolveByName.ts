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
