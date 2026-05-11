import { contextBridge, ipcRenderer } from 'electron';
import type {
  AiExplanation,
  AppSettings,
  MetalExplorerApi,
  ProcessInfo,
  ProcessSnapshot,
  SettingsUpdate,
  TerminateResult
} from '../shared/types';

const api: MetalExplorerApi = {
  listProcesses: () => ipcRenderer.invoke('processes:list') as Promise<ProcessSnapshot>,
  terminateProcess: (pid: number) => ipcRenderer.invoke('processes:terminate', pid) as Promise<TerminateResult>,
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url) as Promise<void>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  updateSettings: (update: SettingsUpdate) => ipcRenderer.invoke('settings:update', update) as Promise<AppSettings>,
  explainProcess: (process: ProcessInfo) => ipcRenderer.invoke('ai:explain', process) as Promise<AiExplanation>
};

contextBridge.exposeInMainWorld('metalExplorer', api);
