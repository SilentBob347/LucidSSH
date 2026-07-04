import keytar from 'keytar';

/**
 * Единственное место работы с секретами (SEC-01, §10 Security_Guide).
 * Пароли и passphrase — только в Windows Credential Manager под ключом
 * LucidSSH/{hostId}. Значение секрета НИКОГДА не уходит в renderer:
 * наружу отдаётся только факт наличия (hasSecret).
 */

const CRED_SERVICE = 'LucidSSH';

export async function setSecret(hostId: number, secret: string): Promise<void> {
  await keytar.setPassword(CRED_SERVICE, String(hostId), secret);
}

/** Только для main (подключение SSH). Не подключать к IPC-ответам. */
export async function getSecretForConnection(hostId: number): Promise<string | null> {
  return keytar.getPassword(CRED_SERVICE, String(hostId));
}

export async function hasSecret(hostId: number): Promise<boolean> {
  return (await keytar.getPassword(CRED_SERVICE, String(hostId))) !== null;
}

export async function deleteSecret(hostId: number): Promise<void> {
  await keytar.deletePassword(CRED_SERVICE, String(hostId));
}
