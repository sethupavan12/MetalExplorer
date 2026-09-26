import type { MemoryPressure } from '../shared/types';

export interface MemoryStats {
  usedBytes: number;
  wiredBytes: number;
  compressedBytes: number;
}

/**
 * Mirrors Activity Monitor's "Memory Used": app memory (anonymous minus purgeable) + wired + compressed.
 */
export function parseVmStat(output: string): MemoryStats | null {
  const pageSize = Number.parseInt(output.match(/page size of (\d+) bytes/)?.[1] ?? '', 10);
  if (!Number.isFinite(pageSize)) {
    return null;
  }

  const pages = (label: string): number => {
    const match = output.match(new RegExp(`${label}:\\s+(\\d+)`));
    return match ? Number.parseInt(match[1], 10) : 0;
  };

  const anonymous = pages('Anonymous pages');
  const purgeable = pages('Pages purgeable');
  const wired = pages('Pages wired down');
  const compressed = pages('Pages occupied by compressor');
  const appPages = anonymous ? Math.max(0, anonymous - purgeable) : pages('Pages active');

  return {
    usedBytes: (appPages + wired + compressed) * pageSize,
    wiredBytes: wired * pageSize,
    compressedBytes: compressed * pageSize
  };
}

export function parsePressureLevel(value: string): MemoryPressure {
  const level = Number.parseInt(value.trim(), 10);
  if (level === 1) {
    return 'normal';
  }
  if (level === 2) {
    return 'warning';
  }
  if (level === 4) {
    return 'critical';
  }
  return 'unknown';
}

/** Parses `vm.swapusage` output such as `total = 2048.00M  used = 1202.88M  free = 845.12M  (encrypted)`. */
export function parseSwapUsage(value: string): number {
  const match = value.match(/used = ([\d.]+)([KMGT])/);
  if (!match) {
    return 0;
  }

  const units: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  return Math.round(Number.parseFloat(match[1]) * units[match[2]]);
}
