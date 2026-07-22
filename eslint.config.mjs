import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'docs/**', 'Design backup/**', 'private/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // CLAUDE.md §2: без any без явной причины в комментарии
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true }]
    }
  },
  {
    // Только renderer — main/preload не React. Берём вручную только два
    // классических правила плагина: остальные (react-hooks/purity,
    // set-state-in-effect, immutability и т.п.) — из набора для React Compiler,
    // рассчитаны на кодовую базу, уже приведённую под них, и на существующем
    // коде дают ~100 несвязанных срабатываний.
    //
    // rules-of-hooks: 'error' ловит вызов хука после условного return
    // (найдено 22.07.2026, NewConnectionDrawer — валило всё приложение чёрным
    // экраном на любое открытие/закрытие дровера).
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
);
