// Initialize adapters (bundled + custom) and hot-reload
import { initializeCustomAdapters, startWatching, adapterEvents } from './watcher.js';

const { count, errors } = initializeCustomAdapters();
if (errors > 0) {
  console.log(`[adapters] Loaded ${count} adapter(s) with ${errors} error(s)`);
}
startWatching();

// Re-export utilities
export { getAdapter, getAvailableAdapters, registerAdapter, getAdapterNames, hasAdapter } from './base.js';
export type { AgentAdapter, SpawnArgs } from './base.js';
export { adapterEvents } from './watcher.js';
