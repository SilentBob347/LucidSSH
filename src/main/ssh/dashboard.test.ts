import { describe, expect, it } from 'vitest';
import { parseMetricsForTest } from './dashboard';

describe('parseMetrics (DASH-02)', () => {
  it('парсит полный набор метрик', () => {
    const out = 'CPU 42\nRAM 1536 4096\nDISK 66\nUP 1234567\n';
    expect(parseMetricsForTest(out)).toEqual({
      cpuPercent: 42,
      ramUsedMb: 1536,
      ramTotalMb: 4096,
      diskPercent: 66,
      uptimeSeconds: 1234567
    });
  });

  it('клампит проценты в 0..100', () => {
    const m = parseMetricsForTest('CPU 150\nDISK -5\n');
    expect(m.cpuPercent).toBe(100);
    expect(m.diskPercent).toBe(0);
  });

  it('отсутствующие строки → null (DASH-05)', () => {
    const m = parseMetricsForTest('CPU 10\n');
    expect(m.cpuPercent).toBe(10);
    expect(m.ramUsedMb).toBeNull();
    expect(m.diskPercent).toBeNull();
    expect(m.uptimeSeconds).toBeNull();
  });

  it('пустой вывод → все null', () => {
    const m = parseMetricsForTest('');
    expect(m).toEqual({
      cpuPercent: null,
      ramUsedMb: null,
      ramTotalMb: null,
      diskPercent: null,
      uptimeSeconds: null
    });
  });

  it('мусорные значения → null, не NaN', () => {
    const m = parseMetricsForTest('CPU abc\nRAM x y\n');
    expect(m.cpuPercent).toBeNull();
    expect(m.ramUsedMb).toBeNull();
  });
});
