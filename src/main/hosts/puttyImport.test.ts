import { describe, it, expect } from 'vitest';
import { parseRegOutput } from './puttyImport';

// Типичный вывод `reg query <Sessions> /s` (сессии PuTTY).
const REG_OUTPUT = `
HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions
HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Prod%20Web
    HostName    REG_SZ    10.0.0.5
    PortNumber    REG_DWORD    0x16
    UserName    REG_SZ    root
    Protocol    REG_SZ    ssh
    PublicKeyFile    REG_SZ    C:\\keys\\id_ed25519.ppk

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Legacy
    HostName    REG_SZ    old.example
    PortNumber    REG_DWORD    0x22b8
    Protocol    REG_SZ    telnet
`;

describe('parseRegOutput', () => {
  it('разбирает сессии и URL-декодирует имена', () => {
    const sessions = parseRegOutput(REG_OUTPUT);
    const names = sessions.map((s) => s.name);
    expect(names).toContain('Prod Web'); // %20 → пробел
    expect(names).toContain('Legacy');
    // Корневой ключ Sessions без имени сессии не попадает в список
    expect(names).not.toContain('Sessions');
  });

  it('извлекает значения HostName/PortNumber/UserName/Protocol/PublicKeyFile', () => {
    const prod = parseRegOutput(REG_OUTPUT).find((s) => s.name === 'Prod Web')!;
    expect(prod.values.get('HostName')).toBe('10.0.0.5');
    expect(prod.values.get('PortNumber')).toBe('0x16');
    expect(prod.values.get('UserName')).toBe('root');
    expect(prod.values.get('Protocol')).toBe('ssh');
    expect(prod.values.get('PublicKeyFile')).toBe('C:\\keys\\id_ed25519.ppk');
  });

  it('не падает на пустом выводе', () => {
    expect(parseRegOutput('')).toEqual([]);
  });
});
