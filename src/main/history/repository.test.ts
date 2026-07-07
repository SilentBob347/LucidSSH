import { describe, expect, it } from 'vitest';
import { prepareOutput } from './repository';

/**
 * Разворачивание вывода команды в истории (Ideas_Backlog.md). Вывод — сырой
 * текст с сервера, поэтому маскируется теми же правилами, что и команда
 * (HIST-07), и не сохраняется вовсе, если сама команда уже была помечена
 * как секретная (двойная защита, §4 CLAUDE.md).
 */

describe('prepareOutput', () => {
  it('обычный короткий вывод сохраняется как есть', () => {
    const result = prepareOutput('total 12\ndrwxr-xr-x 2 root root 4096 file.txt', false);
    expect(result.output).toBe('total 12\ndrwxr-xr-x 2 root root 4096 file.txt');
    expect(result.outputTruncated).toBe(false);
    expect(result.outputHasSecret).toBe(false);
  });

  it('маскирует секрет, обнаруженный прямо в выводе (например, echo $TOKEN)', () => {
    const result = prepareOutput('GITHUB_TOKEN=ghp_leakedFromEnvOutput', false);
    expect(result.output).not.toContain('ghp_leakedFromEnvOutput');
    expect(result.outputHasSecret).toBe(true);
  });

  it('усекает длинный вывод и выставляет outputTruncated', () => {
    const long = 'x'.repeat(5000);
    const result = prepareOutput(long, false);
    expect(result.output).toHaveLength(4000);
    expect(result.outputTruncated).toBe(true);
  });

  it('не усекает вывод ровно на границе лимита', () => {
    const exact = 'x'.repeat(4000);
    const result = prepareOutput(exact, false);
    expect(result.output).toHaveLength(4000);
    expect(result.outputTruncated).toBe(false);
  });

  it('не сохраняет вывод вовсе, если команда уже содержала секрет', () => {
    const result = prepareOutput('some ordinary output, no secrets here', true);
    expect(result.output).toBeNull();
    expect(result.outputTruncated).toBe(false);
    expect(result.outputHasSecret).toBe(false);
  });

  it('пустой/отсутствующий вывод -> null, не падает', () => {
    expect(prepareOutput(undefined, false).output).toBeNull();
    expect(prepareOutput('', false).output).toBeNull();
  });
});
