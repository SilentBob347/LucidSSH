import { describe, it, expect } from 'vitest';
import { parseWinScpIni } from './winscpImport';

const INI = `
[Configuration\\Interface]
ConfirmOverwriting=0

[Sessions\\Prod%20Web]
HostName=10.0.0.5
PortNumber=22
UserName=root
PublicKeyFile=C:\\keys\\id_ed25519.ppk
FSProtocol=0
Password=A1B2C3D4
PasswordFormat=1

[Sessions\\Legacy%20FTP]
HostName=old.example
PortNumber=21
UserName=anon
FSProtocol=2

[Sessions\\NoProtocolField]
HostName=192.168.1.10
UserName=admin

[Sessions\\Default%20Settings]
HostName=
`;

describe('parseWinScpIni', () => {
  it('импортирует SFTP/SCP-сессии с адресом/портом/пользователем/ключом', () => {
    const result = parseWinScpIni(INI);
    const prod = result.hosts.find((h) => h.name === 'Prod Web');
    expect(prod).toBeDefined();
    expect(prod).toMatchObject({
      address: '10.0.0.5',
      port: 22,
      username: 'root',
      authMethod: 'key',
      keyPath: 'C:\\keys\\id_ed25519.ppk'
    });
  });

  it('никогда не выносит Password/PasswordFormat в результат', () => {
    const result = parseWinScpIni(INI);
    const json = JSON.stringify(result);
    expect(json).not.toContain('A1B2C3D4');
    expect(json.toLowerCase()).not.toContain('passwordformat');
  });

  it('URL-декодирует имя сессии', () => {
    const result = parseWinScpIni(INI);
    expect(result.hosts.map((h) => h.name)).toContain('Prod Web');
  });

  it('исключает FTP-сессии (FSProtocol=2)', () => {
    const result = parseWinScpIni(INI);
    expect(result.hosts.find((h) => h.name === 'Legacy FTP')).toBeUndefined();
  });

  it('без FSProtocol считает сессию SFTP и импортирует', () => {
    const result = parseWinScpIni(INI);
    expect(result.hosts.find((h) => h.name === 'NoProtocolField')).toBeDefined();
  });

  it('пропускает Default Settings и пустой ввод', () => {
    expect(parseWinScpIni(INI).hosts.find((h) => h.name === 'Default Settings')).toBeUndefined();
    expect(parseWinScpIni('').hosts).toEqual([]);
  });
});
