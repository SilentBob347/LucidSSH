import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedHost } from '@shared/import';

/**
 * applyExternalImport — резолв ProxyJump-алиаса при импорте из ~/.ssh/config
 * (SSH-05, тикет 06, .scratch/jump-host-support). Тот же приём мока electron,
 * что и repository.test.ts.
 */
let dir = '';
vi.mock('electron', () => ({
  app: {
    getPath: () => dir,
    getVersion: () => '1.2.3-test'
  }
}));

async function fresh(): Promise<{
  applyExternalImport: typeof import('./externalImport').applyExternalImport;
  repo: typeof import('./repository');
}> {
  vi.resetModules();
  const { applyExternalImport } = await import('./externalImport');
  const repo = await import('./repository');
  return { applyExternalImport, repo };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lucidssh-external-import-test-'));
});

afterEach(async () => {
  const { closeHostsDb } = await import('./db');
  closeHostsDb();
  rmSync(dir, { recursive: true, force: true });
});

function host(overrides: Partial<ImportedHost>): ImportedHost {
  return {
    name: 'host',
    address: '203.0.113.10',
    port: 22,
    username: 'root',
    authMethod: 'password',
    ...overrides
  };
}

describe('applyExternalImport — резолв ProxyJump', () => {
  it('резолвит алиас на уже существующий хост', async () => {
    const { applyExternalImport, repo } = await fresh();
    const bastionId = repo.createHost({
      name: 'bastion',
      address: '198.51.100.1',
      port: 22,
      username: 'root',
      authMethod: 'password',
      guardEnabled: true
    });

    const res = applyExternalImport(
      [host({ name: 'prod-db', address: '203.0.113.20', proxyJump: 'bastion' })],
      'skip'
    );

    expect(res.imported).toBe(1);
    expect(res.unresolvedProxyJump).toEqual([]);
    const created = repo.listHosts().find((h) => h.name === 'prod-db');
    expect(created?.proxyJumpHostId).toBe(bastionId);
  });

  it('резолвит алиас на хост из этого же батча импорта', async () => {
    const { applyExternalImport, repo } = await fresh();

    const res = applyExternalImport(
      [
        host({ name: 'prod-db', address: '203.0.113.20', proxyJump: 'bastion' }),
        host({ name: 'bastion', address: '198.51.100.1' })
      ],
      'skip'
    );

    expect(res.imported).toBe(2);
    expect(res.unresolvedProxyJump).toEqual([]);
    const bastion = repo.listHosts().find((h) => h.name === 'bastion')!;
    const prodDb = repo.listHosts().find((h) => h.name === 'prod-db')!;
    expect(prodDb.proxyJumpHostId).toBe(bastion.id);
  });

  it('помечает как unresolved, если алиас ни на что не совпал', async () => {
    const { applyExternalImport, repo } = await fresh();

    const res = applyExternalImport(
      [host({ name: 'prod-db', address: '203.0.113.20', proxyJump: 'unknown-alias' })],
      'skip'
    );

    expect(res.imported).toBe(1);
    expect(res.unresolvedProxyJump).toEqual(['prod-db']);
    const created = repo.listHosts().find((h) => h.name === 'prod-db');
    expect(created?.proxyJumpHostId).toBeUndefined();
  });

  it('хосты без ProxyJump не попадают ни в резолв, ни в unresolved', async () => {
    const { applyExternalImport } = await fresh();

    const res = applyExternalImport(
      [host({ name: 'plain', address: '203.0.113.30' })],
      'skip'
    );

    expect(res.imported).toBe(1);
    expect(res.unresolvedProxyJump).toEqual([]);
  });
});
