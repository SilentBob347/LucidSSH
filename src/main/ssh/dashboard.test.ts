import { describe, expect, it } from 'vitest';
import { parseMetricsForTest } from './dashboard';

describe('parseMetrics (DASH-02)', () => {
  it('парсит полный набор метрик', () => {
    const out =
      'CPU 42\nRAM 1536 4096\nDISK 66\nUP 1234567\nLOAD 0.42 0.51 0.48\nNET 1.2 8.4\n' +
      'PROC 1234 root nginx 12.5 3.1\nPROC 5678 www-data php-fpm 8.0 5.5\n';
    expect(parseMetricsForTest(out)).toEqual({
      cpuPercent: 42,
      ramUsedMb: 1536,
      ramTotalMb: 4096,
      diskPercent: 66,
      uptimeSeconds: 1234567,
      loadAvg1: 0.42,
      loadAvg5: 0.51,
      loadAvg15: 0.48,
      netUpKbps: 1.2,
      netDownKbps: 8.4,
      topProcesses: [
        { pid: 1234, user: 'root', cmd: 'nginx', cpuPercent: 12.5, memPercent: 3.1 },
        { pid: 5678, user: 'www-data', cmd: 'php-fpm', cpuPercent: 8.0, memPercent: 5.5 }
      ]
    });
  });

  it('клампит проценты в 0..100', () => {
    const m = parseMetricsForTest('CPU 150\nDISK -5\n');
    expect(m.cpuPercent).toBe(100);
    expect(m.diskPercent).toBe(0);
  });

  it('отсутствующие строки → null/пустой массив (DASH-05)', () => {
    const m = parseMetricsForTest('CPU 10\n');
    expect(m.cpuPercent).toBe(10);
    expect(m.ramUsedMb).toBeNull();
    expect(m.diskPercent).toBeNull();
    expect(m.uptimeSeconds).toBeNull();
    expect(m.loadAvg1).toBeNull();
    expect(m.netUpKbps).toBeNull();
    expect(m.topProcesses).toEqual([]);
  });

  it('пустой вывод → все null, процессы — пустой массив', () => {
    const m = parseMetricsForTest('');
    expect(m).toEqual({
      cpuPercent: null,
      ramUsedMb: null,
      ramTotalMb: null,
      diskPercent: null,
      uptimeSeconds: null,
      loadAvg1: null,
      loadAvg5: null,
      loadAvg15: null,
      netUpKbps: null,
      netDownKbps: null,
      topProcesses: []
    });
  });

  it('мусорные значения → null, не NaN', () => {
    const m = parseMetricsForTest('CPU abc\nRAM x y\nLOAD a b c\nNET x y\n');
    expect(m.cpuPercent).toBeNull();
    expect(m.ramUsedMb).toBeNull();
    expect(m.loadAvg1).toBeNull();
    expect(m.netUpKbps).toBeNull();
  });

  it('строку PROC с нечисловым cpu/mem пропускает, не ломая остальные метрики', () => {
    const m = parseMetricsForTest('CPU 10\nPROC 1 root sshd bad bad\nPROC 2 root cron 1.0 0.5\n');
    expect(m.cpuPercent).toBe(10);
    expect(m.topProcesses).toEqual([
      { pid: 2, user: 'root', cmd: 'cron', cpuPercent: 1.0, memPercent: 0.5 }
    ]);
  });

  it('вызов parseMetrics дважды не делит общий массив topProcesses (нет утечки состояния)', () => {
    const m1 = parseMetricsForTest('PROC 1 root a 1 1\n');
    const m2 = parseMetricsForTest('');
    expect(m1.topProcesses).toHaveLength(1);
    expect(m2.topProcesses).toHaveLength(0);
  });
});
