import type { MetalExplorerApi } from '../shared/types';

declare global {
  interface Window {
    metalExplorer: MetalExplorerApi;
  }
}

export {};
