import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetEscStackForTest, __setEscTargetForTest, pushEscHandler, type KeyboardEventLike } from './escStack';

/**
 * Один стек закрытия по Esc (ADR-0010, `.scratch/esc-close-stack/spec.md`).
 * Фальшивая цель эмулирует `window`: захватывает слушатель `keydown` на фазе
 * capture и позволяет проверить его установку/снятие напрямую. Сигнатуры
 * `addEventListener`/`removeEventListener` намеренно требуют `{ capture: true }`
 * третьим аргументом — так же, как реальный `EscTarget` в `escStack.ts` — чтобы
 * смену фазы слушателя ловил typecheck, а не только ручной просмотр.
 */

type Listener = (event: KeyboardEventLike) => void;

function createFakeTarget() {
  const listeners = new Set<Listener>();
  return {
    addEventListener: vi.fn((_type: 'keydown', listener: Listener, options: { capture: true }) => {
      expect(options).toEqual({ capture: true });
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: 'keydown', listener: Listener, options: { capture: true }) => {
      expect(options).toEqual({ capture: true });
      listeners.delete(listener);
    }),
    dispatch(key: string, repeat = false): KeyboardEventLike {
      const event: KeyboardEventLike = {
        key,
        repeat,
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
  __resetEscStackForTest();
  target = createFakeTarget();
  __setEscTargetForTest(target);
}

afterEach(() => {
  __resetEscStackForTest();
});

describe('escStack', () => {
  it('Esc достаётся верхнему входу, нижние не вызываются', () => {
    setup();
    const bottom = vi.fn();
    const top = vi.fn();
    pushEscHandler('bottom', bottom);
    pushEscHandler('top', top);

    target.dispatch('Escape');

    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();
  });

  it('снятие входа не с вершины не ломает порядок — следующий Esc уходит новому верхнему', () => {
    setup();
    const bottom = vi.fn();
    const middle = vi.fn();
    const top = vi.fn();
    const disposeBottom = pushEscHandler('bottom', bottom);
    pushEscHandler('middle', middle);
    pushEscHandler('top', top);

    disposeBottom();
    target.dispatch('Escape');

    expect(top).toHaveBeenCalledTimes(1);
    expect(middle).not.toHaveBeenCalled();
    expect(bottom).not.toHaveBeenCalled();
  });

  it('пустой стек: слушатель снят, preventDefault не вызывается', () => {
    setup();
    const onEscape = vi.fn();
    const dispose = pushEscHandler('only', onEscape);

    dispose();

    expect(target.listenerCount).toBe(0);
    const event = target.dispatch('Escape');
    expect(onEscape).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('слушатель ставится ровно один раз на первой регистрации и снимается на последней', () => {
    setup();
    const disposeA = pushEscHandler('a', vi.fn());
    expect(target.addEventListener).toHaveBeenCalledTimes(1);

    pushEscHandler('b', vi.fn());
    expect(target.addEventListener).toHaveBeenCalledTimes(1);

    disposeA();
    expect(target.removeEventListener).not.toHaveBeenCalled();
  });

  it('не-Escape клавиша не трогается вовсе — ни preventDefault, ни stopPropagation', () => {
    setup();
    const onEscape = vi.fn();
    pushEscHandler('only', onEscape);

    const event = target.dispatch('Enter');

    expect(onEscape).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('двойной dispose одного входа идемпотентен (StrictMode)', () => {
    setup();
    const other = vi.fn();
    pushEscHandler('other', other);
    const dispose = pushEscHandler('doubled', vi.fn());

    dispose();
    dispose();

    expect(target.listenerCount).toBe(1);
    target.dispatch('Escape');
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('OS-автоповтор (repeat: true) не размативает стек — держим Esc, обработчик не вызывается второй раз', () => {
    setup();
    const bottom = vi.fn();
    const top = vi.fn();
    pushEscHandler('bottom', bottom);
    pushEscHandler('top', top);

    target.dispatch('Escape', true);

    expect(top).not.toHaveBeenCalled();
    expect(bottom).not.toHaveBeenCalled();
  });

  it('регистрация нового входа изнутри обработчика Esc не приводит к двойной обработке события', () => {
    setup();
    const opened = vi.fn();
    const closeAndOpenConfirm = vi.fn(() => {
      pushEscHandler('confirm', opened);
    });
    pushEscHandler('dialog', closeAndOpenConfirm);

    target.dispatch('Escape');

    expect(closeAndOpenConfirm).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
  });
});
