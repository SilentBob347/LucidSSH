import { describe, expect, it } from 'vitest';
import { parseQuickConnect } from './quickConnect';

describe('parseQuickConnect (HM-11)', () => {
  it('парсит user@host без порта — 22 по умолчанию', () => {
    expect(parseQuickConnect('root@192.0.2.10')).toEqual({
      username: 'root',
      address: '192.0.2.10',
      port: 22
    });
  });

  it('парсит user@host:port', () => {
    expect(parseQuickConnect('deploy@example.com:2222')).toEqual({
      username: 'deploy',
      address: 'example.com',
      port: 2222
    });
  });

  it('обрезает пробелы по краям', () => {
    expect(parseQuickConnect('  root@192.0.2.10  ')).toEqual({
      username: 'root',
      address: '192.0.2.10',
      port: 22
    });
  });

  it('IPv6-адрес в скобках', () => {
    expect(parseQuickConnect('root@[2001:db8::1]:2222')).toEqual({
      username: 'root',
      address: '2001:db8::1',
      port: 2222
    });
  });

  it('отклоняет отсутствие @ или пустой ввод', () => {
    expect(parseQuickConnect('192.0.2.10')).toBeNull();
    expect(parseQuickConnect('')).toBeNull();
    expect(parseQuickConnect('   ')).toBeNull();
  });

  it('отклоняет порт вне диапазона', () => {
    expect(parseQuickConnect('root@host:0')).toBeNull();
    expect(parseQuickConnect('root@host:70000')).toBeNull();
  });

  it('отклоняет опасные символы (не проходит SSH дальше как есть)', () => {
    expect(parseQuickConnect('root@host;rm -rf /')).toBeNull();
    expect(parseQuickConnect('root; whoami@host')).toBeNull();
  });
});
