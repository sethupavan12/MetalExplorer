import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { explainProcessWithAi } from './ai';
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
}
