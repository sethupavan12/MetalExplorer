import { BrowserWindow, Menu, Notification, Tray, app, clipboard, dialog, ipcMain, nativeImage, nativeTheme, screen, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { execFile } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { explainProcessWithAi, redactCommandForAi } from './ai';
import { sessionsNeedingInput } from './agents';
import { Sampler } from './sampler';
import { getAiSettings, getSettings, updateSettings } from './settings';
import { isAllowedLocalHttpUrl } from './url-guards';
import type { AgentSessionStatus, AppSettings, MenuCommand, ProcessSnapshot, SettingsUpdate, TerminateTarget, ThemeName } from '../shared/types';

const sampler = new Sampler({
  agentInsights: () => getSettings().agentUsage,
  intervalMs: () => getSettings().refreshMs,
  onSnapshot: handleSnapshot
});

let mainWindow: BrowserWindow | null = null;
const agentStatuses = new Map<string, AgentSessionStatus>();
let rendererReady = false;
let pendingCommand: MenuCommand | null = null;
let tray: Tray | null = null;
let trayTimer: NodeJS.Timeout | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => showMainWindow());

app.setAboutPanelOptions({
  applicationName: 'MetalExplorer',
  applicationVersion: app.getVersion(),
  copyright: 'MIT License',
  credits: 'Local-first process, network, and coding agent monitor for macOS.'
});

function createWindow(): void {
  const bounds = readWindowBounds();
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1320,
    height: bounds?.height ?? 860,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'MetalExplorer',
    backgroundColor: '#00000000',
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', () => saveWindowBounds());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  rendererReady = false;
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLocalHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function showMainWindow(command?: MenuCommand): void {
  if (!mainWindow) {
    createWindow();
  }
  if (mainWindow?.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow?.show();
  mainWindow?.focus();
  if (command) {
    if (rendererReady) {
      mainWindow?.webContents.send('menu:command', command);
    } else {
      // Delivered once the renderer subscribes; a window that is still loading would drop it.
      pendingCommand = command;
    }
  }
}

app.whenReady().then(() => {
  applyTheme(getSettings().theme);
  registerIpcHandlers();
  buildMenu();
  // Prime the sampler so the first screen already has measured CPU and network deltas.
  void sampler.sample().catch(() => undefined);
  createWindow();
  syncBackground(getSettings());

  app.on('activate', () => showMainWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function sendCommand(command: MenuCommand): void {
  showMainWindow(command);
}

function buildMenu(): void {
  const navigate = (label: string, view: string, accelerator: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => sendCommand({ type: 'navigate', view })
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => sendCommand({ type: 'navigate', view: 'settings' }) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find', accelerator: 'Cmd+F', click: () => sendCommand({ type: 'find' }) }
      ]
    },
    {
      label: 'View',
      submenu: [
        navigate('Overview', 'overview', 'Cmd+1'),
        navigate('Agents', 'agents', 'Cmd+2'),
        navigate('Processes', 'processes', 'Cmd+3'),
        navigate('Services', 'services', 'Cmd+4'),
        navigate('Network', 'network', 'Cmd+5'),
        navigate('Cleanup', 'cleanup', 'Cmd+6'),
        { type: 'separator' },
        { label: 'Command Palette…', accelerator: 'Cmd+K', click: () => sendCommand({ type: 'command-palette' }) },
        { label: 'Refresh Now', accelerator: 'Cmd+R', click: () => sendCommand({ type: 'refresh' }) },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'Ctrl+Cmd+S', click: () => sendCommand({ type: 'toggle-sidebar' }) },
        { label: 'Toggle Inspector', accelerator: 'Alt+Cmd+I', click: () => sendCommand({ type: 'toggle-inspector' }) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions])
      ]
    },
    {
      label: 'Process',
      submenu: [{ label: 'Stop Selected…', accelerator: 'Cmd+Backspace', click: () => sendCommand({ type: 'stop-selected' }) }]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Safety and Privacy',
          click: () => void shell.openExternal('https://github.com/sethupavan12/metalexplorer/blob/main/docs/SAFETY_AND_PRIVACY.md')
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers(): void {
  ipcMain.on('menu:ready', (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    rendererReady = true;
    if (pendingCommand) {
      event.sender.send('menu:command', pendingCommand);
      pendingCommand = null;
    }
  });
  ipcMain.handle('processes:list', () => sampler.sample());
  ipcMain.handle('processes:history', (_event, pid: unknown) => sampler.history(requirePid(pid)));
  ipcMain.handle('processes:terminate', (_event, targets: unknown) => {
    if (!Array.isArray(targets) || targets.length > 200) {
      throw new Error('Expected a list of processes to stop.');
    }
    return sampler.terminate(targets.map(requireTerminateTarget));
  });
  ipcMain.handle('external:open', (_event, url: unknown) => {
    if (typeof url !== 'string' || !isAllowedLocalHttpUrl(url)) {
      throw new Error('Only local http URLs can be opened from process ports.');
    }
    return shell.openExternal(url);
  });
  ipcMain.handle('agents:reveal', async (_event, sessionId: unknown) => {
    const session = typeof sessionId === 'string' ? sampler.findAgent(sessionId) : null;
    if (!session?.cwd || !isPlainFolder(session.cwd)) {
      return false;
    }
    return (await shell.openPath(session.cwd)) === '';
  });
  ipcMain.handle('agents:focus', (_event, sessionId: unknown) => {
    const session = typeof sessionId === 'string' ? sampler.findAgent(sessionId) : null;
    const appPath = session?.host?.appPath;
    if (!appPath || !appPath.endsWith('.app') || !isDirectory(appPath)) {
      return false;
    }
    return new Promise<boolean>((resolve) => execFile('/usr/bin/open', ['-a', appPath], (error) => resolve(!error)));
  });
  ipcMain.handle('clipboard:write', (_event, text: unknown) => {
    if (typeof text === 'string' && text.length <= 10_000) {
      clipboard.writeText(text);
    }
  });
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:update', (_event, update: unknown) => {
    const next = updateSettings(sanitizeSettingsUpdate(update));
    applyTheme(next.theme);
    syncBackground(next);
    return next;
  });
  ipcMain.handle('ai:explain', (_event, pid: unknown) => {
    const processInfo = sampler.findProcess(requirePid(pid));
    if (!processInfo) {
      throw new Error('That process is no longer in the latest sample.');
    }
    return explainProcessWithAi(processInfo, getAiSettings());
  });
  ipcMain.handle('diagnostics:export', (_event, pid: unknown) => exportDiagnostics(requirePid(pid)));
}

function requirePid(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Invalid process id.');
  }
  return value;
}

function requireTerminateTarget(value: unknown): TerminateTarget {
  const target = value as Partial<TerminateTarget> | null;
  if (!target || typeof target !== 'object' || typeof target.command !== 'string' || typeof target.startedAt !== 'number' || !Number.isFinite(target.startedAt)) {
    throw new Error('Invalid stop request.');
  }
  return { pid: requirePid(target.pid), startedAt: Math.round(target.startedAt), command: target.command };
}

function sanitizeSettingsUpdate(value: unknown): SettingsUpdate {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const input = value as Record<string, unknown>;
  const update: SettingsUpdate = {};
  if (typeof input.baseUrl === 'string') update.baseUrl = input.baseUrl;
  if (typeof input.model === 'string') update.model = input.model;
  if (typeof input.refreshMs === 'number') update.refreshMs = input.refreshMs;
  if (typeof input.rememberApiKey === 'boolean') update.rememberApiKey = input.rememberApiKey;
  if (typeof input.theme === 'string') update.theme = input.theme as ThemeName;
  if (typeof input.agentUsage === 'boolean') update.agentUsage = input.agentUsage;
  if (typeof input.menuBarMonitor === 'boolean') update.menuBarMonitor = input.menuBarMonitor;
  if (typeof input.agentNotifications === 'boolean') update.agentNotifications = input.agentNotifications;
  if (typeof input.apiKey === 'string') update.apiKey = input.apiKey;
  if (input.clearApiKey === true) update.clearApiKey = true;
  return update;
}

/** A real folder, not an `.app` or other bundle that Finder would launch instead of showing. */
function isPlainFolder(path: string): boolean {
  return isDirectory(path) && !/\.(app|pkg|mpkg|bundle|framework|plugin|kext|prefPane|appex|xpc)\/?$/i.test(path);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function applyTheme(theme: ThemeName): void {
  nativeTheme.themeSource = theme === 'system' ? 'system' : theme === 'light' ? 'light' : 'dark';
}

/**
 * Background sampling for the optional menu bar monitor and agent notifications. It runs only while the app is open,
 * only when one of those features is on, and never starts at login.
 */
function syncBackground(settings: AppSettings): void {
  if (settings.menuBarMonitor && !tray) {
    tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip('MetalExplorer');
    tray.setTitle('ME');
    if (sampler.latest) updateTray(sampler.latest);
  } else if (!settings.menuBarMonitor && tray) {
    tray.destroy();
    tray = null;
  }

  if (trayTimer) {
    clearInterval(trayTimer);
    trayTimer = null;
  }
  if (settings.menuBarMonitor || settings.agentNotifications) {
    const tick = (): void => void sampler.sample(settings.refreshMs).catch(() => undefined);
    tick();
    trayTimer = setInterval(tick, Math.max(3000, settings.refreshMs));
  }
}

function handleSnapshot(snapshot: ProcessSnapshot): void {
  if (tray) updateTray(snapshot);

  const needing = sessionsNeedingInput(agentStatuses, snapshot.agents);
  const settings = getSettings();
  if (!settings.agentNotifications || !Notification.isSupported() || mainWindow?.isFocused()) {
    return;
  }
  for (const session of needing.slice(0, 3)) {
    const notification = new Notification({
      title: `${session.title ?? session.projectName} needs your input`,
      body: `${session.label}${session.host ? ` in ${session.host.name}` : ''}${session.tty ? ` · ${session.tty}` : ''}`,
      silent: false
    });
    notification.on('click', () => showMainWindow({ type: 'focus-agent', sessionId: session.id }));
    notification.show();
  }
}

function updateTray(snapshot: ProcessSnapshot): void {
  if (!tray) {
    return;
  }

  const working = snapshot.agents.filter((session) => session.status === 'working').length;
  const cpu = Math.round(snapshot.system.cpuUsagePercent);
  tray.setTitle(snapshot.agents.length ? ` ${working}/${snapshot.agents.length} agents · ${cpu}%` : ` ${cpu}% CPU`, { fontType: 'monospacedDigit' });

  const statusGlyph = { working: '●', waiting: '◐', idle: '○' } as const;
  const agentItems: MenuItemConstructorOptions[] = snapshot.agents.slice(0, 20).map((session) => ({
    label: `${statusGlyph[session.status]}  ${session.label} · ${session.title ?? session.projectName}   ${session.cpuPercent.toFixed(0)}%`,
    click: () => showMainWindow({ type: 'focus-agent', sessionId: session.id })
  }));

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `CPU ${cpu}% · Memory ${formatGb(snapshot.system.memoryUsedBytes)} of ${formatGb(snapshot.system.memoryTotalBytes)}`, enabled: false },
      { type: 'separator' },
      ...(agentItems.length ? [{ label: 'Coding agents', enabled: false } as MenuItemConstructorOptions, ...agentItems] : [{ label: 'No coding agents running', enabled: false }]),
      { type: 'separator' },
      { label: 'Open MetalExplorer', click: () => showMainWindow() },
      { label: 'Quit MetalExplorer', role: 'quit' }
    ])
  );
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function readWindowBounds(): WindowBounds | null {
  try {
    const bounds = JSON.parse(readFileSync(windowStatePath(), 'utf8')) as WindowBounds;
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
    });
    return visible && bounds.width >= 960 && bounds.height >= 600 ? bounds : null;
  } catch {
    return null;
  }
}

function saveWindowBounds(): void {
  if (!mainWindow || mainWindow.isFullScreen() || mainWindow.isMinimized()) {
    return;
  }
  try {
    writeFileSync(windowStatePath(), JSON.stringify(mainWindow.getBounds()), { mode: 0o600 });
  } catch {
    // Window placement is a convenience; failing to save it is harmless.
  }
}

async function exportDiagnostics(pid: number): Promise<{ ok: boolean; message: string; path?: string }> {
  const processInfo = sampler.findProcess(pid);
  if (!processInfo) {
    return { ok: false, message: 'That process is no longer in the latest sample.' };
  }

  const safeName = processInfo.name.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 48) || 'process';
  const options = {
    title: 'Export Classification Report',
    defaultPath: `metalexplorer-${safeName}-${processInfo.pid}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return { ok: false, message: 'Classification report export canceled.' };
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'MetalExplorer',
    version: app.getVersion(),
    process: {
      pid: processInfo.pid,
      ppid: processInfo.ppid,
      name: processInfo.name,
      user: processInfo.user,
      category: processInfo.category,
      confidence: processInfo.confidence,
      riskLevel: processInfo.riskLevel,
      description: processInfo.description,
      tags: processInfo.tags,
      evidence: processInfo.evidence,
      safeToTerminate: processInfo.safeToTerminate,
      cleanCandidate: processInfo.cleanCandidate,
      impactScore: processInfo.impactScore,
      cpuPercent: processInfo.cpuPercent,
      cpuTimeSeconds: processInfo.cpuTimeSeconds,
      memoryMb: Math.round(processInfo.rssKb / 1024),
      uptimeSeconds: processInfo.uptimeSeconds,
      command: redactCommandForAi(processInfo.command),
      provenance: { ...processInfo.provenance, commandPreview: redactCommandForAi(processInfo.provenance.commandPreview) },
      serviceGroup: processInfo.serviceGroup,
      ports: processInfo.ports,
      network: {
        usage: processInfo.network,
        connections: processInfo.networkConnections.map((connection) => ({
          remoteAddress: connection.remoteAddress,
          remotePort: connection.remotePort,
          service: connection.service,
          remoteScope: connection.remoteScope,
          direction: connection.direction,
          encryptedLikely: connection.encryptedLikely
        }))
      }
    }
  };

  await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, message: `Classification report exported to ${result.filePath}.`, path: result.filePath };
}
