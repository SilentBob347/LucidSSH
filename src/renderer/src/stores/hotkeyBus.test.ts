import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetHotkeyBusForTest,
  __setHotkeyTargetForTest,
  beginHotkeyCapture,
  pushHotkeyHandler,
  type KeyboardEventLike
} from './hotkeyBus';

/**
 * Одна шина хоткеев (ADR-0012). Фальшивая цель эмулирует `window`, как в
 * `escStack.test.ts`: захватывает слушатель `keydown` и требует
 * `{ capture: true }` третьим аргументом — фаза слушателя и есть предмет
 * этого исправления, её смену должен ловить typecheck, а не ручной просмотр.
 */

type Listener = (event: KeyboardEventLike) => void;

interface Mods {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

function createFakeTarget() {
  const listeners = new Set<Listener>();
  return {
    addEventListener: vi.fn((_type: 'keydown', listener: Listener, options: { capture: true }) => {
      expect(options).toEqual({ capture: true });
      listeners.add(listener);
    }),
    removeEventListener: vi.fn(
      (_type: 'keydown', listener: Listener, options: { capture: true }) => {
        expect(options).toEqual({ capture: true });
        listeners.delete(listener);
      }
    ),
    dispatch(key: string, mods: Mods = {}): KeyboardEventLike {
      const event: KeyboardEventLike = {
        key,
        ctrlKey: mods.ctrl ?? false,
        altKey: mods.alt ?? false,
        shiftKey: mods.shift ?? false,
        metaKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      };
      for (const listener of listeners) listener(event);
      return event;
    },
    get listenerCount() {
      return listeners.size;
    }
  };
}

let target: ReturnType<typeof createFakeTarget>;

function setup() {
  __resetHotkeyBusForTest();
  target = createFakeTarget();
  __setHotkeyTargetForTest(target);
}

afterEach(() => {
  __resetHotkeyBusForTest();
});

describe('hotkeyBus', () => {
  it('обработчик получает каноническую комбинацию', () => {
    setup();
    const handler = vi.fn(() => true);
    pushHotkeyHandler('app', handler);

    target.dispatch('h', { ctrl: true });

    expect(handler).toHaveBeenCalledWith('Ctrl+H');
  });

  it('сработавшая комбинация гасится целиком — иначе xterm отправит управляющий символ в сессию', () => {
    setup();
    pushHotkeyHandler('app', () => true);

    const event = target.dispatch('h', { ctrl: true });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('несработавшая комбинация не трогается — ввод терминала не задет', () => {
    setup();
    pushHotkeyHandler('app', () => false);

    const event = target.dispatch('h', { ctrl: true });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('нажатие одного модификатора обработчикам не показывается', () => {
    setup();
    const handler = vi.fn(() => true);
    pushHotkeyHandler('app', handler);

    const event = target.dispatch('Control', { ctrl: true });

    expect(handler).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('Escape не трогается вовсе — им владеет escStack (ADR-0010)', () => {
    setup();
    const handler = vi.fn(() => true);
    pushHotkeyHandler('app', handler);

    const event = target.dispatch('Escape');

    expect(handler).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('LIFO: последний зарегистрированный отвечает первым, взявший событие останавливает перебор', () => {
    setup();
    const bottom = vi.fn(() => true);
    const top = vi.fn(() => true);
    pushHotkeyHandler('bottom', bottom);
    pushHotkeyHandler('top', top);

    target.dispatch('k', { ctrl: true });

    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();
  });

  it('отказ верхнего обработчика пропускает комбинацию ниже', () => {
    setup();
    const bottom = vi.fn(() => true);
    pushHotkeyHandler('bottom', bottom);
    pushHotkeyHandler('top', () => false);

    const event = target.dispatch('k', { ctrl: true });

    expect(bottom).toHaveBeenCalledWith('Ctrl+K');
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('во время захвата комбинации обработчики не вызываются, комбинация уходит в onCombo', () => {
    setup();
    const handler = vi.fn(() => true);
    pushHotkeyHandler('app', handler);
    const onCombo = vi.fn();
    beginHotkeyCapture(onCombo);

    const event = target.dispatch('f', { ctrl: true });

    expect(handler).not.toHaveBeenCalled();
    expect(onCombo).toHaveBeenCalledWith('Ctrl+F');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('захват гасит и промежуточные нажатия, но onCombo для них не зовёт', () => {
    setup();
    const onCombo = vi.fn();
    beginHotkeyCapture(onCombo);

    const event = target.dispatch('Shift', { ctrl: true, shift: true });

    expect(onCombo).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('захват не трогает Escape — его отменяет escStack', () => {
    setup();
    const onCombo = vi.fn();
    beginHotkeyCapture(onCombo);

    const event = target.dispatch('Escape');

    expect(onCombo).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('после конца захвата обработчики снова в строю', () => {
    setup();
    const handler = vi.fn(() => true);
    pushHotkeyHandler('app', handler);
    const dispose = beginHotkeyCapture(vi.fn());

    dispose();
    target.dispatch('f', { ctrl: true });

    expect(handler).toHaveBeenCalledWith('Ctrl+F');
  });

  it('dispose замещённого захвата не снимает текущий', () => {
    setup();
    const disposeFirst = beginHotkeyCapture(vi.fn());
    const second = vi.fn();
    beginHotkeyCapture(second);

    disposeFirst();
    target.dispatch('f', { ctrl: true });

    expect(second).toHaveBeenCalledWith('Ctrl+F');
  });

  it('слушатель ставится один раз и снимается, когда не осталось ни обработчиков, ни захвата', () => {
    setup();
    const disposeA = pushHotkeyHandler('a', () => false);
    expect(target.addEventListener).toHaveBeenCalledTimes(1);

    const disposeB = pushHotkeyHandler('b', () => false);
    expect(target.addEventListener).toHaveBeenCalledTimes(1);

    disposeA();
    expect(target.removeEventListener).not.toHaveBeenCalled();

    disposeB();
    expect(target.listenerCount).toBe(0);
  });

  it('захват держит слушатель сам по себе, без единого обработчика', () => {
    setup();
    const onCombo = vi.fn();
    const dispose = beginHotkeyCapture(onCombo);
    expect(target.listenerCount).toBe(1);

    dispose();
    expect(target.listenerCount).toBe(0);
  });

  it('двойной dispose одного обработчика идемпотентен (StrictMode)', () => {
    setup();
    const other = vi.fn(() => true);
    pushHotkeyHandler('other', other);
    const dispose = pushHotkeyHandler('doubled', () => false);

    dispose();
    dispose();

    expect(target.listenerCount).toBe(1);
    target.dispatch('k', { ctrl: true });
    expect(other).toHaveBeenCalledTimes(1);
  });
});
