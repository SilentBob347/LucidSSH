/**
 * Fuzzy-подбор имени команды при `command not found` (ERR-07). Расстояние
 * Левенштейна между введённым именем команды и именами из каталога команд
 * (`commands.core.json`, технические, не переводятся — см. shared/content.ts).
 */

/**
 * Расстояние Левенштейна с добавлением перестановки соседних символов как
 * одной правки (Дамерау-Левенштейн, restricted/OSA-вариант). Без этого самая
 * частая опечатка — перестановка двух букв (`sl` вместо `ls`) — считалась бы
 * за 2 правки и наравне с несвязанными командами (`cd`, `cp`), даже теми, что
 * ближе не по смыслу, а случайно совпали по расстоянию. Имена команд короткие,
 * полная O(m·n) матрица без оптимизации памяти — не проблема производительности.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        d[i - 1]![j]! + 1, // удаление
        d[i]![j - 1]! + 1, // вставка
        d[i - 1]![j - 1]! + cost // замена
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, d[i - 2]![j - 2]! + 1); // перестановка соседних символов
      }
      d[i]![j] = value;
    }
  }
  return d[m]![n]!;
}

/** Первое (командное) слово строки — то, что shell пытался запустить. */
export function extractCommandName(command: string): string {
  return command.trim().split(/\s+/)[0] ?? '';
}

/**
 * До `maxCandidates` имён команд на минимальном расстоянии Левенштейна
 * (≤ `maxDistance`, по ТЗ ERR-07 — 2) от `commandName`. Пусто, если ничего
 * не уложилось в порог. Учитывается только минимальный найденный ярус —
 * более дальние совпадения (напр. `cd`/`cp` на дистанции 2 от `sl`, когда
 * `ls` уже нашлась на дистанции 1) в кандидаты не попадают независимо от
 * `maxDistance`. На коротких именах (2 буквы) минимальный ярус иногда
 * содержит несвязанные по смыслу тай-варианты (`sl` → `ls` и `ss` — обе
 * ровно на дистанции 1) — это ожидаемое поведение, ERR-07 явно требует
 * показывать такие тай-варианты, а не отфильтровывать их.
 */
export function findCommandSuggestions(
  commandName: string,
  catalogNames: string[],
  maxDistance = 2,
  maxCandidates = 3
): string[] {
  if (!commandName) return [];

  let bestDistance = maxDistance;
  let candidates: string[] = [];

  for (const name of catalogNames) {
    if (name === commandName) continue;
    const distance = levenshteinDistance(commandName, name);
    if (distance > bestDistance) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      candidates = [name];
    } else {
      candidates.push(name);
    }
  }

  return candidates.slice(0, maxCandidates);
}
