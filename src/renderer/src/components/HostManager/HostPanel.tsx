import type { JSX } from 'react';
import { forwardRef, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Host, HostGroup } from '@shared/hosts';
import type { ImportPreview } from '@shared/hosts';
import { useHosts } from '@/stores/hosts';
import { useSessions } from '@/stores/sessions';
import { usePanels } from '@/stores/panels';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ImportDialog } from './ImportDialog';
import { ExternalImportDialog } from './ExternalImportDialog';

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
  onOpen,
  onSelect,
  onEdit,
  onDelete
}: {
  host: Host;
  connected: boolean;
  selected: boolean;
  onOpen: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      // Draggable на таб-бар: открывает/фокусирует сессию (Design_Brief §4.4)
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-lucidssh-host', String(host.id));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={
        selected
          ? 'group relative flex cursor-default items-center gap-2 rounded-[5px] py-[5px] pr-1 pl-3 before:absolute before:top-1 before:bottom-1 before:left-0 before:w-[2px] before:rounded-full before:bg-accent before:content-[""] bg-[rgba(99,102,241,0.12)]'
          : 'group relative flex cursor-default items-center gap-2 rounded-[5px] py-[5px] pr-1 pl-3 hover:bg-bg-elevated'
      }
    >
      {connected ? (
        <span className="size-[7px] shrink-0 rounded-full bg-success-bright" />
      ) : (
        <span className="size-[7px] shrink-0 rounded-full border-[1.5px] border-text-faint" />
      )}
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[12.5px] font-medium ${selected ? 'text-text-strong' : 'text-text-body group-hover:text-text-strong'}`}
        >
          {host.name}
        </div>
        <div className="truncate font-mono text-[10.5px] text-text-dim">{host.address}</div>
      </div>
      {connected && (
        <span className="shrink-0 rounded-[3px] bg-[rgba(34,197,94,0.14)] px-[5px] py-[1px] text-[9px] font-bold text-success-bright group-hover:hidden">
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
          ✎
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
          🗑
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
  const { sessions, connect } = useSessions();
  const { openSettings } = usePanels();
  const [query, setQuery] = useState('');
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);

  const connectedHostIds = useMemo(
    () => new Set(sessions.filter((s) => s.status === 'connected').map((s) => s.hostId)),
    [sessions]
  );
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Host | null>(null);
  const [snippetHostTarget, setSnippetHostTarget] = useState<Host | null>(null);
  const [importState, setImportState] = useState<{ json: string; preview: ImportPreview } | null>(
    null
  );
  const [importError, setImportError] = useState(false);
  const [extImportOpen, setExtImportOpen] = useState(false);

  const pickImport = async (): Promise<void> => {
    setImportError(false);
    try {
      const res = await window.lucidSSH.pickImportHosts();
      if (res) setImportState(res);
    } catch {
      setImportError(true);
    }
  };

  const q = query.trim();

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

  const toggleGroup = async (g: HostGroup): Promise<void> => {
    await window.lucidSSH.setGroupCollapsed(g.id, !g.collapsed);
    await refresh();
  };

  const removeHost = async (host: Host): Promise<void> => {
    // SNIP-07: серверные сниппеты нельзя удалять молча — спрашиваем пользователя
    if (await window.lucidSSH.hostHasSnippets(host.id)) {
      setDeleteTarget(null);
      setSnippetHostTarget(host);
      return;
    }
    await window.lucidSSH.deleteHost(host.id);
    setDeleteTarget(null);
    await refresh();
  };

  const resolveAndDelete = async (host: Host, action: 'delete' | 'make-global'): Promise<void> => {
    await window.lucidSSH.resolveHostSnippets(host.id, action);
    await window.lucidSSH.deleteHost(host.id);
    setSnippetHostTarget(null);
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
      <div className="flex h-[38px] shrink-0 items-center justify-between pr-2 pl-3">
        <span className="text-[11px] font-semibold tracking-[0.05em] text-text-muted uppercase">
          {t('hosts.title')}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            title={t('hosts.addServer')}
            aria-label={t('hosts.addServer')}
            onClick={() => openDrawer()}
            className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            +
          </button>
          <button
            type="button"
            title={t('hosts.addGroup')}
            aria-label={t('hosts.addGroup')}
            onClick={() => setNewGroupOpen(true)}
            className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            ⊞
          </button>
          <button
            type="button"
            title={t('hosts.export.button')}
            aria-label={t('hosts.export.button')}
            onClick={() => void window.lucidSSH.exportHosts()}
            className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            ⤒
          </button>
          <button
            type="button"
            title={t('hosts.import.button')}
            aria-label={t('hosts.import.button')}
            onClick={() => void pickImport()}
            className="flex size-[22px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            ⤓
          </button>
        </div>
      </div>

      {importError && (
        <div className="mx-3 mt-2 rounded-[6px] border border-danger/30 bg-danger/10 px-3 py-2 text-[11.5px] text-danger-text">
          {t('hosts.import.invalidFile')}
        </div>
      )}

      <div className="px-3 pt-[10px] pb-2">
        <input
          type="text"
          placeholder={t('hosts.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-7 w-full rounded-[4px] border border-border-default bg-bg-base px-2 text-[12px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {newGroupOpen && (
          <div className="mb-2 rounded-[5px] border border-border-accent bg-accent/10 p-2">
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createGroup();
                if (e.key === 'Escape') {
                  setNewGroupOpen(false);
                  setNewGroupName('');
                }
              }}
              placeholder={t('hosts.newGroup.placeholder')}
              maxLength={60}
              className="h-7 w-full rounded-[4px] border border-border-strong bg-bg-base px-2 text-[12px] text-text-strong outline-none focus:border-accent"
            />
            <div className="mt-1 text-[10.5px] text-text-dim">{t('hosts.newGroup.hint')}</div>
          </div>
        )}

        {noHostsAtAll && !newGroupOpen && groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 pt-10 text-center">
            <div className="text-[26px] text-text-faint">▤</div>
            <div className="text-[13px] font-semibold text-text-body">{t('hosts.empty.title')}</div>
            <div className="text-[12px] leading-relaxed text-text-dim">
              {t('hosts.empty.description')}
            </div>
            <button
              type="button"
              onClick={() => openDrawer()}
              className="mt-2 h-8 rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover"
            >
              + {t('hosts.empty.cta')}
            </button>
          </div>
        ) : nothingFound ? (
          <div className="flex flex-col items-center gap-1 px-3 pt-10 text-center">
            <div className="text-[13px] font-semibold text-text-body">
              {t('hosts.noMatches.title')}
            </div>
            <div className="text-[12px] text-text-dim">{t('hosts.noMatches.description')}</div>
          </div>
        ) : (
          <>
            {groups.map((g) => {
              const groupHosts = hostsByGroup.get(g.id) ?? [];
              if (q !== '' && groupHosts.length === 0) return null; // HM-05: группа без совпадений скрыта
              const collapsed = g.collapsed && q === '';
              return (
                <div key={g.id} className="mb-1">
                  <div className="group flex items-center gap-1 rounded-[5px] px-1 py-[3px] hover:bg-bg-elevated">
                    <button
                      type="button"
                      onClick={() => void toggleGroup(g)}
                      className="flex min-w-0 flex-1 items-center gap-[6px] text-left"
                      aria-expanded={!collapsed}
                    >
                      <span
                        className="inline-block text-[9px] text-text-dim transition-transform duration-[120ms]"
                        style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
                      >
                        ▶
                      </span>
                      <span className="truncate text-[11px] font-semibold tracking-[0.04em] text-text-muted uppercase">
                        {g.name}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-text-dim">
                        {t('hosts.groupCount', { count: groupHosts.length })}
                      </span>
                    </button>
                    <button
                      type="button"
                      title={t('hosts.addServer')}
                      aria-label={t('hosts.addServer')}
                      onClick={() => openDrawer({ presetGroupId: g.id })}
                      className="hidden size-[18px] items-center justify-center rounded-[4px] text-text-dim group-hover:flex hover:bg-bg-elevated-2 hover:text-text-strong"
                    >
                      +
                    </button>
                  </div>
                  {!collapsed &&
                    groupHosts.map((h) => (
                      <HostRow
                        key={h.id}
                        host={h}
                        connected={connectedHostIds.has(h.id)}
                        selected={selectedHostId === h.id}
                        onOpen={() => void connect(h.id)}
                        onSelect={() => setSelectedHostId(h.id)}
                        onEdit={() => openDrawer({ editHost: h })}
                        onDelete={() => setDeleteTarget(h)}
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
                onOpen={() => void connect(h.id)}
                onSelect={() => setSelectedHostId(h.id)}
                onEdit={() => openDrawer({ editHost: h })}
                onDelete={() => setDeleteTarget(h)}
              />
            ))}
          </>
        )}
      </div>

      <div className="flex shrink-0 gap-1 border-t border-border-hairline px-[10px] py-2">
        <button
          type="button"
          onClick={openSettings}
          className="h-7 flex-1 rounded-[4px] text-[12px] text-text-muted hover:bg-bg-elevated hover:text-text-strong"
        >
          {t('hosts.footer.settings')}
        </button>
        <button
          type="button"
          onClick={() => setExtImportOpen(true)}
          className="h-7 flex-1 rounded-[4px] text-[12px] text-text-muted hover:bg-bg-elevated hover:text-text-strong"
        >
          {t('hosts.footer.importPutty')}
        </button>
      </div>

      {importState && (
        <ImportDialog
          json={importState.json}
          preview={importState.preview}
          onClose={() => setImportState(null)}
        />
      )}

      {extImportOpen && <ExternalImportDialog onClose={() => setExtImportOpen(false)} />}

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
    </aside>
  );
});
