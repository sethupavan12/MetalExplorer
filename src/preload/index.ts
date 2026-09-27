import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { MenuCommand, MetalExplorerApi } from '../shared/types';

const api: MetalExplorerApi = {
  vibrancy: process.platform === 'darwin',
  listProcesses: () => ipcRenderer.invoke('processes:list'),
  getProcessHistory: (pid) => ipcRenderer.invoke('processes:history', pid),
  terminateProcesses: (targets) => ipcRenderer.invoke('processes:terminate', targets),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  revealAgentFolder: (sessionId) => ipcRenderer.invoke('agents:reveal', sessionId),
  focusAgentHost: (sessionId) => ipcRenderer.invoke('agents:focus', sessionId),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (update) => ipcRenderer.invoke('settings:update', update),
  explainProcess: (pid) => ipcRenderer.invoke('ai:explain', pid),
  exportDiagnostics: (pid) => ipcRenderer.invoke('diagnostics:export', pid),
  onMenuCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: MenuCommand): void => listener(command);
    ipcRenderer.on('menu:command', handler);
    ipcRenderer.send('menu:ready');
    return () => {
      ipcRenderer.removeListener('menu:command', handler);
    };
  }
};

contextBridge.exposeInMainWorld('metalExplorer', api);
