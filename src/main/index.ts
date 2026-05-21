import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { explainProcessWithAi, redactCommandForAi } from './ai';
import { collectProcessSnapshot, terminateProcessByPid } from './processes';
import { getAiSettings, getSettings, updateSettings } from './settings';
import { isAllowedLocalHttpUrl } from './url-guards';
import type { ProcessInfo, SettingsUpdate } from '../shared/types';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: 'MetalExplorer',
    backgroundColor: '#0a0c0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLocalHttpUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIpcHandlers(): void {
  ipcMain.handle('processes:list', () => collectProcessSnapshot());
  ipcMain.handle('processes:terminate', (_event, pid: number) => terminateProcessByPid(pid));
  ipcMain.handle('external:open', (_event, url: string) => {
    if (!isAllowedLocalHttpUrl(url)) {
      throw new Error('Only local http URLs can be opened from process ports.');
    }

    return shell.openExternal(url);
  });
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:update', (_event, update: SettingsUpdate) => updateSettings(update));
  ipcMain.handle('ai:explain', (_event, processInfo: ProcessInfo) => explainProcessWithAi(processInfo, getAiSettings()));
  ipcMain.handle('diagnostics:export', (_event, processInfo: ProcessInfo) => exportDiagnostics(processInfo));
}

async function exportDiagnostics(processInfo: ProcessInfo): Promise<{ ok: boolean; message: string; path?: string }> {
  const safeName = processInfo.name.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 48) || 'process';
  const result = await dialog.showSaveDialog({
    title: 'Export Classification Report',
    defaultPath: `metalexplorer-${safeName}-${processInfo.pid}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, message: 'Classification report export canceled.' };
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'MetalExplorer',
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
      memoryMb: Math.round(processInfo.rssKb / 1024),
      uptimeSeconds: processInfo.uptimeSeconds,
      command: redactCommandForAi(processInfo.command),
      provenance: processInfo.provenance,
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

  await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { ok: true, message: `Classification report exported to ${result.filePath}.`, path: result.filePath };
}
