import type { Client } from 'ssh2';
import { IPC } from '@shared/ipc';
import { EMPTY_METRICS, type DashboardMetrics } from '@shared/dashboard';
import { getMainWindow } from '../window/mainWindow';

/** Логгер в лог соединения сессии (передаёт sessionManager, чтобы не плодить цикл импортов). */
export type DashboardLogger = (messageKey: string, params?: Record<string, string | number>) => void;

/**
 * Мини-дашборд сервера (DASH-01…05, §19 Security_Guide).
 * Отдельный SSH exec-канал (НЕ основная сессия), заранее заданный набор команд,
 * интервал 10 с. Метрики парсятся как данные и не исполняются. Недоступность
 * канала → «—» без ошибки в UI (DASH-05).
 */

const INTERVAL_MS = 10_000;
const EXEC_TIMEOUT_MS = 8_000;

/**
 * Фиксированная POSIX-sh команда сбора метрик. Печатает строки key value.
 * Не содержит недоверенного ввода — статическая строка (§19 гайда).
 */
const METRICS_COMMAND = [
  // CPU %: два замера /proc/stat с короткой паузой.
  // `rest` обязателен: в /proc/stat 10 полей (…steal guest guest_nice), без него
  // последняя переменная забирает остаток строки («N 0 0»), арифметика $(( ))
  // падает с syntax error, а ошибка расширения ФАТАЛЬНА для неинтерактивного
  // bash — умирала вся команда, и дашборд всегда показывал «—» (найдено 07.07.2026).
  'read cpu a b c d e f g h rest < /proc/stat 2>/dev/null; t1=$((a+b+c+d+e+f+g+h)); id1=$d;',
  'sleep 0.4;',
  'read cpu a b c d e f g h rest < /proc/stat 2>/dev/null; t2=$((a+b+c+d+e+f+g+h)); id2=$d;',
  'dt=$((t2-t1)); di=$((id2-id1));',
  'if [ "$dt" -gt 0 ] 2>/dev/null; then echo "CPU $(( (100*(dt-di))/dt ))"; fi;',
  // RAM: total и available (fallback MemFree) в МБ
  'mt=$(awk "/^MemTotal:/{print \\$2}" /proc/meminfo 2>/dev/null);',
  'ma=$(awk "/^MemAvailable:/{print \\$2}" /proc/meminfo 2>/dev/null);',
  '[ -z "$ma" ] && ma=$(awk "/^MemFree:/{print \\$2}" /proc/meminfo 2>/dev/null);',
  '[ -n "$mt" ] && [ -n "$ma" ] && echo "RAM $(( (mt-ma)/1024 )) $(( mt/1024 ))";',
  // Диск по /
  'df -kP / 2>/dev/null | awk "NR==2{gsub(\\"%\\",\\"\\",\\$5); print \\"DISK \\"\\$5}";',
  // Uptime
  'awk "{print \\"UP \\"int(\\$1)}" /proc/uptime 2>/dev/null'
].join(' ');

interface DashboardState {
  timer: NodeJS.Timeout;
  client: Client;
  running: boolean;
  logger: DashboardLogger;
  /** Причина недоступности уже записана в лог соединения — не спамим каждые 10 с. */
  problemLogged: boolean;
}

const dashboards = new Map<string, DashboardState>();

function send(sessionId: string, metrics: DashboardMetrics): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send(IPC.evDashboard, sessionId, metrics);
}

function parseMetrics(output: string): DashboardMetrics {
  const metrics: DashboardMetrics = { ...EMPTY_METRICS };
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    const num = (s: string | undefined): number | null => {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    switch (parts[0]) {
      case 'CPU':
        metrics.cpuPercent = clampPercent(num(parts[1]));
        break;
      case 'RAM':
        metrics.ramUsedMb = num(parts[1]);
        metrics.ramTotalMb = num(parts[2]);
        break;
      case 'DISK':
        metrics.diskPercent = clampPercent(num(parts[1]));
        break;
      case 'UP':
        metrics.uptimeSeconds = num(parts[1]);
        break;
    }
  }
  return metrics;
}

function clampPercent(n: number | null): number | null {
  if (n === null) return null;
  return Math.max(0, Math.min(100, n));
}

function poll(sessionId: string): void {
  const state = dashboards.get(sessionId);
  if (!state || state.running) return;
  state.running = true;

  let output = '';
  let stderrOut = '';
  let settled = false;
  const finish = (metrics: DashboardMetrics): void => {
    if (settled) return;
    settled = true;
    state.running = false;
    if (dashboards.has(sessionId)) send(sessionId, metrics);
  };
  // Диагностика «—» в лог соединения (однократно): без этого причину
  // недоступности метрик было невозможно увидеть нигде (DASH-05).
  const logProblem = (key: string, params?: Record<string, string | number>): void => {
    if (state.problemLogged) return;
    state.problemLogged = true;
    state.logger(key, params);
  };

  const timeout = setTimeout(() => {
    logProblem('clog.dashboardTimeout');
    finish({ ...EMPTY_METRICS });
  }, EXEC_TIMEOUT_MS);

  state.client.exec(METRICS_COMMAND, (err, stream) => {
    if (err) {
      clearTimeout(timeout);
      logProblem('clog.dashboardExecError', { error: err.message });
      finish({ ...EMPTY_METRICS }); // канал недоступен → «—» (DASH-05)
      return;
    }
    stream.on('data', (d: Buffer) => {
      output += d.toString('utf8');
      if (output.length > 8192) stream.close();
    });
    stream.on('close', () => {
      clearTimeout(timeout);
      const metrics = parseMetrics(output);
      const empty =
        metrics.cpuPercent === null &&
        metrics.ramUsedMb === null &&
        metrics.diskPercent === null &&
        metrics.uptimeSeconds === null;
      if (empty) {
        // exec отработал, но ни одной метрики не распознано — покажем хвосты
        // stdout/stderr (усечённые), чтобы было ясно, что ответил сервер.
        logProblem('clog.dashboardNoData', {
          stdout: output.trim().slice(0, 200) || '—',
          stderr: stderrOut.trim().slice(0, 200) || '—'
        });
      }
      finish(metrics);
    });
    stream.stderr?.on('data', (d: Buffer) => {
      stderrOut += d.toString('utf8'); // только для диагностики, не парсится
    });
  });
}

export function startDashboard(sessionId: string, client: Client, logger: DashboardLogger): void {
  stopDashboard(sessionId);
  const timer = setInterval(() => poll(sessionId), INTERVAL_MS);
  dashboards.set(sessionId, { timer, client, running: false, logger, problemLogged: false });
  poll(sessionId); // первый замер сразу
}

export function stopDashboard(sessionId: string): void {
  const state = dashboards.get(sessionId);
  if (state) {
    clearInterval(state.timer);
    dashboards.delete(sessionId);
  }
}

/** Экспорт парсера для юнит-тестов (DASH-02). */
export const parseMetricsForTest = parseMetrics;
