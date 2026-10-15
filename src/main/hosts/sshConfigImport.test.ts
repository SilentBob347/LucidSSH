import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseSshConfig } from './sshConfigImport';

const HOME = '/home/tester';

describe('parseSshConfig', () => {
  it('импортирует безопасные директивы Host/HostName/User/Port/IdentityFile', () => {
    const cfg = `
Host web
  HostName 192.168.1.10
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
`;
    const { hosts } = parseSshConfig(cfg, HOME);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.name).toBe('web');
    expect(hosts[0]!.address).toBe('192.168.1.10');
    expect(hosts[0]!.username).toBe('deploy');
    expect(hosts[0]!.port).toBe(2222);
    expect(hosts[0]!.authMethod).toBe('key');
    expect(hosts[0]!.keyPath).toBe(join(HOME, '.ssh/id_ed25519'));
  });

  it('захватывает ProxyJump как безопасную директиву', () => {
    const { hosts } = parseSshConfig('Host a\n HostName h\n ProxyJump bastion\n', HOME);
    expect(hosts[0]!.proxyJump).toBe('bastion');
  });

  it('НЕ исполняет и помечает ProxyCommand/LocalCommand/Match exec/KnownHostsCommand', () => {
    const cfg = `
Host danger
  HostName evil.example
  ProxyCommand nc -X connect %h %p
  LocalCommand rm -rf ~
  KnownHostsCommand /bin/echo
Match exec "hostname | grep work"
  User work
`;
    const { hosts, unsupported } = parseSshConfig(cfg, HOME);
    // Хост danger импортируется, но исполняемые директивы — только в unsupported
    const directives = unsupported.map((u) => u.directive.toLowerCase());
    expect(directives).toContain('proxycommand');
    expect(directives).toContain('localcommand');
    expect(directives).toContain('knownhostscommand');
    expect(directives.some((d) => d.startsWith('match exec'))).toBe(true);
    // Ни одна команда не попала в поля хоста
    expect(JSON.stringify(hosts)).not.toContain('rm -rf');
    expect(JSON.stringify(hosts)).not.toContain('nc -X');
  });

  it('пропускает шаблоны с wildcard (Host *)', () => {
    const { hosts } = parseSshConfig('Host *\n User all\nHost real\n HostName r\n', HOME);
    expect(hosts.map((h) => h.name)).toEqual(['real']);
  });

  it('authMethod = password без IdentityFile', () => {
    const { hosts } = parseSshConfig('Host p\n HostName p.example\n User u\n', HOME);
    expect(hosts[0]!.authMethod).toBe('password');
    expect(hosts[0]!.keyPath).toBeUndefined();
  });

  it('берёт первый не-wildcard шаблон при нескольких на строке Host', () => {
    const { hosts } = parseSshConfig('Host * web1 web2\n HostName h\n', HOME);
    expect(hosts[0]!.name).toBe('web1');
  });

  it('поддерживает разделитель "=" и кавычки', () => {
    const { hosts } = parseSshConfig('Host q\nHostName="my.host"\nPort=22\n', HOME);
    expect(hosts[0]!.address).toBe('my.host');
    expect(hosts[0]!.port).toBe(22);
  });
});

describe('parseSshConfig — патологический ввод и формы записи', () => {
  it('Key value / Key=value / Key = value', () => {
    const r = parseSshConfig('Host a\n HostName=1.2.3.4\n User = bob\n Port 2200', '/h');
    expect(r.hosts[0]).toMatchObject({ name: 'a', address: '1.2.3.4', username: 'bob', port: 2200 });
  });
  it('длинная серия "=" и одинокие CR не вешают парсер', () => {
    const t = performance.now();
    parseSshConfig('Host a\n' + 'k' + '='.repeat(60_000) + '\n', '/h');
    const r = parseSshConfig('Host a\rHostName 9.9.9.9\r' + 'x '.repeat(50_000), '/h');
    expect(r.hosts[0]?.address).toBe('9.9.9.9');
    expect(performance.now() - t).toBeLessThan(500);
  });
  it('пропущенная сверхдлинная Host-строка не отдаёт свои директивы предыдущему хосту', () => {
    const long = 'Host ' + 'x'.repeat(5000);
    const r = parseSshConfig(['Host a', ' HostName 1.1.1.1', long, ' HostName 6.6.6.6'].join('\n'), '/h');
    expect(r.hosts).toHaveLength(1);
    expect(r.hosts[0]?.address).toBe('1.1.1.1');
  });
});
