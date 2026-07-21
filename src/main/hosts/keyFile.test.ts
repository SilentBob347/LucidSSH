import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyFileExists } from './keyFile';

describe('keyFileExists', () => {
  it('возвращает true для существующего файла', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lucidssh-keyfile-'));
    const file = join(dir, 'id_ed25519');
    writeFileSync(file, 'fake key');
    expect(keyFileExists(file)).toBe(true);
  });

  it('возвращает false для несуществующего пути', () => {
    expect(keyFileExists('C:\\does\\not\\exist\\id_ed25519')).toBe(false);
  });

  it('возвращает false для пустой строки', () => {
    expect(keyFileExists('')).toBe(false);
    expect(keyFileExists('   ')).toBe(false);
  });

  it('возвращает false для директории', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lucidssh-keyfile-dir-'));
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    expect(keyFileExists(sub)).toBe(false);
  });
});
