import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { Breadcrumb } from '@shared/breadcrumb';
import type { DashboardMetrics } from '@shared/dashboard';
import { insertIntoComposer } from '@/stores/composerBus';
import { useConfig } from '@/stores/config';

/**
 * Ряд breadcrumb + мини-дашборд, 48px (Design_Brief §2.1, §3.3).
 * Breadcrumb: user@host > path с кликабельными сегментами (вставка `cd` через
 * Стража, BRD-02). Привилегия дублируется цветом И текстом (BRD-03, §7 брифа).
 * Дашборд: инлайн CPU/RAM/Disk/uptime, пороги, «—» при недоступности (DASH-03/05).
 */

/** Клик по сегменту → `cd <path до сегмента>` в композер (проходит через Стража). */
function pathSegments(path: string): { label: string; full: string }[] {
  if (path === '/' || path === '') return [{ label: '/', full: '/' }];
  const parts = path.split('/').filter(Boolean);
  const segs: { label: string; full: string }[] = [];
  let acc = '';
  for (const p of parts) {
    acc += '/' + p;
    segs.push({ label: p, full: acc });
  }
  // ~ отображаем как есть, если путь начинается с ~
  if (path.startsWith('~')) {
    return [{ label: '~', full: '~' }, ...segs];
  }
  return segs;
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

function Metric({
  label,
  value,
  warn,
  danger
}: {
  label: string;
  value: string;
  warn?: boolean;
  danger?: boolean;
}): JSX.Element {
  const color = danger ? 'text-danger' : warn ? 'text-warning' : 'text-text-body';
  return (
    <span className="flex items-center gap-1 font-mono text-[12px]">
      <span className="text-text-dim">{label}</span>
      <span className={color}>
        {value}
        {(warn || danger) && <span className="ml-[2px]">▲</span>}
      </span>
    </span>
  );
}

export function BreadcrumbBar({
  crumb,
  metrics
}: {
  crumb: Breadcrumb | undefined;
  metrics: DashboardMetrics | undefined;
}): JSX.Element {
  const { t } = useTranslation();
  const { config } = useConfig();
  const dashVisible = config?.ui.dashboardVisible ?? true;

  const priv = crumb?.privilege ?? 'normal';
  const userColor =
    priv === 'root' ? 'text-danger' : priv === 'sudo' ? 'text-warning' : 'text-success-bright';

  const cpu = metrics?.cpuPercent ?? null;
  const disk = metrics?.diskPercent ?? null;
  const ramPct =
    metrics?.ramUsedMb != null && metrics.ramTotalMb
      ? (metrics.ramUsedMb / metrics.ramTotalMb) * 100
      : null;

  return (
    <div
      className={`flex h-12 shrink-0 items-center gap-3 border-b border-border-default px-4 ${
        priv === 'root' ? 'bg-[rgba(239,68,68,0.06)]' : 'bg-bg-panel'
      }`}
    >
      {/* Breadcrumb */}
      <div className="flex min-w-0 flex-1 items-center gap-1 font-mono text-[13px]">
        {crumb ? (
          <>
            <span className={userColor}>{crumb.username}</span>
            {priv === 'root' && (
              <span className="rounded-[3px] bg-danger/20 px-[5px] text-[9px] font-bold text-danger uppercase">
                {t('breadcrumb.rootBadge')}
              </span>
            )}
            {priv === 'sudo' && (
              <span className="rounded-[3px] bg-warning/20 px-[5px] text-[9px] font-bold text-warning uppercase">
                {t('breadcrumb.sudoBadge')}
              </span>
            )}
            <span className="text-text-dim">@</span>
            <span className="text-text-body">{crumb.host}</span>
            <span className="mx-1 text-accent">›</span>
            <div className="flex min-w-0 items-center">
              {pathSegments(crumb.path).map((seg, i) => (
                <span key={i} className="flex items-center">
                  {i > 0 && seg.label !== '~' && <span className="text-text-faint">/</span>}
                  <button
                    type="button"
                    title={t('breadcrumb.insertCd')}
                    onClick={() => insertIntoComposer(`cd ${seg.full}`)}
                    className="max-w-[160px] truncate text-info hover:text-lavender-light hover:underline"
                  >
                    {seg.label}
                  </button>
                </span>
              ))}
            </div>
          </>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </div>

      {/* Мини-дашборд */}
      {dashVisible && (
        <div className="flex shrink-0 items-center gap-3">
          <Metric
            label={t('dashboard.cpu')}
            value={cpu === null ? '—' : `${cpu}%`}
            warn={cpu !== null && cpu > 80 && cpu <= 90}
            danger={cpu !== null && cpu > 90}
          />
          <span className="h-3 w-px bg-[rgba(255,255,255,0.1)]" />
          <Metric
            label={t('dashboard.ram')}
            value={
              metrics?.ramUsedMb != null && metrics.ramTotalMb != null
                ? `${(metrics.ramUsedMb / 1024).toFixed(1)}/${(metrics.ramTotalMb / 1024).toFixed(1)}GB`
                : '—'
            }
            warn={ramPct !== null && ramPct > 85 && ramPct <= 90}
            danger={ramPct !== null && ramPct > 90}
          />
          <span className="h-3 w-px bg-[rgba(255,255,255,0.1)]" />
          <Metric
            label={t('dashboard.disk')}
            value={disk === null ? '—' : `${disk}%`}
            warn={disk !== null && disk > 80 && disk <= 90}
            danger={disk !== null && disk > 90}
          />
          <span className="h-3 w-px bg-[rgba(255,255,255,0.1)]" />
          <span className="font-mono text-[12px] text-text-dim">
            ↑{' '}
            {(() => {
              const up = uptimeParts(metrics?.uptimeSeconds ?? null);
              return up ? t(up.key, up.params) : '—';
            })()}
          </span>
        </div>
      )}
    </div>
  );
}
