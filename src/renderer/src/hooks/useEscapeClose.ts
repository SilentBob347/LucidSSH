import { useEffect, useRef } from 'react';
import { pushEscHandler } from '../stores/escStack';

/**
 * Тонкая обвязка над `escStack` (ADR-0010): регистрирует вход стека на
 * монтировании (или на переходе `enabled` в `true`) и снимает его на
 * размонтировании / переходе обратно. `onEscape` держится в ref — обновление
 * колбэка между рендерами не должно перерегистрировать вход, иначе он бы
 * переставлялся на вершину стека и забирал чужой Esc.
 */
export function useEscapeClose(id: string, onEscape: () => void, enabled = true): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!enabled) return;
    return pushEscHandler(id, () => onEscapeRef.current());
    // onEscape намеренно не в зависимостях — актуальная версия читается из ref,
    // регистрация не должна дёргаться на каждый рендер (см. escStack.ts).
  }, [id, enabled]);
}
