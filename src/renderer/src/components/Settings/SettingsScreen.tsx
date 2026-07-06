import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '@shared/config';
import type { KnownHostView } from '@shared/ssh';
import type { ImportPreview } from '@shared/hosts';
import { ImportDialog } from '@/components/HostManager/ImportDialog';
import { useConfig, getCurrentConfig } from '@/stores/config';
import { usePanels } from '@/stores/panels';
import { useUpdates } from '@/stores/updates';
import { useSessions } from '@/stores/sessions';
import { applyTerminalConfig } from '@/components/Terminal/XtermView';
import { Card, Segment, SectionTitle, Toggle, ToggleRow } from './controls';
import { Icon } from '@/components/common/Icon';

/**
 * Страница настроек (SET-01…08; Design_Brief §3.10; скриншот 08). Отдельная
 * полностраничная поверхность (не модалка), Ctrl+, или кнопка в панели хостов.
 * Разделы: Терминал, Подключение, Безопасность, Интерфейс, Горячие клавиши,
 * О программе. Запись немедленная (SET-07) — кнопки «Сохранить» нет.
 */

type Section = 'terminal' | 'connection' | 'security' | 'interface' | 'hotkeys' | 'about';

const FONTS = ['JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code'];
const SIZE_MAP: Record<'small' | 'medium' | 'large', number> = { small: 12, medium: 14, large: 16 };
function sizeKey(px: number): 'small' | 'medium' | 'large' {
  if (px <= 12) return 'small';
  if (px >= 15) return 'large';
  return 'medium';
}

export function SettingsScreen({ onOpenGuide }: { onOpenGuide: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { config, update } = useConfig();
  const { closeSettings } = usePanels();
  const [section, setSection] = useState<Section>('terminal');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSettings]);

  // Настройки терминала применяем к живым сессиям сразу (SET-02).
  const updateTerminal = useCallback(
    async (path: string, value: string | number | boolean) => {
      await update(path, value);
      const c = getCurrentConfig();
      if (c) applyTerminalConfig(c);
    },
    [update]
  );

  if (!config) return <div className="fixed inset-0 z-50 bg-bg-base" />;

  const sections: { k: Section; label: string }[] = [
    { k: 'terminal', label: t('settings.sections.terminal') },
    { k: 'connection', label: t('settings.sections.connection') },
    { k: 'security', label: t('settings.sections.security') },
    { k: 'interface', label: t('settings.sections.interface') },
    { k: 'hotkeys', label: t('settings.sections.hotkeys') },
    { k: 'about', label: t('settings.sections.about') }
  ];

  return (
    <div className="animate-[esh-fade_.15s_ease] fixed inset-0 z-50 flex flex-col bg-bg-base">
      {/* Шапка */}
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border-default px-5">
        <div className="flex items-center gap-2">
          <Icon name="settings" size={17} className="text-text-muted" />
          <span className="text-[15px] font-semibold text-text-primary">{t('settings.title')}</span>
          <span className="rounded-[4px] border border-border-strong px-[6px] py-[1px] font-mono text-[10.5px] text-text-dim">
            Ctrl + ,
          </span>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={closeSettings}
          className="flex size-[26px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Навигация */}
        <nav className="w-[210px] shrink-0 border-r border-border-default p-3">
          {sections.map((s) => (
            <button
              key={s.k}
              type="button"
              onClick={() => setSection(s.k)}
              className={`mb-[2px] block w-full rounded-[5px] px-3 py-2 text-left text-[13px] ${
                section === s.k
                  ? 'bg-bg-elevated font-medium text-text-strong'
                  : 'text-text-muted hover:text-text-strong'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Контент */}
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-[640px]">
            {section === 'terminal' && (
              <TerminalSection config={config} update={update} updateTerminal={updateTerminal} />
            )}
            {section === 'connection' && <ConnectionSection config={config} update={update} />}
            {section === 'security' && <SecuritySection config={config} update={update} />}
            {section === 'interface' && <InterfaceSection config={config} update={update} />}
            {section === 'hotkeys' && <HotkeysSection />}
            {section === 'about' && <AboutSection onOpenGuide={onOpenGuide} />}
          </div>
        </div>
      </div>
    </div>
  );
}

type UpdateFn = (path: string, value: string | number | boolean) => Promise<void>;

function TerminalSection({
  config,
  update,
  updateTerminal
}: {
  config: AppConfig;
  update: UpdateFn;
  updateTerminal: UpdateFn;
}): JSX.Element {
  const { t } = useTranslation();
  const guardOn = config.guard.globalEnabled;
  return (
    <>
      <SectionTitle>{t('settings.sections.terminal')}</SectionTitle>
      <div className="space-y-3">
        <Card title={t('settings.terminal.font')}>
          <div className="flex flex-wrap gap-2">
            {FONTS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => void updateTerminal('terminal.font', f)}
                className={`rounded-[4px] px-3 py-[5px] font-mono text-[12px] ${
                  config.terminal.font === f
                    ? 'bg-accent text-white'
                    : 'border border-border-strong bg-bg-base text-text-dim hover:text-text-strong'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </Card>

        <Card title={t('settings.terminal.fontSize')}>
          <Segment
            value={sizeKey(config.terminal.fontSize)}
            onChange={(k) => void updateTerminal('terminal.fontSize', SIZE_MAP[k])}
            options={[
              { key: 'small', label: t('settings.terminal.sizeSmall') },
              { key: 'medium', label: t('settings.terminal.sizeMedium') },
              { key: 'large', label: t('settings.terminal.sizeLarge') }
            ]}
          />
        </Card>

        <ToggleRow
          title={t('settings.terminal.bell')}
          desc={t('settings.terminal.bellDesc')}
          on={config.terminal.bell === 'sound'}
          onChange={(v) => void update('terminal.bell', v ? 'sound' : 'off')}
        />
        <ToggleRow
          title={t('settings.terminal.brightBold')}
          desc={t('settings.terminal.brightBoldDesc')}
          on={config.terminal.brightBold}
          onChange={(v) => void updateTerminal('terminal.brightBold', v)}
        />
        <ToggleRow
          title={t('settings.terminal.selectCopy')}
          desc={t('settings.terminal.selectCopyDesc')}
          on={config.terminal.selectToCopy}
          onChange={(v) => void update('terminal.selectToCopy', v)}
        />
        <ToggleRow
          title={t('settings.terminal.rightPaste')}
          desc={t('settings.terminal.rightPasteDesc')}
          on={config.terminal.rightClickPaste}
          onChange={(v) => void update('terminal.rightClickPaste', v)}
        />

        {/* Ввод прямо в консоли — с предупреждением о Страже (§4–5) */}
        <div className="rounded-[8px] border border-border-default bg-bg-panel px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-text-strong">
                {t('settings.terminal.inlineInput')}
              </div>
              <div className="mt-[2px] text-[12px] text-text-dim">
                {t('settings.terminal.inlineInputDesc')}
              </div>
            </div>
            <Toggle
              on={config.terminal.inlineInput}
              onChange={(v) => void update('terminal.inlineInput', v)}
              label={t('settings.terminal.inlineInput')}
            />
          </div>
          {config.terminal.inlineInput && guardOn && (
            <div className="mt-3 flex items-start gap-2 rounded-[6px] border border-warning/25 bg-warning/10 px-3 py-2 text-[11.5px] text-warning-text">
              <Icon name="alert" size={14} className="mt-[1px] shrink-0" />
              <span>{t('settings.terminal.inlineInputGuardWarn')}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ConnectionSection({ config, update }: { config: AppConfig; update: UpdateFn }): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <SectionTitle>{t('settings.sections.connection')}</SectionTitle>
      <div className="space-y-3">
        <NumberCard
          title={t('settings.connection.keepalive')}
          desc={t('settings.connection.keepaliveDesc')}
          value={config.connection.keepaliveIntervalSec}
          min={5}
          max={3600}
          onCommit={(n) => void update('connection.keepaliveIntervalSec', n)}
        />
        <NumberCard
          title={t('settings.connection.timeout')}
          desc={t('settings.connection.timeoutDesc')}
          value={config.connection.connectTimeoutSec}
          min={3}
          max={120}
          onCommit={(n) => void update('connection.connectTimeoutSec', n)}
        />
        <ToggleRow
          title={t('settings.connection.autoreconnect')}
          desc={t('settings.connection.autoreconnectDesc')}
          on={config.connection.autoreconnect}
          onChange={(v) => void update('connection.autoreconnect', v)}
        />
      </div>
    </>
  );
}

function NumberCard({
  title,
  desc,
  value,
  min,
  max,
  onCommit
}: {
  title: string;
  desc: string;
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (): void => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
    else setDraft(String(value));
  };
  return (
    <div className="flex items-center justify-between gap-4 rounded-[8px] border border-border-default bg-bg-panel px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-text-strong">{title}</div>
        <div className="mt-[2px] text-[12px] text-text-dim">{desc}</div>
      </div>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="h-[32px] w-[80px] shrink-0 rounded-[5px] border border-border-strong bg-bg-base px-2 text-center text-[13px] text-text-strong outline-none focus:border-accent"
      />
    </div>
  );
}

function SecuritySection({ config, update }: { config: AppConfig; update: UpdateFn }): JSX.Element {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<KnownHostView[]>([]);
  const refresh = useCallback(() => void window.lucidSSH.listKnownHosts().then(setHosts), []);
  useEffect(() => refresh(), [refresh]);

  // Экспорт/импорт хостов JSON (EXP-01…04) — по дизайну живут в настройках, не в шапке.
  const [importState, setImportState] = useState<{ json: string; preview: ImportPreview } | null>(
    null
  );
  const [importError, setImportError] = useState(false);
  const pickImport = async (): Promise<void> => {
    setImportError(false);
    try {
      const res = await window.lucidSSH.pickImportHosts();
      if (res) setImportState(res);
    } catch {
      setImportError(true);
    }
  };

  return (
    <>
      <SectionTitle>{t('settings.sections.security')}</SectionTitle>
      <div className="space-y-3">
        <div className="rounded-[8px] border border-border-default bg-bg-panel px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-text-strong">
                {t('settings.security.guard')}
              </div>
              <div className="mt-[2px] text-[12px] text-text-dim">
                {t('settings.security.guardDesc')}
              </div>
            </div>
            <Toggle
              on={config.guard.globalEnabled}
              onChange={(v) => void update('guard.globalEnabled', v)}
              label={t('settings.security.guard')}
            />
          </div>
        </div>

        <ToggleRow
          title={t('settings.security.history')}
          desc={t('settings.security.historyDesc')}
          on={config.history.enabled}
          onChange={(v) => void update('history.enabled', v)}
        />

        <Card title={t('settings.security.knownHosts')}>
          {hosts.length === 0 ? (
            <div className="py-2 text-[12px] text-text-dim">{t('settings.security.knownEmpty')}</div>
          ) : (
            <div className="space-y-1">
              {hosts.map((h) => (
                <div
                  key={h.line}
                  className="flex items-center justify-between gap-3 rounded-[5px] px-2 py-[6px] hover:bg-bg-base"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] text-text-strong">{h.host}</div>
                    <div className="truncate font-mono text-[10.5px] text-text-dim">
                      {h.keyType} · {h.fingerprint}
                    </div>
                  </div>
                  <button
                    type="button"
                    title={t('settings.security.knownDelete')}
                    aria-label={t('settings.security.knownDelete')}
                    onClick={() => void window.lucidSSH.deleteKnownHost(h.line).then(refresh)}
                    className="flex size-[26px] shrink-0 items-center justify-center rounded-[4px] text-text-dim hover:bg-danger/15 hover:text-danger-text"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t('settings.security.hostData')}>
          <div className="mb-2 text-[12px] text-text-dim">{t('settings.security.hostDataDesc')}</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void window.lucidSSH.exportHosts()}
              className="flex h-[32px] items-center gap-2 rounded-[6px] border border-border-strong bg-bg-base px-3 text-[12.5px] text-text-body hover:text-text-strong"
            >
              <Icon name="upload" size={14} /> {t('settings.security.exportHosts')}
            </button>
            <button
              type="button"
              onClick={() => void pickImport()}
              className="flex h-[32px] items-center gap-2 rounded-[6px] border border-border-strong bg-bg-base px-3 text-[12.5px] text-text-body hover:text-text-strong"
            >
              <Icon name="download" size={14} /> {t('settings.security.importHosts')}
            </button>
          </div>
          {importError && (
            <div className="mt-2 text-[11.5px] text-danger-text">{t('hosts.import.invalidFile')}</div>
          )}
        </Card>
      </div>

      {importState && (
        <ImportDialog
          json={importState.json}
          preview={importState.preview}
          onClose={() => setImportState(null)}
        />
      )}
    </>
  );
}

function InterfaceSection({ config, update }: { config: AppConfig; update: UpdateFn }): JSX.Element {
  const { t } = useTranslation();
  const h = config.ui.hints;
  const expertActive =
    !h.commandCatalog && !h.outputTooltips && !h.errorPanel && !h.connectionDialog;

  const enableExpert = async (): Promise<void> => {
    await update('ui.expertMode', true);
    await update('ui.hints.commandCatalog', false);
    await update('ui.hints.outputTooltips', false);
    await update('ui.hints.errorPanel', false);
    await update('ui.hints.connectionDialog', false);
  };

  return (
    <>
      <SectionTitle>{t('settings.sections.interface')}</SectionTitle>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-[8px] border border-accent/25 bg-accent/5 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-text-strong">
              {t('settings.interface.expert')}
            </div>
            <div className="mt-[2px] text-[12px] text-text-dim">
              {t('settings.interface.expertDesc')}
            </div>
          </div>
          <button
            type="button"
            disabled={expertActive}
            onClick={() => void enableExpert()}
            className="h-[32px] shrink-0 rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {expertActive ? t('settings.interface.expertOn') : t('settings.interface.expertEnable')}
          </button>
        </div>

        <ToggleRow
          title={t('settings.interface.hintCatalog')}
          desc={t('settings.interface.hintCatalogDesc')}
          on={h.commandCatalog}
          onChange={(v) => void update('ui.hints.commandCatalog', v)}
        />
        <ToggleRow
          title={t('settings.interface.hintTooltips')}
          desc={t('settings.interface.hintTooltipsDesc')}
          on={h.outputTooltips}
          onChange={(v) => void update('ui.hints.outputTooltips', v)}
        />
        <ToggleRow
          title={t('settings.interface.hintError')}
          desc={t('settings.interface.hintErrorDesc')}
          on={h.errorPanel}
          onChange={(v) => void update('ui.hints.errorPanel', v)}
        />
        <ToggleRow
          title={t('settings.interface.hintConnect')}
          desc={t('settings.interface.hintConnectDesc')}
          on={h.connectionDialog}
          onChange={(v) => void update('ui.hints.connectionDialog', v)}
        />

        <div className="pt-1">
          <SectionTitle>{t('settings.interface.notifications')}</SectionTitle>
        </div>
        <ToggleRow
          title={t('settings.interface.systemToasts')}
          desc={t('settings.interface.systemToastsDesc')}
          on={config.ui.notifications.systemToasts}
          onChange={(v) => void update('ui.notifications.systemToasts', v)}
        />
        <NumberCard
          title={t('settings.interface.longCommand')}
          desc={t('settings.interface.longCommandDesc')}
          value={config.ui.notifications.longCommandThresholdSec}
          min={0}
          max={86400}
          onCommit={(n) => void update('ui.notifications.longCommandThresholdSec', n)}
        />
      </div>
    </>
  );
}

interface Hotkey {
  keys: string;
  action: string;
}

function HotkeysSection(): JSX.Element {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const all: Hotkey[] = useMemo(
    () => [
      { keys: 'Ctrl + ,', action: t('settings.hk.openSettings') },
      { keys: 'Ctrl + H', action: t('settings.hk.openHistory') },
      { keys: 'Ctrl + L', action: t('settings.hk.openCatalog') },
      { keys: 'Ctrl + F', action: t('settings.hk.search') },
      { keys: 'Ctrl + W', action: t('settings.hk.closeTab') },
      { keys: 'Ctrl + Shift + C', action: t('settings.hk.copy') },
      { keys: 'Ctrl + Shift + V', action: t('settings.hk.paste') },
      { keys: 'Esc', action: t('settings.hk.closePanel') },
      { keys: 'F1', action: t('settings.hk.guide') }
    ],
    [t]
  );
  const query = q.trim().toLowerCase();
  const rows = all.filter(
    (r) => !query || r.action.toLowerCase().includes(query) || r.keys.toLowerCase().includes(query)
  );

  return (
    <>
      <SectionTitle>{t('settings.sections.hotkeys')}</SectionTitle>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('settings.hk.searchPlaceholder')}
        className="mb-3 h-9 w-full rounded-[6px] border border-border-strong bg-bg-base px-3 text-[13px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent"
      />
      <div className="overflow-hidden rounded-[8px] border border-border-default">
        {rows.length === 0 ? (
          <div className="bg-bg-panel py-6 text-center text-[12.5px] text-text-dim">
            {t('settings.hk.noMatches')}
          </div>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.keys}
              className={`flex items-center justify-between px-4 py-[10px] ${
                i % 2 ? 'bg-bg-base' : 'bg-bg-panel'
              }`}
            >
              <span className="text-[13px] text-text-body">{r.action}</span>
              <span className="rounded-[4px] border border-border-strong px-[7px] py-[2px] font-mono text-[11px] text-text-muted">
                {r.keys}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function UpdatesCard(): JSX.Element {
  const { t } = useTranslation();
  const { config, update } = useConfig();
  const { status, check, download, install } = useUpdates();
  const { sessions } = useSessions();
  const [confirmInstall, setConfirmInstall] = useState(false);

  const activeCount = sessions.filter(
    (s) => s.status === 'connected' || s.status === 'connecting' || s.status === 'reconnecting'
  ).length;
  const state = status?.state ?? 'idle';
  const busy = state === 'checking' || state === 'downloading';

  const statusLine = (): string => {
    if (status?.notConfigured) return t('settings.updates.notConfigured');
    switch (state) {
      case 'checking':
        return t('settings.updates.checking');
      case 'available':
        return t('settings.updates.available', { version: status?.info?.version ?? '' });
      case 'not-available':
        return t('settings.updates.upToDate');
      case 'downloading':
        return t('settings.updates.downloading', { percent: Math.round(status?.progress?.percent ?? 0) });
      case 'downloaded':
        return t('settings.updates.downloaded', { version: status?.info?.version ?? '' });
      case 'error':
        return t('settings.updates.error');
      default:
        return t('settings.updates.idle');
    }
  };

  return (
    <div className="rounded-[8px] border border-border-default bg-bg-panel px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-text-strong">
            {t('settings.updates.title')}
          </div>
          <div className="mt-[2px] text-[12px] text-text-dim">{statusLine()}</div>
        </div>
        {state === 'available' ? (
          <button
            type="button"
            onClick={() => void download()}
            className="h-[32px] shrink-0 rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover"
          >
            {t('settings.updates.download')}
          </button>
        ) : state === 'downloaded' ? (
          <button
            type="button"
            onClick={() => setConfirmInstall(true)}
            className="h-[32px] shrink-0 rounded-[6px] bg-accent px-4 text-[12.5px] font-medium text-white hover:bg-accent-hover"
          >
            {t('settings.updates.install')}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void check()}
            className="h-[32px] shrink-0 rounded-[6px] border border-border-strong bg-bg-base px-4 text-[12.5px] text-text-body hover:text-text-strong disabled:opacity-50"
          >
            {t('settings.updates.check')}
          </button>
        )}
      </div>

      {/* Согласие на установку с предупреждением о живых SSH-сессиях (UPD-02) */}
      {confirmInstall && (
        <div className="mt-3 rounded-[6px] border border-warning/25 bg-warning/10 px-3 py-2">
          <div className="text-[11.5px] text-warning-text">
            {activeCount > 0
              ? t('settings.updates.installWarnSessions', { count: activeCount })
              : t('settings.updates.installWarn')}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void install()}
              className="h-[30px] rounded-[6px] bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent-hover"
            >
              {t('settings.updates.installNow')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmInstall(false)}
              className="h-[30px] rounded-[6px] bg-bg-tab-active px-3 text-[12px] text-text-body hover:text-text-strong"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border-hairline pt-3">
        <div className="min-w-0">
          <div className="text-[12.5px] text-text-body">{t('settings.updates.autoCheck')}</div>
          <div className="text-[11px] text-text-dim">{t('settings.updates.autoCheckDesc')}</div>
        </div>
        <Toggle
          on={config?.updates.autoCheck ?? true}
          onChange={(v) => void update('updates.autoCheck', v)}
          label={t('settings.updates.autoCheck')}
        />
      </div>
    </div>
  );
}

function AboutSection({ onOpenGuide }: { onOpenGuide: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { config } = useConfig();
  const { closeSettings } = usePanels();
  const [confirmReset, setConfirmReset] = useState(false);

  const doReset = async (): Promise<void> => {
    await window.lucidSSH.resetConfig();
    setConfirmReset(false);
    // Перечитываем конфиг из main через полную перезагрузку окна — проще и надёжнее,
    // чем ре-инициализировать все сторы.
    window.location.reload();
  };

  return (
    <>
      <SectionTitle>{t('settings.sections.about')}</SectionTitle>
      <div className="space-y-3">
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex size-[44px] items-center justify-center rounded-[10px] bg-accent/15 text-lavender">
              <Icon name="file" size={22} />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-text-strong">LucidSSH</div>
              <div className="text-[12px] text-text-dim">
                {t('settings.about.version', { version: config?.version ?? '—' })}
              </div>
            </div>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-text-muted">
            {t('settings.about.tagline')}
          </p>
        </Card>

        <UpdatesCard />

        <Card title={t('settings.about.help')}>
          <button
            type="button"
            onClick={() => {
              closeSettings();
              onOpenGuide();
            }}
            className="h-[34px] rounded-[6px] border border-border-strong bg-bg-base px-4 text-[12.5px] text-text-body hover:text-text-strong"
          >
            {t('settings.about.openGuide')}
          </button>
        </Card>

        <div className="rounded-[8px] border border-danger/25 bg-danger/5 px-4 py-3">
          <div className="text-[13.5px] font-semibold text-text-strong">
            {t('settings.about.reset')}
          </div>
          <div className="mt-[2px] mb-3 text-[12px] text-text-dim">
            {t('settings.about.resetDesc')}
          </div>
          {confirmReset ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void doReset()}
                className="h-[32px] rounded-[6px] bg-danger px-4 text-[12.5px] font-medium text-white hover:opacity-90"
              >
                {t('settings.about.resetConfirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="h-[32px] rounded-[6px] bg-bg-tab-active px-4 text-[12.5px] text-text-body hover:text-text-strong"
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="h-[32px] rounded-[6px] border border-danger/40 px-4 text-[12.5px] text-danger-text hover:bg-danger/10"
            >
              {t('settings.about.resetBtn')}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
