import React from 'react';
import { createRoot } from 'react-dom/client';
// Шрифты забандлены локально (Inter + JetBrains Mono, латиница+кириллица) —
// рантайм не тянет их из сети (SEC-07). Соответствует финальному дизайну.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/cyrillic-500.css';
import '@fontsource/inter/cyrillic-600.css';
import '@fontsource/inter/cyrillic-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/cyrillic-400.css';
import '@fontsource/jetbrains-mono/cyrillic-500.css';
import '@fontsource/jetbrains-mono/cyrillic-600.css';
import '@fontsource/jetbrains-mono/cyrillic-700.css';
import App from './App';
import { initRendererI18n } from './i18n';
import { initTerminalBuffer } from './stores/terminalBuffer';
import './styles/global.css';

async function bootstrap(): Promise<void> {
  // Подписка на терминальный вывод — до первого рендера, чтобы не терять
  // ранние данные сессии (приветствие shell).
  initTerminalBuffer();
  await initRendererI18n();
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('#root not found');
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
