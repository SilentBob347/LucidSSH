import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let locale = 'ru-RU';
let appPath = '';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => appPath,
    getLocale: () => locale
  }
}));

async function freshLanguages(): Promise<typeof import('./languages')> {
  vi.resetModules();
  return import('./languages');
}

beforeEach(() => {
  // localesDir() резолвится от appPath/assets/locales — используем реальную
  // директорию проекта, чтобы listLanguages() видела настоящие ru/en.
  appPath = resolve(fileURLToPath(import.meta.url), '../../../..');
  locale = 'ru-RU';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectSystemLanguage', () => {
  it('системная локаль ru-RU → ru', async () => {
    locale = 'ru-RU';
    const { detectSystemLanguage } = await freshLanguages();
    expect(detectSystemLanguage()).toBe('ru');
  });

  it('системная локаль en-US → en', async () => {
    locale = 'en-US';
    const { detectSystemLanguage } = await freshLanguages();
    expect(detectSystemLanguage()).toBe('en');
  });

  it('неподдерживаемая локаль (de-DE) → откат на DEFAULT_LANGUAGE (ru)', async () => {
    locale = 'de-DE';
    const { detectSystemLanguage, DEFAULT_LANGUAGE } = await freshLanguages();
    expect(detectSystemLanguage()).toBe(DEFAULT_LANGUAGE);
  });

  it('app.getLocale() возвращает не-строку — не падает, откат на DEFAULT_LANGUAGE', async () => {
    locale = undefined as unknown as string; // .split() на undefined бросит TypeError
    const { detectSystemLanguage, DEFAULT_LANGUAGE } = await freshLanguages();
    expect(detectSystemLanguage()).toBe(DEFAULT_LANGUAGE);
  });
});
