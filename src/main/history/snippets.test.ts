import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ручной порядок сниппетов (SNIP-10). Тот же приём мока electron, что и в
 * config/store.test.ts — configDir() = app.getPath('userData').
 */
let dir = '';
vi.mock('electron', () => ({
  app: {
    getPath: () => dir,
    getVersion: () => '1.2.3-test'
  }
}));

async function freshSnippets(): Promise<typeof import('./snippets')> {
  vi.resetModules();
  return import('./snippets');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lucidssh-snippets-test-'));
});

afterEach(async () => {
  const { closeHistoryDb } = await import('./db');
  closeHistoryDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('reorderSnippets / listSnippets order', () => {
  it('новый сниппет получает sort_order=0 и сортируется по имени среди таких же', async () => {
    const { createSnippet, listSnippets } = await freshSnippets();
    createSnippet({ name: 'Zeta', command: 'echo z' });
    createSnippet({ name: 'Alpha', command: 'echo a' });
    const names = listSnippets().map((s) => s.name);
    expect(names).toEqual(['Alpha', 'Zeta']);
  });

  it('reorderSnippets переставляет ручной порядок и переживает его в listSnippets', async () => {
    const { createSnippet, listSnippets, reorderSnippets } = await freshSnippets();
    const a = createSnippet({ name: 'Alpha', command: 'echo a' }).id;
    const b = createSnippet({ name: 'Beta', command: 'echo b' }).id;
    const c = createSnippet({ name: 'Gamma', command: 'echo c' }).id;

    reorderSnippets([c, a, b]);

    const ordered = listSnippets().map((s) => s.id);
    expect(ordered).toEqual([c, a, b]);
  });

  it('серверные и глобальные сниппеты сортируются раздельно (SNIP-06 + SNIP-10)', async () => {
    const { createSnippet, listSnippets, reorderSnippets } = await freshSnippets();
    const g1 = createSnippet({ name: 'Global One', command: 'echo g1' }).id;
    const g2 = createSnippet({ name: 'Global Two', command: 'echo g2' }).id;
    const s1 = createSnippet({ name: 'Server One', command: 'echo s1', hostId: 42 }).id;
    const s2 = createSnippet({ name: 'Server Two', command: 'echo s2', hostId: 42 }).id;

    reorderSnippets([g2, g1]);
    reorderSnippets([s2, s1]);

    const forHost = listSnippets(42).map((s) => s.id);
    // Серверные первыми (SNIP-06), внутри каждой группы — ручной порядок
    expect(forHost).toEqual([s2, s1, g2, g1]);
  });

  it('reorderSnippets сама не проверяет scope (валидация — в IPC-хендлере, не здесь)', async () => {
    const { createSnippet, reorderSnippets, listSnippets } = await freshSnippets();
    const a = createSnippet({ name: 'A', command: 'echo a' }).id;
    const b = createSnippet({ name: 'B', command: 'echo b', hostId: 1 }).id;
    reorderSnippets([b, a]);
    expect(listSnippets().map((s) => s.id)).toContain(a);
    expect(listSnippets(1).map((s) => s.id)).toContain(b);
  });
});

describe('findDuplicateSnippet', () => {
  it('находит дубликат по совпадению команды в том же скоупе', async () => {
    const { createSnippet, findDuplicateSnippet } = await freshSnippets();
    createSnippet({ name: 'Disk usage', command: 'df -h' });
    const dup = findDuplicateSnippet('df -h');
    expect(dup?.name).toBe('Disk usage');
  });

  it('не считает дубликатом ту же команду в другом скоупе', async () => {
    const { createSnippet, findDuplicateSnippet } = await freshSnippets();
    createSnippet({ name: 'Disk usage global', command: 'df -h' });
    const dup = findDuplicateSnippet('df -h', 42);
    expect(dup).toBeNull();
  });

  it('исключает сам редактируемый сниппет через excludeId', async () => {
    const { createSnippet, findDuplicateSnippet } = await freshSnippets();
    const id = createSnippet({ name: 'Disk usage', command: 'df -h' }).id;
    expect(findDuplicateSnippet('df -h', undefined, id)).toBeNull();
  });

  it('сравнивает по замаскированной команде — секрет в разном виде всё равно совпадает', async () => {
    const { createSnippet, findDuplicateSnippet } = await freshSnippets();
    createSnippet({ name: 'Login', command: 'curl -H "Authorization: Bearer abc123" x.com' });
    const dup = findDuplicateSnippet('curl -H "Authorization: Bearer xyz789" x.com');
    expect(dup?.name).toBe('Login');
  });
});
