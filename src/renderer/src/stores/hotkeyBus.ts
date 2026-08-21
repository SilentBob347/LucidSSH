import { normalizeCombo } from '@shared/hotkeys';
import { ESCAPE_KEY } from './escStack';

/**
 * Единственный keydown-слушатель приложения для хоткеев (ADR-0012,
 * `docs/agent/adr/0012-hotkey-bus-capture-phase.md`). Плоский .ts-синглтон без
 * React, по образцу соседнего `escStack.ts` (ADR-0010) — та же причина: раньше
 * хоткеи разошлись по трём независимым слушателям на одном и том же `window`,
 * с разной фазой и несогласуемым порядком.
 *
 * Три вещи, которые шина держит в одном месте:
 *
 * 1. **Фаза capture.** xterm.js вешает свой `keydown` на textarea и для каждой
 *    клавиши, которую распознал как ввод терминала, зовёт `cancel(e, true)` =
 *    `preventDefault()` + `stopPropagation()`. Слушатель на всплытии до таких
 *    комбинаций просто не доходит: Ctrl+H (0x08) и Ctrl+K (0x0B) не работали
 *    именно поэтому (найдено 21.08.2026).
 * 2. **`stopPropagation()` на сработавшую комбинацию.** xterm не смотрит на
 *    `defaultPrevented` — он сначала шлёт символ в сессию
 *    (`triggerDataEvent`), и только потом отменяет событие. Без обрыва
 *    распространения Ctrl+H открыл бы историю И отправил Backspace в шелл.
 *    Правило «сработало → `preventDefault` + `stopPropagation`» применяет сама
 *    шина, обработчикам событие не выдаётся вовсе: они видят только
 *    каноническую комбинацию и отвечают «моё / не моё». Это важно для SET-10 —
 *    комбинации редактируемые, разбираться «управляющий ли это символ» для
 *    каждой назначенной комбинации негде и незачем.
 * 3. **Режим захвата новой комбинации** (Настройки → Горячие клавиши, SET-10).
 *    Пока он активен, обработчики не вызываются вовсе. Раньше захват был
 *    четвёртым слушателем на том же `window` и рассчитывал, что его
 *    `stopPropagation()` погасит остальные, — но `stopPropagation()` не
 *    блокирует соседние слушатели одного узла (это умеет только
 *    `stopImmediatePropagation`, см. тот же разбор в `escStack.ts`), так что
 *    назначение Ctrl+F заодно открывало поиск за оверлеем Настроек.
 *
 * Esc шина не трогает вовсе — он принадлежит `escStack` (ADR-0010). Два
 * слушателя на одном `window` не спорят за одно событие: шина игнорирует Esc,
 * стек игнорирует всё остальное, порядок регистрации ни на что не влияет.
 */

export interface KeyboardEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * Обработчик хоткеев одного экрана. Получает каноническую комбинацию
 * (`normalizeCombo`), возвращает `true`, если она его — тогда шина отменяет
 * событие и до остальных обработчиков оно не идёт.
 */
export type HotkeyHandler = (combo: string) => boolean;

interface HotkeyTarget {
  addEventListener(
    type: 'keydown',
    listener: (event: KeyboardEventLike) => void,
    options: { capture: true }
  ): void;
  removeEventListener(
    type: 'keydown',
    listener: (event: KeyboardEventLike) => void,
    options: { capture: true }
  ): void;
}

interface HotkeyEntry {
  id: string;
  handler: HotkeyHandler;
}

interface CaptureEntry {
  onCombo: (combo: string) => void;
}

const handlers: HotkeyEntry[] = [];
let capture: CaptureEntry | null = null;
let installed = false;
let testTarget: HotkeyTarget | null = null;

/** `window` берётся лениво — модуль должен импортироваться в node-окружении
 *  vitest (`environment: 'node'`), где `window` не существует. */
function getTarget(): HotkeyTarget {
  return testTarget ?? (window as unknown as HotkeyTarget);
}

function handleKeyDown(event: KeyboardEventLike): void {
  // Esc — не хоткей приложения, а зафиксированное «закрыть текущую панель»
  // (FIXED_HOTKEYS.closePanel): им владеет escStack, шина пропускает событие
  // мимо себя нетронутым.
  if (event.key === ESCAPE_KEY) return;

  if (capture) {
    // Во время захвата гасится всё, а не только распознанные комбинации: пока
    // пользователь набирает Ctrl+Shift+…, промежуточные нажатия не должны
    // ни срабатывать как хоткеи, ни уходить в сессию.
    event.preventDefault();
    event.stopPropagation();
    const combo = normalizeCombo(event);
    if (combo) capture.onCombo(combo);
    return;
  }

  const combo = normalizeCombo(event);
  if (!combo) return;
  // LIFO, как в escStack: последний зарегистрированный обработчик отвечает
  // первым. Наборы комбинаций у экранов не пересекаются (findHotkeyConflict
  // не даёт назначить одну комбинацию двум действиям), так что порядок —
  // вопрос предсказуемости, а не разрешения споров.
  for (let i = handlers.length - 1; i >= 0; i -= 1) {
    const entry = handlers[i];
    if (entry && entry.handler(combo)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }
}

function syncListener(): void {
  const needed = handlers.length > 0 || capture !== null;
  if (needed === installed) return;
  installed = needed;
  if (needed) getTarget().addEventListener('keydown', handleKeyDown, { capture: true });
  else getTarget().removeEventListener('keydown', handleKeyDown, { capture: true });
}

/**
 * Зарегистрировать обработчик хоткеев. Возвращает `dispose`, идемпотентный
 * (React.StrictMode монтирует эффекты дважды — двойной `dispose` одного входа
 * не должен ронять реестр).
 */
export function pushHotkeyHandler(id: string, handler: HotkeyHandler): () => void {
  const entry: HotkeyEntry = { id, handler };
  handlers.push(entry);
  syncListener();

  let disposed = false;
  return function dispose(): void {
    if (disposed) return;
    disposed = true;
    const index = handlers.indexOf(entry);
    if (index !== -1) handlers.splice(index, 1);
    syncListener();
  };
}

/**
 * Включить режим захвата комбинации (SET-10). Пока он активен, обработчики
 * хоткеев не вызываются, а каждая распознанная комбинация уходит в `onCombo` —
 * включая невалидные (без модификатора): экран Настроек показывает их как
 * «набирается» и решает сам, когда захват закончен, вызвав `dispose`.
 * Одновременный захват один; повторный вызов замещает предыдущий, и `dispose`
 * старого входа уже не снимает чужой захват.
 */
export function beginHotkeyCapture(onCombo: (combo: string) => void): () => void {
  const entry: CaptureEntry = { onCombo };
  capture = entry;
  syncListener();

  return function dispose(): void {
    if (capture !== entry) return;
    capture = null;
    syncListener();
  };
}

/** Инъекция цели для тестов, по образцу `__setEscTargetForTest` в `escStack`. */
export function __setHotkeyTargetForTest(target: HotkeyTarget | null): void {
  testTarget = target;
}

/** Сброс реестра, захвата и тестовой цели между тестами. Слушатель снимается
 *  с текущей цели, если был установлен, — иначе он остаётся висеть на
 *  брошенном объекте, пока реестр уже считается пустым. */
export function __resetHotkeyBusForTest(): void {
  handlers.length = 0;
  capture = null;
  if (installed) {
    installed = false;
    getTarget().removeEventListener('keydown', handleKeyDown, { capture: true });
  }
  testTarget = null;
}
