import type { JSX } from 'react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Breadcrumb } from '@shared/breadcrumb';
import type { DashboardMetrics } from '@shared/dashboard';
import type { InteractiveProgramName } from '@shared/interactivePrograms';
import { insertIntoComposer } from '@/stores/composerBus';
import { useConfig } from '@/stores/config';
import { Icon } from '@/components/common/Icon';

/**
 * Ряд breadcrumb + мини-дашборд, 48px (Design_Brief §2.1, §3.3).
 * Breadcrumb: user@host > path с кликабельными сегментами (вставка `cd` через
 * Стража, BRD-02). Привилегия дублируется цветом И текстом (BRD-03, §7 брифа).
 * Дашборд: инлайн CPU/RAM/Disk/пинг, пороги, «—» при недоступности (DASH-03/05).
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
      <span className="text-text-muted">{label}</span>
      <span className={`${color} ${warn || danger ? 'font-bold' : ''}`}>
        {value}
        {(warn || danger) && <span className="ml-[2px] text-[9px]">▲</span>}
      </span>
    </span>
  );
}

export function BreadcrumbBar({
  crumb,
  metrics,
  onOpenDashboard,
  guardEnabled,
  guardOffReason,
  shellStateUnknown,
  onOpenGuardSettings,
  interactiveProgram
}: {
  crumb: Breadcrumb | undefined;
  metrics: DashboardMetrics | undefined;
  onOpenDashboard: () => void;
  /** Эффективное состояние Стража для активной сессии (глобально И по хосту). */
  guardEnabled?: boolean;
  /** Почему выключен, если выключен — влияет на текст тултипа и на то, куда
   *  ведёт клик (настройки → Безопасность vs форма конкретного хоста). */
  guardOffReason?: 'global' | 'host';
  /** Не удалось определить «на промпте ли» сессия — стража, возможно, не
   *  проверяет часть ввода на этом хосте (fail-safe продолжает проверять
   *  вслепую, см. XtermView). Перекрывает цвет индикатора на «внимание». */
  shellStateUnknown?: boolean;
  onOpenGuardSettings?: () => void;
  /** BRD-05/06: запущена известная интерактивная программа — путь временно
   *  заменяется статусом на месте (см. комментарий у места отрисовки). */
  interactiveProgram?: { program: InteractiveProgramName; showHotkeys: boolean };
}): JSX.Element {
  const { t } = useTranslation();
  const { config } = useConfig();
  const dashVisible = config?.ui.dashboardVisible ?? true;

  const priv = crumb?.privilege ?? 'normal';
  // BRD-03: у root привилегия видна цветом+жирностью имени, у sudo — отдельным
  // бейджем (само имя остаётся обычного цвета), у normal — только зелёным именем.
  const userColor =
    priv === 'root' ? 'font-semibold text-danger' : priv === 'sudo' ? 'text-text-body' : 'text-success-bright';

  const cpu = metrics?.cpuPercent ?? null;
  const disk = metrics?.diskPercent ?? null;
  const ramPct =
    metrics?.ramUsedMb != null && metrics.ramTotalMb
      ? (metrics.ramUsedMb / metrics.ramTotalMb) * 100
      : null;

  const stripRef = useRef<HTMLDivElement>(null);
  // Прокрутка зажатой кнопкой мыши, как в панели каталога — иначе горизонтальный
  // скролл был доступен только Shift+колесом, что неочевидно.
  const dragState = useRef<{ startX: number; startLeft: number } | null>(null);
  const onStripMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    const el = stripRef.current;
    if (!el) return;
    dragState.current = { startX: e.clientX, startLeft: el.scrollLeft };
    const onMove = (mv: MouseEvent): void => {
      if (!dragState.current || !stripRef.current) return;
      stripRef.current.scrollLeft = dragState.current.startLeft - (mv.clientX - dragState.current.startX);
    };
    const onUp = (): void => {
      dragState.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border-default bg-bg-panel px-4">
      {/* Breadcrumb: ряд не переносится на вторую строку — при нехватке места
          скроллится горизонтально (иначе сжатый текст переносился и раздувал
          высоту 48px-полосы, наезжая на дашборд). Прокрутка — зажатой кнопкой
          мыши (клики по сегментам путей по-прежнему работают, как в каталоге). */}
      <div
        ref={stripRef}
        onMouseDown={onStripMouseDown}
        title={t('catalog.dragScroll')}
        className="flex min-w-0 flex-1 cursor-grab items-center gap-[7px] overflow-x-auto font-mono text-[13px] whitespace-nowrap select-none [scrollbar-width:none]"
      >
        {crumb ? (
          <>
            {priv === 'root' && (
              <span
                className="size-[7px] shrink-0 rounded-full bg-danger"
                title={t('breadcrumb.rootBadge')}
              />
            )}
            {priv === 'sudo' && <span className="size-[7px] shrink-0 rounded-full bg-warning" />}
            <span className={`shrink-0 ${userColor}`}>{crumb.username}</span>
            {priv === 'sudo' && (
              <span className="shrink-0 rounded-[4px] bg-[rgba(245,158,11,0.14)] px-[7px] py-[1px] font-sans text-[11px] text-warning">
                {t('breadcrumb.sudoBadge')}
              </span>
            )}
            <span className="shrink-0 text-text-dim">@</span>
            <span className="shrink-0 text-text-body">{crumb.host}</span>
            <span className="mx-[2px] shrink-0 text-accent">&gt;</span>
            {/* BRD-05/06: пока запущена известная интерактивная программа, путь
                временно заменяется статусом (вместо отдельной строки над
                breadcrumb) — так высота панели не меняется и не триггерит
                resize терминала (см. XtermView ResizeObserver), который иначе
                вызывал у удалённого shell лишнюю перерисовку prompt. */}
            {interactiveProgram ? (
              <span className="flex min-w-0 shrink items-center gap-[7px] overflow-hidden">
                <Icon name="terminal" size={13} className="shrink-0 text-lavender-light" />
                <span className="shrink-0 text-text-strong">
                  {t('breadcrumb.interactiveOpen', { program: interactiveProgram.program })}
                </span>
                {interactiveProgram.showHotkeys && (
                  <>
                    <span className="shrink-0 text-accent">·</span>
                    <span className="truncate text-text-dim">
                      {t(`interactiveProgram.hotkeys.${interactiveProgram.program}`)}
                    </span>
                  </>
                )}
              </span>
            ) : (
              <div className="flex shrink-0 items-center">
                {pathSegments(crumb.path).map((seg, i, arr) => {
                  const isLast = i === arr.length - 1;
                  return (
                    <span key={i} className="flex shrink-0 items-center">
                      {i > 0 && seg.label !== '~' && <span className="text-accent">/</span>}
                      <button
                        type="button"
                        title={t('breadcrumb.insertCd')}
                        onClick={() => insertIntoComposer(`cd ${seg.full}`)}
                        className={`max-w-[160px] truncate hover:text-lavender-light hover:underline ${
                          isLast ? 'text-text-strong' : 'text-text-muted'
                        }`}
                      >
                        {seg.label}
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </div>

      {/* Индикатор Стража для активной сессии: зелёный — включён, красный —
          выключен (глобально или для этого хоста), оранжевый — не удалось
          определить состояние шелла (fail-safe продолжает проверять вслепую,
          см. XtermView). Клик открывает настройки Стража — кроме оранжевого
          состояния, там открывать нечего (проблема не в настройке хоста), см.
          подробности в уведомлениях. */}
      {guardEnabled !== undefined &&
        (shellStateUnknown ? (
          <span
            title={t('breadcrumb.shellStateUnknown')}
            className="flex shrink-0 items-center rounded-full p-1 text-warning"
          >
            <Icon name="shield-alert" size={18} />
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpenGuardSettings}
            title={
              guardEnabled
                ? t('breadcrumb.guardOn')
                : guardOffReason === 'global'
                  ? t('breadcrumb.guardOffGlobal')
                  : t('breadcrumb.guardOff')
            }
            className={`flex shrink-0 items-center rounded-full p-1 hover:bg-bg-elevated ${
              guardEnabled ? 'text-success-bright' : 'text-danger'
            }`}
          >
            <Icon name={guardEnabled ? 'shield-check' : 'shield-x'} size={18} />
          </button>
        ))}

      {/* Мини-дашборд — клик открывает полную модалку «Дашборд сервера» */}
      {dashVisible && (
        <button
          type="button"
          onClick={onOpenDashboard}
          title={t('dashboard.openModal')}
          className="flex shrink-0 items-center gap-3 rounded-[5px] hover:opacity-90"
        >
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
          <Metric
            label={t('dashboard.ping')}
            value={metrics?.pingMs == null ? '—' : `${metrics.pingMs}ms`}
          />
        </button>
      )}
    </div>
  );
}
