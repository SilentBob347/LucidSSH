import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingKeyDeployment } from '@shared/keygen';

// keygen.ts персистирует «ожидающие дозаписи» ключи в config.json (переживает
// перезапуск приложения — реальный пользователь может закрыть LucidSSH между
// мастером и первым входом по паролю), поэтому config/store мокается тем же
// приёмом, что и в sessionManager.test.ts: фальшивое хранилище в замыкании
// фабрики, без реального fs/Electron.
vi.mock('../config/store', () => {
  const state = { pendingKeyDeployments: [] as PendingKeyDeployment[] };
  return {
    __state: state,
    loadConfig: () => state,
    updateConfig: (mutator: (cfg: typeof state) => void) => {
      mutator(state);
      return state;
    }
  };
});

import {
  __clearPendingDeploymentsForTest,
  authorizedKeysContains,
  buildAppendCommand,
  hasPendingDeployment,
  isSafePublicKeyLine,
  keyFileSlug,
  registerPendingDeployment
} from './keygen';

/** Тесты HM-12: логика вокруг реальных системных вызовов (ssh-keygen.exe и
 *  exec-канал живой проверкой не покрываются) — slug имени файла, валидация
 *  строки публичного ключа, дедупликация в authorized_keys, реестр ожидающих
 *  дозаписей (Testing Decisions спеки release-1.0-remaining-features). */

const KEY_LINE =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFa2ke1vYtOWma8XPeCBAbcXAdmYRWFRW21NRBFukhsJ deploy@example.com';

describe('keyFileSlug', () => {
  it('берёт slug из имени хоста, если оно введено', () => {
    expect(keyFileSlug('Мой сервер VPS-1', 'root', '203.0.113.5')).toBe('vps-1');
  });

  it('латинское имя санитизируется и приводится к нижнему регистру', () => {
    expect(keyFileSlug('Prod Server #2', 'root', 'example.com')).toBe('prod_server_2');
  });

  it('без имени — из пользователя и адреса', () => {
    expect(keyFileSlug('', 'deploy', 'example.com')).toBe('deploy_example.com');
    expect(keyFileSlug('   ', 'root', '203.0.113.5')).toBe('root_203.0.113.5');
  });

  it('пустой результат санитизации заменяется на key', () => {
    expect(keyFileSlug('Сервер', '', '')).toBe('key');
    expect(keyFileSlug('', '', '')).toBe('key');
  });

  it('обрезается до 40 символов', () => {
    expect(keyFileSlug('a'.repeat(80), 'u', 'h').length).toBeLessThanOrEqual(40);
  });
});

describe('isSafePublicKeyLine', () => {
  it('принимает нормальную строку ed25519 с комментарием', () => {
    expect(isSafePublicKeyLine(KEY_LINE)).toBe(true);
  });

  it('принимает строку без комментария', () => {
    expect(isSafePublicKeyLine('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFa2ke1vYtOW')).toBe(true);
  });

  it('отклоняет другой тип ключа', () => {
    expect(isSafePublicKeyLine('ssh-rsa AAAAB3NzaC1yc2E comment')).toBe(false);
  });

  it('отклоняет кавычки, перевод строки и прочие опасные символы', () => {
    expect(isSafePublicKeyLine("ssh-ed25519 AAAA' ; rm -rf /")).toBe(false);
    expect(isSafePublicKeyLine('ssh-ed25519 AAAA\nssh-ed25519 BBBB')).toBe(false);
    expect(isSafePublicKeyLine('ssh-ed25519 AAAA `id`')).toBe(false);
  });
});

describe('authorizedKeysContains', () => {
  it('находит ключ среди других строк', () => {
    const file = `ssh-rsa AAAABBBB old@pc\n${KEY_LINE}\nssh-ed25519 CCCC other@pc\n`;
    expect(authorizedKeysContains(file, KEY_LINE)).toBe(true);
  });

  it('не находит отсутствующий ключ (в т.ч. с другим комментарием)', () => {
    const other = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFa2ke1vYtOWma8XPeCBAbcXAdmYRWFRW21NRBFukhsJ another@pc';
    expect(authorizedKeysContains(other, KEY_LINE)).toBe(false);
    expect(authorizedKeysContains('', KEY_LINE)).toBe(false);
  });

  it('терпит CRLF, хвостовые пробелы и лишние пробелы между полями', () => {
    const file = `# comment\r\n  ${KEY_LINE.replace(' ', '   ')}  \r\n`;
    expect(authorizedKeysContains(file, KEY_LINE)).toBe(true);
  });

  it('пустая искомая строка не совпадает с пустыми строками файла', () => {
    expect(authorizedKeysContains('\n\n', '')).toBe(false);
  });
});

describe('buildAppendCommand', () => {
  it('оборачивает ключ в одинарные кавычки и дописывает в authorized_keys', () => {
    expect(buildAppendCommand(KEY_LINE)).toBe(
      `printf '%s\n' '${KEY_LINE}' >> ~/.ssh/authorized_keys`
    );
  });
});

describe('реестр ожидающих дозаписей', () => {
  const KEY_PATH = 'C:\\Users\\u\\.ssh\\id_ed25519_web';

  afterEach(() => __clearPendingDeploymentsForTest());

  it('регистрация видна по keyPath', () => {
    registerPendingDeployment({ keyPath: KEY_PATH, publicKey: KEY_LINE });
    expect(hasPendingDeployment(KEY_PATH)).toBe(true);
    expect(hasPendingDeployment('C:\\Users\\u\\.ssh\\id_ed25519_other')).toBe(false);
  });

  it('повторная регистрация того же keyPath заменяет запись, а не дублирует её', async () => {
    registerPendingDeployment({ keyPath: KEY_PATH, publicKey: KEY_LINE });
    registerPendingDeployment({ keyPath: KEY_PATH, publicKey: 'ssh-ed25519 BBBB deploy@example.com' });
    const { __state } = (await import('../config/store')) as unknown as {
      __state: { pendingKeyDeployments: unknown[] };
    };
    expect(__state.pendingKeyDeployments).toHaveLength(1);
  });
});
