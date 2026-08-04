import type { TFunction } from 'i18next';
import type { ConnectionLogEntry } from '@shared/ssh';

/**
 * Оборачивает уже переведённый текст префиксом bastion (SSH-05), если запись
 * относится к первому хопу — общий хелпер для «Деталей подключения»,
 * степпера (CLOG-04) и результата «Проверить соединение», чтобы формат
 * префикса не разъезжался между местами, где он используется.
 */
export function wrapJumpStep(t: TFunction, step: string | undefined, text: string): string {
  return step === 'jump' ? t('clog.jumpLine', { text }) : text;
}

/**
 * Текст записи лога соединения (CLOG-01…03) — общий для «Деталей подключения»
 * и строки ошибки в степпере (CLOG-04), чтобы одна и та же запись читалась
 * одинаково в обоих местах.
 *
 * Записи первого хопа (`step: 'jump'`, SSH-05) помечаются префиксом: у bastion
 * и целевого хоста общие ключи для greeting/handshake/fingerprint, и без
 * пометки пользователь видел бы два подряд идущих одинаковых сообщения — ровно
 * то, чего требовалось избежать.
 */
export function formatLogEntry(t: TFunction, entry: ConnectionLogEntry): string {
  return wrapJumpStep(t, entry.step, t(entry.messageKey, entry.params));
}
