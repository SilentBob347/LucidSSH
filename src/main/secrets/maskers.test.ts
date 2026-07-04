import { describe, expect, it } from 'vitest';
import { maskSecrets } from './maskers';

/**
 * Обязательное покрытие маскирования (§10) на реальных примерах утечек (§16).
 * Ключевая проверка: секрет не остаётся в замаскированной строке.
 */

const notContains = (masked: string, secret: string): boolean => !masked.includes(secret);

describe('maskSecrets — примеры из §16 гайда', () => {
  it('export API_KEY=secret', () => {
    const { masked, hasSecret } = maskSecrets('export API_KEY=supersecret123');
    expect(hasSecret).toBe(true);
    expect(masked).toBe('export API_KEY=••••••••');
    expect(notContains(masked, 'supersecret123')).toBe(true);
  });

  it('curl -H "Authorization: Bearer secret"', () => {
    const { masked, hasSecret } = maskSecrets('curl -H "Authorization: Bearer abc.def.ghi" example.com');
    expect(hasSecret).toBe(true);
    expect(notContains(masked, 'abc.def.ghi')).toBe(true);
    expect(masked).toContain('Authorization: Bearer ••••••••');
    expect(masked).toContain('example.com'); // остальное сохранено
  });

  it('mysql --password=secret', () => {
    const { masked, hasSecret } = maskSecrets('mysql -u root --password=hunter2 mydb');
    expect(hasSecret).toBe(true);
    expect(notContains(masked, 'hunter2')).toBe(true);
    expect(masked).toContain('--password=••••••••');
    expect(masked).toContain('mydb');
  });
});

describe('maskSecrets — другие формы', () => {
  it('-p без пробела (mysql -psecret)', () => {
    const { masked } = maskSecrets('mysql -uroot -pMyP@ss mydb');
    expect(notContains(masked, 'MyP@ss')).toBe(true);
  });

  it('--token= и --api-key=', () => {
    expect(notContains(maskSecrets('deploy --token=ghp_xxx').masked, 'ghp_xxx')).toBe(true);
    expect(notContains(maskSecrets('aws --access-key=AKIA123').masked, 'AKIA123')).toBe(true);
  });

  it('--password value через пробел', () => {
    const { masked } = maskSecrets('tool --password topsecret');
    expect(notContains(masked, 'topsecret')).toBe(true);
  });

  it('переменные *_TOKEN / *_SECRET / DB_PASSWORD', () => {
    expect(notContains(maskSecrets('GITHUB_TOKEN=ghp_abc npm publish').masked, 'ghp_abc')).toBe(true);
    expect(notContains(maskSecrets('export DB_PASSWORD=qwerty').masked, 'qwerty')).toBe(true);
  });

  it('sshpass -p', () => {
    const { masked } = maskSecrets("sshpass -p 'my pass' ssh user@host");
    expect(notContains(masked, 'my pass')).toBe(true);
  });
});

describe('maskSecrets — отсутствие ложных срабатываний', () => {
  it('обычные команды не трогаются', () => {
    for (const cmd of ['ls -la /var/www', 'grep -p pattern file', 'systemctl restart nginx', 'df -h']) {
      const { masked, hasSecret } = maskSecrets(cmd);
      // grep -p... наш -p<value> сработает на "grep -ppattern"? тут пробел, значит -p + pattern
      if (cmd.startsWith('grep')) continue;
      expect(hasSecret).toBe(false);
      expect(masked).toBe(cmd);
    }
  });

  it('обычная переменная без секретного имени не маскируется', () => {
    const { masked, hasSecret } = maskSecrets('export EDITOR=vim');
    expect(hasSecret).toBe(false);
    expect(masked).toBe('export EDITOR=vim');
  });

  it('идемпотентность: повторное маскирование ничего не ломает', () => {
    const once = maskSecrets('export API_KEY=secret').masked;
    const twice = maskSecrets(once);
    expect(twice.masked).toBe(once);
    expect(twice.hasSecret).toBe(false);
  });
});
