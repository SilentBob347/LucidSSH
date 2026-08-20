/**
 * Один стек закрытия по Esc вместо 17 самодельных обработчиков (ADR-0010,
 * `docs/agent/adr/0010-esc-stack-not-overlay-module.md`). Плоский .ts-синглтон
 * без React, по образцу соседних `composerBus.ts` и `terminalBuffer.ts`. Держит
 * стек входов `(id, onEscape)` и один слушатель `keydown` на фазе capture:
 * ставится при первой регистрации, снимается при последней.
 *
 * Обработка: клавиша не `Escape` — событие не трогается вовсе (остальной ввод
 * терминала не задет). Стек пуст — слушателя нет, Esc уходит в сессию как
 * сегодня. Стек непуст — `preventDefault()` + `stopPropagation()` и вызов
 * `onEscape` только у верхнего входа.
 */

/**
 * Единственное официальное место сравнения с литералом `'Escape'` в renderer
 * (остальные ловит ESLint `no-restricted-syntax`, см. eslint.config.mjs).
 * Экспортируется для редких мест, которым нужно узнать клавишу, не владея её
 * обработкой, — например HotkeysSection в SettingsScreen.tsx: пока идёт захват
 * новой комбинации, её собственный `keydown`-слушатель обязан пропустить Esc
 * мимо себя (`stopPropagation()` в escStack не блокирует другие слушатели того
 * же узла — это делает только `stopImmediatePropagation()`, которую escStack
 * намеренно не использует, см. spec `.scratch/esc-close-stack/spec.md`).
 */
export const ESCAPE_KEY = 'Escape';

export interface KeyboardEventLike {
  key: string;
  repeat: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

interface EscTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEventLike) => void, options: { capture: true }): void;
  removeEventListener(
    type: 'keydown',
    listener: (event: KeyboardEventLike) => void,
    options: { capture: true }
  ): void;
}

interface EscEntry {
  id: string;
  onEscape: () => void;
}

const stack: EscEntry[] = [];
let testTarget: EscTarget | null = null;

/** `window` берётся лениво — модуль должен импортироваться в node-окружении
 *  vitest (`environment: 'node'`), где `window` не существует. */
function getTarget(): EscTarget {
  return testTarget ?? (window as unknown as EscTarget);
}

function handleKeyDown(event: KeyboardEventLike): void {
  if (event.key !== ESCAPE_KEY) return;
  // OS-автоповтор при удержании клавиши шлёт несколько keydown с repeat=true
  // до одного keyup — без этой проверки удержанный Esc мог бы размотать
  // несколько уровней стека за одно физическое нажатие.
  if (event.repeat) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  // Верхний вход захвачен до вызова — если onEscape синхронно зарегистрирует
  // новый вход (закрытие открывает ConfirmDialog), это событие всё равно
  // обработано ровно один раз.
  top.onEscape();
}

function ensureListenerInstalled(): void {
  if (stack.length === 1) {
    getTarget().addEventListener('keydown', handleKeyDown, { capture: true });
  }
}

function ensureListenerRemoved(): void {
  if (stack.length === 0) {
    getTarget().removeEventListener('keydown', handleKeyDown, { capture: true });
  }
}

/**
 * Зарегистрировать вход стека — LIFO, верхний вход получает следующий Esc.
 * Возвращает `dispose`, идемпотентный (React.StrictMode монтирует эффекты
 * дважды — двойной `dispose` одного входа не должен ронять стек). Снятие входа
 * не с вершины (диалог закрыт программно) не ломает порядок остальных.
 */
export function pushEscHandler(id: string, onEscape: () => void): () => void {
  const entry: EscEntry = { id, onEscape };
  stack.push(entry);
  ensureListenerInstalled();

  let disposed = false;
  return function dispose(): void {
    if (disposed) return;
    disposed = true;
    const index = stack.indexOf(entry);
    if (index !== -1) stack.splice(index, 1);
    ensureListenerRemoved();
  };
}

/** Инъекция цели для тестов, по образцу `__setClientFactoryForTest` в `src/main/ssh`. */
export function __setEscTargetForTest(target: EscTarget | null): void {
  testTarget = target;
}

/** Сброс стека и тестовой цели между тестами. Снимает слушатель с текущей
 *  цели, если стек был непуст, — иначе он остаётся висеть на брошенном
 *  объекте, пока стек уже считается пустым. */
export function __resetEscStackForTest(): void {
  if (stack.length > 0) {
    stack.length = 0;
    getTarget().removeEventListener('keydown', handleKeyDown, { capture: true });
  }
  testTarget = null;
}
