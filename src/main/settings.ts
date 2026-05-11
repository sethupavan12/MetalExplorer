import { app, safeStorage } from 'electron';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { AppSettings, SettingsUpdate, ThemeName } from '../shared/types';

interface StoredSettings {
  baseUrl: string;
  model: string;
  refreshMs: number;
  rememberApiKey: boolean;
  theme: ThemeName;
  encryptedApiKey?: string;
}

const DEFAULT_SETTINGS: StoredSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  refreshMs: 3000,
  rememberApiKey: false,
  theme: 'light'
};

let memoryApiKey = '';

export function getSettings(): AppSettings {
  const stored = readStoredSettings();

  return {
    baseUrl: stored.baseUrl,
    model: stored.model,
    refreshMs: stored.refreshMs,
    rememberApiKey: stored.rememberApiKey,
    theme: stored.theme,
    hasApiKey: Boolean(memoryApiKey || stored.encryptedApiKey),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  };
}

export function getAiSettings(): AppSettings & { apiKey?: string } {
  const settings = getSettings();
  const stored = readStoredSettings();
  const apiKey = memoryApiKey || decryptApiKey(stored.encryptedApiKey);
  return { ...settings, apiKey };
}

export function updateSettings(update: SettingsUpdate): AppSettings {
  const previous = readStoredSettings();
  const next: StoredSettings = {
    baseUrl: normalizeBaseUrl(update.baseUrl ?? previous.baseUrl),
    model: sanitizeString(update.model ?? previous.model, DEFAULT_SETTINGS.model),
    refreshMs: clampRefresh(update.refreshMs ?? previous.refreshMs),
    rememberApiKey: update.rememberApiKey ?? previous.rememberApiKey,
    theme: normalizeTheme(update.theme ?? previous.theme),
    encryptedApiKey: previous.encryptedApiKey
  };

  if (update.clearApiKey) {
    memoryApiKey = '';
    next.encryptedApiKey = undefined;
  }

  if (typeof update.apiKey === 'string' && update.apiKey.trim()) {
    memoryApiKey = update.apiKey.trim();
  }

  if (next.rememberApiKey && memoryApiKey) {
    next.encryptedApiKey = encryptApiKey(memoryApiKey);
  }

  if (!next.rememberApiKey) {
    next.encryptedApiKey = undefined;
  }

  writeStoredSettings(next);
  return getSettings();
}

function readStoredSettings(): StoredSettings {
  const path = settingsPath();

  if (!existsSync(path)) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredSettings>;
    return {
      baseUrl: normalizeBaseUrl(parsed.baseUrl ?? DEFAULT_SETTINGS.baseUrl),
      model: sanitizeString(parsed.model ?? DEFAULT_SETTINGS.model, DEFAULT_SETTINGS.model),
      refreshMs: clampRefresh(parsed.refreshMs ?? DEFAULT_SETTINGS.refreshMs),
      rememberApiKey: Boolean(parsed.rememberApiKey),
      theme: normalizeTheme(parsed.theme),
      encryptedApiKey: typeof parsed.encryptedApiKey === 'string' ? parsed.encryptedApiKey : undefined
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStoredSettings(settings: StoredSettings): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), { mode: 0o600 });

  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort. The OS user data directory still owns the file.
  }
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function encryptApiKey(apiKey: string): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) {
    return undefined;
  }

  return safeStorage.encryptString(apiKey).toString('base64');
}

function decryptApiKey(encryptedApiKey?: string): string | undefined {
  if (!encryptedApiKey || !safeStorage.isEncryptionAvailable()) {
    return undefined;
  }

  try {
    return safeStorage.decryptString(Buffer.from(encryptedApiKey, 'base64'));
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = sanitizeString(value, DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, '');

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : DEFAULT_SETTINGS.baseUrl;
  } catch {
    return DEFAULT_SETTINGS.baseUrl;
  }
}

function sanitizeString(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function clampRefresh(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.refreshMs;
  }

  return Math.min(30000, Math.max(1000, Math.round(value)));
}

function normalizeTheme(value: unknown): ThemeName {
  return value === 'light' || value === 'dark' || value === 'matrix' ? value : DEFAULT_SETTINGS.theme;
}
