import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Строгая локальная CSP (SEC-05, §6 Security_Guide).
 * В dev-режиме vite/react-refresh требуют inline-скрипты и ws-подключение HMR,
 * поэтому CSP ослабляется ТОЛЬКО для dev; в production — строгая.
 */
function cspPlugin(): Plugin {
  return {
    name: 'lucidssh-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const dev = ctx.server !== undefined;
        const csp = dev
          ? [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self' ws://localhost:* http://localhost:*",
              "img-src 'self' data:",
              "font-src 'self' data:",
              "object-src 'none'",
              "frame-src 'none'"
            ].join('; ')
          : [
              "default-src 'none'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self'",
              "img-src 'self' data:",
              "font-src 'self' data:",
              "object-src 'none'",
              "frame-src 'none'",
              "base-uri 'none'",
              "form-action 'none'"
            ].join('; ');
        return html.replace(
          '<!--CSP-->',
          `<meta http-equiv="Content-Security-Policy" content="${csp}">`
        );
      }
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') }
    }
  },
  renderer: {
    plugins: [react(), tailwindcss(), cspPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
});
