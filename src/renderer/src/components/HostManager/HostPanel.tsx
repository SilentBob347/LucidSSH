import type { JSX } from 'react';
import { forwardRef, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Host, HostGroup } from '@shared/hosts';
import { parseQuickConnect } from '@shared/quickConnect';
import { useHosts } from '@/stores/hosts';
import { useSessions } from '@/stores/sessions';
import { usePanels } from '@/stores/panels';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Icon } from '@/components/common/Icon';
import { AddBadge } from '@/components/common/AddBadge';
import { useEscapeClose } from '@/hooks/useEscapeClose';

/**
 * Левая панель — менеджер хостов (HM-01, HM-02, HM-05; Design_Brief §3.2):
 * дерево групп со сворачиванием (состояние в БД), поиск в реальном времени,
 * инлайн-создание группы, пустые состояния, футер.
 */

function matches(host: Host, groupName: string | undefined, q: string): boolean {
  const query = q.toLowerCase();
  return (
    host.name.toLowerCase().includes(query) ||
    host.address.toLowerCase().includes(query) ||
    (groupName ?? '').toLowerCase().includes(query)
  );
}

function HostRow({
  host,
  connected,
  selected,
  isDragging,
  dropIndicator,
  onOpen,
  onSelect,
  onEdit,
  onDelete,
  onDragStartReorder,
  onDragOverReorder,
  onDropReorder,
  onDragEndReorder
}: {
  host: Host;
  connected: boolean;
  selected: boolean;
  isDragging: boolean;
  dropIndicator: 'before' | 'after' | null;
  onOpen: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStartReorder: () => void;
  onDragOverReorder: (position: 'before' | 'after') => void;
  onDropReorder: () => void;
  onDragEndReorder: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  // ::before занят акцентной полосой выбранной строки — индикатор вставки
  // всегда на ::after, позиция (верх/низ) переключается модификатором.
  const indicatorClass =
    dropIndicator === 'before'
      ? 'after:absolute after:inset-x-2 after:top-0 after:h-[2px] after:rounded-full after:bg-accent after:content-[""]'
      : dropIndicator === 'after'
        ? 'after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-accent after:content-[""]'
        : '';
  return (
    <div
      // Draggable и на таб-бар (открыть сессию, Design_Brief §4.4), и для
      // переупорядочивания внутри группы (тот же native drag, два типа данных).
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-lucidssh-host', String(host.id));
        e.dataTransfer.setData('application/x-lucidssh-reorder', String(host.id));
        e.dataTransfer.effectAllowed = 'copyMove';
        onDragStartReorder();
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-lucidssh-reorder')) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
        onDragOverReorder(position);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('application/x-lucidssh-reorder')) return;
        e.preventDefault();
        onDropReorder();
      }}
      onDragEnd={onDragEndReorder}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={
        (selected
          ? 'group relative my-px flex cursor-default items-center gap-2 rounded-[5px] py-[6px] pr-[6px] pl-2 before:absolute before:top-1 before:bottom-1 before:left-0 before:w-[2px] before:rounded-full before:bg-accent before:content-[""] bg-[rgba(99,102,241,0.12)]'
          : 'group relative my-px flex cursor-default items-center gap-2 rounded-[5px] py-[6px] pr-[6px] pl-2 hover:bg-bg-elevated') +
        (isDragging ? ' opacity-40' : '') +
        (indicatorClass ? ` ${indicatorClass}` : '')
      }
    >
      {connected ? (
        <span className="size-2 shrink-0 rounded-full bg-success-bright" />
      ) : (
        <span className="size-2 shrink-0 rounded-full border-[1.5px] border-text-faint" />
      )}
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[12.5px] ${selected ? 'font-medium text-text-strong' : 'text-text-body'}`}
        >
          {host.name}
        </div>
        {/* Осознанное отступление: в макете адрес набран Inter, оставлен mono (решение от 07.07.2026) */}
        <div className="truncate font-mono text-[10.5px] text-text-muted">{host.address}</div>
      </div>
      {connected && (
        <span className="shrink-0 text-[9px] font-bold tracking-[0.05em] text-success-bright group-hover:hidden">
          ON
        </span>
      )}
      <div className="hidden shrink-0 gap-[2px] group-hover:flex">
        <button
          type="button"
          title={t('hosts.actions.edit')}
          aria-label={t('hosts.actions.edit')}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-lavender"
        >
          <Icon name="edit" size={13} />
        </button>
        <button
          type="button"
          title={t('hosts.actions.delete')}
          aria-label={t('hosts.actions.delete')}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated-2 hover:text-danger"
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
}

export const HostPanel = forwardRef<HTMLElement, { width: number }>(function HostPanel(
  { width },
  ref
): JSX.Element {
  const { t } = useTranslation();
  const { hosts, groups, refresh, openDrawer } = useHosts();
  const { sessions, connect, connectQuick } = useSessions();
  const { openQuickConnect } = usePanels();
  const [query, setQuery] = useState('');
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);

  const connectedHostIds = useMemo(
    () => new Set(sessions.filter((s) => s.status === 'connected').map((s) => s.hostId)),
    [sessions]
  );
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Host | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<HostGroup | null>(null);
  const [snippetHostTarget, setSnippetHostTarget] = useState<Host | null>(null);
  // SSH-05 тикет 05: хост, который удаляют, но его использует как jump-хост кто-то ещё
  const [jumpDependentsTarget, setJumpDependentsTarget] = useState<{
    host: Host;
    dependents: Host[];
  } | null>(null);

  // Переупорядочивание хостов внутри группы перетаскиванием (только внутри
  // одной и той же группы/«без группы» — перенос между группами делает Edit).
  const [dragHost, setDragHost] = useState<{ id: number; groupId: number | null } | null>(null);
  const [overRow, setOverRow] = useState<{ id: number; position: 'before' | 'after' } | null>(
    null
  );

  const q = query.trim();

  // HM-11 (третий вход): строка вида user@host[:port] в поиске — отдельный
  // пункт-переход в существующий Quick Connect, не влияет на обычный поиск.
  const quickConnectMatch = useMemo(() => (q === '' ? null : parseQuickConnect(q)), [q]);
  const doQuickConnect = (): void => {
    if (!quickConnectMatch) return;
    void connectQuick(q);
    setQuery('');
  };

  const groupByIdName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  const visibleHosts = useMemo(
    () =>
      q === ''
        ? hosts
        : hosts.filter((h) =>
            matches(h, h.groupId !== undefined ? groupByIdName.get(h.groupId) : undefined, q)
          ),
    [hosts, q, groupByIdName]
  );

  const hostsByGroup = useMemo(() => {
    const map = new Map<number | null, Host[]>();
    for (const h of visibleHosts) {
      const key = h.groupId ?? null;
      const arr = map.get(key) ?? [];
      arr.push(h);
      map.set(key, arr);
    }
    return map;
  }, [visibleHosts]);

  const createGroup = async (): Promise<void> => {
    const name = newGroupName.trim();
    if (name.length === 0) return;
    await window.lucidSSH.createGroup(name);
    setNewGroupName('');
    setNewGroupOpen(false);
    await refresh();
  };

  // Незавершённая правка (ADR-0010): имя новой группы.
  useEscapeClose(
    'hostpanel-new-group',
    () => {
      setNewGroupOpen(false);
      setNewGroupName('');
    },
    newGroupOpen
  );

  const toggleGroup = async (g: HostGroup): Promise<void> => {
    await window.lucidSSH.setGroupCollapsed(g.id, !g.collapsed);
    await refresh();
  };

  // Пустая группа удаляется сразу; с серверами — через подтверждение
  // (хосты при этом не удаляются, уходят в «Без группы» — SET NULL в БД).
  const removeGroup = async (g: HostGroup): Promise<void> => {
    await window.lucidSSH.deleteGroup(g.id);
    setDeleteGroupTarget(null);
    await refresh();
  };

  const requestGroupDelete = (g: HostGroup): void => {
    const hasHosts = hosts.some((h) => h.groupId === g.id);
    if (hasHosts) setDeleteGroupTarget(g);
    else void removeGroup(g);
  };

  // Общий финальный шаг удаления. Хендлер `hosts:delete` сам проверяет
  // jump-зависимости (SSH-05 тикет 05) и без force отказывает, возвращая
  // список задетых хостов — тогда вместо удаления показываем предупреждение.
  const deleteHostOrWarn = async (host: Host, force = false): Promise<void> => {
    const result = await window.lucidSSH.deleteHost(host.id, force);
    setDeleteTarget(null);
    setSnippetHostTarget(null);
    if (!result.deleted) {
      setJumpDependentsTarget({ host, dependents: result.dependents });
      return;
    }
    setJumpDependentsTarget(null);
    await refresh();
  };

  const removeHost = async (host: Host): Promise<void> => {
    // SNIP-07: серверные сниппеты нельзя удалять молча — спрашиваем пользователя
    if (await window.lucidSSH.hostHasSnippets(host.id)) {
      setDeleteTarget(null);
      setSnippetHostTarget(host);
      return;
    }
    await deleteHostOrWarn(host);
  };

  const resolveAndDelete = async (host: Host, action: 'delete' | 'make-global'): Promise<void> => {
    await window.lucidSSH.resolveHostSnippets(host.id, action);
    await deleteHostOrWarn(host);
  };

  const dropOnRow = async (groupHostsList: Host[], targetId: number): Promise<void> => {
    if (!dragHost || !overRow || overRow.id !== targetId || dragHost.id === targetId) return;
    const ids = groupHostsList.map((h) => h.id);
    const from = ids.indexOf(dragHost.id);
    if (from === -1) return;
    ids.splice(from, 1);
    let to = ids.indexOf(targetId);
    if (overRow.position === 'after') to += 1;
    ids.splice(to, 0, dragHost.id);
    setDragHost(null);
    setOverRow(null);
    await window.lucidSSH.reorderHosts(ids);
    await refresh();
  };

  const ungrouped = hostsByGroup.get(null) ?? [];
  const nothingFound = q !== '' && visibleHosts.length === 0;
  const noHostsAtAll = hosts.length === 0;

  return (
    <aside
      ref={ref}
      style={{ width }}
      className="flex shrink-0 flex-col border-r border-border-default bg-bg-panel"
    >
      <div className="flex h-[38px] shrink-0 items-center justify-between border-b border-border-default pr-2 pl-3">
        <span className="text-[12px] font-semibold tracking-[0.04em] text-text-muted uppercase">
          {t('hosts.title')}
        </span>
        <div className="flex gap-px">
          <button
            type="button"
            title={t('hosts.addServer')}
            aria-label={t('hosts.addServer')}
            onClick={() => openDrawer()}
            className="relative flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            <Icon name="server" size={15} />
            <AddBadge />
          </button>
          <button
            type="button"
            title={t('hosts.addGroup')}
            aria-label={t('hosts.addGroup')}
            onClick={() => setNewGroupOpen(true)}
            className="relative flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            <Icon name="folders" size={15} />
            <AddBadge />
          </button>
          <button
            type="button"
            title={t('hosts.footer.quickConnect')}
            aria-label={t('hosts.footer.quickConnect')}
            onClick={openQuickConnect}
            className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            <Icon name="zap" size={15} />
          </button>
        </div>
      </div>

      <div className="px-3 pt-[10px] pb-2">
        <input
          type="text"
          placeholder={t('hosts.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && quickConnectMatch) doQuickConnect();
          }}
          className="h-7 w-full rounded-[4px] border border-border-default bg-bg-base px-[9px] text-[12px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[6px] pt-[2px] pb-2">
        {quickConnectMatch && (
          <button
            type="button"
            onClick={doQuickConnect}
            className="my-px flex w-full items-center gap-2 rounded-[5px] bg-accent/10 py-[6px] pr-[6px] pl-2 text-left hover:bg-accent/15"
          >
            <span className="shrink-0 text-[12px] text-accent">→</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-accent">
              {t('hosts.quickConnectPrefix')} <span className="font-mono">{q}</span>
            </span>
          </button>
        )}
        {newGroupOpen && (
          <div className="animate-[esh-fade_.12s_ease] pt-[2px] pb-1">
            <div className="flex items-center gap-[6px] rounded-[5px] border border-border-accent bg-accent/10 px-[6px] py-[5px]">
              <span className="text-[9px] text-accent">▸</span>
              <input
                autoFocus
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createGroup();
                }}
                placeholder={t('hosts.newGroup.placeholder')}
                maxLength={60}
                className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-text-strong outline-none placeholder:text-text-dim"
              />
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => {
                  setNewGroupOpen(false);
                  setNewGroupName('');
                }}
                className="flex size-4 shrink-0 items-center justify-center text-[13px] text-text-dim hover:text-text-strong"
              >
                ×
              </button>
            </div>
            <div className="px-2 py-[3px] text-[10.5px] text-text-dim">
              {t('hosts.newGroup.hint')}
            </div>
          </div>
        )}

        {noHostsAtAll && !newGroupOpen && groups.length === 0 ? (
          <div className="flex flex-col items-center gap-[11px] px-[18px] pt-10 text-center">
            <Icon name="server" size={30} className="text-text-faint" />
            <div className="text-[12.5px] font-medium text-text-body">{t('hosts.empty.title')}</div>
            <div className="max-w-[200px] text-[11.5px] leading-[1.5] text-text-muted">
              {t('hosts.empty.description')}
            </div>
            <button
              type="button"
              onClick={() => openDrawer()}
              className="mt-1 flex h-[30px] items-center gap-[7px] rounded-[6px] bg-accent px-[14px] text-[12px] font-medium text-white hover:bg-accent-hover"
            >
              <Icon name="plus" size={13} strokeWidth={2.5} />
              {t('hosts.empty.cta')}
            </button>
          </div>
        ) : nothingFound ? (
          <div className="flex flex-col items-center gap-[11px] px-[18px] pt-10 text-center">
            <Icon name="server" size={30} className="text-text-faint" />
            <div className="text-[12.5px] font-medium text-text-body">
              {t('hosts.noMatches.title')}
            </div>
            <div className="max-w-[200px] text-[11.5px] leading-[1.5] text-text-muted">
              {t('hosts.noMatches.description')}
            </div>
          </div>
        ) : (
          <>
            {groups.map((g) => {
              const groupHosts = hostsByGroup.get(g.id) ?? [];
              if (q !== '' && groupHosts.length === 0) return null; // HM-05: группа без совпадений скрыта
              const collapsed = g.collapsed && q === '';
              return (
                <div key={g.id} className="mb-[2px]">
                  <div className="group/head flex items-center">
                    <button
                      type="button"
                      onClick={() => void toggleGroup(g)}
                      className="flex min-w-0 flex-1 items-center gap-[6px] rounded-[5px] px-[6px] py-[5px] text-left hover:bg-bg-elevated"
                      aria-expanded={!collapsed}
                    >
                      <span
                        className="inline-flex text-[9px] text-text-muted transition-transform duration-[120ms]"
                        style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
                      >
                        ▸
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-body">
                        {g.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-dim">
                        {t('hosts.groupCount', { count: groupHosts.length })}
                      </span>
                    </button>
                    <button
                      type="button"
                      title={t('hosts.groupDelete.action')}
                      aria-label={t('hosts.groupDelete.action')}
                      onClick={() => requestGroupDelete(g)}
                      className="hidden size-[22px] shrink-0 items-center justify-center rounded-[4px] text-text-dim group-hover/head:flex hover:bg-bg-elevated hover:text-danger"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                    <button
                      type="button"
                      title={t('hosts.addServer')}
                      aria-label={t('hosts.addServer')}
                      onClick={() => openDrawer({ presetGroupId: g.id })}
                      className="flex size-[22px] shrink-0 items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
                    >
                      <Icon name="plus" size={13} />
                    </button>
                  </div>
                  {!collapsed &&
                    groupHosts.map((h) => (
                      <HostRow
                        key={h.id}
                        host={h}
                        connected={connectedHostIds.has(h.id)}
                        selected={selectedHostId === h.id}
                        isDragging={dragHost?.id === h.id}
                        dropIndicator={overRow?.id === h.id ? overRow.position : null}
                        onOpen={() => void connect(h.id)}
                        onSelect={() => setSelectedHostId(h.id)}
                        onEdit={() => openDrawer({ editHost: h })}
                        onDelete={() => setDeleteTarget(h)}
                        onDragStartReorder={() => setDragHost({ id: h.id, groupId: h.groupId ?? null })}
                        onDragOverReorder={(position) => {
                          if (dragHost?.groupId !== (h.groupId ?? null)) return;
                          setOverRow({ id: h.id, position });
                        }}
                        onDropReorder={() => void dropOnRow(groupHosts, h.id)}
                        onDragEndReorder={() => {
                          setDragHost(null);
                          setOverRow(null);
                        }}
                      />
                    ))}
                </div>
              );
            })}
            {ungrouped.map((h) => (
              <HostRow
                key={h.id}
                host={h}
                connected={connectedHostIds.has(h.id)}
                selected={selectedHostId === h.id}
                isDragging={dragHost?.id === h.id}
                dropIndicator={overRow?.id === h.id ? overRow.position : null}
                onOpen={() => void connect(h.id)}
                onSelect={() => setSelectedHostId(h.id)}
                onEdit={() => openDrawer({ editHost: h })}
                onDelete={() => setDeleteTarget(h)}
                onDragStartReorder={() => setDragHost({ id: h.id, groupId: h.groupId ?? null })}
                onDragOverReorder={(position) => {
                  if (dragHost?.groupId !== (h.groupId ?? null)) return;
                  setOverRow({ id: h.id, position });
                }}
                onDropReorder={() => void dropOnRow(ungrouped, h.id)}
                onDragEndReorder={() => {
                  setDragHost(null);
                  setOverRow(null);
                }}
              />
            ))}
          </>
        )}
      </div>

      {deleteGroupTarget && (
        <ConfirmDialog
          title={t('hosts.groupDelete.title')}
          confirmLabel={t('hosts.groupDelete.confirm')}
          danger
          onConfirm={() => void removeGroup(deleteGroupTarget)}
          onCancel={() => setDeleteGroupTarget(null)}
        >
          {t('hosts.groupDelete.body', { name: deleteGroupTarget.name })}
        </ConfirmDialog>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t('hosts.deleteConfirm.title')}
          confirmLabel={t('hosts.deleteConfirm.confirm')}
          danger
          onConfirm={() => void removeHost(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        >
          {t('hosts.deleteConfirm.body', { name: deleteTarget.name })}
        </ConfirmDialog>
      )}

      {/* SNIP-07: выбор судьбы серверных сниппетов при удалении хоста */}
      {snippetHostTarget && (
        <ConfirmDialog
          title={t('hostSnippets.title')}
          confirmLabel={t('hostSnippets.makeGlobal')}
          onConfirm={() => void resolveAndDelete(snippetHostTarget, 'make-global')}
          onCancel={() => setSnippetHostTarget(null)}
        >
          <div className="mb-3">{t('hostSnippets.body', { name: snippetHostTarget.name })}</div>
          <button
            type="button"
            onClick={() => void resolveAndDelete(snippetHostTarget, 'delete')}
            className="text-[12px] text-danger hover:underline"
          >
            {t('hostSnippets.delete')}
          </button>
        </ConfirmDialog>
      )}

      {/* SSH-05 тикет 05: удаляемый хост используется как jump-хост у других */}
      {jumpDependentsTarget && (
        <ConfirmDialog
          title={t('hosts.deleteJumpWarning.title')}
          confirmLabel={t('hosts.deleteJumpWarning.confirm')}
          danger
          onConfirm={() => void deleteHostOrWarn(jumpDependentsTarget.host, true)}
          onCancel={() => setJumpDependentsTarget(null)}
        >
          {t('hosts.deleteJumpWarning.body', {
            name: jumpDependentsTarget.host.name,
            names: jumpDependentsTarget.dependents.map((h) => h.name).join(', ')
          })}
        </ConfirmDialog>
      )}
    </aside>
  );
});
