import { describe, expect, it } from 'vitest';
import { resolveHostRefByName } from './resolveByName';

const hosts = [
  { id: 1, name: 'bastion' },
  { id: 2, name: 'prod-db' }
];

describe('resolveHostRefByName', () => {
  it('находит id по точному совпадению имени', () => {
    expect(resolveHostRefByName(hosts, 'bastion')).toBe(1);
  });

  it('не совпадает по регистру', () => {
    expect(resolveHostRefByName(hosts, 'Bastion')).toBeNull();
  });

  it('возвращает null, если совпадений нет', () => {
    expect(resolveHostRefByName(hosts, 'unknown')).toBeNull();
  });

  it('пустой список хостов — null, не падает', () => {
    expect(resolveHostRefByName([], 'bastion')).toBeNull();
  });
});
