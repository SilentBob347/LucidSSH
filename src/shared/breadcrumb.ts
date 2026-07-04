/**
 * Breadcrumb «где я» (BRD-01…04, Data_Structures §7.1).
 * Путь и привилегия приходят от сервера как ДАННЫЕ (не исполняются),
 * экранируются при отображении и при построении `cd` (§19 гайда).
 */
export interface Breadcrumb {
  username: string;
  host: string;
  path: string;
  privilege: 'normal' | 'sudo' | 'root';
}
