import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthMethod, HostInput } from '@shared/hosts';
import { useHosts } from '@/stores/hosts';

/**
 * Drawer «Новое подключение» (скриншот 03-Newconn, Design_Brief §3.5):
 * выезжает справа (esh-slidein), поля с подсказками для новичков (§5.3 ТЗ).
 * Секрет уходит отдельным аргументом IPC сразу в keychain; при редактировании
 * реальное значение НИКОГДА не подставляется — только состояние «сохранён» (§10 гайда).
 */

interface FormState {
  name: string;
  address: string;
  port: string;
  username: string;
  authMethod: AuthMethod;
  keyPath: string;
  groupId: string; // '' = без группы
  secret: string; // пароль или passphrase; не хранится дольше сабмита
}

export function NewConnectionDrawer(): JSX.Element | null {
  const { t } = useTranslation();
  const { drawer, closeDrawer, groups, refresh } = useHosts();
  const [form, setForm] = useState<FormState | null>(null);
  const [hasSavedSecret, setHasSavedSecret] = useState(false);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const editHost = drawer.editHost;

  useEffect(() => {
    if (!drawer.open) {
      setForm(null);
      return;
    }
    setError(false);
    setHasSavedSecret(false);
    if (editHost) {
      setForm({
        name: editHost.name,
        address: editHost.address,
        port: String(editHost.port),
        username: editHost.username,
        authMethod: editHost.authMethod,
        keyPath: editHost.keyPath ?? '',
        groupId: editHost.groupId !== undefined ? String(editHost.groupId) : '',
        secret: ''
      });
      void window.lucidSSH.hostHasSecret(editHost.id).then(setHasSavedSecret);
    } else {
      setForm({
        name: '',
        address: '',
        port: '22',
        username: '',
        authMethod: 'password',
        keyPath: '',
        groupId: drawer.presetGroupId !== undefined ? String(drawer.presetGroupId) : '',
        secret: ''
      });
    }
  }, [drawer.open, editHost, drawer.presetGroupId]);

  useEffect(() => {
    if (!drawer.open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer.open, closeDrawer]);

  if (!drawer.open || !form) return null;

  const set = (patch: Partial<FormState>): void => setForm({ ...form, ...patch });

  const portNum = Number(form.port);
  const valid =
    form.name.trim().length > 0 &&
    form.address.trim().length > 0 &&
    form.username.trim().length > 0 &&
    Number.isInteger(portNum) &&
    portNum >= 1 &&
    portNum <= 65535 &&
    (form.authMethod === 'password' || form.keyPath.trim().length > 0);

  const submit = async (): Promise<void> => {
    if (!valid || saving) return;
    setSaving(true);
    setError(false);
    const input: HostInput = {
      name: form.name.trim(),
      address: form.address.trim(),
      port: portNum,
      username: form.username.trim(),
      authMethod: form.authMethod,
      keyPath: form.authMethod === 'key' ? form.keyPath.trim() : undefined,
      groupId: form.groupId !== '' ? Number(form.groupId) : undefined,
      guardEnabled: editHost?.guardEnabled ?? true,
      proxyJump: editHost?.proxyJump,
      note: editHost?.note
    };
    const secret = form.secret.length > 0 ? form.secret : undefined;
    try {
      if (editHost) {
        await window.lucidSSH.updateHost(editHost.id, input, secret);
      } else {
        await window.lucidSSH.createHost(input, secret);
      }
      await refresh();
      closeDrawer();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const label = 'mb-1 block text-[12.5px] font-semibold text-text-strong';
  const helper = 'mt-1 text-[11px] text-lavender';
  const inputCls =
    'h-[34px] w-full rounded-[4px] border border-border-strong bg-bg-base px-[10px] text-[13px] text-text-strong outline-none placeholder:text-text-dim focus:border-accent';

  return (
    <div
      className="animate-[esh-fade_.15s_ease] fixed inset-0 z-40 bg-black/45"
      onClick={closeDrawer}
      role="presentation"
    >
      <aside
        className="animate-[esh-slidein_.22s_cubic-bezier(.2,.7,.3,1)] absolute top-0 right-0 flex h-full w-[360px] flex-col border-l border-border-default bg-bg-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={editHost ? t('conn.titleEdit') : t('conn.titleNew')}
      >
        <div className="flex h-[52px] shrink-0 items-center justify-between px-5">
          <span className="text-[15px] font-semibold text-text-primary">
            {editHost ? t('conn.titleEdit') : t('conn.titleNew')}
          </span>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={closeDrawer}
            className="flex size-[24px] items-center justify-center rounded-[4px] text-text-dim hover:bg-bg-elevated hover:text-text-strong"
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          <div>
            <label className={label} htmlFor="conn-name">
              {t('conn.name')}
            </label>
            <input
              id="conn-name"
              className={inputCls}
              placeholder={t('conn.namePlaceholder')}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              maxLength={100}
            />
            <div className={helper}>{t('conn.nameHelper')}</div>
          </div>

          <div>
            <label className={label} htmlFor="conn-address">
              {t('conn.address')}
            </label>
            <input
              id="conn-address"
              className={`${inputCls} font-mono`}
              placeholder={t('conn.addressPlaceholder')}
              value={form.address}
              onChange={(e) => set({ address: e.target.value })}
              maxLength={255}
            />
            <div className={helper}>{t('conn.addressHelper')}</div>
          </div>

          <div className="flex gap-3">
            <div className="w-[90px] shrink-0">
              <label className={label} htmlFor="conn-port">
                {t('conn.port')}
              </label>
              <input
                id="conn-port"
                className={`${inputCls} font-mono`}
                value={form.port}
                onChange={(e) => set({ port: e.target.value.replace(/[^0-9]/g, '') })}
                inputMode="numeric"
                maxLength={5}
              />
            </div>
            <div className="min-w-0 flex-1">
              <label className={label} htmlFor="conn-username">
                {t('conn.username')}
              </label>
              <input
                id="conn-username"
                className={`${inputCls} font-mono`}
                placeholder={t('conn.usernamePlaceholder')}
                value={form.username}
                onChange={(e) => set({ username: e.target.value })}
                maxLength={64}
              />
            </div>
          </div>
          <div className={`${helper} -mt-2`}>{t('conn.usernameHelper')}</div>

          <div>
            <span className={label}>{t('conn.auth')}</span>
            <div className="flex rounded-[7px] bg-bg-base p-[3px]" role="tablist">
              {(['password', 'key'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={form.authMethod === m}
                  onClick={() => set({ authMethod: m })}
                  className={
                    form.authMethod === m
                      ? 'h-[28px] flex-1 rounded-[3px] bg-bg-elevated-2 text-[12.5px] font-medium text-text-strong'
                      : 'h-[28px] flex-1 rounded-[3px] text-[12.5px] text-text-dim hover:text-text-muted'
                  }
                >
                  {m === 'password' ? t('conn.authPassword') : t('conn.authKey')}
                </button>
              ))}
            </div>
          </div>

          {form.authMethod === 'password' ? (
            <div>
              <label className={label} htmlFor="conn-secret">
                {t('conn.password')}
              </label>
              <input
                id="conn-secret"
                type="password"
                className={inputCls}
                value={form.secret}
                onChange={(e) => set({ secret: e.target.value })}
                maxLength={1024}
                autoComplete="off"
              />
              <div className={helper}>
                {hasSavedSecret ? t('conn.passwordSavedHelper') : t('conn.passwordHelper')}
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className={label} htmlFor="conn-keypath">
                  {t('conn.keyPath')}
                </label>
                <div className="flex gap-2">
                  <input
                    id="conn-keypath"
                    className={`${inputCls} min-w-0 flex-1 font-mono`}
                    value={form.keyPath}
                    onChange={(e) => set({ keyPath: e.target.value })}
                    maxLength={500}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void window.lucidSSH.pickKeyFile().then((p) => {
                        if (p) set({ keyPath: p });
                      });
                    }}
                    className="h-[34px] shrink-0 rounded-[4px] bg-bg-elevated-2 px-3 text-[12px] text-text-body hover:text-text-strong"
                  >
                    {t('conn.browse')}
                  </button>
                </div>
                <div className={helper}>{t('conn.keyPathHelper')}</div>
              </div>
              <div>
                <label className={label} htmlFor="conn-passphrase">
                  {t('conn.passphrase')}
                </label>
                <input
                  id="conn-passphrase"
                  type="password"
                  className={inputCls}
                  value={form.secret}
                  onChange={(e) => set({ secret: e.target.value })}
                  maxLength={1024}
                  autoComplete="off"
                />
                <div className={helper}>
                  {hasSavedSecret ? t('conn.passwordSavedHelper') : t('conn.passphraseHelper')}
                </div>
              </div>
            </>
          )}

          <div>
            <label className={label} htmlFor="conn-group">
              {t('conn.group')}
            </label>
            <select
              id="conn-group"
              className={`${inputCls} appearance-none`}
              value={form.groupId}
              onChange={(e) => set({ groupId: e.target.value })}
            >
              <option value="">{t('conn.groupNone')}</option>
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="rounded-[6px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger-text">
              {t('conn.saveError')}
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t border-border-hairline px-5 py-4">
          <button
            type="button"
            disabled={!valid || saving}
            onClick={() => void submit()}
            className="h-9 w-full rounded-[6px] bg-accent text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
      </aside>
    </div>
  );
}
