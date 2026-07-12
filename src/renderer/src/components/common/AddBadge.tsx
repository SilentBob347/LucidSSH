import type { JSX } from 'react';

/**
 * Бейдж-плюс в углу иконки (шапка «Серверы»): без кружка-подложки — на таком
 * размере (10-11px) он не читался, оставлен только сам плюс акцентным цветом
 * (решение разработчика 07.07.2026).
 */
export function AddBadge(): JSX.Element {
  return (
    <span className="pointer-events-none absolute -right-[1px] -bottom-[1px] flex size-[10px] items-center justify-center">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth={4} strokeLinecap="round" aria-hidden="true">
        <path d="M12 6v12" />
        <path d="M6 12h12" />
      </svg>
    </span>
  );
}
