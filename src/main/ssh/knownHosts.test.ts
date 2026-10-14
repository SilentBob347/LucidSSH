import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = vi.hoisted(() => ({ path: '' }));
vi.mock('../config/store', () => ({ configDir: () => dir.path }));

import { parseKnownHosts, preferredHostKeyAlgorithms, sha256Fingerprint } from './knownHosts';

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

describe('preferredHostKeyAlgorithms', () => {
  beforeEach(() => {
    dir.path = mkdtempSync(join(tmpdir(), 'lucidssh-knownhosts-'));
  });

  afterEach(() => {
    rmSync(dir.path, { recursive: true, force: true });
  });

  function writeKnownHosts(lines: string[]): void {
    writeFileSync(join(dir.path, 'known_hosts'), lines.join('\n') + '\n', 'utf8');
  }

  it('неизвестный хост → пусто (ssh2 согласует по своему списку по умолчанию)', () => {
    writeKnownHosts(['10.0.0.7 ssh-ed25519 AAAA']);

    expect(preferredHostKeyAlgorithms('10.0.0.5', 22)).toEqual([]);
  });

  it('алгоритмы доверенных ключей хоста; ssh-rsa раскрывается в три RSA-алгоритма', () => {
    writeKnownHosts(['10.0.0.5 ssh-rsa AAAA', '10.0.0.5 ecdsa-sha2-nistp256 BBBB', '[10.0.0.5]:2222 ssh-ed25519 CCCC']);

    expect(preferredHostKeyAlgorithms('10.0.0.5', 22)).toEqual([
      'ecdsa-sha2-nistp256',
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-rsa'
    ]);
  });

  it('мусорный тип и ssh-dss отбрасываются', () => {
    writeKnownHosts(['10.0.0.5 garbage-type AAAA', '10.0.0.5 ssh-dss BBBB', '10.0.0.5 ssh-ed25519 CCCC']);

    expect(preferredHostKeyAlgorithms('10.0.0.5', 22)).toEqual(['ssh-ed25519']);
  });
});
