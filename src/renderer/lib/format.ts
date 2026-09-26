import type { NetworkUsage } from '../../shared/types';

export function formatBytes(value: number, digits = 1): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let scaled = value;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  const precision = index === 0 ? 0 : scaled >= 100 ? 0 : digits;
  return `${scaled.toFixed(precision)} ${units[index]}`;
}

export function formatKb(kb: number): string {
  return formatBytes(kb * 1024);
}

export function formatRate(bps: number | null, status?: NetworkUsage['status']): string {
  if (bps === null) {
    return status === 'measuring' ? 'Measuring' : '-';
  }
  if (bps === 0) {
    return '0 B/s';
  }
  return `${formatBytes(bps)}/s`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)}%`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '-';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

/** Formats CPU time like Activity Monitor: `1:02:03.45` or `12.34`. */
export function formatCpuTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0.00';
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const secText = secs.toFixed(2).padStart(5, '0');
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${secText}`;
  }
  if (minutes) {
    return `${minutes}:${secText}`;
  }
  return secs.toFixed(2);
}

export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  if (value < 1000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  }
  if (value < 1_000_000_000) {
    return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 2 : 1)}M`;
  }
  return `${(value / 1_000_000_000).toFixed(2)}B`;
}

export function formatRelativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) {
    return '-';
  }
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) {
    return '-';
  }
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 5) {
    return 'just now';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  return `${formatDuration(seconds)} ago`;
}

export function formatClock(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? '-' : time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function shortenPath(path: string | null, home?: string): string {
  if (!path) {
    return '-';
  }
  const userHome = home ?? path.match(/^\/Users\/[^/]+/)?.[0];
  return userHome && path.startsWith(userHome) ? `~${path.slice(userHome.length)}` : path;
}

/** Keeps the start and the meaningful end of long paths: `/Volumes/…/projects/MetalExplorer`. */
export function compactPath(path: string | null, maxLength = 42): string {
  const short = shortenPath(path);
  if (short.length <= maxLength) return short;
  const parts = short.split('/');
  const tail = parts.slice(-2).join('/');
  const head = parts.slice(0, parts[0] === '' ? 2 : 1).join('/');
  const compact = `${head}/…/${tail}`;
  return compact.length <= maxLength + 8 ? compact : `…/${parts.at(-1)}`;
}
