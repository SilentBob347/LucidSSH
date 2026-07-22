import { describe, expect, it, vi } from 'vitest';
import type { Host, HostGroup } from '@shared/hosts';

const hostExists = vi.fn<(address: string, username: string) => boolean>(() => false);
vi.mock('./repository', () => ({
  hostExists: (address: string, username: string) => hostExists(address, username)
}));
vi.mock('./keyFile', () => ({
  keyFileExists: (path: string) => path === 'C:\\keys\\id_ed25519'
}));

const { buildExport, EXPORT_FORMAT, EXPORT_VERSION, parseImportFile, previewImport } =
  await import('./exportImport');

const host: Host = {
  id: 1,
  name: 'web-01',
  address: '203.0.113.10',
  port: 22,
  username: 'root',
  authMethod: 'key',
  keyPath: 'C:\\keys\\id_ed25519',
  groupId: 5,
  guardEnabled: true,
  sortOrder: 0,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z'
};

const group: HostGroup = {
  id: 5,
  name: 'PROD',
  sortOrder: 0,
  collapsed: false,
  createdAt: '2026-07-01T00:00:00Z'
};

describe('buildExport (EXP-01)', () => {
  it('не содержит полей с секретами', () => {
    const out = buildExport([host], [group]);
    const json = JSON.stringify(out).toLowerCase();
    for (const forbidden of ['password', 'passphrase', 'secret', 'privatekey']) {
      expect(json).not.toContain(forbidden);
    }
    // путь к ключу — единственная допустимая ссылка (EXP-01)
    expect(out.hosts[0]?.keyPath).toBe('C:\\keys\\id_ed25519');
    expect(out.hosts[0]?.group).toBe('PROD');
  });
});

describe('parseImportFile (EXP-04)', () => {
  const validFile = JSON.stringify(buildExport([host], [group]));

  it('принимает собственный экспорт (round-trip)', () => {
    const { hosts, groups } = parseImportFile(validFile);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.name).toBe('web-01');
    expect(groups).toEqual(['PROD']);
  });

  it('отклоняет не-JSON и чужой формат', () => {
    expect(() => parseImportFile('not json at all')).toThrow();
    expect(() => parseImportFile('{"hosts": []}')).toThrow(); // нет format
    expect(() => parseImportFile('[]')).toThrow();
    expect(() =>
      parseImportFile(JSON.stringify({ format: 'other', version: 1, hosts: [] }))
    ).toThrow();
  });

  it('отклоняет версию новее поддерживаемой', () => {
    expect(() =>
      parseImportFile(
        JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION + 1, hosts: [] })
      )
    ).toThrow();
  });

  it('отклоняет хост с некорректными полями (та же валидация, что и IPC)', () => {
    const bad = JSON.stringify({
      format: EXPORT_FORMAT,
      version: 1,
      hosts: [{ name: 'x', address: 'evil;rm -rf /', port: 22, username: 'root', authMethod: 'password' }]
    });
    expect(() => parseImportFile(bad)).toThrow();
  });

  it('не исполняет содержимое: поля-строки остаются данными', () => {
    const sneaky = JSON.stringify({
      format: EXPORT_FORMAT,
      version: 1,
      hosts: [
        {
          name: '<script>alert(1)</script>',
          address: 'example.com',
          port: 22,
          username: 'root',
          authMethod: 'password',
          note: 'require("child_process")'
        }
      ]
    });
    const { hosts } = parseImportFile(sneaky);
    expect(hosts[0]?.name).toBe('<script>alert(1)</script>'); // просто строка
  });
});

describe('previewImport (тикет 03 — предупреждение про ключи)', () => {
  it('считает хостов с методом «ключ», чей файл не найден на этом ПК', () => {
    const missingKeyHost: Host = { ...host, id: 2, keyPath: 'C:\\keys\\missing' };
    const file = JSON.stringify(buildExport([host, missingKeyHost], [group]));
    const preview = previewImport(file);
    expect(preview.missingKeyCount).toBe(1);
    expect(preview.toAdd).toBe(2);
  });

  it('не считает хосты с методом «пароль», даже если keyPath не задан', () => {
    const passwordHost: Host = { ...host, id: 3, authMethod: 'password', keyPath: undefined };
    const file = JSON.stringify(buildExport([passwordHost], [group]));
    const preview = previewImport(file);
    expect(preview.missingKeyCount).toBe(0);
  });

  it('счётчик равен 0, если у всех key-хостов файл ключа найден', () => {
    const file = JSON.stringify(buildExport([host], [group]));
    const preview = previewImport(file);
    expect(preview.missingKeyCount).toBe(0);
  });

  it('не считает конфликтующий (toSkip) хост — он может не импортироваться вовсе', () => {
    hostExists.mockReturnValueOnce(true); // этот хост уйдёт в conflicts, не в toAdd
    const missingKeyHost: Host = { ...host, id: 2, keyPath: 'C:\\keys\\missing' };
    const file = JSON.stringify(buildExport([missingKeyHost], [group]));
    const preview = previewImport(file);
    expect(preview.toSkip).toBe(1);
    expect(preview.missingKeyCount).toBe(0);
  });
});
