import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ipcBackend } from './ipc-backend';

export async function initRendererI18n(): Promise<void> {
  const language = await window.lucidSSH.i18nGetLanguage();
  await i18next
    .use(ipcBackend)
    .use(initReactI18next)
    .init({
      lng: language,
      // ru → en; остальные языки при неполном переводе падают на ru (CLAUDE.md §5a)
      fallbackLng: { ru: ['en'], default: ['ru'] },
      ns: ['common'],
      defaultNS: 'common',
      interpolation: { escapeValue: false }, // React экранирует сам
      react: { useSuspense: false }
    });
}
