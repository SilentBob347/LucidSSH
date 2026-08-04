import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deriveStepperState,
  STEPPER_STAGE_IDS,
  type StepperStageId,
  type StepperStageStatus
} from '@shared/connectionStepper';
import { Icon } from '@/components/common/Icon';
import { useConnectionLog } from '@/hooks/useConnectionLog';
import { formatLogEntry } from './connectionLogText';

const STAGE_LABEL_KEY: Record<StepperStageId, string> = {
  dns: 'tabs.stepper.stage.dns',
  port: 'tabs.stepper.stage.port',
  handshake: 'tabs.stepper.stage.handshake',
  hostkey: 'tabs.stepper.stage.hostkey',
  auth: 'tabs.stepper.stage.auth',
  shell: 'tabs.stepper.stage.shell'
};

function StageIcon({ status }: { status: StepperStageStatus }): JSX.Element {
  if (status === 'done') return <Icon name="check" size={13} className="text-success-bright" />;
  if (status === 'error') return <Icon name="close" size={13} className="text-danger-text" />;
  if (status === 'active') {
    return (
      <span className="flex size-[13px] items-center justify-center">
        <span className="animate-[esh-pulse_1.2s_ease-in-out_infinite] size-[8px] rounded-full bg-warning" />
      </span>
    );
  }
  return (
    <span className="flex size-[13px] items-center justify-center">
      <span className="size-[8px] rounded-full bg-text-dim" />
    </span>
  );
}

const STAGE_TEXT_CLASS: Record<StepperStageStatus, string> = {
  done: 'text-text-body',
  active: 'font-medium text-text-strong',
  error: 'font-medium text-danger-text',
  pending: 'text-text-faint'
};

/**
 * Живой степпер этапов подключения (CLOG-04): DNS → порт → SSH handshake →
 * fingerprint → авторизация → запуск shell. Показывается вместо терминала,
 * пока сессия не готова (только для первоначального подключения — TerminalArea
 * не монтирует его при автопереподключении, см. everConnected). Данные —
 * тот же лог соединения, что и «Детали подключения» (CLOG-01/02), только
 * спроецированный на шесть этапов через deriveStepperState.
 *
 * Отдельной кнопки «Отменить» во время самого подключения нет (решение
 * 22.07.2026, отступление от буквального текста CLOG-04 в private/TZ.md) —
 * крестик «×» на вкладке (TabBar) уже закрывает попытку подключения без
 * ожидания таймаута, дублирующая кнопка внутри степпера признана избыточной.
 */
export function ConnectionStepper({
  sessionId,
  failed,
  onReconnect,
  onShowDetails
}: {
  sessionId: string;
  /** true — попытка уже провалилась (сессия перешла в disconnected) — под
   *  степпером показываются Переподключить/Детали, как в обычном disconnected. */
  failed: boolean;
  onReconnect?: () => void;
  onShowDetails: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const entries = useConnectionLog(sessionId);
  const state = deriveStepperState(entries);

  return (
    // pointer-events-none на обёртке (как и у соседних connecting/disconnected
    // блоков в TerminalArea) — иначе абсолютно позиционированный inset-0
    // перекрывает клики по «Детали подключения» ниже (ConnectionLogPanel — не
    // absolute, но стоит в обычном потоке под этим слоем); включаем события
    // точечно только там, где реально есть контролы (кнопки).
    // Список этапов закреплён фиксированным смещением от центра (translate-y
    // в пикселях, не в %) — в отличие от justify-center по всей колонке, это
    // не пересчитывается от суммарной высоты содержимого, поэтому появление
    // текста ошибки и кнопок ниже не сдвигает сами этапы вверх.
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute top-1/2 left-1/2 flex w-full max-w-[400px] -translate-x-1/2 -translate-y-[104px] flex-col items-center gap-3 px-4">
        <div className="flex flex-col gap-[7px]">
          {STEPPER_STAGE_IDS.map((id) => {
            const status = state.stages.find((s) => s.id === id)?.status ?? 'pending';
            return (
              <div key={id} className="flex items-center gap-2 text-[12.5px]">
                <StageIcon status={status} />
                <span className={STAGE_TEXT_CLASS[status]}>{t(STAGE_LABEL_KEY[id])}</span>
              </div>
            );
          })}
        </div>

        {state.errorEntry && (
          <div className="text-center text-[12px] text-danger-text">
            {formatLogEntry(t, state.errorEntry)}
          </div>
        )}

        {failed && (
          <div className="pointer-events-auto flex flex-col items-center gap-2">
            {onReconnect && (
              <button
                type="button"
                onClick={onReconnect}
                className="h-8 w-[168px] rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover"
              >
                {t('tabs.reconnect')}
              </button>
            )}
            <button
              type="button"
              onClick={onShowDetails}
              className="h-8 w-[168px] rounded-[6px] border border-border-strong px-4 text-[12.5px] font-medium text-text-body hover:bg-bg-elevated"
            >
              {t('tabs.details')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
