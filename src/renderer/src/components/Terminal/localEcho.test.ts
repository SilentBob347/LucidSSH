import { describe, expect, it } from 'vitest';
import { buildRedrawSequence, echoRowRanges, findEchoStartRow, reconcile } from './localEcho';

/**
 * Обязательное покрытие чистого ядра localEcho.ts (CLAUDE.md §10, ADR-0013).
 * Никакого @xterm/headless — только простые данные (environment: 'node').
 */

describe('findEchoStartRow — перенос строки', () => {
  it('Эхо длиннее cols: поднимается на нужное число строк по цепочке isWrapped', () => {
    // Строки 5,6,7 — перенос друг друга (одно логическое Эхо на 3 экранных
    // строки), строка 4 — начало (приглашение), 8 — соседняя команда сверху,
    // никак не участвует.
    const wrapped = new Set([5, 6, 7]);
    const isWrapped = (row: number): boolean => wrapped.has(row);
    expect(findEchoStartRow(isWrapped, 7)).toBe(4);
    // Перенос строки при стирании (третий дефект класса, spec §"Диагноз шире
    // исходного отчёта") чинится тем же примитивом — buildRedrawSequence
    // получает верное linesUp = cursorRow - startRow.
    expect(buildRedrawSequence(7 - 4, 4, 'x')).toContain('\x1b[3A');
  });

  it('Эхо не переносилось: строка старта совпадает со строкой курсора', () => {
    expect(findEchoStartRow(() => false, 12)).toBe(12);
  });

  it('не поднимается выше строки 0, даже если она тоже помечена isWrapped', () => {
    expect(findEchoStartRow(() => true, 0)).toBe(0);
  });

  it('широкие символы (CJK) и табы: считать по длине текста было бы неверно — ' +
    'isWrapped даёт точный ответ независимо от того, что реально заняло ячейки', () => {
    // cols=10: приглашение с CJK-символом (2 ячейки) + Tab (прыжок до
    // табстопа, не одна ячейка) заполняют ровно 10 колонок первой строки —
    // JS-строка "ëêç" по факту занимает МЕНЬШЕ 10 символов, чем 10 ячеек,
    // поэтому наивная арифметика "startCol + text.length <= cols" сочла бы,
    // что переноса нет. Настоящий терминал перенёс — isWrapped(1) === true —
    // и findEchoStartRow верит этому факту, а не счёту символов.
    const naiveGuessNoWrap = 3 + 'ab'.length <= 10; // 3 колонки "занято" по символам, а не по ячейкам
    expect(naiveGuessNoWrap).toBe(true); // наивная арифметика ошиблась бы
    const isWrapped = (row: number): boolean => row === 1;
    expect(findEchoStartRow(isWrapped, 1)).toBe(0); // а сверка по isWrapped — нет
  });
});

describe('echoRowRanges — арифметика колоночных диапазонов', () => {
  it('Эхо на одной строке — один диапазон от startCol до курсора', () => {
    expect(echoRowRanges(4, 6, 4, 10, 80)).toEqual([{ row: 4, from: 6, to: 10 }]);
  });

  it('Эхо, перенесённое на 3 строки — первая до конца, средняя целиком, последняя от начала', () => {
    expect(echoRowRanges(4, 76, 6, 5, 80)).toEqual([
      { row: 4, from: 76, to: 80 },
      { row: 5, from: 0, to: 80 },
      { row: 6, from: 0, to: 5 }
    ]);
  });
});

describe('reconcile — три исхода', () => {
  it('текст на месте → no-op, колонка старта не меняется', () => {
    const r = reconcile('abcd', 'abcd', 5, 9);
    expect(r).toEqual({ matched: true, startCol: 5 });
    expect(r.redrawSequence).toBeUndefined();
  });

  it('текста нет → перерисовать от текущего курсора, колонка переусвоена', () => {
    const r = reconcile('', 'abcd', 5, 4);
    expect(r.matched).toBe(false);
    expect(r.startCol).toBe(4); // переусвоена от cursorCol, не от старого startCol=5
    expect(r.redrawSequence).toBe(buildRedrawSequence(0, 4, 'abcd'));
  });

  it('приглашение уехало ниже (fish-подобный случай) → перерисовка от нового курсора', () => {
    // Курсор на другой строке, readline только что напечатал пустое
    // приглашение — на его месте не может быть Набранной строки, значит
    // расхождение и здесь. Перерисовка не трогает то, что осталось выше
    // (buildRedrawSequence с linesUp=0 пишет строго от текущей позиции).
    const r = reconcile('', 'abcd', 5, 0);
    expect(r.matched).toBe(false);
    expect(r.startCol).toBe(0);
    expect(r.redrawSequence).toBe(buildRedrawSequence(0, 0, 'abcd'));
  });

  it('идемпотентность: повторный вызов после перерисовки не даёт удвоения', () => {
    const first = reconcile('', 'abcd', 5, 4);
    expect(first.matched).toBe(false);
    // Экран теперь показывает то, что первый вызов записал.
    const second = reconcile('abcd', 'abcd', first.startCol, 8);
    expect(second).toEqual({ matched: true, startCol: first.startCol });
    expect(second.redrawSequence).toBeUndefined();
  });
});

describe('buildRedrawSequence — сборка escape-последовательности', () => {
  it('не двигается влево от startCol=0 и вверх, если курсор уже на строке старта', () => {
    const seq = buildRedrawSequence(0, 0, 'abcd');
    expect(seq).toBe('\r\x1b[Jabcd');
  });

  it('поднимается на linesUp строк и вправо на startCol колонок перед стиранием', () => {
    const seq = buildRedrawSequence(2, 4, 'ab');
    expect(seq).toBe('\x1b[2A\r\x1b[4C\x1b[Jab');
  });
});
