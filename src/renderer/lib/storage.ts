import { useEffect, useState } from 'react';
import { DEFAULT_RULES, type UserRules } from './model';

/** Per-viewer UI preferences only. Process data and history are never written here. */
const PREFIX = 'metalexplorer.';

export function readPreference<T>(key: string, fallback: T, validate: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writePreference(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Preferences are a convenience; storage can be unavailable.
  }
}

export function usePreference<T>(key: string, fallback: T, validate: (value: unknown) => value is T): [T, (value: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readPreference(key, fallback, validate));
  useEffect(() => writePreference(key, value), [key, value]);
  return [value, setValue];
}

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function isUserRules(value: unknown): value is UserRules {
  if (!value || typeof value !== 'object') return false;
  const rules = value as Partial<UserRules>;
  return (
    ['balanced', 'focus', 'deep-dev', 'strict'].includes(rules.preset as string) &&
    Array.isArray(rules.keep) &&
    rules.keep.every((item) => typeof item === 'string') &&
    Array.isArray(rules.flag) &&
    rules.flag.every((item) => typeof item === 'string')
  );
}

/** Removes data written by earlier versions that persisted per-process resource history. */
export function migrateLegacyStorage(): void {
  try {
    window.localStorage.removeItem('metalexplorer.trends.v1');
    const legacyRules = window.localStorage.getItem('metalexplorer.rules.v1');
    if (legacyRules && window.localStorage.getItem(`${PREFIX}rules`) === null) {
      const parsed: unknown = JSON.parse(legacyRules);
      window.localStorage.setItem(`${PREFIX}rules`, JSON.stringify(isUserRules(parsed) ? parsed : DEFAULT_RULES));
    }
    window.localStorage.removeItem('metalexplorer.rules.v1');
  } catch {
    // Nothing to migrate.
  }
}
