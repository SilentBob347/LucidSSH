/**
 * Список известных интерактивных программ (BRD-05/06) — фиксированный, из ТЗ.
 * Общий для main (детекция запуска, shellIntegration.ts) и renderer (статус-
 * строка над breadcrumb, тексты хоткеев).
 */
export const INTERACTIVE_PROGRAMS = ['nano', 'vim', 'less', 'man', 'htop', 'top'] as const;

export type InteractiveProgramName = (typeof INTERACTIVE_PROGRAMS)[number];

export function isInteractiveProgramName(value: string): value is InteractiveProgramName {
  return (INTERACTIVE_PROGRAMS as readonly string[]).includes(value);
}
