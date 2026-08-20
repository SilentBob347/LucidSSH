import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { DashboardMetrics } from '@shared/dashboard';
import { Icon } from '@/components/common/Icon';
import { useBackdropClose } from '@/hooks/useBackdropClose';
import { useEscapeClose } from '@/hooks/useEscapeClose';

/**
 * Модалка «Дашборд сервера» (DASH-01…05, Design_Brief §3.9; docs/Final
 * design/LucidSSH.dc.html строки 610-673). Отдельная от мини-дашборда в
 * breadcrumb полная картина: CPU/RAM/Disk с барами, аптайм/нагрузка/сеть,
 * топ-5 процессов. Недоступность сервера → «—» везде, без ошибок (DASH-05).
 */

type Level = 'normal' | 'warn' | 'danger';

function metricLevel(v: number, amber: number, red: number): Level {
  if (v >= red) return 'danger';
  if (v >= amber) return 'warn';
  return 'normal';
}

function MetricCard({
  label,
  value,
  pct,
  level,
  available
}: {
  label: string;
  value: string;
  pct: number;
  level: Level;
  available: boolean;
}): JSX.Element {
  const warn = available && level !== 'normal';
  const valueColor = !available
    ? 'text-text-dim'
    : level === 'danger'
      ? 'text-danger'
      : level === 'warn'
        ? 'text-warning'
        : 'text-text-strong';
  const barColor = !available
    ? 'bg-bg-tab-active'
    : level === 'danger'
      ? 'bg-danger'
      : level === 'warn'
        ? 'bg-warning'
        : 'bg-accent';
  return (
    <div className="rounded-[8px] border border-border-default bg-bg-elevated p-[14px]">
      <div className="flex items-baseline justify-between">
        <span className="text-[11.5px] font-semibold tracking-[0.04em] text-text-muted uppercase">
          {label}
        </span>
        {warn && (
          <span className={`text-[11px] ${level === 'danger' ? 'text-danger' : 'text-warning'}`}>
            ▲
          </span>
        )}
      </div>
      <div className={`mt-2 font-mono text-[26px] font-bold ${valueColor}`}>{value}</div>
      <div className="mt-[10px] h-[6px] overflow-hidden rounded-[3px] bg-bg-base">
        <div
          className={`h-full rounded-[3px] transition-all duration-300 ${barColor}`}
          style={{ width: `${available ? Math.min(100, pct) : 0}%` }}
        />
      </div>
    </div>
  );
}

function MetaTile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-[140px] flex-1 rounded-[6px] border border-border-default bg-bg-elevated px-[13px] py-[11px]">
      <div className="mb-1 text-[11px] text-text-muted">{label}</div>
      <div className="font-mono text-[13px] text-text-strong">{value}</div>
    </div>
  );
}

function uptimeParts(seconds: number | null): { key: string; params: Record<string, number> } | null {
  if (seconds === null) return null;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return days > 0
    ? { key: 'dashboard.uptimeDays', params: { days, hours } }
    : { key: 'dashboard.uptimeHours', params: { hours, mins } };
}

export function ServerDashboardModal({
  hostName,
  metrics,
  onClose
}: {
  hostName: string;
  metrics: DashboardMetrics | undefined;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const available = metrics?.cpuPercent != null || metrics?.ramUsedMb != null || metrics?.diskPercent != null;

  const cpu = metrics?.cpuPercent ?? 0;
  const disk = metrics?.diskPercent ?? 0;
  const ramPct =
    metrics?.ramUsedMb != null && metrics.ramTotalMb ? (metrics.ramUsedMb / metrics.ramTotalMb) * 100 : 0;

  const ramValue =
    metrics?.ramUsedMb != null && metrics.ramTotalMb != null
      ? `${(metrics.ramUsedMb / 1024).toFixed(1)} / ${(metrics.ramTotalMb / 1024).toFixed(1)} GB`
      : '—';

  const loadValue =
    metrics?.loadAvg1 != null && metrics.loadAvg5 != null && metrics.loadAvg15 != null
      ? `${metrics.loadAvg1.toFixed(2)} ${metrics.loadAvg5.toFixed(2)} ${metrics.loadAvg15.toFixed(2)}`
      : '—';

  const netValue =
    metrics?.netUpKbps != null && metrics.netDownKbps != null
      ? `${formatRate(metrics.netUpKbps)} / ${formatRate(metrics.netDownKbps)}`
      : '—';

  const procs = metrics?.topProcesses ?? [];
  const backdrop = useBackdropClose(onClose);
  useEscapeClose('server-dashboard-modal', onClose);

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-[45] flex items-center justify-center bg-black/70"
      {...backdrop}
      role="presentation"
    >
      <div
        className="animate-[esh-pop_.18s_ease] flex max-h-[88%] w-[680px] max-w-[94%] flex-col overflow-y-auto rounded-[6px] border border-[rgba(255,255,255,0.12)] bg-bg-panel shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-border-default bg-bg-panel px-5 py-[15px]">
          <div className="flex items-center gap-[10px]">
            <Icon name="server" size={18} className="text-lavender" />
            <span className="text-[15px] font-semibold text-text-strong">
              {t('dashboard.modal.title', { host: hostName })}
            </span>
            <span
              className={`rounded-[20px] px-[9px] py-[2px] text-[11px] ${
                available ? 'bg-success/[0.14] text-success-bright' : 'bg-[rgba(100,116,139,0.18)] text-text-muted'
              }`}
            >
              {available ? t('dashboard.modal.available') : t('dashboard.modal.unavailable')}
            </span>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-[4px] text-text-muted hover:bg-bg-elevated hover:text-text-strong"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-[18px]">
          {!available && (
            <div className="flex items-center gap-[9px] rounded-[6px] border border-border-default bg-bg-elevated px-[14px] py-[11px]">
              <span className="size-2 shrink-0 rounded-full bg-text-dim" />
              <span className="text-[12.5px] text-text-muted">{t('dashboard.modal.unavailableBanner')}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label={t('dashboard.cpu')}
              value={available ? `${cpu}%` : '—'}
              pct={cpu}
              level={metricLevel(cpu, 80, 90)}
              available={available}
            />
            <MetricCard
              label={t('dashboard.ram')}
              value={ramValue}
              pct={ramPct}
              level={metricLevel(ramPct, 85, 90)}
              available={available}
            />
            <MetricCard
              label={t('dashboard.disk')}
              value={available ? `${disk}%` : '—'}
              pct={disk}
              level={metricLevel(disk, 80, 90)}
              available={available}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <MetaTile
              label={t('dashboard.uptime')}
              value={(() => {
                const up = uptimeParts(metrics?.uptimeSeconds ?? null);
                return up ? t(up.key, up.params) : '—';
              })()}
            />
            <MetaTile label={t('dashboard.modal.loadAvg')} value={loadValue} />
            <MetaTile label={t('dashboard.modal.network')} value={netValue} />
            <MetaTile
              label={t('dashboard.ping')}
              value={metrics?.pingMs == null ? '—' : `${metrics.pingMs}ms`}
            />
          </div>

          <div>
            <div className="mb-[10px] text-[12px] font-semibold tracking-[0.04em] text-text-muted uppercase">
              {t('dashboard.modal.topProcesses')}
            </div>
            {procs.length === 0 ? (
              <div className="rounded-[6px] border border-border-default bg-bg-elevated py-[26px] text-center font-mono text-[12.5px] text-text-dim">
                {t('dashboard.modal.noData')}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[6px] border border-border-default bg-bg-elevated">
                <div className="grid grid-cols-[62px_92px_1fr_56px_56px] gap-2 border-b border-border-default px-[14px] py-[9px] text-[10.5px] font-semibold tracking-[0.03em] text-text-dim uppercase">
                  <span>{t('dashboard.modal.pid')}</span>
                  <span>{t('dashboard.modal.user')}</span>
                  <span>{t('dashboard.modal.command')}</span>
                  <span className="text-right">{t('dashboard.modal.cpu')}</span>
                  <span className="text-right">{t('dashboard.modal.mem')}</span>
                </div>
                {procs.map((p) => (
                  <div
                    key={p.pid}
                    className="grid grid-cols-[62px_92px_1fr_56px_56px] items-center gap-2 border-b border-[rgba(255,255,255,0.04)] px-[14px] py-2 font-mono text-[12px] text-text-body last:border-b-0"
                  >
                    <span className="text-text-dim">{p.pid}</span>
                    <span className="truncate text-text-muted">{p.user}</span>
                    <span className="truncate">{p.cmd}</span>
                    <span className={`text-right ${p.cpuPercent >= 40 ? 'text-warning' : ''}`}>
                      {p.cpuPercent.toFixed(1)}
                    </span>
                    <span className={`text-right ${p.memPercent >= 30 ? 'text-warning' : ''}`}>
                      {p.memPercent.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRate(kbps: number): string {
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps.toFixed(1)} KB/s`;
}
