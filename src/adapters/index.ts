// Import adapters to register them
import './claude.js';
import './codex.js';

// Re-export utilities
export { getAdapter, getAvailableAdapters, registerAdapter } from './base.js';
export type { AgentAdapter } from './base.js';
