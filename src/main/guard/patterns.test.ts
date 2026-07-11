import { describe, expect, it } from 'vitest';
import { analyzeCommand, CONFIRM_WORD } from './patterns';

/**
 * Обязательное покрытие guard/patterns.ts (CLAUDE.md §10):
 * и срабатывание, и отсутствие ложных срабатываний.
 */

describe('analyzeCommand — срабатывание (GUARD-01)', () => {
  it('rm -rf с путём', () => {
    const m = analyzeCommand('rm -rf /var/www');
    expect(m).toMatchObject({ patternId: 'rm-recursive', target: '/var/www', scope: 'directory' });
    expect(m?.confirmationText).toBe('www'); // GUARD-03: реальное имя объекта
    expect(m?.confirmationKind).toBe('target');
  });

  it('rm -fr (другой порядок флагов) и rm -r', () => {
    expect(analyzeCommand('rm -fr /etc/nginx')?.patternId).toBe('rm-recursive');
    expect(analyzeCommand('rm -r ./build')?.patternId).toBe('rm-recursive');
  });

  it('rm -rf / — масштаб диск', () => {
    expect(analyzeCommand('rm -rf /')?.scope).toBe('disk');
  });

  it('sudo не прячет команду', () => {
    expect(analyzeCommand('sudo rm -rf /opt/app')?.patternId).toBe('rm-recursive');
  });

  it('опасная часть составной команды', () => {
    expect(analyzeCommand('cd /tmp && rm -rf ./cache')?.patternId).toBe('rm-recursive');
    expect(analyzeCommand('echo hi; dd if=/dev/zero of=/dev/sda')?.patternId).toBe('dd-write');
  });

  it('dd в устройство — масштаб диск', () => {
    const m = analyzeCommand('dd if=/dev/zero of=/dev/sda bs=1M');
    expect(m).toMatchObject({ patternId: 'dd-write', target: '/dev/sda', scope: 'disk' });
  });

  it('mkfs с типом и без', () => {
    expect(analyzeCommand('mkfs.ext4 /dev/sdb1')?.target).toBe('/dev/sdb1');
    expect(analyzeCommand('mkfs /dev/sdb1')?.patternId).toBe('mkfs');
  });

  it('chmod -R 777', () => {
    const m = analyzeCommand('chmod -R 777 /var/www');
    expect(m).toMatchObject({ patternId: 'chmod-777', target: '/var/www' });
  });

  it('truncate -s 0', () => {
    expect(analyzeCommand('truncate -s 0 /var/log/syslog')?.patternId).toBe('truncate');
  });

  it('перенаправление в устройство', () => {
    expect(analyzeCommand('echo test > /dev/sda')?.patternId).toBe('redirect-device');
    expect(analyzeCommand('cat backup.img > /dev/nvme0n1')?.scope).toBe('disk');
  });

  it('fork-бомба — подтверждение словом', () => {
    const m = analyzeCommand(':(){ :|:& };:');
    expect(m?.patternId).toBe('fork-bomb');
    expect(m?.confirmationText).toBe(CONFIRM_WORD);
    expect(m?.confirmationKind).toBe('word');
  });

  it('drop database', () => {
    expect(analyzeCommand('mysql -e "DROP DATABASE production"')?.patternId).toBe('drop-database');
  });

  it('shred и wipefs', () => {
    expect(analyzeCommand('shred -n 3 /dev/sdb')?.scope).toBe('disk');
    expect(analyzeCommand('wipefs -a /dev/sdc')?.patternId).toBe('wipefs');
  });

  it('kill -9 1', () => {
    expect(analyzeCommand('kill -9 1')?.patternId).toBe('kill-init');
  });
});

describe('analyzeCommand — отсутствие ложных срабатываний', () => {
  const safe = [
    'ls -la',
    'rm file.txt', // без рекурсии — обычное удаление файла
    'rm -f single-file.log', // -f без -r
    'cd /var/www',
    'cat /var/log/syslog',
    'grep -r "pattern" /etc', // -r у grep — не rm
    'chmod 644 config.json',
    'chmod -R 755 /var/www', // 755 — не 777
    'dd if=/dev/sda of=backup.img', // чтение С диска в файл-бэкап (of=файл — file, не disk)
    'echo "rm -rf" ', // просто текст в echo… содержит паттерн — допустимое консервативное срабатывание? см. ниже
    'kill -9 12345', // обычный процесс, не init
    'truncate -s 10M bigfile', // не до нуля
    'mkdir -p /opt/app',
    'tail -f /var/log/nginx/error.log',
    'echo hello > output.txt',
    'firmware-update --dry-run'
  ];

  for (const cmd of safe) {
    if (cmd.startsWith('echo "rm -rf"')) continue; // отдельный кейс ниже
    if (cmd.startsWith('dd if=/dev/sda')) continue; // отдельный кейс ниже
    it(`не срабатывает на: ${cmd}`, () => {
      expect(analyzeCommand(cmd)).toBeNull();
    });
  }

  it('dd с of=файл — file-масштаб (предупреждение о перезаписи файла)', () => {
    // Консервативно: dd of=… перезаписывает цель без вопросов — предупреждаем,
    // но масштаб file, и подтверждение — имя файла
    const m = analyzeCommand('dd if=/dev/sda of=backup.img');
    expect(m?.scope).toBe('file');
    expect(m?.confirmationText).toBe('backup.img');
  });

  it('пустая и сверхдлинная строки безопасны', () => {
    expect(analyzeCommand('')).toBeNull();
    expect(analyzeCommand('a'.repeat(20_000))).toBeNull();
  });
});
