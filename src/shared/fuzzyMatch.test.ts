import { describe, expect, it } from 'vitest';
import { applyCommandSuggestion } from './fuzzyMatch';

describe('applyCommandSuggestion (ERR-07)', () => {
  it('заменяет только имя команды, сохраняя аргументы', () => {
    expect(applyCommandSuggestion('sl -la', 'ls')).toBe('ls -la');
    expect(applyCommandSuggestion('sl -la /var/log', 'ls')).toBe('ls -la /var/log');
  });

  it('без аргументов — просто подставляет предложение', () => {
    expect(applyCommandSuggestion('sl', 'ls')).toBe('ls');
  });
});
