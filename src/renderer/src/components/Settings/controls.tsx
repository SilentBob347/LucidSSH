import type { JSX, ReactNode } from 'react';

/**
 * Мелкие переиспользуемые контролы страницы настроек (Design_Brief §3.10;
 * скриншот 08). Вынесены отдельно, чтобы секции читались декларативно.
 */

export function Toggle({
  on,
  onChange,
  label
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors ${
        on ? 'bg-accent' : 'bg-bg-elevated-2'
      }`}
    >
      <span
        className={`absolute top-[3px] size-[16px] rounded-full bg-white transition-all ${
          on ? 'left-[21px]' : 'left-[3px]'
        }`}
      />
    </button>
  );
}

/** Строка-карточка с заголовком/описанием слева и контролом справа. */
export function ToggleRow({
  title,
  desc,
  on,
  onChange
}: {
  title: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[8px] border border-border-default bg-bg-panel px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-text-strong">{title}</div>
        <div className="mt-[2px] text-[12px] text-text-dim">{desc}</div>
      </div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}

/** Сегмент-переключатель (несколько взаимоисключающих вариантов). */
export function Segment<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="flex rounded-[7px] bg-bg-base p-[3px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={
            value === o.key
              ? 'h-[30px] flex-1 rounded-[4px] bg-bg-tab-active text-[12.5px] font-medium text-text-strong'
              : 'h-[30px] flex-1 rounded-[4px] text-[12.5px] text-text-dim hover:text-text-muted'
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({
  title,
  children
}: {
  title?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-[8px] border border-border-default bg-bg-panel px-4 py-3">
      {title && <div className="mb-2 text-[13.5px] font-semibold text-text-strong">{title}</div>}
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="mb-3 text-[13px] font-semibold tracking-[0.05em] text-text-dim uppercase">
      {children}
    </div>
  );
}
