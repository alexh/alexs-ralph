import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getConfigPaths, loadCustomAdapters } from './loader.js';
import { registerAdapter } from './base.js';

export const adapterEvents = new EventEmitter();

interface WatcherState {
  watchers: fs.FSWatcher[];
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

const state: WatcherState = {
  watchers: [],
  debounceTimer: null,
};

const DEBOUNCE_MS = 500;

/**
 * Start watching adapter config directories for changes.
 */
export function startWatching(): void {
  stopWatching();

  const paths = getConfigPaths();

  for (const dir of paths) {
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        continue;
      }
    }

    try {
      const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
        if (!filename) return;

        const ext = path.extname(filename).toLowerCase();
        if (ext !== '.yaml' && ext !== '.yml' && ext !== '.json') return;

        // Debounce reload
        if (state.debounceTimer) {
          clearTimeout(state.debounceTimer);
        }

        state.debounceTimer = setTimeout(() => {
          reloadAdapters();
        }, DEBOUNCE_MS);
      });

      state.watchers.push(watcher);
    } catch (err) {
      console.warn(`[adapters] Could not watch ${dir}: ${err}`);
    }
  }
}

/**
 * Stop watching adapter config directories.
 */
export function stopWatching(): void {
  for (const watcher of state.watchers) {
    watcher.close();
  }
  state.watchers = [];

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
}

/**
 * Reload all custom adapters and update registry.
 */
function reloadAdapters(): void {
  const { adapters, errors } = loadCustomAdapters();

  // Log errors but don't block
  for (const { file, error } of errors) {
    console.warn(`[adapter] ${file}: ${error}`);
    adapterEvents.emit('error', { file, error });
  }

  // Update registry with new adapters
  for (const [name, adapter] of adapters) {
    registerAdapter(adapter);
  }

  adapterEvents.emit('reload', { count: adapters.size, errors: errors.length });
}

/**
 * Initial load of custom adapters.
 */
export function initializeCustomAdapters(): { count: number; errors: number } {
  const { adapters, errors } = loadCustomAdapters();

  for (const { file, error } of errors) {
    console.warn(`[adapter] ${file}: ${error}`);
  }

  for (const [, adapter] of adapters) {
    registerAdapter(adapter);
  }

  return { count: adapters.size, errors: errors.length };
}
