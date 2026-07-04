/**
 * Метрики мини-дашборда сервера (DASH-01…05, Data_Structures §7.1).
 * null → «—» без ошибки (DASH-05). Значения парсятся как данные, не исполняются.
 */
export interface DashboardMetrics {
  cpuPercent: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  diskPercent: number | null;
  uptimeSeconds: number | null;
}

export const EMPTY_METRICS: DashboardMetrics = {
  cpuPercent: null,
  ramUsedMb: null,
  ramTotalMb: null,
  diskPercent: null,
  uptimeSeconds: null
};
