import { useCallback, useRef, type MouseEvent } from 'react';

/**
 * Клик по бэкдропу модалки/дровера закрывает её — но только если и mousedown,
 * и последующий click произошли прямо на бэкдропе, а не начались перетаскиванием
 * (например, выделением текста) внутри панели с отпусканием кнопки мыши уже за
 * её пределами. В этом drag-случае нативный `click` по спецификации DOM
 * срабатывает на ближайшем общем предке mousedown- и mouseup-таргетов — им
 * оказывается сам бэкдроп, так что проверки одного только `e.target ===
 * e.currentTarget` в onClick недостаточно (баг: случайное закрытие «Нового
 * подключения» с потерей введённых данных при выделении текста мышью).
 */
export function useBackdropClose(onClose: () => void): {
  onMouseDown: (e: MouseEvent) => void;
  onClick: (e: MouseEvent) => void;
} {
  const downOnBackdrop = useRef(false);

  const onMouseDown = useCallback((e: MouseEvent) => {
    downOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(
    (e: MouseEvent) => {
      const wasDownOnBackdrop = downOnBackdrop.current;
      downOnBackdrop.current = false;
      if (wasDownOnBackdrop && e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  return { onMouseDown, onClick };
}
