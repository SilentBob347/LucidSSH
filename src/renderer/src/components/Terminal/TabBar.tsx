import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionInfo } from '@shared/ssh';
import { useSessions } from '@/stores/sessions';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

/**
 * Таб-бар сессий 38px (Design_Brief §3.3): статус-точка, имя, ×.
 * Двойной клик — переименование; правая кнопка — меню переименовать/дублировать/
 * закрыть (TERM-02, CTX-03). Закрытие активной сессии требует подтверждения (WIN-03).
 */

function StatusDot({ status }: { status: SessionInfo['status'] }): JSX.Element {
  if (status === 'connected') {
    return <span className="size-[7px] shrink-0 rounded-full bg-success-bright" />;
  }
  if (status === 'reconnecting' || status === 'connecting') {
    return (
      <span className="animate-[esh-pulse_1.2s_ease-in-out_infinite] size-[7px] shrink-0 rounded-full bg-warning" />
    );
  }
  return <span className="size-[7px] shrink-0 rounded-full border-[1.5px] border-text-faint" />;
}

export function TabBar({
  onToggleDetails,
  detailsOpen
}: {
  onToggleDetails: () => void;
  detailsOpen: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const { sessions, activeSessionId, select, closeTab, connect, renameTab, reorderTab } =
    useSessions();
  const [closeTarget, setCloseTarget] = useState<SessionInfo | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menu, setMenu] = useState<{ x: number; session: SessionInfo } | null>(null);
  const dragSessionId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Drop строки хоста из левой панели на таб-бар → открыть сессию (Design_Brief §4.4)
  const onHostDrop = (e: React.DragEvent): void => {
    const raw = e.dataTransfer.getData('application/x-lucidssh-host');
    if (raw) {
      const hostId = Number(raw);
      if (Number.isInteger(hostId) && hostId > 0) void connect(hostId);
    }
    setDragOverId(null);
  };

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  const requestClose = (s: SessionInfo): void => {
    if (s.status === 'connected' || s.status === 'connecting' || s.status === 'reconnecting') {
      setCloseTarget(s); // WIN-03
    } else {
      void closeTab(s.sessionId);
    }
  };

  const startRename = (s: SessionInfo): void => {
    setRenamingId(s.sessionId);
    setRenameValue(s.hostName);
  };

  const commitRename = (): void => {
    if (renamingId) renameTab(renamingId, renameValue);
    setRenamingId(null);
  };

  return (
    <div
      className="flex h-[38px] shrink-0 items-end border-b border-border-hairline bg-bg-base"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-lucidssh-host')) e.preventDefault();
      }}
      onDrop={onHostDrop}
    >
      <div className="flex min-w-0 flex-1 items-end gap-[2px] overflow-x-auto px-2 [scrollbar-width:none]">
        {sessions.map((s) => {
          const activeTab = s.sessionId === activeSessionId;
          const isDragOver = dragOverId === s.sessionId;
          return (
            <div
              key={s.sessionId}
              role="tab"
              aria-selected={activeTab}
              tabIndex={0}
              draggable
              onDragStart={(e) => {
                dragSessionId.current = s.sessionId;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (dragSessionId.current && dragSessionId.current !== s.sessionId) {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverId(s.sessionId);
                }
              }}
              onDrop={(e) => {
                if (dragSessionId.current) {
                  e.preventDefault();
                  e.stopPropagation();
                  reorderTab(dragSessionId.current, s.sessionId);
                  dragSessionId.current = null;
                  setDragOverId(null);
                }
              }}
              onDragEnd={() => {
                dragSessionId.current = null;
                setDragOverId(null);
              }}
              onClick={() => select(s.sessionId)}
              onDoubleClick={() => startRename(s)}
              onContextMenu={(e) => {
                e.preventDefault();
                select(s.sessionId);
                setMenu({ x: e.clientX, session: s });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') select(s.sessionId);
              }}
              className={
                (activeTab
                  ? 'flex h-[34px] max-w-[190px] min-w-0 cursor-default items-center gap-2 rounded-t-[7px] border-t-2 border-t-accent bg-bg-tab-active px-3'
                  : 'flex h-[34px] max-w-[190px] min-w-0 cursor-default items-center gap-2 rounded-t-[7px] border-t-2 border-t-transparent bg-bg-tab-idle px-3 hover:bg-bg-elevated') +
                (isDragOver ? ' border-l-2 border-l-accent' : '')
              }
            >
              <StatusDot status={s.status} />
              {renamingId === s.sessionId ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  maxLength={60}
                  className="h-[22px] w-[120px] rounded-[3px] border border-accent bg-bg-base px-1 text-[12px] text-text-strong outline-none"
                />
              ) : (
                <span
                  className={`truncate text-[12px] ${activeTab ? 'font-medium text-text-strong' : 'text-text-dim'}`}
                >
                  {s.hostName}
                </span>
              )}
              <button
                type="button"
                title={t('tabs.close')}
                aria-label={t('tabs.close')}
                onClick={(e) => {
                  e.stopPropagation();
                  requestClose(s);
                }}
                className="flex size-[16px] shrink-0 items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-text-strong"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {activeSessionId && (
        <div className="flex h-full shrink-0 items-center pr-2">
          <button
            type="button"
            title={t('tabs.details')}
            aria-label={t('tabs.details')}
            aria-pressed={detailsOpen}
            onClick={onToggleDetails}
            className={`flex size-[24px] items-center justify-center rounded-[4px] text-[12px] ${
              detailsOpen
                ? 'bg-bg-elevated-2 text-lavender'
                : 'text-text-dim hover:bg-bg-elevated hover:text-text-strong'
            }`}
          >
            ⓘ
          </button>
        </div>
      )}

      {menu && (
        <div
          className="animate-[esh-pop_.12s_ease] fixed z-50 w-[160px] rounded-[6px] border border-border-strong bg-bg-elevated py-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
          style={{ left: Math.min(menu.x, window.innerWidth - 170), top: 40 }}
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              startRename(menu.session);
              setMenu(null);
            }}
            className="w-full px-3 py-[6px] text-left text-[12.5px] text-text-body hover:bg-bg-elevated-2 hover:text-text-strong"
          >
            {t('tabs.rename')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void connect(menu.session.hostId); // дублирование — новая сессия к тому же хосту
              setMenu(null);
            }}
            className="w-full px-3 py-[6px] text-left text-[12.5px] text-text-body hover:bg-bg-elevated-2 hover:text-text-strong"
          >
            {t('tabs.duplicate')}
          </button>
          <div className="my-1 h-px bg-border-hairline" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              requestClose(menu.session);
              setMenu(null);
            }}
            className="w-full px-3 py-[6px] text-left text-[12.5px] text-danger-text hover:bg-bg-elevated-2"
          >
            {t('tabs.close')}
          </button>
        </div>
      )}

      {closeTarget && (
        <ConfirmDialog
          title={t('tabs.closeConfirm.title')}
          confirmLabel={t('tabs.closeConfirm.confirm')}
          danger
          onConfirm={() => {
            void closeTab(closeTarget.sessionId);
            setCloseTarget(null);
          }}
          onCancel={() => setCloseTarget(null)}
        >
          {t('tabs.closeConfirm.body', { name: closeTarget.hostName })}
        </ConfirmDialog>
      )}
    </div>
  );
}
