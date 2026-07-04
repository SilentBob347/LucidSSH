import React from 'react';
import { createRoot } from 'react-dom/client';
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
