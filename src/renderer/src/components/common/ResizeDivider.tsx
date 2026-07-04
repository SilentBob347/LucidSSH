import type { JSX } from 'react';
import { useEffect, useRef } from 'react';

/**
 * Вертикальный ресайз-дивайдер панели (Design_Brief §4.4): во время drag ширина
 * пишется прямо в DOM целевого узла (мимо React) для плавности и коммитится в
 * state на mouseup. Клампы задаёт вызывающий. Хит-зона 5px, hover — индиго.
 */
export function ResizeDivider({
  side,
  targetRef,
  min,
  max,
  onCommit
}: {
  /** С какой стороны панель: 'left' — панель слева от дивайдера растёт вправо. */
  side: 'left' | 'right';
  targetRef: React.RefObject<HTMLElement | null>;
  min: number;
  max: number;
  onCommit: (width: number) => void;
}): JSX.Element {
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragging.current || !targetRef.current) return;
      const rect = targetRef.current.getBoundingClientRect();
      const raw = side === 'left' ? e.clientX - rect.left : rect.right - e.clientX;
      const clamped = Math.max(min, Math.min(max, raw));
      targetRef.current.style.width = `${clamped}px`;
    };
    const onUp = (): void => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (targetRef.current) {
        onCommit(Math.round(targetRef.current.getBoundingClientRect().width));
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [side, targetRef, min, max, onCommit]);

  return (
    // Визуально 5px (Design_Brief §2.1), но интерактивная зона шире (±5px) через
    // абсолютный оверлей — так дивайдер удобнее захватить, layout не смещается.
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={() => {
        dragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      className="group relative z-10 w-[5px] shrink-0 cursor-col-resize"
    >
      <div className="absolute inset-y-0 -left-[3px] -right-[3px] group-hover:bg-[rgba(99,102,241,0.28)]" />
    </div>
  );
}
