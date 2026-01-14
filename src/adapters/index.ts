// Import built-in adapters to register them
import './claude.js';
import './codex.js';

// Initialize custom adapters and hot-reload
import { initializeCustomAdapters, startWatching, adapterEvents } from './watcher.js';

const { count, errors } = initializeCustomAdapters();
if (count > 0 || errors > 0) {
  console.log(`[adapters] Loaded ${count} custom adapter(s)${errors > 0 ? ` (${errors} error(s))` : ''}`);
}
startWatching();

// Re-export utilities
export { getAdapter, getAvailableAdapters, registerAdapter, getAdapterNames, hasAdapter } from './base.js';
export type { AgentAdapter, SpawnArgs } from './base.js';
export { adapterEvents } from './watcher.js';
