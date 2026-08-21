import type { Terminal } from '@xterm/xterm';

/**
 * Эхо сверяется с содержимым экрана, а не считается по счётчику (ADR-0013,
 * `.scratch/local-echo-resize-desync/spec.md`). Раньше стирание делалось
 * вслепую — `'\b \b'.repeat(n)` по счётчику из Набранной строки, без сверки
 * с тем, что на экране на самом деле. Экран уезжает из-под этого счётчика
 * от чего угодно, что пишет в терминал помимо нас (resize → readline
 * перерисовывает строку приглашения на SIGWINCH; вклинившийся вывод с
 * сервера — тоже) — xterm держит содержимое сетки и отдаёт его публичным
 * API, поэтому «текст на экране или нет» можно не гадать по сигналам
 * шелла, можно посмотреть.
 *
 * Чистое ядро ниже (арифметика позиций, сравнение, сборка
 * escape-последовательностей) не знает про DOM и про xterm — тестируется в
 * обычном node-окружении. Тонкий адаптер под ним читает/пишет настоящий
 * `Terminal`; XtermView.tsx использует только адаптерные функции
 * (`redrawEchoLine`, `reconcileEchoLine`).
 */

// ---------------------------------------------------------------------------
// Чистое ядро — без DOM и без xterm (vitest.config.ts: environment 'node').
// ---------------------------------------------------------------------------

/**
 * Поднимается от курсора вверх по цепочке «перенесённых» строк (isWrapped) —
 * находит визуальную строку, где на самом деле начинается текущая логическая
 * строка терминала (приглашение + Эхо). Не считает символы: сколько ячеек
 * реально заняло Эхо, зависит от табов и широких (CJK, 2 ячейки) символов —
 * посчитать это арифметикой по длине строки нельзя, а isWrapped уже посчитан
 * правильно самим xterm в момент записи. Это и есть смягчение из ADR-0013:
 * подъём по isWrapped вместо чистой арифметики по длине текста.
 *
 * @param isWrapped Признак «эта строка — перенос предыдущей» для абсолютного
 *   индекса строки буфера (адаптер передаёт
 *   `term.buffer.active.getLine(row)?.isWrapped`).
 * @param cursorRow Абсолютный индекс строки, где сейчас курсор.
 */
export function findEchoStartRow(isWrapped: (row: number) => boolean, cursorRow: number): number {
  let row = cursorRow;
  while (row > 0 && isWrapped(row)) row -= 1;
  return row;
}

/**
 * Диапазон колонок на одной строке экрана. Адаптер читает/стирает его через
 * `translateToString(false, from, to)` — колоночными границами, а не
 * индексом JS-строки: иначе широкие символы (CJK, 2 ячейки) не совпадут с
 * позицией курсора (одна ячейка ширины 2 — это один код в JS-строке, но две
 * колонки на экране).
 */
export interface RowRange {
  row: number;
  from: number;
  to: number;
}

/**
 * Диапазоны колонок, которые Эхо занимает на экране между (startRow,
 * startCol) и (cursorRow, cursorCol). Если Эхо не переносилось — диапазон
 * один; если переносилось (длиннее cols) — первая строка от startCol до
 * конца, средние строки целиком, последняя строка от начала до курсора.
 */
export function echoRowRanges(
  startRow: number,
  startCol: number,
  cursorRow: number,
  cursorCol: number,
  cols: number
): RowRange[] {
  if (startRow === cursorRow) return [{ row: startRow, from: startCol, to: cursorCol }];
  const ranges: RowRange[] = [{ row: startRow, from: startCol, to: cols }];
  for (let row = startRow + 1; row < cursorRow; row += 1) ranges.push({ row, from: 0, to: cols });
  ranges.push({ row: cursorRow, from: 0, to: cursorCol });
  return ranges;
}

/**
 * Escape-последовательность примитива «перерисовать область Эха»: вернуть
 * курсор к старту относительными перемещениями (`\x1b[<n>A` — вверх на n
 * строк, `\r` — в начало строки, `\x1b[<c>C` — вправо на c колонок), стереть
 * до конца экрана (`\x1b[J`), напечатать текст. Левее startCol примитив не
 * ходит НИКОГДА — неприкосновенность приглашения (ADR-0013) не отдельная
 * проверка, а прямое следствие того, что тут не с чем сравнивать: только
 * вправо от нуля.
 */
export function buildRedrawSequence(linesUp: number, startCol: number, text: string): string {
  let seq = '';
  if (linesUp > 0) seq += `\x1b[${linesUp}A`;
  seq += '\r';
  if (startCol > 0) seq += `\x1b[${startCol}C`;
  seq += '\x1b[J';
  return seq + text;
}

export interface ReconcileResult {
  matched: boolean;
  /** Новая колонка старта Эха: не меняется при совпадении, переусваивается
   *  от текущего курсора при расхождении — после перерисовки readline
   *  ставит курсор сразу за приглашением (его буфер пуст), значит cursorCol
   *  в этот момент и есть корректная новая колонка старта (ADR-0013 §2). */
  startCol: number;
  /** Присутствует, только если !matched — что нужно записать в терминал. */
  redrawSequence?: string;
}

/**
 * Сверка Набранной строки с прочитанным содержимым экрана. Три исхода:
 * текст на месте — no-op (matched=true, startCol не меняется); текста нет —
 * перерисовать от текущего курсора; приглашение уехало в другое место
 * (fish-подобный случай, readline напечатал приглашение ниже) — тот же
 * случай «текста нет» на новом месте, перерисовка тоже от текущего курсора,
 * старая копия остаётся выше как обычный след в истории (перерисовка не
 * трогает ничего выше себя). Идемпотентна: повторный вызов с actualText,
 * уже равным expectedText (после того как адаптер записал redrawSequence),
 * снова даст matched=true и ничего не напечатает.
 */
export function reconcile(
  actualText: string,
  expectedText: string,
  oldStartCol: number,
  cursorCol: number
): ReconcileResult {
  if (actualText === expectedText) return { matched: true, startCol: oldStartCol };
  return {
    matched: false,
    startCol: cursorCol,
    redrawSequence: buildRedrawSequence(0, cursorCol, expectedText)
  };
}

// ---------------------------------------------------------------------------
// Адаптер — тонкий слой поверх настоящего xterm.Terminal. @xterm/headless не
// подключаем (не нужен зависимостью, см. spec «Чего НЕ делаем») — вся
// арифметика уже проверена в ядре выше, здесь только чтение/запись.
// ---------------------------------------------------------------------------

function cursorAbsRow(term: Terminal): number {
  const buf = term.buffer.active;
  return buf.baseY + buf.cursorY;
}

function findEchoStartRowOnTerm(term: Terminal, cursorRow: number): number {
  return findEchoStartRow((row) => term.buffer.active.getLine(row)?.isWrapped ?? false, cursorRow);
}

function readEchoFromScreen(term: Terminal, startCol: number): { text: string; cursorCol: number } {
  const cursorRow = cursorAbsRow(term);
  const cursorCol = term.buffer.active.cursorX;
  const startRow = findEchoStartRowOnTerm(term, cursorRow);
  const ranges = echoRowRanges(startRow, startCol, cursorRow, cursorCol, term.cols);
  const text = ranges
    .map((r) => term.buffer.active.getLine(r.row)?.translateToString(false, r.from, r.to) ?? '')
    .join('');
  return { text, cursorCol };
}

/**
 * Примитив «перерисовать область Эха» на реальном терминале — общий для
 * Backspace и подстановки строки из локальной истории (стрелки ↑/↓): оба
 * доверяют переданному startCol, никакого сравнения с экраном не делают.
 * Перенос строки при стирании чинится тем же примитивом (третий дефект
 * класса из spec) — `linesUp` считается через findEchoStartRowOnTerm, а не
 * предполагается равным 0.
 */
export function redrawEchoLine(term: Terminal, startCol: number, text: string): void {
  const cursorRow = cursorAbsRow(term);
  const startRow = findEchoStartRowOnTerm(term, cursorRow);
  term.write(buildRedrawSequence(cursorRow - startRow, startCol, text));
}

/**
 * Сверка Набранной строки с экраном (ADR-0013 §3): читает ячейки перед
 * курсором на ширину expectedText и сравнивает. Совпало — ничего не пишет;
 * не совпало — перерисовывает. В обоих случаях `done` получает актуальную
 * колонку старта — вызывающий обязан сохранить её как новый startCol
 * (переусвоение происходит здесь, не на стороне вызывающего).
 *
 * Асинхронная по необходимости, не по стилю: `term.write` у xterm сам
 * асинхронный (WriteBuffer ставит запись в очередь и парсит её позже — тем
 * же callback-приёмом читает состояние сетки XtermView.tsx на самих данных
 * из PTY, см. ADR-0013 §3). Если звать `done` сразу же после `term.write(...)`
 * без ожидания её колбэка, любой код, который читает `term.buffer.active`
 * дальше в ТОМ ЖЕ синхронном тике (например следующий Backspace того же
 * чанка ввода), увидит состояние ДО перерисовки — не после. `done`
 * вызывается синхронно только тогда, когда писать было нечего (matched).
 */
export function reconcileEchoLine(
  term: Terminal,
  startCol: number,
  expectedText: string,
  done: (newStartCol: number) => void
): void {
  const { text, cursorCol } = readEchoFromScreen(term, startCol);
  const result = reconcile(text, expectedText, startCol, cursorCol);
  if (result.matched || !result.redrawSequence) {
    done(result.startCol);
    return;
  }
  term.write(result.redrawSequence, () => done(result.startCol));
}
