import type { Client, ClientChannel } from 'ssh2';

/**
 * Канал bastion→target через уже установленное соединение с bastion (SSH-05).
 * Адрес источника ssh2 передаёт серверу лишь как справочный (в OpenSSH это
 * локальный конец форварда) — реального сокета за ним нет.
 *
 * Общая для `sessionManager.ts` (реальные сессии) и `testConnection.ts`
 * (кнопка «Проверить подключение») — раньше была продублирована в обоих
 * файлах дословно. `Pick<Client, 'forwardOut'>` — чтобы принимать и настоящий
 * `ssh2.Client`, и фейковые Client'ы из тестов обоих файлов без приведения типов.
 */
export function forwardOut(
  client: Pick<Client, 'forwardOut'>,
  address: string,
  port: number
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, address, port, (err, channel) => {
      if (err || !channel) reject(err ?? new Error('forwardOut: no channel'));
      else resolve(channel);
    });
  });
}
