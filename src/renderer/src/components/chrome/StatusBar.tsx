import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessions } from '@/stores/sessions';

/**
 * Статус-бар 24px, фон #0B0B0F (Design_Brief §3.1):
 * слева — крипто активной сессии (SSH-2 · шифр · тип ключа), справа — версия +
 * «локально». Данные берутся из лога соединения (CLOG), без секретов.
 */

function formatKeyType(k: string): string {
  const t = k.replace(/^ssh-/, '');
  if (t.startsWith('ecdsa')) return 'ECDSA';
  if (t.startsWith('ed25519')) return 'Ed25519';
  if (t.startsWith('rsa')) return 'RSA';
  if (t.startsWith('dss')) return 'DSA';
  return t.toUpperCase();
}

export function StatusBar(): JSX.Element {
  const { t } = useTranslation();
  const { sessions, activeSessionId } = useSessions();
  const [version, setVersion] = useState('');
  const [crypto, setCrypto] = useState<{ cipher: string; keyType: string } | null>(null);

  useEffect(() => {
    void window.lucidSSH.getAppInfo().then((info) => setVersion(info.version));
  }, []);

  const active = sessions.find((s) => s.sessionId === activeSessionId);
  const connected = active?.status === 'connected';

  // Крипто активной сессии из лога соединения (CLOG): шифр handshake + тип ключа
  useEffect(() => {
    if (!active || !connected) {
      setCrypto(null);
      return;
    }
    void window.lucidSSH.getConnectionLog(active.sessionId).then((log) => {
      const hs = log.find((e) => e.messageKey === 'clog.handshake');
      const hk = log.find((e) => e.messageKey === 'clog.hostkeyReceived');
      const cipher = hs?.params?.['cipher'];
      const keyType = hk?.params?.['keyType'];
      if (typeof cipher === 'string' && typeof keyType === 'string') {
        setCrypto({ cipher: cipher.toUpperCase(), keyType: formatKeyType(keyType) });
      } else {
        setCrypto(null);
      }
    });
  }, [active, connected]);

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border-default bg-bg-base-deep px-3 font-mono text-[11.5px] text-text-muted">
      <div className="flex items-center gap-[10px]">
        {crypto && <span>{`SSH-2 · ${crypto.cipher} · ${crypto.keyType}`}</span>}
      </div>
      <span>
        {version ? t('statusBar.version', { version }) : ''}
        {version ? ' · ' : ''}
        {t('statusBar.local')}
      </span>
    </footer>
  );
}
