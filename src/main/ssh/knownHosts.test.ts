import { describe, expect, it } from 'vitest';
import { parseKnownHosts, sha256Fingerprint } from './knownHosts';

describe('parseKnownHosts', () => {
  it('парсит стандартные строки OpenSSH', () => {
    const content = [
      '# comment',
      '',
      'example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIabc',
      '[10.0.0.1]:2222 ssh-rsa AAAAB3NzaC1yc2Eabc extra-comment'
    ].join('\n');
    const entries = parseKnownHosts(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      hostPattern: 'example.com',
      keyType: 'ssh-ed25519',
      keyBase64: 'AAAAC3NzaC1lZDI1NTE5AAAAIabc'
    });
    expect(entries[1]).toMatchObject({
      hostPattern: '[10.0.0.1]:2222',
      keyType: 'ssh-rsa'
    });
  });

  it('игнорирует мусорные строки, не падая', () => {
    const entries = parseKnownHosts('malformed\ngarbage line here without key\n');
    expect(entries.filter((e) => e.keyType.startsWith('ssh'))).toHaveLength(0);
  });
});

describe('sha256Fingerprint', () => {
  it('формат SHA256:base64 без паддинга', () => {
    const fp = sha256Fingerprint(Buffer.from('test-key-blob'));
    expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(fp).not.toContain('=');
  });

  it('детерминирован и различает ключи', () => {
    const a = sha256Fingerprint(Buffer.from('key-a'));
    expect(a).toBe(sha256Fingerprint(Buffer.from('key-a')));
    expect(a).not.toBe(sha256Fingerprint(Buffer.from('key-b')));
  });
});
