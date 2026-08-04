/**
 * Разбор release notes GitHub-релиза (electron-updater `info.releaseNotes`)
 * на секции `## RU` / `## EN`. Формат маркеров — новое соглашение (согласовано
 * в чате при проработке темы «changelog при обновлении», НЕ описано в
 * Release_and_Update_Strategy.md §6.1 — тот пункт лишь требует «обновить
 * примечания к выпуску», без формата). Разработчику нужно вручную писать
 * release notes в этом формате начиная со следующего релиза; при желании
 * зафиксировать это в §6.1 — отдельная правка документа. Без markdown-
 * библиотеки — только построчный разбор списков `- пункт`.
 */

const SECTION_HEADER = /^##\s*(ru|en)\s*$/i;

/** Возвращает пункты изменений для языка `lang`, с фолбэком на другой язык. */
export function parseReleaseNotes(text: string | undefined, lang: 'ru' | 'en'): string[] {
  if (!text || !text.trim()) return [];

  const lines = text.split('\n');
  const sections = new Map<'ru' | 'en', string[]>();
  let current: 'ru' | 'en' | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const header = SECTION_HEADER.exec(line);
    if (header) {
      current = header[1]!.toLowerCase() as 'ru' | 'en';
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current && line) sections.get(current)!.push(line);
  }

  if (sections.size === 0) return [text.trim()];

  const target = sections.get(lang) ?? sections.get(lang === 'ru' ? 'en' : 'ru') ?? [];
  return target.map((line) => line.replace(/^[-*]\s*/, ''));
}
