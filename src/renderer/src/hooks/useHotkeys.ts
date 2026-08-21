import { useEffect, useRef } from 'react';
import { pushHotkeyHandler, type HotkeyHandler } from '../stores/hotkeyBus';

/**
 * Тонкая обвязка над `hotkeyBus` (ADR-0012), по образцу `useEscapeClose`:
 * регистрирует обработчик хоткеев на монтировании и снимает на
 * размонтировании. `handler` держится в ref — он замыкает состояние экрана
 * (активная сессия, открытые панели, config.hotkeys) и меняется на каждом
 * рендере, но перерегистрация от этого не нужна: шина всегда зовёт актуальную
 * версию, а вход не переставляется в конец реестра.
 *
 * Обработчик получает только каноническую комбинацию и отвечает «моё / не
 * моё»; `preventDefault`/`stopPropagation` — забота шины, см. `hotkeyBus.ts`.
 */
export function useHotkeys(id: string, handler: HotkeyHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return pushHotkeyHandler(id, (combo) => handlerRef.current(combo));
    // handler намеренно не в зависимостях — актуальная версия читается из ref
    // (см. комментарий выше и тот же приём в useEscapeClose).
  }, [id]);
}
