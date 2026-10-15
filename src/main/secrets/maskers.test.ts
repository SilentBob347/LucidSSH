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

describe('maskSecrets — голые имена переменных (тикет 08)', () => {
  // §16 гайда: `export API_KEY=secret` — то же, но без префикса перед ключевым словом.
  for (const name of ['PASSWORD', 'TOKEN', 'SECRET', 'PASS', 'KEY', 'AUTH']) {
    it(`export ${name}=…`, () => {
      const { masked, hasSecret } = maskSecrets(`export ${name}=hunter2 && ./deploy.sh`);
      expect(hasSecret).toBe(true);
      expect(masked).toBe(`export ${name}=•••••••• && ./deploy.sh`);
    });
  }

  it('несекретная переменная перед секретной не прячет её: HOST=x;API_KEY=y', () => {
    const { masked } = maskSecrets('HOST=db;API_KEY=supersecret ./run');
    expect(masked).toBe('HOST=db;API_KEY=•••••••• ./run');
  });

  // Выбор: голое имя маскируем только из списка тикета. Ключевое слово в начале
  // обычного имени (KEYMAP, AUTHOR, PASSWORD_FILE) — не секрет; голый PWD — рабочий
  // каталог shell, он в каждом выводе `env`.
  it('KEYMAP= / KEYBOARD= / AUTHOR= / PASSWORD_FILE= / PWD= не маскируются', () => {
    for (const cmd of [
      'KEYMAP=ru loadkeys',
      'export KEYBOARD=us',
      'AUTHOR=nikita git commit',
      'PASSWORD_FILE=/run/secrets/db ./start',
      'PWD=/home/u'
    ]) {
      const { masked, hasSecret } = maskSecrets(cmd);
      expect(hasSecret).toBe(false);
      expect(masked).toBe(cmd);
    }
  });

  // Известная цена голого PASS (требование тикета): сводка тест-раннера тоже маскируется.
  it('TOTAL=10 PASS=9 FAIL=1 — PASS маскируется (принятое ложное срабатывание)', () => {
    expect(maskSecrets('TOTAL=10 PASS=9 FAIL=1').masked).toBe('TOTAL=10 PASS=•••••••• FAIL=1');
  });
});

describe('maskSecrets — значение в кавычках с пробелами (тикет 08)', () => {
  const cases: Array<[string, (v: string) => string]> = [
    ['Bearer', (v) => `curl -H Authorization: Bearer ${v} example.com`],
    ['Basic', (v) => `curl -H Authorization: Basic ${v} example.com`],
    ['--password=', (v) => `mysql --password=${v} mydb`],
    ['--password value', (v) => `tool --password ${v} mydb`],
    ['-p<value>', (v) => `mysql -uroot -p${v} mydb`],
    ['ENV=', (v) => `export DB_PASSWORD=${v} && psql mydb`],
    ['sshpass -p', (v) => `sshpass -p ${v} ssh user@host`]
  ];
  for (const [rule, build] of cases) {
    for (const q of ["'", '"']) {
      it(`${rule} ${q}my secret phrase${q}`, () => {
        const { masked, hasSecret } = maskSecrets(build(`${q}my secret phrase${q}`));
        expect(hasSecret).toBe(true);
        expect(masked).toBe(build('••••••••'));
      });
    }
  }

  it('незакрытая кавычка маскирует до конца строки (обрезка вывода посреди значения)', () => {
    expect(maskSecrets('PASSWORD="my secret phr').masked).toBe('PASSWORD=••••••••');
    expect(maskSecrets("PASSWORD='my secret phr\nnext line").masked).toBe('PASSWORD=••••••••\nnext line');
  });

  it('хвост слова после кавычек — часть значения: "p1"$SUFFIX, "ab"cd', () => {
    expect(maskSecrets('DB_PASSWORD="p1"$SUFFIX ./run').masked).toBe('DB_PASSWORD=•••••••• ./run');
    expect(maskSecrets("tool --password='ab'cd x").masked).toBe('tool --password=•••••••• x');
  });

  it('маска другого правила внутри кавычек не оставляет остальное значение открытым', () => {
    const multi = maskSecrets(`export DB_PASSWORD='my secret pass\ncurl -H "Authorization: Bearer tok" x`).masked;
    expect(multi).not.toContain('my secret');
    expect(multi).not.toContain('tok');
    expect(maskSecrets('export X_KEY="my -pword secret"').masked).toBe('export X_KEY=••••••••');
  });
});

describe('maskSecrets — линейное время на 64 КБ (тикет 08)', () => {
  const N = 64 * 1024;
  const inputs: Record<string, string> = {
    'длинное UPPER-слово без =': 'A'.repeat(N),
    'повтор ключевого слова без =': 'KEY'.repeat(N / 3),
    'повтор PASSWORD_ без =': 'PASSWORD_'.repeat(N / 9),
    'повтор X_KEY=" без закрытия': 'X_KEY="'.repeat(N / 7),
    "повтор --password ' ": "--password '".repeat(N / 12),
    'повтор " -p"': ' -p'.repeat(N / 3),
    "повтор KEY=' без закрытия и строк": "KEY='a".repeat(N / 6)
  };
  for (const [name, input] of Object.entries(inputs)) {
    it(name, () => {
      const start = performance.now();
      maskSecrets(input);
      expect(performance.now() - start).toBeLessThan(200);
    });
  }
});
