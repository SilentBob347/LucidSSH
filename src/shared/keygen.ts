/**
 * Мастер создания SSH-ключа (HM-12): типы IPC-контракта renderer ↔ main.
 * Сама генерация и дозапись на сервер — в src/main/ssh/keygen.ts.
 */

export interface KeygenGenerateRequest {
  /** Имя хоста из формы; может быть пустым — тогда slug берётся из user/address. */
  name: string;
  address: string;
  port: number;
  username: string;
}

export type KeygenGenerateResult =
  | { ok: true; keyPath: string; publicKey: string }
  | { ok: false; reason: 'keygen-missing' | 'failed' };

/**
 * Публичный ключ, ожидающий дозаписи в authorized_keys сервера после первого
 * пароль-логина. Хранится в config.json (не секрет — публичный ключ и так
 * предназначен для передачи на сервер), чтобы пережить перезапуск приложения
 * между мастером и первым входом — иначе последующее подключение уходит по
 * ключу напрямую (которого ещё нет на сервере) и сразу проваливает auth.
 *
 * Идентификатор записи — `keyPath` (путь к приватному файлу ключа), а не
 * адрес/порт/пользователь хоста: путь приходит из мастера в форму и НЕ меняется,
 * даже если пользователь потом отредактирует адрес/пользователя до сохранения
 * хоста; привязка к серверной тройке сиротела бы при такой правке.
 */
export interface PendingKeyDeployment {
  keyPath: string;
  publicKey: string;
}

/** Минимальная длина passphrase — ограничение самого ssh-keygen (общее для
 *  UI-валидации мастера и IPC-валидации в main). */
export const PASSPHRASE_MIN = 5;
